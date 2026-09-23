import { Hono } from "hono";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  ACTIVE_BOOKING_STATUSES,
  addDays,
  vendorBookingSchema,
  type ApiError,
  type BookingSource,
  type PublicBookingPage,
  type PublicBookingResult,
  type PublicRequestStatus,
} from "@flightplan/shared";
import { createBookings, findOrCreateVendor, TableTakenError } from "../bookings.js";
import { db, schema } from "../db/index.js";
import { notifyRequestCreated } from "../email/notifications.js";
import { uploadUrl } from "../uploads.js";

const { bookings, eventDays, events, eventTables, user, vendorInvites } = schema;

// Tokens are 32 hex characters
const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/);
const notFound = { error: "This booking link isn't valid" } satisfies ApiError;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type EventRow = typeof events.$inferSelect;

/** Resolve a booking link to its event (and invite, for personal links). */
async function resolve(kind: "event" | "invite", token: string) {
  if (!tokenSchema.safeParse(token).success) return null;

  if (kind === "event") {
    const [event] = await db.select().from(events).where(eq(events.bookingToken, token));
    // Public links only work for published shows
    if (!event || event.status !== "published") return null;
    return { event, invite: null };
  }

  const [row] = await db
    .select({ invite: vendorInvites, event: events })
    .from(vendorInvites)
    .innerJoin(events, eq(events.id, vendorInvites.eventId))
    .where(eq(vendorInvites.token, token));
  // Invites also work for drafts, so organizers can line up vendors before publishing
  if (!row || row.event.status === "template") return null;
  return row;
}

/** Why a vendor can't book right now, or null if they can. */
function closedReason(
  event: EventRow,
  endDate: string | null,
  invite: typeof vendorInvites.$inferSelect | null,
): string | null {
  if (!event.startDate || !endDate) return "This show isn't scheduled yet.";
  if (endDate < todayISO()) return "This show has already happened.";
  if (invite) {
    if (invite.revokedAt) return "This invite link has been cancelled. Please contact the organizer.";
    if (invite.bookingId) return "This invite link has already been used to book a table.";
    return null;
  }
  if (!event.bookingOpen) return "Table booking isn't open for this show yet. Please check back later.";
  return null;
}

async function loadPage(kind: "event" | "invite", token: string) {
  const found = await resolve(kind, token);
  if (!found) return null;
  const { event, invite } = found;

  const [days, tables, held] = await Promise.all([
    db
      .select({ dayOffset: eventDays.dayOffset, startTime: eventDays.startTime, endTime: eventDays.endTime })
      .from(eventDays)
      .where(eq(eventDays.eventId, event.id))
      .orderBy(asc(eventDays.dayOffset)),
    db
      .select({ id: eventTables.id, label: eventTables.label })
      .from(eventTables)
      .where(eq(eventTables.eventId, event.id))
      .orderBy(asc(eventTables.number)),
    db
      .select({ tableId: bookings.tableId })
      .from(bookings)
      .where(and(eq(bookings.eventId, event.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]))),
  ]);

  const endDate = event.startDate && days.length ? addDays(event.startDate, Math.max(...days.map((d) => d.dayOffset))) : null;
  const heldIds = new Set(held.map((h) => h.tableId));

  const page: PublicBookingPage = {
    event: {
      name: event.name,
      description: event.description,
      venueName: event.venueName,
      address: event.address,
      city: event.city,
      startDate: event.startDate!,
      days,
      tablePriceCents: event.tablePriceCents,
      requiresApproval: event.requiresApproval,
      paymentDueDays: event.paymentDueDays,
      floorMapUrl: uploadUrl(event.floorMapFile),
      maxTablesPerRequest: event.maxTablesPerRequest,
    },
    tables: tables.map((t) => ({ id: t.id, label: t.label, available: !heldIds.has(t.id) })),
    invite: invite ? { name: invite.name, email: invite.email, used: invite.bookingId !== null } : null,
    closedReason: closedReason(event, endDate, invite),
  };
  return { page, event, invite, tables };
}

class InviteUsedError extends Error {}

function bookingHandlers(kind: "event" | "invite") {
  const source: BookingSource = kind === "event" ? "public_link" : "invite";
  return new Hono()
    .get("/:token", async (c) => {
      const loaded = await loadPage(kind, c.req.param("token"));
      return loaded ? c.json(loaded.page) : c.json(notFound, 404);
    })
    .post("/:token", async (c) => {
      const loaded = await loadPage(kind, c.req.param("token"));
      if (!loaded) return c.json(notFound, 404);
      const { page, event, invite, tables } = loaded;
      if (page.closedReason) return c.json<ApiError>({ error: page.closedReason }, 409);

      const parsed = vendorBookingSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json<ApiError>(
          { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(parsed.error).fieldErrors },
          400,
        );
      }
      const { tableIds, message, ...contact } = parsed.data;
      if (tableIds.length > event.maxTablesPerRequest) {
        return c.json<ApiError>(
          { error: `You can request up to ${event.maxTablesPerRequest} table${event.maxTablesPerRequest > 1 ? "s" : ""} at once.` },
          400,
        );
      }
      const picked = tables.filter((t) => tableIds.includes(t.id));
      if (picked.length !== tableIds.length) return c.json<ApiError>({ error: "Pick tables from the map" }, 400);

      try {
        const rows = await db.transaction(async (tx) => {
          const vendorId = await findOrCreateVendor(tx, event.organizerId, contact);
          // Keep tables in floor order
          const created = await createBookings(tx, {
            event,
            tableIds: picked.map((t) => t.id),
            vendorId,
            contact,
            message,
            source,
          });
          if (invite) {
            // Claim the invite; fails if it was used or cancelled in the meantime
            const claimed = await tx
              .update(vendorInvites)
              .set({ bookingId: created[0].id })
              .where(and(eq(vendorInvites.id, invite.id), isNull(vendorInvites.bookingId), isNull(vendorInvites.revokedAt)))
              .returning({ id: vendorInvites.id });
            if (!claimed.length) throw new InviteUsedError();
          }
          return created;
        });
        // Emails go out in the background once the booking is saved
        void notifyRequestCreated(rows[0].requestId);

        const result: PublicBookingResult = {
          requestId: rows[0].requestId,
          status: rows[0].status,
          tableLabels: picked.map((t) => t.label),
          paymentDueAt: rows[0].paymentDueAt?.toISOString() ?? null,
          paymentInstructions: event.paymentInstructions,
        };
        return c.json(result, 201);
      } catch (err) {
        if (err instanceof TableTakenError) return c.json<ApiError>({ error: err.message }, 409);
        if (err instanceof InviteUsedError) {
          return c.json<ApiError>({ error: "This invite link has already been used to book a table." }, 409);
        }
        throw err;
      }
    });
}

// Public (no sign-in): /api/public/book/:token and /api/public/invite/:token
export const publicRoutes = new Hono().route("/book", bookingHandlers("event")).route("/invite", bookingHandlers("invite"));

// ── Vendor status page: /api/public/request/:requestId ───────────────────
// Linked from every vendor email. The request id is a random UUID known only to the vendor
// (and the organizer), so it works as the page's secret.

const requestIdSchema = z.uuid();

const requestStatusRoutes = new Hono().get("/:requestId", async (c) => {
  const requestId = c.req.param("requestId");
  if (!requestIdSchema.safeParse(requestId).success) return c.json<ApiError>({ error: "Booking not found" }, 404);

  const rows = await db
    .select({ booking: bookings, label: eventTables.label })
    .from(bookings)
    .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
    .where(eq(bookings.requestId, requestId))
    .orderBy(asc(eventTables.number));
  if (!rows.length) return c.json<ApiError>({ error: "Booking not found" }, 404);

  const first = rows[0].booking;
  const [event] = await db.select().from(events).where(eq(events.id, first.eventId));
  const [organizer] = await db.select({ name: user.name }).from(user).where(eq(user.id, event.organizerId));
  const days = await db
    .select({ dayOffset: eventDays.dayOffset, startTime: eventDays.startTime, endTime: eventDays.endTime })
    .from(eventDays)
    .where(eq(eventDays.eventId, event.id))
    .orderBy(asc(eventDays.dayOffset));

  const active = rows.filter((r) => (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(r.booking.status));
  const lead = active[0]?.booking;
  const status: PublicRequestStatus["status"] = lead ? (lead.status as "pending" | "awaiting_payment" | "paid") : "closed";

  const body: PublicRequestStatus = {
    event: {
      name: event.name,
      venueName: event.venueName,
      address: event.address,
      city: event.city,
      startDate: event.startDate!,
      days,
      tablePriceCents: event.tablePriceCents,
      floorMapUrl: uploadUrl(event.floorMapFile),
    },
    organizerName: organizer?.name ?? "",
    vendorName: first.name,
    status,
    closedAs: lead ? null : first.status,
    tableLabels: active.map((r) => r.label),
    paymentDueAt: lead?.paymentDueAt?.toISOString() ?? null,
    overdue: Boolean(lead && lead.status === "awaiting_payment" && lead.paymentDueAt && lead.paymentDueAt.getTime() < Date.now()),
    paymentInstructions: status === "pending" || status === "awaiting_payment" ? event.paymentInstructions : "",
  };
  return c.json(body);
});

publicRoutes.route("/request", requestStatusRoutes);
