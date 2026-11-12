import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ACTIVE_BOOKING_STATUSES, type ApiError, type EventWaitlistResponse, type WaitlistEntry } from "@flightplan/shared";
import { canEdit, eventAccess, forbidden } from "../access.js";
import { db, schema } from "../db/index.js";
import { sendWaitlistOffer } from "../email/notifications.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { waitlistOrder } from "../waitlist.js";

const { bookings, events, eventTables, vendorInvites, vendors, waitlistEntries } = schema;

const idSchema = z.uuid();
const notFound = (what = "Event") => ({ error: `${what} not found` }) satisfies ApiError;

/** A show (not a template) the user can at least view, with their access. */
async function findShow(id: string, userId: string) {
  if (!idSchema.safeParse(id).success) return null;
  const access = await eventAccess(id, userId);
  if (!access) return null;
  const [event] = await db.select({ id: events.id, status: events.status }).from(events).where(eq(events.id, id));
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

class LeftWaitlistError extends Error {}

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

    const [rows, [tables], [held]] = await Promise.all([
      db
        .select({ entry: waitlistEntries, invite: vendorInvites, bannedAt: vendors.bannedAt })
        .from(waitlistEntries)
        .innerJoin(vendors, eq(vendors.id, waitlistEntries.vendorId))
        .leftJoin(vendorInvites, eq(vendorInvites.id, waitlistEntries.inviteId))
        .where(eq(waitlistEntries.eventId, event.id))
        .orderBy(asc(waitlistEntries.createdAt), asc(waitlistEntries.id)),
      db.select({ n: sql<number>`count(*)::int` }).from(eventTables).where(eq(eventTables.eventId, event.id)),
      // At most one active booking per table (unique index), so this counts held tables
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.eventId, event.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]))),
    ]);

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
      openTables: tables.n - held.n,
      totalTables: tables.n,
    };
    return c.json(body);
  })

  // Offer a table: email the vendor a personal, single-use booking link
  .post("/:id/waitlist/:entryId/offer", async (c) => {
    const event = await findShow(c.req.param("id"), c.var.user.id);
    if (!event) return c.json(notFound(), 404);
    if (!canEdit(event.access)) return c.json(forbidden("offer tables"), 403);
    const found = await findEntry(event.id, c.req.param("entryId"));
    if (!found) return c.json(notFound("Waitlist entry"), 404);
    const { entry, invite } = found;
    if (entry.status === "booked" || entry.status === "removed") {
      return c.json<ApiError>({ error: `${entry.name} isn't on the waitlist any more.` }, 409);
    }
    if (entry.status === "offered" && liveOffer(invite)) {
      return c.json<ApiError>({ error: `${entry.name} already has a booking link. Withdraw it first to send a new one.` }, 409);
    }

    let created: { id: string; token: string };
    try {
      created = await db.transaction(async (tx) => {
        const [link] = await tx
          .insert(vendorInvites)
          .values({ eventId: event.id, name: entry.name, email: entry.email })
          .returning({ id: vendorInvites.id, token: vendorInvites.token });
        // Only if nobody else booked or removed them in the meantime
        const [updated] = await tx
          .update(waitlistEntries)
          .set({ status: "offered", offeredAt: new Date(), inviteId: link.id })
          .where(and(eq(waitlistEntries.id, entry.id), inArray(waitlistEntries.status, ["waiting", "offered"])))
          .returning({ id: waitlistEntries.id });
        if (!updated) throw new LeftWaitlistError();
        return link;
      });
    } catch (err) {
      if (err instanceof LeftWaitlistError) return c.json<ApiError>({ error: `${entry.name} isn't on the waitlist any more.` }, 409);
      throw err;
    }

    await sendWaitlistOffer(entry.id, created.token, { name: c.var.user.name, email: c.var.user.email });
    return c.json({ ok: true, link: `/invite/${created.token}` });
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
