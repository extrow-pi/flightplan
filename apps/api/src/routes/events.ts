import { Hono } from "hono";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { EVENT_STATUSES, eventInputSchema, type ApiError } from "@flightplan/shared";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";

const { events } = schema;

// Everything except organizer_id is returned to the client
const { organizerId: _organizerId, ...publicColumns } = getTableColumns(events);

const idSchema = z.uuid();
const statusSchema = z.object({ status: z.enum(EVENT_STATUSES) });

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

// All routes are scoped to the signed-in organizer's own events
export const eventRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/", async (c) => {
    const rows = await db
      .select(publicColumns)
      .from(events)
      .where(eq(events.organizerId, c.var.user.id))
      .orderBy(asc(events.date), asc(events.startTime));
    return c.json({ events: rows });
  })

  .post("/", async (c) => {
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [event] = await db
      .insert(events)
      .values({ ...parsed.data, organizerId: c.var.user.id })
      .returning(publicColumns);
    return c.json({ event }, 201);
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json<ApiError>({ error: "Event not found" }, 404);

    const [event] = await db
      .select(publicColumns)
      .from(events)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)));
    if (!event) return c.json<ApiError>({ error: "Event not found" }, 404);
    return c.json({ event });
  })

  // Full update from the event form
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json<ApiError>({ error: "Event not found" }, 404);
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [event] = await db
      .update(events)
      .set(parsed.data)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)))
      .returning(publicColumns);
    if (!event) return c.json<ApiError>({ error: "Event not found" }, 404);
    return c.json({ event });
  })

  // Publish / unpublish
  .patch("/:id/status", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json<ApiError>({ error: "Event not found" }, 404);
    const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [event] = await db
      .update(events)
      .set({ status: parsed.data.status })
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)))
      .returning(publicColumns);
    if (!event) return c.json<ApiError>({ error: "Event not found" }, 404);
    return c.json({ event });
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json<ApiError>({ error: "Event not found" }, 404);

    const deleted = await db
      .delete(events)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)))
      .returning({ id: events.id });
    if (!deleted.length) return c.json<ApiError>({ error: "Event not found" }, 404);
    return c.body(null, 204);
  });
