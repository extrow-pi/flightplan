import { Hono } from "hono";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  discountCodeSchema,
  type ApiError,
  type BookingStatus,
  type DiscountCode,
  type DiscountCodeUse,
} from "@flightplan/shared";
import { codeStatus, countsAsUse, usesOf } from "../discounts.js";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";

// The organizer's discount codes (the Discounts page). Codes work for the organizer's own shows:
// all of them, or the ones picked. Each code's usage is counted from the bookings that applied it.

const { bookings, discountCodeEvents, discountCodes, events, eventTables } = schema;

const idSchema = z.uuid();
const notFound = { error: "Discount code not found" } satisfies ApiError;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const duplicate = {
  error: "You already have a code with that name",
  fieldErrors: { code: ["Already used"] },
} satisfies ApiError;

async function listCodes(organizerId: string, onlyId?: string): Promise<DiscountCode[]> {
  const where = onlyId
    ? and(eq(discountCodes.organizerId, organizerId), eq(discountCodes.id, onlyId))
    : eq(discountCodes.organizerId, organizerId);
  const rows = await db.select().from(discountCodes).where(where).orderBy(desc(discountCodes.createdAt));
  const ids = rows.map((r) => r.id);
  const [scopes, uses] = await Promise.all([
    ids.length
      ? db.select().from(discountCodeEvents).where(inArray(discountCodeEvents.codeId, ids))
      : Promise.resolve([]),
    usesOf(ids),
  ]);
  return rows.map((r) => {
    const u = uses.get(r.id) ?? { uses: 0, discountCents: 0 };
    return {
      id: r.id,
      code: r.code,
      kind: r.kind,
      value: r.value,
      description: r.description,
      maxUses: r.maxUses,
      expiresOn: r.expiresOn,
      oncePerVendor: r.oncePerVendor,
      active: r.active,
      eventIds: scopes.filter((s) => s.codeId === r.id).map((s) => s.eventId),
      createdAt: r.createdAt.toISOString(),
      uses: u.uses,
      discountGivenCents: u.discountCents,
      status: codeStatus(r, u.uses),
    };
  });
}

/** The organizer's own event ids out of `ids` (codes only work for their own shows) */
async function ownEventIds(ids: string[], organizerId: string) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(inArray(events.id, [...new Set(ids)]), eq(events.organizerId, organizerId)));
  return rows.map((r) => r.id);
}

export const discountCodeRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/", async (c) => c.json({ codes: await listCodes(c.var.user.id) }))

  .post("/", async (c) => {
    const parsed = discountCodeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { eventIds, ...fields } = parsed.data;
    // Look these up before the transaction (PGlite has one connection)
    const scope = await ownEventIds(eventIds, c.var.user.id);
    try {
      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(discountCodes)
          .values({ organizerId: c.var.user.id, ...fields })
          .returning({ id: discountCodes.id });
        if (scope.length) await tx.insert(discountCodeEvents).values(scope.map((eventId) => ({ codeId: row.id, eventId })));
        return row.id;
      });
      const [code] = await listCodes(c.var.user.id, id);
      return c.json({ code }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(duplicate, 409);
      throw err;
    }
  })

  // Full update (same body as create). Past uses keep the discount they got.
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = discountCodeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const [existing] = await db
      .select({ id: discountCodes.id })
      .from(discountCodes)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.organizerId, c.var.user.id)));
    if (!existing) return c.json(notFound, 404);
    const { eventIds, ...fields } = parsed.data;
    const scope = await ownEventIds(eventIds, c.var.user.id);
    try {
      await db.transaction(async (tx) => {
        await tx.update(discountCodes).set(fields).where(eq(discountCodes.id, id));
        await tx.delete(discountCodeEvents).where(eq(discountCodeEvents.codeId, id));
        if (scope.length) await tx.insert(discountCodeEvents).values(scope.map((eventId) => ({ codeId: id, eventId })));
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(duplicate, 409);
      throw err;
    }
    const [code] = await listCodes(c.var.user.id, id);
    return c.json({ code });
  })

  // Deleting a code doesn't change past requests: they keep their discount and label
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const [row] = await db
      .delete(discountCodes)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.organizerId, c.var.user.id)))
      .returning({ id: discountCodes.id });
    return row ? c.body(null, 204) : c.json(notFound, 404);
  })

  // Requests that used the code, newest first
  .get("/:id/uses", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const [code] = await db
      .select({ id: discountCodes.id })
      .from(discountCodes)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.organizerId, c.var.user.id)));
    if (!code) return c.json(notFound, 404);

    const rows = await db
      .select({
        booking: bookings,
        eventName: events.name,
        tableLabel: eventTables.label,
      })
      .from(bookings)
      .innerJoin(events, eq(events.id, bookings.eventId))
      .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
      .where(and(eq(bookings.discountCodeId, id), countsAsUse))
      .orderBy(desc(bookings.createdAt), asc(eventTables.number));

    const byRequest = new Map<string, DiscountCodeUse>();
    const rank: Record<BookingStatus, number> = { paid: 0, awaiting_payment: 1, pending: 2, released: 3, rejected: 4, cancelled: 5 };
    for (const r of rows) {
      const b = r.booking;
      const existing = byRequest.get(b.requestId);
      if (existing) {
        existing.tableLabels.push(r.tableLabel);
        existing.discountCents += b.basePriceCents - b.priceCents;
        existing.totalCents += b.priceCents;
        if (rank[b.status] < rank[existing.status]) existing.status = b.status;
        continue;
      }
      byRequest.set(b.requestId, {
        requestId: b.requestId,
        eventId: b.eventId,
        eventName: r.eventName,
        vendorName: b.businessName ? `${b.name} · ${b.businessName}` : b.name,
        vendorEmail: b.email,
        tableLabels: [r.tableLabel],
        status: b.status,
        discountCents: b.basePriceCents - b.priceCents,
        totalCents: b.priceCents,
        createdAt: b.createdAt.toISOString(),
      });
    }
    return c.json({ uses: [...byRequest.values()] });
  });
