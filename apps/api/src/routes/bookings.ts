import { Hono } from "hono";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ACTIVE_BOOKING_STATUSES,
  assignTableSchema,
  createInviteSchema,
  keepBookingSchema,
  releaseBookingSchema,
  type ApiError,
  type BookingAlert,
  type BookingStatus,
  type EventTablesResponse,
  type Invite,
  type Vendor,
} from "@flightplan/shared";
import {
  approvedFields,
  createBookings,
  findOrCreateVendor,
  overdueCondition,
  TableTakenError,
  toBooking,
} from "../bookings.js";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";

const { bookings, events, eventTables, vendorInvites, vendors } = schema;

const idSchema = z.uuid();
const notFound = (what = "Event") => ({ error: `${what} not found` }) satisfies ApiError;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

async function findOwnedEvent(id: string, organizerId: string) {
  if (!idSchema.safeParse(id).success) return null;
  const [event] = await db
    .select({
      id: events.id,
      status: events.status,
      requiresApproval: events.requiresApproval,
      tablePriceCents: events.tablePriceCents,
      paymentDueDays: events.paymentDueDays,
    })
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizerId, organizerId)));
  return event ?? null;
}

function toInvite(i: typeof vendorInvites.$inferSelect): Invite {
  return {
    id: i.id,
    token: i.token,
    name: i.name,
    email: i.email,
    createdAt: i.createdAt.toISOString(),
    bookingId: i.bookingId,
    revokedAt: i.revokedAt?.toISOString() ?? null,
  };
}

const active = [...ACTIVE_BOOKING_STATUSES];

// ── Per-event: /api/events/:id/… ─────────────────────────────────────────

export const eventBookingRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  // Everything the Tables page needs
  .get("/:id/tables", async (c) => {
    const event = await findOwnedEvent(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);

    const [tableRows, bookingRows, inviteRows] = await Promise.all([
      db.select().from(eventTables).where(eq(eventTables.eventId, event.id)).orderBy(asc(eventTables.number)),
      db.select().from(bookings).where(eq(bookings.eventId, event.id)).orderBy(desc(bookings.createdAt)),
      db.select().from(vendorInvites).where(eq(vendorInvites.eventId, event.id)).orderBy(desc(vendorInvites.createdAt)),
    ]);

    const activeByTable = new Map(
      bookingRows.filter((b) => active.includes(b.status as (typeof active)[number])).map((b) => [b.tableId, toBooking(b)]),
    );
    const body: EventTablesResponse = {
      tables: tableRows.map((t) => ({ id: t.id, number: t.number, label: t.label, booking: activeByTable.get(t.id) ?? null })),
      history: bookingRows.filter((b) => !active.includes(b.status as (typeof active)[number])).map(toBooking),
      invites: inviteRows.map(toInvite),
    };
    return c.json(body);
  })

  // Organizer assigns a table to a vendor (no approval needed)
  .post("/:id/bookings", async (c) => {
    const event = await findOwnedEvent(c.req.param("id"), c.var.user.id);
    if (!event || event.status === "template") return c.json(notFound(), 404);
    const parsed = assignTableSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const input = parsed.data;

    const [table] = await db
      .select({ id: eventTables.id })
      .from(eventTables)
      .where(and(eq(eventTables.id, input.tableId), eq(eventTables.eventId, event.id)));
    if (!table) return c.json(notFound("Table"), 404);

    try {
      const booking = await db.transaction(async (tx) => {
        let vendorId: string;
        let contact;
        if (input.vendorId) {
          const [vendor] = await tx
            .select()
            .from(vendors)
            .where(and(eq(vendors.id, input.vendorId), eq(vendors.organizerId, c.var.user.id)));
          if (!vendor) throw new VendorNotFoundError();
          vendorId = vendor.id;
          contact = { name: vendor.name, businessName: vendor.businessName, email: vendor.email, phone: vendor.phone };
        } else {
          contact = input.contact!;
          vendorId = await findOrCreateVendor(tx, c.var.user.id, contact);
        }
        const [row] = await createBookings(tx, {
          event,
          tableIds: [table.id],
          vendorId,
          contact,
          source: "organizer",
          paid: input.paid,
        });
        return row;
      });
      return c.json({ booking: toBooking(booking) }, 201);
    } catch (err) {
      if (err instanceof TableTakenError) return c.json<ApiError>({ error: "That table is already booked" }, 409);
      if (err instanceof VendorNotFoundError) return c.json(notFound("Vendor"), 404);
      throw err;
    }
  })

  // Personal invite link for one vendor
  .post("/:id/invites", async (c) => {
    const event = await findOwnedEvent(c.req.param("id"), c.var.user.id);
    if (!event || event.status === "template") return c.json(notFound(), 404);
    const parsed = createInviteSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [invite] = await db
      .insert(vendorInvites)
      .values({ eventId: event.id, ...parsed.data })
      .returning();
    return c.json({ invite: toInvite(invite) }, 201);
  });

class VendorNotFoundError extends Error {}

// ── Bookings: /api/bookings/:id/… ────────────────────────────────────────

/** Load a booking (with its event's pricing settings) if it belongs to one of the organizer's events. */
async function findOwnedBooking(id: string, organizerId: string) {
  if (!idSchema.safeParse(id).success) return null;
  const [row] = await db
    .select({
      booking: bookings,
      event: { tablePriceCents: events.tablePriceCents, paymentDueDays: events.paymentDueDays },
    })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .where(and(eq(bookings.id, id), eq(events.organizerId, organizerId)));
  return row ?? null;
}

/**
 * Apply a status change to every booking in a request that's still in one of `from`
 * (tables already released keep their status; also guards against double clicks).
 */
async function transitionRequest(requestId: string, from: BookingStatus[], set: Partial<typeof bookings.$inferInsert>) {
  return db
    .update(bookings)
    .set(set)
    .where(and(eq(bookings.requestId, requestId), inArray(bookings.status, from)))
    .returning();
}

const cantDo = (action: string, status: BookingStatus) =>
  ({ error: `Can't ${action} a booking that is ${status.replace("_", " ")}` }) satisfies ApiError;

// Actions are addressed by any booking in the request. Approve, reject, mark paid and keep apply
// to the whole request (one vendor, one payment); release can free a single table or all of them.
export const bookingRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .post("/:id/approve", async (c) => {
    const found = await findOwnedBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    const rows = await transitionRequest(found.booking.requestId, ["pending"], approvedFields(found.event));
    return rows.length ? c.json({ bookings: rows.map(toBooking) }) : c.json(cantDo("approve", found.booking.status), 409);
  })

  .post("/:id/reject", async (c) => {
    const found = await findOwnedBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    const rows = await transitionRequest(found.booking.requestId, ["pending"], { status: "rejected", closedAt: new Date() });
    return rows.length ? c.json({ bookings: rows.map(toBooking) }) : c.json(cantDo("reject", found.booking.status), 409);
  })

  .post("/:id/mark-paid", async (c) => {
    const found = await findOwnedBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    const now = new Date();
    const rows = await transitionRequest(found.booking.requestId, ["pending", "awaiting_payment"], {
      status: "paid",
      approvedAt: found.booking.approvedAt ?? now,
      paidAt: now,
      paymentDueAt: null,
    });
    return rows.length
      ? c.json({ bookings: rows.map(toBooking) })
      : c.json(cantDo("mark as paid", found.booking.status), 409);
  })

  // Free a table (or with { wholeRequest: true }, every table in the request)
  .post("/:id/release", async (c) => {
    const found = await findOwnedBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    const parsed = releaseBookingSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const set = { status: "released" as const, closedAt: new Date() };
    const active = [...ACTIVE_BOOKING_STATUSES];
    const rows = parsed.data.wholeRequest
      ? await transitionRequest(found.booking.requestId, active, set)
      : await db
          .update(bookings)
          .set(set)
          .where(and(eq(bookings.id, found.booking.id), inArray(bookings.status, active)))
          .returning();
    return rows.length ? c.json({ bookings: rows.map(toBooking) }) : c.json(cantDo("release", found.booking.status), 409);
  })

  // Keep an unpaid request: extend its deadline by some days, or remove the deadline
  .post("/:id/keep", async (c) => {
    const found = await findOwnedBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    const parsed = keepBookingSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { extendDays } = parsed.data;
    const rows = await transitionRequest(found.booking.requestId, ["awaiting_payment"], {
      paymentDueAt: extendDays ? new Date(Date.now() + extendDays * 86_400_000) : null,
    });
    return rows.length ? c.json({ bookings: rows.map(toBooking) }) : c.json(cantDo("keep", found.booking.status), 409);
  });

// ── Invites: /api/invites/:id ────────────────────────────────────────────

export const inviteRoutes = new Hono<AuthEnv>().use(requireUser).delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json(notFound("Invite"), 404);
  // Only unused invites can be revoked; a used one already has a booking to manage instead
  const [row] = await db
    .update(vendorInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(vendorInvites.id, id),
        sql`${vendorInvites.bookingId} is null`,
        inArray(
          vendorInvites.eventId,
          db.select({ id: events.id }).from(events).where(eq(events.organizerId, c.var.user.id)),
        ),
      ),
    )
    .returning();
  return row ? c.json({ invite: toInvite(row) }) : c.json(notFound("Invite"), 404);
});

// ── Dashboard alerts: /api/alerts ────────────────────────────────────────

export const alertRoutes = new Hono<AuthEnv>().use(requireUser).get("/", async (c) => {
  const rows = await db
    .select({ booking: bookings, eventId: events.id, eventName: events.name, tableLabel: eventTables.label })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
    .where(and(eq(events.organizerId, c.var.user.id), or(eq(bookings.status, "pending"), overdueCondition)))
    .orderBy(asc(bookings.paymentDueAt), asc(bookings.createdAt), asc(eventTables.number));

  // One alert per vendor request, listing all of its tables
  const byRequest = new Map<string, BookingAlert>();
  for (const r of rows) {
    const existing = byRequest.get(r.booking.requestId);
    if (existing) {
      existing.tableLabels.push(r.tableLabel);
      continue;
    }
    byRequest.set(r.booking.requestId, {
      kind: r.booking.status === "pending" ? "pending" : "overdue",
      booking: toBooking(r.booking),
      eventId: r.eventId,
      eventName: r.eventName,
      tableLabels: [r.tableLabel],
    });
  }
  const alerts = [...byRequest.values()];
  // Overdue payments first: they need a decision
  alerts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "overdue" ? -1 : 1));
  return c.json({ alerts });
});

// ── Vendor list: /api/vendors ────────────────────────────────────────────

export const vendorRoutes = new Hono<AuthEnv>().use(requireUser).get("/", async (c) => {
  const rows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.organizerId, c.var.user.id))
    .orderBy(asc(sql`lower(${vendors.name})`));
  const list: Vendor[] = rows.map((v) => ({
    id: v.id,
    name: v.name,
    businessName: v.businessName,
    email: v.email,
    phone: v.phone,
    notes: v.notes,
    createdAt: v.createdAt.toISOString(),
  }));
  return c.json({ vendors: list });
});

