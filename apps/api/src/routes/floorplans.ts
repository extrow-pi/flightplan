import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { floorplanInputSchema, type ApiError, type Floorplan } from "@flightplan/shared";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";

// The organizer's floorplan library (the Floorplans page): plans they design and reuse as templates.
// Plans that belong to an event are reached through that event, not here.

const { floorplans } = schema;

const notFound = { error: "Floorplan not found" } satisfies ApiError;

function invalid(error: z.ZodError) {
  // Plan-wide problems (like two tables with the same label) are the most useful message
  const first = error.issues[0]?.message ?? "Please fix the plan";
  return { error: first, fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

export function toFloorplan(row: typeof floorplans.$inferSelect): Floorplan {
  return {
    id: row.id,
    name: row.name,
    units: row.units,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    items: row.items,
    tableCount: row.items.filter((i) => i.kind === "table").length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A library plan owned by this organizer. */
async function ownPlan(id: string, organizerId: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select()
    .from(floorplans)
    .where(and(eq(floorplans.id, id), eq(floorplans.organizerId, organizerId), isNull(floorplans.eventId)));
  return row ?? null;
}

export const floorplanRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/", async (c) => {
    const rows = await db
      .select()
      .from(floorplans)
      .where(and(eq(floorplans.organizerId, c.var.user.id), isNull(floorplans.eventId)))
      .orderBy(desc(floorplans.updatedAt));
    return c.json({ floorplans: rows.map(toFloorplan) });
  })

  .post("/", async (c) => {
    const parsed = floorplanInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const [row] = await db
      .insert(floorplans)
      .values({ organizerId: c.var.user.id, ...parsed.data })
      .returning();
    return c.json({ floorplan: toFloorplan(row) }, 201);
  })

  .get("/:id", async (c) => {
    const row = await ownPlan(c.req.param("id"), c.var.user.id);
    return row ? c.json({ floorplan: toFloorplan(row) }) : c.json(notFound, 404);
  })

  .put("/:id", async (c) => {
    const existing = await ownPlan(c.req.param("id"), c.var.user.id);
    if (!existing) return c.json(notFound, 404);
    const parsed = floorplanInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const [row] = await db.update(floorplans).set(parsed.data).where(eq(floorplans.id, existing.id)).returning();
    return c.json({ floorplan: toFloorplan(row) });
  })

  .post("/:id/duplicate", async (c) => {
    const existing = await ownPlan(c.req.param("id"), c.var.user.id);
    if (!existing) return c.json(notFound, 404);
    const [row] = await db
      .insert(floorplans)
      .values({
        organizerId: c.var.user.id,
        name: `${existing.name} (copy)`.slice(0, 80),
        units: existing.units,
        widthMm: existing.widthMm,
        depthMm: existing.depthMm,
        items: existing.items,
      })
      .returning();
    return c.json({ floorplan: toFloorplan(row) }, 201);
  })

  .delete("/:id", async (c) => {
    const existing = await ownPlan(c.req.param("id"), c.var.user.id);
    if (!existing) return c.json(notFound, 404);
    // Events keep their own copies, so deleting a library plan never changes an event
    await db.delete(floorplans).where(eq(floorplans.id, existing.id));
    return c.json({ ok: true });
  });
