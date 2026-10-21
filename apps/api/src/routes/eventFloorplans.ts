import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { floorplanInputSchema, publicMapSchema, savePlanToLibrarySchema, useLibraryPlanSchema, type ApiError } from "@flightplan/shared";
import { canEdit, eventAccess, forbidden } from "../access.js";
import { db, schema } from "../db/index.js";
import { PlanTablesInUseError, removeEventPlan, saveEventPlan, TooManyTablesError } from "../eventPlans.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { toFloorplan } from "./floorplans.js";

// An event's or event template's own floorplan: /api/events/:id/floorplan…
// Anyone on the event can see it; owners and editors change it.

const { events, floorplans } = schema;

const notFound = { error: "Event not found" } satisfies ApiError;

function invalid(error: z.ZodError) {
  return { error: error.issues[0]?.message ?? "Please fix the plan", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

async function access(id: string, userId: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return eventAccess(id, userId);
}

const planOf = async (eventId: string) => {
  const [row] = await db.select().from(floorplans).where(eq(floorplans.eventId, eventId));
  return row ?? null;
};

/** Run a plan change; turn table conflicts into a 409 the editor can show. */
async function applying(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof PlanTablesInUseError || err instanceof TooManyTablesError) return { error: err.message } satisfies ApiError;
    throw err;
  }
}

export const eventFloorplanRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/:id/floorplan", async (c) => {
    const a = await access(c.req.param("id"), c.var.user.id);
    if (!a) return c.json(notFound, 404);
    const row = await planOf(c.req.param("id"));
    return c.json({ floorplan: row ? toFloorplan(row) : null });
  })

  // Save the event's plan (creating it if needed); the event's tables follow the plan's tables
  .put("/:id/floorplan", async (c) => {
    const id = c.req.param("id");
    const a = await access(id, c.var.user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a)) return c.json(forbidden("change the floorplan"), 403);
    const parsed = floorplanInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const conflict = await applying(() => db.transaction((tx) => saveEventPlan(tx, id, a.ownerId, parsed.data)));
    if (conflict) return c.json(conflict, 409);
    return c.json({ floorplan: toFloorplan((await planOf(id))!) });
  })

  // Use (a copy of) one of the signed-in organizer's library plans, replacing any current plan
  .post("/:id/floorplan/from-library", async (c) => {
    const id = c.req.param("id");
    const a = await access(id, c.var.user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a)) return c.json(forbidden("change the floorplan"), 403);
    const parsed = useLibraryPlanSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const [source] = await db
      .select()
      .from(floorplans)
      .where(and(eq(floorplans.id, parsed.data.floorplanId), eq(floorplans.organizerId, c.var.user.id), isNull(floorplans.eventId)));
    if (!source) return c.json<ApiError>({ error: "Floorplan not found" }, 404);
    const { name, units, widthMm, depthMm, items, groups } = source;
    const conflict = await applying(() => db.transaction((tx) => saveEventPlan(tx, id, a.ownerId, { name, units, widthMm, depthMm, items, groups })));
    if (conflict) return c.json(conflict, 409);
    return c.json({ floorplan: toFloorplan((await planOf(id))!) }, 201);
  })

  // Copy the event's plan into the signed-in organizer's library
  .post("/:id/floorplan/to-library", async (c) => {
    const id = c.req.param("id");
    const a = await access(id, c.var.user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a)) return c.json(forbidden("save this floorplan"), 403);
    const parsed = savePlanToLibrarySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const plan = await planOf(id);
    if (!plan) return c.json<ApiError>({ error: "This event has no floorplan" }, 404);
    const [row] = await db
      .insert(floorplans)
      .values({
        organizerId: c.var.user.id,
        name: parsed.data.name,
        units: plan.units,
        widthMm: plan.widthMm,
        depthMm: plan.depthMm,
        items: plan.items,
        groups: plan.groups,
      })
      .returning();
    return c.json({ floorplan: toFloorplan(row) }, 201);
  })

  // Who appears on the public visitor map (off / paid vendors / everyone with a table)
  .put("/:id/public-map", async (c) => {
    const id = c.req.param("id");
    const a = await access(id, c.var.user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a)) return c.json(forbidden("change the visitor map"), 403);
    const parsed = publicMapSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    await db.update(events).set({ publicMap: parsed.data.publicMap }).where(eq(events.id, id));
    return c.json({ publicMap: parsed.data.publicMap });
  })

  // Take the plan off the event; its tables stay as numbered tables
  .delete("/:id/floorplan", async (c) => {
    const id = c.req.param("id");
    const a = await access(id, c.var.user.id);
    if (!a) return c.json(notFound, 404);
    if (!canEdit(a)) return c.json(forbidden("change the floorplan"), 403);
    if (!(await planOf(id))) return c.json<ApiError>({ error: "This event has no floorplan" }, 404);
    await db.transaction((tx) => removeEventPlan(tx, id));
    return c.json({ ok: true });
  });
