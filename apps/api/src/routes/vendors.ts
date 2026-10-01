import { Hono } from "hono";
import { and, asc, count, countDistinct, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createVendorSchema,
  MAX_VENDOR_GROUPS,
  updateVendorSchema,
  vendorGroupSchema,
  type ApiError,
  type BookingStatus,
  type VendorGroup,
  type VendorListItem,
  type VendorRequestHistory,
} from "@flightplan/shared";
import { toVendor } from "../bookings.js";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";

// The organizer's own vendor list (the Vendors page). Vendors are added automatically when they book
// one of the organizer's shows, or by hand here. Collaborators manage the owner's vendors from each
// show's Tables page; this page only ever shows the signed-in organizer's own list.

const { bookings, eventTables, events, vendorGroupMembers, vendorGroups, vendors } = schema;

const idSchema = z.uuid();
const notFound = (what = "Vendor") => ({ error: `${what} not found` }) satisfies ApiError;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

/** Postgres unique-constraint violation (drizzle wraps the driver error in `cause`) */
const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

async function ownVendor(id: string, organizerId: string) {
  if (!idSchema.safeParse(id).success) return null;
  const [row] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizerId, organizerId)));
  return row ?? null;
}

/** Vendors with their groups and booking stats, favourites first. */
async function listVendors(organizerId: string, onlyId?: string): Promise<VendorListItem[]> {
  const where = onlyId ? and(eq(vendors.organizerId, organizerId), eq(vendors.id, onlyId)) : eq(vendors.organizerId, organizerId);
  const [rows, memberships, stats] = await Promise.all([
    db.select().from(vendors).where(where).orderBy(desc(vendors.favourite), asc(sql`lower(${vendors.name})`)),
    db
      .select({ vendorId: vendorGroupMembers.vendorId, groupId: vendorGroupMembers.groupId })
      .from(vendorGroupMembers)
      .innerJoin(vendorGroups, eq(vendorGroups.id, vendorGroupMembers.groupId))
      .where(eq(vendorGroups.organizerId, organizerId)),
    db
      .select({
        vendorId: bookings.vendorId,
        requests: countDistinct(bookings.requestId),
        shows: countDistinct(bookings.eventId),
        last: max(bookings.createdAt),
      })
      .from(bookings)
      .innerJoin(events, eq(events.id, bookings.eventId))
      .where(eq(events.organizerId, organizerId))
      .groupBy(bookings.vendorId),
  ]);

  const groupsOf = new Map<string, string[]>();
  for (const m of memberships) groupsOf.set(m.vendorId, [...(groupsOf.get(m.vendorId) ?? []), m.groupId]);
  const statsOf = new Map(stats.map((s) => [s.vendorId, s]));

  return rows.map((v) => {
    const s = statsOf.get(v.id);
    return {
      ...toVendor(v),
      banReason: v.banReason,
      bannedAt: v.bannedAt?.toISOString() ?? null,
      groupIds: groupsOf.get(v.id) ?? [],
      requestCount: s?.requests ?? 0,
      showCount: s?.shows ?? 0,
      lastRequestAt: s?.last ? new Date(s.last).toISOString() : null,
    };
  });
}

/** Group ids that belong to the organizer, out of `ids`. */
async function ownGroupIds(ids: string[], organizerId: string) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: vendorGroups.id })
    .from(vendorGroups)
    .where(and(inArray(vendorGroups.id, ids), eq(vendorGroups.organizerId, organizerId)));
  return rows.map((r) => r.id);
}

// ── /api/vendors ─────────────────────────────────────────────────────────

export const vendorRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/", async (c) => c.json({ vendors: await listVendors(c.var.user.id) }))

  // Add a vendor by hand
  .post("/", async (c) => {
    const parsed = createVendorSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const [row] = await db
      .insert(vendors)
      .values({ organizerId: c.var.user.id, ...parsed.data })
      .onConflictDoNothing()
      .returning({ id: vendors.id });
    if (!row) {
      return c.json<ApiError>(
        { error: "That email is already in your vendor list", fieldErrors: { email: ["Already in your vendor list"] } },
        409,
      );
    }
    const [vendor] = await listVendors(c.var.user.id, row.id);
    return c.json({ vendor }, 201);
  })

  // Edit details, favourite, ban and groups
  .patch("/:id", async (c) => {
    const existing = await ownVendor(c.req.param("id"), c.var.user.id);
    if (!existing) return c.json(notFound(), 404);
    const parsed = updateVendorSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { groupIds, banned, banReason, ...fields } = parsed.data;

    const set: Partial<typeof vendors.$inferInsert> = { ...fields };
    if (banned === true) {
      set.bannedAt = existing.bannedAt ?? new Date();
      if (banReason !== undefined) set.banReason = banReason;
    } else if (banned === false) {
      set.bannedAt = null;
      set.banReason = "";
    } else if (banReason !== undefined && existing.bannedAt) {
      set.banReason = banReason;
    }

    // Look this up before the transaction: a query on `db` inside it would wait on the transaction's
    // own connection (and deadlock with PGlite's single connection)
    const valid = groupIds ? await ownGroupIds([...new Set(groupIds)], c.var.user.id) : [];
    try {
      await db.transaction(async (tx) => {
        if (Object.keys(set).length) await tx.update(vendors).set(set).where(eq(vendors.id, existing.id));
        if (groupIds) {
          await tx.delete(vendorGroupMembers).where(eq(vendorGroupMembers.vendorId, existing.id));
          if (valid.length) {
            await tx.insert(vendorGroupMembers).values(valid.map((groupId) => ({ groupId, vendorId: existing.id })));
          }
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json<ApiError>(
          { error: "Another vendor already has that email", fieldErrors: { email: ["Another vendor has this email"] } },
          409,
        );
      }
      throw err;
    }
    const [vendor] = await listVendors(c.var.user.id, existing.id);
    return c.json({ vendor });
  })

  // Every request this vendor has made for the organizer's shows, newest first
  .get("/:id/requests", async (c) => {
    const vendor = await ownVendor(c.req.param("id"), c.var.user.id);
    if (!vendor) return c.json(notFound(), 404);
    const rows = await db
      .select({
        requestId: bookings.requestId,
        eventId: events.id,
        eventName: events.name,
        eventStartDate: events.startDate,
        tableLabel: eventTables.label,
        status: bookings.status,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .innerJoin(events, eq(events.id, bookings.eventId))
      .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
      .where(and(eq(bookings.vendorId, vendor.id), eq(events.organizerId, c.var.user.id)))
      .orderBy(desc(bookings.createdAt), asc(eventTables.number));

    // One entry per request. Its status is that of a table it still holds, if any.
    const byRequest = new Map<string, VendorRequestHistory>();
    const rank: Record<BookingStatus, number> = { paid: 0, awaiting_payment: 1, pending: 2, released: 3, rejected: 4, cancelled: 5 };
    for (const r of rows) {
      const existing = byRequest.get(r.requestId);
      if (existing) {
        existing.tableLabels.push(r.tableLabel);
        if (rank[r.status] < rank[existing.status]) existing.status = r.status;
        continue;
      }
      byRequest.set(r.requestId, {
        requestId: r.requestId,
        eventId: r.eventId,
        eventName: r.eventName,
        eventStartDate: r.eventStartDate,
        tableLabels: [r.tableLabel],
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      });
    }
    return c.json({ requests: [...byRequest.values()] });
  });

// ── /api/vendor-groups ───────────────────────────────────────────────────

async function listGroups(organizerId: string): Promise<VendorGroup[]> {
  return db
    .select({ id: vendorGroups.id, name: vendorGroups.name, vendorCount: count(vendorGroupMembers.vendorId) })
    .from(vendorGroups)
    .leftJoin(vendorGroupMembers, eq(vendorGroupMembers.groupId, vendorGroups.id))
    .where(eq(vendorGroups.organizerId, organizerId))
    .groupBy(vendorGroups.id)
    .orderBy(asc(sql`lower(${vendorGroups.name})`));
}

const duplicateGroup = {
  error: "You already have a group with that name",
  fieldErrors: { name: ["Already used"] },
} satisfies ApiError;

export const vendorGroupRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/", async (c) => c.json({ groups: await listGroups(c.var.user.id) }))

  .post("/", async (c) => {
    const parsed = vendorGroupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const [{ total }] = await db
      .select({ total: count() })
      .from(vendorGroups)
      .where(eq(vendorGroups.organizerId, c.var.user.id));
    if (total >= MAX_VENDOR_GROUPS) return c.json<ApiError>({ error: `You can have up to ${MAX_VENDOR_GROUPS} groups` }, 400);
    try {
      const [group] = await db
        .insert(vendorGroups)
        .values({ organizerId: c.var.user.id, name: parsed.data.name })
        .returning({ id: vendorGroups.id, name: vendorGroups.name });
      return c.json({ group: { ...group, vendorCount: 0 } satisfies VendorGroup }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(duplicateGroup, 409);
      throw err;
    }
  })

  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound("Group"), 404);
    const parsed = vendorGroupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    try {
      const [row] = await db
        .update(vendorGroups)
        .set({ name: parsed.data.name })
        .where(and(eq(vendorGroups.id, id), eq(vendorGroups.organizerId, c.var.user.id)))
        .returning({ id: vendorGroups.id });
      return row ? c.json({ ok: true }) : c.json(notFound("Group"), 404);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(duplicateGroup, 409);
      throw err;
    }
  })

  // Deleting a group removes it from its vendors; the vendors stay
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound("Group"), 404);
    const [row] = await db
      .delete(vendorGroups)
      .where(and(eq(vendorGroups.id, id), eq(vendorGroups.organizerId, c.var.user.id)))
      .returning({ id: vendorGroups.id });
    return row ? c.body(null, 204) : c.json(notFound("Group"), 404);
  });
