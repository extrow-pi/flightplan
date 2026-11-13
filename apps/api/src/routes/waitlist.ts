import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ACTIVE_BOOKING_STATUSES,
  ACTIVE_WAITLIST_STATUSES,
  addWaitlistEntrySchema,
  reorderWaitlistSchema,
  type ApiError,
  type EventWaitlistResponse,
  type WaitlistEntry,
} from "@flightplan/shared";
import { canEdit, eventAccess, forbidden } from "../access.js";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { waitlistOrder } from "../waitlist.js";
import { visibleVendors } from "./bookings.js";

const { bookings, events, eventTables, vendorInvites, vendors, waitlistEntries } = schema;

const idSchema = z.uuid();
const notFound = (what = "Event") => ({ error: `${what} not found` }) satisfies ApiError;
const invalid = (error: z.ZodError) =>
  ({ error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors }) satisfies ApiError;

/** A show (not a template) the user can at least view, with their access. */
async function findShow(id: string, userId: string) {
  if (!idSchema.safeParse(id).success) return null;
  const access = await eventAccess(id, userId);
  if (!access) return null;
  const [event] = await db
    .select({ id: events.id, status: events.status, maxTablesPerRequest: events.maxTablesPerRequest })
    .from(events)
    .where(eq(events.id, id));
  return event && event.status !== "template" ? { ...event, access } : null;
}

/** One of the show's waitlist entries, with its offer link. */
async function findEntry(eventId: string, entryId: string) {
  if (!idSchema.safeParse(entryId).success) return null;
  const [row] = await db
    .select({ entry: waitlistEntries, invite: vendorInvites })
    .from(waitlistEntries)
    .leftJoin(vendorInvites, eq(vendorInvites.id, waitlistEntries.inviteId))
    .where(and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.eventId, eventId)));
  return row ?? null;
}

type InviteRow = typeof vendorInvites.$inferSelect;

/** An offer whose booking link can still be used */
const liveOffer = (invite: InviteRow | null) => Boolean(invite && !invite.revokedAt && !invite.bookingId);

/** Cancel an offer's booking link if it hasn't been used */
const revokeOffer = (inviteId: string | null) =>
  inviteId
    ? db
        .update(vendorInvites)
        .set({ revokedAt: new Date() })
        .where(and(eq(vendorInvites.id, inviteId), isNull(vendorInvites.bookingId), isNull(vendorInvites.revokedAt)))
    : Promise.resolve();

export const waitlistRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  // The show's waitlist (any role)
  .get("/:id/waitlist", async (c) => {
    const event = await findShow(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);

    const [rows, [tables], heldByVendor] = await Promise.all([
      db
        .select({ entry: waitlistEntries, invite: vendorInvites, bannedAt: vendors.bannedAt })
        .from(waitlistEntries)
        .innerJoin(vendors, eq(vendors.id, waitlistEntries.vendorId))
        .leftJoin(vendorInvites, eq(vendorInvites.id, waitlistEntries.inviteId))
        .where(eq(waitlistEntries.eventId, event.id))
        .orderBy(asc(waitlistEntries.sortOrder), asc(waitlistEntries.createdAt), asc(waitlistEntries.id)),
      db.select({ n: sql<number>`count(*)::int` }).from(eventTables).where(eq(eventTables.eventId, event.id)),
      // At most one active booking per table (unique index), so these count held tables
      db
        .select({ vendorId: bookings.vendorId, n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.eventId, event.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])))
        .groupBy(bookings.vendorId),
    ]);
    const tablesByVendor = Object.fromEntries(heldByVendor.map((r) => [r.vendorId, r.n]));
    const held = heldByVendor.reduce((sum, r) => sum + r.n, 0);

    const order = await waitlistOrder(db, event.id);
    const toEntry = ({ entry: e, invite, bannedAt }: (typeof rows)[number]): WaitlistEntry => ({
      id: e.id,
      vendorId: e.vendorId,
      name: e.name,
      businessName: e.businessName,
      email: e.email,
      phone: e.phone,
      message: e.message,
      tablesWanted: e.tablesWanted,
      status: e.status,
      position: order.includes(e.id) ? order.indexOf(e.id) + 1 : null,
      banned: bannedAt !== null,
      createdAt: e.createdAt.toISOString(),
      offeredAt: e.offeredAt?.toISOString() ?? null,
      offerCancelled: e.status === "offered" && !liveOffer(invite),
      closedAt: e.closedAt?.toISOString() ?? null,
    });
    const inLine = rows.filter((r) => r.entry.status === "waiting" || r.entry.status === "offered");
    const done = rows
      .filter((r) => r.entry.status === "booked" || r.entry.status === "removed")
      .sort((a, b) => (b.entry.closedAt?.getTime() ?? 0) - (a.entry.closedAt?.getTime() ?? 0));

    const body: EventWaitlistResponse = {
      entries: [...inLine, ...done].map(toEntry),
      openTables: tables.n - held,
      totalTables: tables.n,
      tablesByVendor,
    };
    return c.json(body);
  })

  // Put someone from the vendor list at the back of the line. Not emailed: an offer emails them later.
  .post("/:id/waitlist", async (c) => {
    const event = await findShow(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("change the waitlist"), 403);
    const parsed = addWaitlistEntrySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { vendorId, tablesWanted, message } = parsed.data;

    const [vendor] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), visibleVendors(event.access, c.var.user.id)));
    if (!vendor) return c.json(notFound("Vendor"), 404);

    const [entry] = await db
      .insert(waitlistEntries)
      .values({
        eventId: event.id,
        vendorId: vendor.id,
        name: vendor.name,
        businessName: vendor.businessName,
        email: vendor.email,
        phone: vendor.phone,
        message,
        tablesWanted: Math.min(tablesWanted, event.maxTablesPerRequest),
      })
      // Already in line (the unique index)
      .onConflictDoNothing()
      .returning({ id: waitlistEntries.id });
    if (!entry) return c.json<ApiError>({ error: `${vendor.businessName || vendor.name} is already on the waitlist.` }, 409);
    return c.json({ id: entry.id }, 201);
  })

  // Change who's next: the full new order of everyone in line
  .put("/:id/waitlist/order", async (c) => {
    const event = await findShow(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("change the waitlist"), 403);
    const parsed = reorderWaitlistSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { entryIds } = parsed.data;

    const changed = await db.transaction(async (tx) => {
      const current = await tx
        .select({ id: waitlistEntries.id, sortOrder: waitlistEntries.sortOrder })
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.eventId, event.id), inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES])))
        .for("update");
      // Someone joined, booked or was removed since the page loaded
      const ids = new Set(current.map((r) => r.id));
      if (entryIds.length !== ids.size || new Set(entryIds).size !== ids.size || !entryIds.every((id) => ids.has(id))) {
        return true;
      }
      // Hand out the same sort values in the new order, so anyone who joins later still goes to the back
      const values = current.map((r) => r.sortOrder).sort((a, b) => a - b);
      for (const [i, id] of entryIds.entries()) {
        await tx.update(waitlistEntries).set({ sortOrder: values[i] }).where(eq(waitlistEntries.id, id));
      }
      return false;
    });
    if (changed) return c.json<ApiError>({ error: "The waitlist changed since you opened it. Refresh and try again." }, 409);
    return c.json({ ok: true });
  })

  // Take back an offer: cancel the link and put the vendor back in line where they were
  .post("/:id/waitlist/:entryId/withdraw", async (c) => {
    const event = await findShow(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("change the waitlist"), 403);
    const found = await findEntry(event.id, c.req.param("entryId"));
    if (!found) return c.json(notFound("Waitlist entry"), 404);
    if (found.entry.status !== "offered") return c.json<ApiError>({ error: "There's no offer to withdraw." }, 409);

    await revokeOffer(found.entry.inviteId);
    await db
      .update(waitlistEntries)
      .set({ status: "waiting", offeredAt: null })
      .where(and(eq(waitlistEntries.id, found.entry.id), eq(waitlistEntries.status, "offered")));
    return c.json({ ok: true });
  })

  // Take a vendor off the waitlist (cancels an unused offer link)
  .delete("/:id/waitlist/:entryId", async (c) => {
    const event = await findShow(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("change the waitlist"), 403);
    const found = await findEntry(event.id, c.req.param("entryId"));
    if (!found) return c.json(notFound("Waitlist entry"), 404);
    if (found.entry.status === "booked" || found.entry.status === "removed") {
      return c.json<ApiError>({ error: `${found.entry.name} isn't on the waitlist any more.` }, 409);
    }

    await revokeOffer(found.entry.inviteId);
    await db
      .update(waitlistEntries)
      .set({ status: "removed", closedAt: new Date() })
      .where(and(eq(waitlistEntries.id, found.entry.id), inArray(waitlistEntries.status, ["waiting", "offered"])));
    return c.body(null, 204);
  });
