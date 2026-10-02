import { Hono } from "hono";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ACTIVE_BOOKING_STATUSES,
  assignTableSchema,
  bulkInviteSchema,
  createInviteSchema,
  keepBookingSchema,
  markPaidSchema,
  setPaymentMethodSchema,
  releaseBookingSchema,
  type ApiError,
  type BookingAlert,
  type BookingStatus,
  type BulkInviteResult,
  type EventTablesResponse,
  type Invite,
} from "@flightplan/shared";
import {
  approvedFields,
  createBookings,
  DiscountCodeError,
  findOrCreateVendor,
  overdueCondition,
  TableTakenError,
  toBooking,
  toVendor,
} from "../bookings.js";
import { db, schema } from "../db/index.js";
import {
  notifyApproved,
  notifyKept,
  notifyPaid,
  notifyRejected,
  notifyReleased,
  notifyRequestCreated,
  sendVendorInvites,
} from "../email/notifications.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import {
  accessibleEvents,
  canEdit,
  collaboratorJoin,
  editableEvents,
  eventAccess,
  forbidden,
  roleOf,
  type Access,
} from "../access.js";

const { bookings, eventCollaborators, eventDays, events, eventTables, vendorGroupMembers, vendorGroups, vendorInvites, vendors } = schema;

const idSchema = z.uuid();
const notFound = (what = "Event") => ({ error: `${what} not found` }) satisfies ApiError;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

/** An event the user can at least view, with its booking settings and the user's access. */
async function findEvent(id: string, userId: string) {
  const access = await eventAccess(id, userId);
  if (!access) return null;
  const [event] = await db
    .select({
      id: events.id,
      organizerId: events.organizerId,
      status: events.status,
      requiresApproval: events.requiresApproval,
      tablePriceCents: events.tablePriceCents,
      paymentDueDays: events.paymentDueDays,
      bulkDiscounts: events.bulkDiscounts,
    })
    .from(events)
    .where(eq(events.id, id));
  return { ...event, access };
}

/**
 * Vendors from the event owner's list that the user may see. Owners see their whole list;
 * collaborators only see vendors who have booked one of that owner's events shared with them.
 */
function visibleVendors(access: Access, userId: string) {
  const ofOwner = eq(vendors.organizerId, access.ownerId);
  if (access.role === "owner") return ofOwner;
  return and(
    ofOwner,
    inArray(
      vendors.id,
      db
        .select({ id: bookings.vendorId })
        .from(bookings)
        .innerJoin(events, eq(events.id, bookings.eventId))
        .where(and(eq(events.organizerId, access.ownerId), accessibleEvents(userId))),
    ),
  );
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

  // Everything the Tables page needs (any role)
  .get("/:id/tables", async (c) => {
    const event = await findEvent(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);

    const [tableRows, bookingRows, inviteRows] = await Promise.all([
      db.select().from(eventTables).where(eq(eventTables.eventId, event.id)).orderBy(asc(eventTables.number)),
      db.select().from(bookings).where(eq(bookings.eventId, event.id)).orderBy(desc(bookings.createdAt)),
      db.select().from(vendorInvites).where(eq(vendorInvites.eventId, event.id)).orderBy(desc(vendorInvites.createdAt)),
    ]);

    const activeByTable = new Map(
      bookingRows.filter((b) => active.includes(b.status as (typeof active)[number])).map((b) => [b.tableId, toBooking(b)]),
    );
    const vendorIds = [...new Set(bookingRows.map((b) => b.vendorId))];
    const flagRows = vendorIds.length
      ? await db
          .select({ id: vendors.id, favourite: vendors.favourite, bannedAt: vendors.bannedAt })
          .from(vendors)
          .where(inArray(vendors.id, vendorIds))
      : [];
    const body: EventTablesResponse = {
      tables: tableRows.map((t) => ({ id: t.id, number: t.number, label: t.label, booking: activeByTable.get(t.id) ?? null })),
      history: bookingRows.filter((b) => !active.includes(b.status as (typeof active)[number])).map(toBooking),
      invites: inviteRows.map(toInvite),
      vendorFlags: Object.fromEntries(flagRows.map((v) => [v.id, { favourite: v.favourite, banned: v.bannedAt !== null }])),
    };
    return c.json(body);
  })

  // Vendors to pick from when assigning a table on this event: the owner's vendor list
  // (or, for collaborators, the part of it they can see)
  .get("/:id/vendors", async (c) => {
    const event = await findEvent(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("assign tables"), 403);
    const rows = await db
      .select()
      .from(vendors)
      .where(visibleVendors(event.access, c.var.user.id))
      .orderBy(desc(vendors.favourite), asc(sql`lower(${vendors.name})`));
    return c.json({ vendors: rows.map(toVendor) });
  })

  // Organizer assigns one or more tables to a vendor as one request (no approval needed)
  .post("/:id/bookings", async (c) => {
    const event = await findEvent(c.req.param("id"), c.var.user.id);
    if (!event || event.status === "template") return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("assign tables"), 403);
    const parsed = assignTableSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const input = parsed.data;

    const found = await db
      .select({ id: eventTables.id })
      .from(eventTables)
      .where(and(inArray(eventTables.id, input.tableIds), eq(eventTables.eventId, event.id)));
    if (found.length !== input.tableIds.length) return c.json(notFound("Table"), 404);

    try {
      const rows = await db.transaction(async (tx) => {
        let vendorId: string;
        let contact;
        if (input.vendorId) {
          const [vendor] = await tx
            .select()
            .from(vendors)
            .where(and(eq(vendors.id, input.vendorId), visibleVendors(event.access, c.var.user.id)));
          if (!vendor) throw new VendorNotFoundError();
          vendorId = vendor.id;
          contact = { name: vendor.name, businessName: vendor.businessName, email: vendor.email, phone: vendor.phone };
        } else {
          contact = input.contact!;
          // Vendors always go in the event owner's list, whoever assigns the table
          vendorId = (await findOrCreateVendor(tx, event.access.ownerId, contact)).id;
        }
        return createBookings(tx, {
          event,
          tableIds: input.tableIds,
          vendorId,
          contact,
          source: "organizer",
          paid: input.paid,
          paymentMethod: input.paid ? input.paymentMethod : null,
          discountCode: input.discountCode || undefined,
        });
      });
      void notifyRequestCreated(rows[0].requestId);
      return c.json({ bookings: rows.map(toBooking) }, 201);
    } catch (err) {
      // Names the taken tables, e.g. "Sorry, tables 4, 5 were just taken"
      if (err instanceof TableTakenError) return c.json<ApiError>({ error: err.message }, 409);
      if (err instanceof VendorNotFoundError) return c.json(notFound("Vendor"), 404);
      if (err instanceof DiscountCodeError) {
        return c.json<ApiError>({ error: err.message, fieldErrors: { discountCode: [err.message] } }, 400);
      }
      throw err;
    }
  })

  // Personal invite link for one vendor
  .post("/:id/invites", async (c) => {
    const event = await findEvent(c.req.param("id"), c.var.user.id);
    if (!event || event.status === "template") return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("create invite links"), 403);
    const parsed = createInviteSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [invite] = await db
      .insert(vendorInvites)
      .values({ eventId: event.id, ...parsed.data })
      .returning();
    return c.json({ invite: toInvite(invite) }, 201);
  });

// Personal invite links for every vendor in one of the owner's groups (or all favourites), emailed
// to them. Skips banned vendors, vendors already holding tables, and vendors with an unused invite.
// Owner only: groups and favourites are part of the owner's own vendor list.
eventBookingRoutes.post("/:id/invites/bulk", async (c) => {
  const event = await findEvent(c.req.param("id"), c.var.user.id);
  if (!event || event.status === "template") return c.json(notFound(), 404);
  if (event.access.role !== "owner") return c.json(forbidden("invite a vendor group. Only the owner can"), 403);
  const parsed = bulkInviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(invalid(parsed.error), 400);
  const { target } = parsed.data;
  const ownerId = event.access.ownerId;

  const inTarget =
    target === "favourites"
      ? and(eq(vendors.organizerId, ownerId), eq(vendors.favourite, true))
      : and(
          eq(vendors.organizerId, ownerId),
          inArray(
            vendors.id,
            db
              .select({ id: vendorGroupMembers.vendorId })
              .from(vendorGroupMembers)
              .innerJoin(vendorGroups, eq(vendorGroups.id, vendorGroupMembers.groupId))
              .where(and(eq(vendorGroups.id, target), eq(vendorGroups.organizerId, ownerId))),
          ),
        );
  const [targets, heldBy, invited] = await Promise.all([
    db.select().from(vendors).where(inTarget).orderBy(asc(sql`lower(${vendors.name})`)),
    db
      .selectDistinct({ vendorId: bookings.vendorId })
      .from(bookings)
      .where(and(eq(bookings.eventId, event.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]))),
    db
      .select({ email: vendorInvites.email })
      .from(vendorInvites)
      .where(and(eq(vendorInvites.eventId, event.id), sql`${vendorInvites.bookingId} is null`, sql`${vendorInvites.revokedAt} is null`)),
  ]);
  const booked = new Set(heldBy.map((b) => b.vendorId));
  const alreadyInvited = new Set(invited.map((i) => i.email.toLowerCase()));

  const result: BulkInviteResult = { invited: 0, skipped: [] };
  const toInvite: (typeof targets)[number][] = [];
  for (const v of targets) {
    const reason = v.bannedAt ? "banned" : booked.has(v.id) ? "booked" : alreadyInvited.has(v.email) ? "invited" : null;
    if (reason) result.skipped.push({ name: v.name, email: v.email, reason });
    else toInvite.push(v);
  }

  if (toInvite.length) {
    const created = await db
      .insert(vendorInvites)
      .values(toInvite.map((v) => ({ eventId: event.id, name: v.name, email: v.email })))
      .returning({ name: vendorInvites.name, email: vendorInvites.email, token: vendorInvites.token });
    result.invited = created.length;

    const [details] = await db
      .select({
        id: events.id,
        name: events.name,
        organizerId: events.organizerId,
        startDate: events.startDate,
        venueName: events.venueName,
        address: events.address,
        city: events.city,
      })
      .from(events)
      .where(eq(events.id, event.id));
    const days = await db
      .select({ dayOffset: eventDays.dayOffset, startTime: eventDays.startTime, endTime: eventDays.endTime })
      .from(eventDays)
      .where(eq(eventDays.eventId, event.id))
      .orderBy(asc(eventDays.dayOffset));
    await sendVendorInvites({
      event: details,
      days,
      organizer: { name: c.var.user.name, email: c.var.user.email },
      invites: created,
    });
  }
  return c.json(result, 201);
});

class VendorNotFoundError extends Error {}

// ── Bookings: /api/bookings/:id/… ────────────────────────────────────────

/** Load a booking (with its event's pricing settings and the user's access) if the user can see its event. */
async function findBooking(id: string, userId: string) {
  if (!idSchema.safeParse(id).success) return null;
  const [row] = await db
    .select({
      booking: bookings,
      event: { tablePriceCents: events.tablePriceCents, paymentDueDays: events.paymentDueDays },
    })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .where(and(eq(bookings.id, id), accessibleEvents(userId)));
  if (!row) return null;
  const access = await eventAccess(row.booking.eventId, userId);
  return access ? { ...row, access } : null;
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
    const found = await findBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    if (!canEdit(found.access)) return c.json(forbidden("change bookings"), 403);
    const rows = await transitionRequest(found.booking.requestId, ["pending"], approvedFields(found.event));
    if (!rows.length) return c.json(cantDo("approve", found.booking.status), 409);
    void notifyApproved(found.booking.requestId);
    return c.json({ bookings: rows.map(toBooking) });
  })

  .post("/:id/reject", async (c) => {
    const found = await findBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    if (!canEdit(found.access)) return c.json(forbidden("change bookings"), 403);
    const rows = await transitionRequest(found.booking.requestId, ["pending"], { status: "rejected", closedAt: new Date() });
    if (!rows.length) return c.json(cantDo("reject", found.booking.status), 409);
    void notifyRejected(found.booking.requestId);
    return c.json({ bookings: rows.map(toBooking) });
  })

  // Optional body: { paymentMethod } to record how they paid
  .post("/:id/mark-paid", async (c) => {
    const found = await findBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    if (!canEdit(found.access)) return c.json(forbidden("change bookings"), 403);
    const parsed = markPaidSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const now = new Date();
    const rows = await transitionRequest(found.booking.requestId, ["pending", "awaiting_payment"], {
      status: "paid",
      approvedAt: found.booking.approvedAt ?? now,
      paidAt: now,
      paymentDueAt: null,
      paymentMethod: parsed.data.paymentMethod,
    });
    if (!rows.length) return c.json(cantDo("mark as paid", found.booking.status), 409);
    void notifyPaid(found.booking.requestId);
    return c.json({ bookings: rows.map(toBooking) });
  })

  // Change (or clear) how a paid request was paid
  .post("/:id/payment-method", async (c) => {
    const found = await findBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    if (!canEdit(found.access)) return c.json(forbidden("change bookings"), 403);
    const parsed = setPaymentMethodSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const rows = await transitionRequest(found.booking.requestId, ["paid"], { paymentMethod: parsed.data.paymentMethod });
    if (!rows.length) return c.json(cantDo("set the payment method of", found.booking.status), 409);
    return c.json({ bookings: rows.map(toBooking) });
  })

  // Free a table (or with { wholeRequest: true }, every table in the request)
  .post("/:id/release", async (c) => {
    const found = await findBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    if (!canEdit(found.access)) return c.json(forbidden("change bookings"), 403);
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
    if (!rows.length) return c.json(cantDo("release", found.booking.status), 409);
    const released = await db
      .select({ label: eventTables.label })
      .from(eventTables)
      .where(
        inArray(
          eventTables.id,
          rows.map((r) => r.tableId),
        ),
      )
      .orderBy(asc(eventTables.number));
    void notifyReleased(
      found.booking.requestId,
      released.map((t) => t.label),
    );
    return c.json({ bookings: rows.map(toBooking) });
  })

  // Keep an unpaid request: extend its deadline by some days, or remove the deadline
  .post("/:id/keep", async (c) => {
    const found = await findBooking(c.req.param("id"), c.var.user.id);
    if (!found) return c.json(notFound("Booking"), 404);
    if (!canEdit(found.access)) return c.json(forbidden("change bookings"), 403);
    const parsed = keepBookingSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { extendDays } = parsed.data;
    const rows = await transitionRequest(found.booking.requestId, ["awaiting_payment"], {
      paymentDueAt: extendDays ? new Date(Date.now() + extendDays * 86_400_000) : null,
      // A new deadline gets its own reminder and overdue notice
      reminderSentAt: null,
      overdueNotifiedAt: null,
    });
    if (!rows.length) return c.json(cantDo("keep", found.booking.status), 409);
    void notifyKept(found.booking.requestId);
    return c.json({ bookings: rows.map(toBooking) });
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
        inArray(vendorInvites.eventId, db.select({ id: events.id }).from(events).where(editableEvents(c.var.user.id))),
      ),
    )
    .returning();
  return row ? c.json({ invite: toInvite(row) }) : c.json(notFound("Invite"), 404);
});

// ── Dashboard alerts: /api/alerts ────────────────────────────────────────

export const alertRoutes = new Hono<AuthEnv>().use(requireUser).get("/", async (c) => {
  const me = c.var.user.id;
  const rows = await db
    .select({
      booking: bookings,
      eventId: events.id,
      eventName: events.name,
      tableLabel: eventTables.label,
      ownerId: events.organizerId,
      collaboratorRole: eventCollaborators.role,
      vendorBannedAt: vendors.bannedAt,
    })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
    .innerJoin(vendors, eq(vendors.id, bookings.vendorId))
    .leftJoin(eventCollaborators, collaboratorJoin(me))
    .where(and(accessibleEvents(me), or(eq(bookings.status, "pending"), overdueCondition)))
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
      role: roleOf(r.ownerId, r.collaboratorRole, me),
      vendorBanned: r.vendorBannedAt !== null,
    });
  }
  const alerts = [...byRequest.values()];
  // Overdue payments first: they need a decision
  alerts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "overdue" ? -1 : 1));
  return c.json({ alerts });
});
