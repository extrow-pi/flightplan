import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  eventInputSchema,
  FLOOR_MAP_MAX_BYTES,
  spawnFromTemplateSchema,
  type ApiError,
  type EventDay,
  type EventInput,
} from "@flightplan/shared";
import { syncTables, TablesInUseError, type Tx } from "../bookings.js";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { deleteUpload, saveImage, UploadError, uploadUrl } from "../uploads.js";

const { events, eventDays } = schema;

// Everything except organizer_id is returned to the client
const { organizerId: _organizerId, ...publicColumns } = getTableColumns(events);

const idSchema = z.uuid();
const statusSchema = z.object({ status: z.enum(["draft", "published"]) });

type EventOutput = z.output<typeof eventInputSchema>;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

const notFound = { error: "Event not found" } satisfies ApiError;

/** Attach days to event rows and swap the stored floor map file name for its URL. */
async function withDays<T extends { id: string; floorMapFile: string | null }>(
  rows: T[],
): Promise<(Omit<T, "floorMapFile"> & { days: EventDay[]; floorMapUrl: string | null })[]> {
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
  return rows.map(({ floorMapFile, ...r }) => ({
    ...r,
    days: byEvent.get(r.id) ?? [],
    floorMapUrl: uploadUrl(floorMapFile),
  }));
}

async function findOwned(id: string, organizerId: string) {
  const [row] = await db
    .select(publicColumns)
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizerId, organizerId)));
  if (!row) return null;
  return (await withDays([row]))[0];
}

async function insertEvent(
  tx: Tx,
  organizerId: string,
  { days, ...fields }: EventOutput,
  floorMapFile: string | null = null,
) {
  const [row] = await tx
    .insert(events)
    .values({ ...fields, organizerId, floorMapFile })
    .returning({ id: events.id });
  await tx.insert(eventDays).values(days.map((d) => ({ ...d, eventId: row.id })));
  await syncTables(tx, row.id, fields.vendorTables);
  return row.id;
}

/** Delete a floor map file once no event or template uses it any more. */
async function deleteFloorMapIfUnused(file: string | null) {
  if (!file) return;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.floorMapFile, file));
  if (count === 0) await deleteUpload(file);
}

const tablesInUse = (err: unknown) => (err instanceof TablesInUseError ? ({ error: err.message } satisfies ApiError) : null);

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

  // ?floorMapFrom=<event id> reuses another of the organizer's floor maps (used by "Save as template")
  .post("/", async (c) => {
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    let floorMapFile: string | null = null;
    const from = c.req.query("floorMapFrom");
    if (from && idSchema.safeParse(from).success) {
      const [source] = await db
        .select({ floorMapFile: events.floorMapFile })
        .from(events)
        .where(and(eq(events.id, from), eq(events.organizerId, c.var.user.id)));
      floorMapFile = source?.floorMapFile ?? null;
    }

    const id = await db.transaction((tx) => insertEvent(tx, c.var.user.id, parsed.data, floorMapFile));
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
    try {
      await db.transaction(async (tx) => {
        await tx.update(events).set(fields).where(eq(events.id, id));
        await tx.delete(eventDays).where(eq(eventDays.eventId, id));
        await tx.insert(eventDays).values(days.map((d) => ({ ...d, eventId: id })));
        await syncTables(tx, id, fields.vendorTables);
      });
    } catch (err) {
      const conflict = tablesInUse(err);
      if (conflict) return c.json(conflict, 409);
      throw err;
    }
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

    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      bookingToken: _t,
      floorMapUrl: _f,
      ...copy
    } = template;
    const [{ floorMapFile }] = await db.select({ floorMapFile: events.floorMapFile }).from(events).where(eq(events.id, id));
    // The draft gets its own booking link, closed until the organizer opens it
    const draft: EventInput = { ...copy, status: "draft", startDate: parsed.data.startDate, bookingOpen: false };
    const newId = await db.transaction((tx) =>
      insertEvent(tx, c.var.user.id, eventInputSchema.parse(draft), floorMapFile),
    );
    return c.json({ event: await findOwned(newId, c.var.user.id) }, 201);
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);

    // Days, tables, bookings and invites are removed by ON DELETE CASCADE
    const deleted = await db
      .delete(events)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)))
      .returning({ id: events.id, floorMapFile: events.floorMapFile });
    if (!deleted.length) return c.json(notFound, 404);
    await deleteFloorMapIfUnused(deleted[0].floorMapFile);
    return c.body(null, 204);
  })

  // Upload (or replace) the floor map image. multipart/form-data with a "file" field.
  .post("/:id/floor-map", bodyLimit({ maxSize: FLOOR_MAP_MAX_BYTES + 64 * 1024 }), async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const [existing] = await db
      .select({ floorMapFile: events.floorMapFile })
      .from(events)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)));
    if (!existing) return c.json(notFound, 404);

    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body["file"];
    if (!(file instanceof File)) return c.json<ApiError>({ error: "Choose an image to upload" }, 400);

    let name: string;
    try {
      name = await saveImage(file);
    } catch (err) {
      if (err instanceof UploadError) return c.json<ApiError>({ error: err.message }, 400);
      throw err;
    }
    await db.update(events).set({ floorMapFile: name }).where(eq(events.id, id));
    await deleteFloorMapIfUnused(existing.floorMapFile);
    return c.json({ event: await findOwned(id, c.var.user.id) });
  })

  .delete("/:id/floor-map", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const [existing] = await db
      .select({ floorMapFile: events.floorMapFile })
      .from(events)
      .where(and(eq(events.id, id), eq(events.organizerId, c.var.user.id)));
    if (!existing) return c.json(notFound, 404);

    await db.update(events).set({ floorMapFile: null }).where(eq(events.id, id));
    await deleteFloorMapIfUnused(existing.floorMapFile);
    return c.json({ event: await findOwned(id, c.var.user.id) });
  });
