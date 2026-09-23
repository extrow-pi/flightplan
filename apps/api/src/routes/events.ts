import { Hono } from "hono";
import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  eventInputSchema,
  spawnFromTemplateSchema,
  type ApiError,
  type EventDay,
  type EventInput,
} from "@flightplan/shared";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";

const { events, eventDays } = schema;

// Everything except organizer_id is returned to the client
const { organizerId: _organizerId, ...publicColumns } = getTableColumns(events);

const idSchema = z.uuid();
const statusSchema = z.object({ status: z.enum(["draft", "published"]) });

type EventOutput = z.output<typeof eventInputSchema>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

const notFound = { error: "Event not found" } satisfies ApiError;

/** Load events (by id) with their days attached, in the order given. */
async function withDays<T extends { id: string }>(rows: T[]): Promise<(T & { days: EventDay[] })[]> {
  if (!rows.length) return [];
  const days = await db
    .select({
      eventId: eventDays.eventId,
      dayOffset: eventDays.dayOffset,
      startTime: eventDays.startTime,
      endTime: eventDays.endTime,
    })
    .from(eventDays)
    .where(
      inArray(
        eventDays.eventId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(eventDays.dayOffset));

  const byEvent = new Map<string, EventDay[]>();
  for (const { eventId, ...day } of days) {
    byEvent.set(eventId, [...(byEvent.get(eventId) ?? []), day]);
  }
  return rows.map((r) => ({ ...r, days: byEvent.get(r.id) ?? [] }));
}

async function findOwned(id: string, organizerId: string) {
  const [row] = await db
    .select(publicColumns)
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizerId, organizerId)));
  if (!row) return null;
  return (await withDays([row]))[0];
}

async function insertEvent(tx: Tx, organizerId: string, { days, ...fields }: EventOutput) {
  const [row] = await tx
    .insert(events)
    .values({ ...fields, organizerId })
    .returning({ id: events.id });
  await tx.insert(eventDays).values(days.map((d) => ({ ...d, eventId: row.id })));
  return row.id;
}

// All routes are scoped to the signed-in organizer's own events and templates
export const eventRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  // Dated events by start date; templates (no date) last, by name
  .get("/", async (c) => {
    const rows = await db
      .select(publicColumns)
      .from(events)
      .where(eq(events.organizerId, c.var.user.id))
      .orderBy(sql`${events.startDate} asc nulls last`, asc(events.name));
    return c.json({ events: await withDays(rows) });
  })

  .post("/", async (c) => {
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const id = await db.transaction((tx) => insertEvent(tx, c.var.user.id, parsed.data));
    return c.json({ event: await findOwned(id, c.var.user.id) }, 201);
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const event = await findOwned(id, c.var.user.id);
    return event ? c.json({ event }) : c.json(notFound, 404);
  })

  // Full update from the event form (replaces the schedule)
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const existing = await findOwned(id, c.var.user.id);
    if (!existing) return c.json(notFound, 404);
    // A template stays a template, and a dated event stays dated. Use spawn / save-as-template to convert.
    if ((existing.status === "template") !== (parsed.data.status === "template")) {
      return c.json<ApiError>({ error: "Templates and events can't be converted into each other" }, 400);
    }

    const { days, ...fields } = parsed.data;
    await db.transaction(async (tx) => {
      await tx.update(events).set(fields).where(eq(events.id, id));
      await tx.delete(eventDays).where(eq(eventDays.eventId, id));
      await tx.insert(eventDays).values(days.map((d) => ({ ...d, eventId: id })));
    });
    return c.json({ event: await findOwned(id, c.var.user.id) });
  })

  // Publish / unpublish a dated event
  .patch("/:id/status", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [updated] = await db
      .update(events)
      .set({ status: parsed.data.status })
      .where(
        and(eq(events.id, id), eq(events.organizerId, c.var.user.id), sql`${events.status} <> 'template'`),
      )
      .returning({ id: events.id });
    if (!updated) return c.json(notFound, 404);
    return c.json({ event: await findOwned(id, c.var.user.id) });
  })

  // Create a draft from a template, with its first day on startDate
  .post("/:id/spawn", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = spawnFromTemplateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const template = await findOwned(id, c.var.user.id);
    if (!template || template.status !== "template") return c.json(notFound, 404);

    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = template;
    const draft: EventInput = { ...copy, status: "draft", startDate: parsed.data.startDate };
    const newId = await db.transaction((tx) => insertEvent(tx, c.var.user.id, eventInputSchema.parse(draft)));
    return c.json({ event: await findOwned(newId, c.var.user.id) }, 201);
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);

    // event_days rows are removed by ON DELETE CASCADE
    const deleted = await db
      .delete(events)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)))
      .returning({ id: events.id });
    if (!deleted.length) return c.json(notFound, 404);
    return c.body(null, 204);
  });
