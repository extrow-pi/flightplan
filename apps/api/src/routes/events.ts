import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  eventInputSchema,
  FLOOR_MAP_MAX_BYTES,
  spawnFromTemplateSchema,
  type ApiError,
  type EventDay,
  type EventInput,
  type EventRecord,
} from "@flightplan/shared";
import { accessColumns, accessibleEvents, canEdit, collaboratorJoin, editableEvents, eventAccess, forbidden, roleOf } from "../access.js";
import { syncTables, TablesInUseError, type Tx } from "../bookings.js";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { deleteUpload, saveImage, UploadError, uploadUrl } from "../uploads.js";

const { events, eventDays, eventCollaborators, user } = schema;

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

/** Events matching `where`, with days, floor map URL and the user's access to each. */
async function loadEvents(userId: string, where: SQL | undefined): Promise<EventRecord[]> {
  const rows = await db
    .select({ ...publicColumns, ...accessColumns })
    .from(events)
    .innerJoin(user, eq(user.id, events.organizerId))
    .leftJoin(eventCollaborators, collaboratorJoin(userId))
    .where(where)
    .orderBy(sql`${events.startDate} asc nulls last`, asc(events.name));
  const withAccess = rows.map(({ ownerId, ownerName, collaboratorRole, ...r }) => ({
    ...r,
    access: { role: roleOf(ownerId, collaboratorRole, userId), ownerName },
  }));
  return (await withDays(withAccess)) as unknown as EventRecord[];
}

/** One event or template the user can at least view, or null. */
async function findAccessible(id: string, userId: string) {
  const [event] = await loadEvents(userId, and(eq(events.id, id), accessibleEvents(userId)));
  return event ?? null;
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

// Routes cover the signed-in organizer's own events and templates, plus ones shared with them
// (see access.ts for what each role can do)
export const eventRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  // Dated events by start date; templates (no date) last, by name. Includes shared events.
  .get("/", async (c) => {
    return c.json({ events: await loadEvents(c.var.user.id, accessibleEvents(c.var.user.id)) });
  })

  // ?floorMapFrom=<event id> reuses the floor map of an event they can edit (used by "Save as template")
  .post("/", async (c) => {
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    let floorMapFile: string | null = null;
    const from = c.req.query("floorMapFrom");
    if (from && idSchema.safeParse(from).success) {
      const [source] = await db
        .select({ floorMapFile: events.floorMapFile })
        .from(events)
        .where(and(eq(events.id, from), editableEvents(c.var.user.id)));
      floorMapFile = source?.floorMapFile ?? null;
    }

    const id = await db.transaction((tx) => insertEvent(tx, c.var.user.id, parsed.data, floorMapFile));
    return c.json({ event: await findAccessible(id, c.var.user.id) }, 201);
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const event = await findAccessible(id, c.var.user.id);
    return event ? c.json({ event }) : c.json(notFound, 404);
  })

  // Full update from the event form (replaces the schedule)
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = eventInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const access = await eventAccess(id, c.var.user.id);
    if (!access) return c.json(notFound, 404);
    if (!canEdit(access)) return c.json(forbidden("edit this event"), 403);
    const existing = (await findAccessible(id, c.var.user.id))!;
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
    return c.json({ event: await findAccessible(id, c.var.user.id) });
  })

  // Publish / unpublish a dated event
  .patch("/:id/status", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const access = await eventAccess(id, c.var.user.id);
    if (!access) return c.json(notFound, 404);
    if (!canEdit(access)) return c.json(forbidden("publish this event"), 403);

    const [updated] = await db
      .update(events)
      .set({ status: parsed.data.status })
      .where(and(eq(events.id, id), sql`${events.status} <> 'template'`))
      .returning({ id: events.id });
    if (!updated) return c.json(notFound, 404);
    return c.json({ event: await findAccessible(id, c.var.user.id) });
  })

  // Create a draft from a template, with its first day on startDate. The new draft belongs to whoever
  // creates it and keeps the template's team: its collaborators keep their roles, and the template's
  // owner (if someone else) becomes an editor.
  .post("/:id/spawn", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const parsed = spawnFromTemplateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const access = await eventAccess(id, c.var.user.id);
    if (!access) return c.json(notFound, 404);
    if (!canEdit(access)) return c.json(forbidden("use this template"), 403);
    const template = (await findAccessible(id, c.var.user.id))!;
    if (template.status !== "template") return c.json(notFound, 404);

    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      bookingToken: _t,
      floorMapUrl: _f,
      access: _a,
      ...copy
    } = template;
    const [{ floorMapFile }] = await db.select({ floorMapFile: events.floorMapFile }).from(events).where(eq(events.id, id));
    // The draft gets its own booking link, closed until the organizer opens it
    const draft: EventInput = { ...copy, status: "draft", startDate: parsed.data.startDate, bookingOpen: false };
    const me = c.var.user.id;
    const newId = await db.transaction(async (tx) => {
      const newId = await insertEvent(tx, me, eventInputSchema.parse(draft), floorMapFile);
      const team = await tx
        .select({ userId: eventCollaborators.userId, role: eventCollaborators.role })
        .from(eventCollaborators)
        .where(eq(eventCollaborators.eventId, id));
      const members = team.filter((m) => m.userId !== me).map((m) => ({ ...m, eventId: newId, invitedBy: me }));
      if (access.ownerId !== me) members.push({ userId: access.ownerId, role: "editor", eventId: newId, invitedBy: me });
      if (members.length) await tx.insert(eventCollaborators).values(members);
      return newId;
    });
    return c.json({ event: await findAccessible(newId, me) }, 201);
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);

    const access = await eventAccess(id, c.var.user.id);
    if (!access) return c.json(notFound, 404);
    if (access.role !== "owner") return c.json(forbidden("delete this event. Only its owner can"), 403);

    // Days, tables, bookings, invites and collaborators are removed by ON DELETE CASCADE
    const deleted = await db
      .delete(events)
      .where(eq(events.id, id))
      .returning({ id: events.id, floorMapFile: events.floorMapFile });
    if (!deleted.length) return c.json(notFound, 404);
    await deleteFloorMapIfUnused(deleted[0].floorMapFile);
    return c.body(null, 204);
  })

  // Upload (or replace) the floor map image. multipart/form-data with a "file" field.
  .post("/:id/floor-map", bodyLimit({ maxSize: FLOOR_MAP_MAX_BYTES + 64 * 1024 }), async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const access = await eventAccess(id, c.var.user.id);
    if (!access) return c.json(notFound, 404);
    if (!canEdit(access)) return c.json(forbidden("change the floor map"), 403);
    const [existing] = await db.select({ floorMapFile: events.floorMapFile }).from(events).where(eq(events.id, id));

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
    return c.json({ event: await findAccessible(id, c.var.user.id) });
  })

  .delete("/:id/floor-map", async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound, 404);
    const access = await eventAccess(id, c.var.user.id);
    if (!access) return c.json(notFound, 404);
    if (!canEdit(access)) return c.json(forbidden("change the floor map"), 403);
    const [existing] = await db.select({ floorMapFile: events.floorMapFile }).from(events).where(eq(events.id, id));

    await db.update(events).set({ floorMapFile: null }).where(eq(events.id, id));
    await deleteFloorMapIfUnused(existing.floorMapFile);
    return c.json({ event: await findAccessible(id, c.var.user.id) });
  });
