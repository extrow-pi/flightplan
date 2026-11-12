import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  FLOOR_MAP_MAX_BYTES,
  showPageImages,
  showPageSchema,
  suggestShowSlug,
  ticketsCandyUrl,
  type ApiError,
  type ShowPageResponse,
  type ShowPageSettings,
  type StoredShowPage,
} from "@flightplan/shared";
import { canEdit, eventAccess, forbidden } from "../access.js";
import { db, schema } from "../db/index.js";
import { isUniqueViolation } from "../db/errors.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { deleteUpload, saveImage, UploadError, uploadUrl } from "../uploads.js";

// A show's public page (/o/:handle/:slug): its address, cover image, content and TicketsCandy widget.
// Organizers edit it on the event's "Show page" tab.

const { events, organizerProfiles } = schema;

const notFound = { error: "Event not found" } satisfies ApiError;

class MissingImageError extends Error {}

/** Most images waiting to be used on one show's page */
const MAX_PENDING_UPLOADS = 150;
/** Unused uploads are kept this long, so a save doesn't delete photos still being added in the editor */
const PENDING_UPLOAD_MS = 60 * 60 * 1000;

const { slug: _slug, ...defaultSettings } = showPageSchema.parse({});

/** Stored settings with defaults filled in (older rows have none). */
export function pageSettings(stored: StoredShowPage): ShowPageSettings {
  const { assets: _a, uploads: _u, sections, ...rest } = stored;
  const settings = { ...defaultSettings, ...rest };
  // Early versions had text sections, and no blocks: give them blocks, with the widget first
  if (!rest.blocks?.length && sections?.length) {
    settings.blocks = sections.map((s, i) => ({ id: `text-${i + 1}`, type: "text" as const, ...s }));
  }
  // Re-read the saved address with today's rules (an early version kept the widget's loader script)
  settings.tickets = ticketsCandyUrl(settings.tickets) ?? "";
  if (settings.tickets && !rest.blocks?.length && !settings.blocks.some((b) => b.type === "tickets")) {
    settings.blocks = [{ id: "tickets", type: "tickets", title: "Tickets" }, ...settings.blocks];
  }
  return settings;
}

/** Uploaded images the page doesn't use yet (older pages kept them as plain names). */
const pendingUploads = (stored: StoredShowPage) => [...(stored.uploads ?? []), ...(stored.assets ?? []).map((file) => ({ file, at: 0 }))];

/** Every image file a show's page holds: ones uploaded for it, and ones it uses. */
export const pageImages = (stored: StoredShowPage) => [...pendingUploads(stored).map((u) => u.file), ...showPageImages(pageSettings(stored))];


/** A free page address for one of the organizer's shows: the name, then name-2, name-3… */
async function freeSlug(organizerId: string, eventId: string, base: string) {
  // Long names are shortened to fit "-2", so look at everything sharing the shortened start
  const taken = new Set(
    (
      await db
        .select({ slug: events.pageSlug })
        .from(events)
        .where(and(eq(events.organizerId, organizerId), ne(events.id, eventId), like(events.pageSlug, `${base.slice(0, 50)}%`)))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const slug = `${base.slice(0, 60 - String(n).length - 1)}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

/** Give a dated show a page address from its name, if it doesn't have one yet. */
export async function ensureShowSlug(eventId: string) {
  const [e] = await db
    .select({ organizerId: events.organizerId, name: events.name, status: events.status, pageSlug: events.pageSlug })
    .from(events)
    .where(eq(events.id, eventId));
  if (!e || e.pageSlug || e.status === "template") return;
  const slug = await freeSlug(e.organizerId, eventId, suggestShowSlug(e.name) || "show");
  // Someone else may have just taken it; the event's id still works as its address
  await db.update(events).set({ pageSlug: slug }).where(eq(events.id, eventId)).catch((err) => {
    if (!isUniqueViolation(err)) throw err;
  });
}

async function loadPage(eventId: string): Promise<ShowPageResponse | null> {
  const [row] = await db
    .select({
      id: events.id,
      status: events.status,
      pageSlug: events.pageSlug,
      coverFile: events.coverFile,
      pageSettings: events.pageSettings,
      handle: organizerProfiles.handle,
      profilePublished: organizerProfiles.published,
    })
    .from(events)
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, events.organizerId))
    .where(eq(events.id, eventId));
  if (!row) return null;
  const slug = row.pageSlug ?? row.id;
  return {
    settings: pageSettings(row.pageSettings),
    slug: row.pageSlug ?? "",
    coverUrl: uploadUrl(row.coverFile),
    url: row.handle ? `/o/${row.handle}/${slug}` : null,
    hiddenBecause: !row.handle ? "no-profile" : !row.profilePublished ? "profile-off" : row.status !== "published" ? "not-published" : null,
  };
}

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

/** Templates have no page; everything else needs edit access to change it. */
async function editable(eventId: string, userId: string) {
  const access = await eventAccess(eventId, userId);
  if (!access) return { error: notFound, status: 404 as const };
  if (!canEdit(access)) return { error: forbidden("change this show's page"), status: 403 as const };
  const [e] = await db
    .select({ status: events.status, coverFile: events.coverFile, pageSettings: events.pageSettings })
    .from(events)
    .where(eq(events.id, eventId));
  if (e.status === "template") return { error: { error: "Templates don't have a show page" } satisfies ApiError, status: 400 as const };
  return { access, coverFile: e.coverFile, stored: e.pageSettings };
}

export const showPageRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/:id/page", async (c) => {
    const id = c.req.param("id");
    if (!(await eventAccess(id, c.var.user.id))) return c.json(notFound, 404);
    return c.json((await loadPage(id))!);
  })

  .put("/:id/page", async (c) => {
    const id = c.req.param("id");
    const check = await editable(id, c.var.user.id);
    if ("error" in check) return c.json(check.error, check.status);
    const parsed = showPageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const { slug, ...settings } = parsed.data;
    const used = new Set(showPageImages(settings));
    let removed: string[];
    try {
      // The row is locked so an image uploaded while this saves isn't lost (the upload waits for it)
      removed = await db.transaction(async (tx) => {
        const [row] = await tx.select({ stored: events.pageSettings }).from(events).where(eq(events.id, id)).for("update");
        // Pages can only use images uploaded for this show
        const own = new Set(pageImages(row.stored));
        if ([...used].some((f) => !own.has(f))) throw new MissingImageError();
        // Unused recent uploads may still be on their way into the editor; older ones are dropped
        const now = Date.now();
        const uploads = pendingUploads(row.stored).filter((u) => !used.has(u.file) && now - u.at < PENDING_UPLOAD_MS);
        const kept = new Set([...used, ...uploads.map((u) => u.file)]);
        await tx
          .update(events)
          .set({ pageSlug: slug || null, pageSettings: { ...settings, uploads } satisfies StoredShowPage })
          .where(eq(events.id, id));
        return [...own].filter((f) => !kept.has(f));
      });
    } catch (err) {
      if (err instanceof MissingImageError) return c.json<ApiError>({ error: "One of the images is missing. Upload it again." }, 400);
      if (!isUniqueViolation(err)) throw err;
      return c.json<ApiError>(
        { error: "That page address is taken", fieldErrors: { slug: ["Another of your shows uses this address"] } },
        409,
      );
    }
    for (const f of removed) await deleteUpload(f);
    // A cleared address goes back to one made from the show's name
    if (!slug) await ensureShowSlug(id);
    return c.json((await loadPage(id))!);
  })

  // Upload an image for the page (flyer, gallery photo, sponsor logo). It's used once the page is saved.
  .post("/:id/page/images", bodyLimit({ maxSize: FLOOR_MAP_MAX_BYTES + 64 * 1024 }), async (c) => {
    const id = c.req.param("id");
    const check = await editable(id, c.var.user.id);
    if ("error" in check) return c.json(check.error, check.status);
    if (pendingUploads(check.stored).length >= MAX_PENDING_UPLOADS) {
      return c.json<ApiError>({ error: "Too many images. Save the page or remove some first." }, 400);
    }
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
    await db
      .update(events)
      .set({
        pageSettings: sql`jsonb_set(${events.pageSettings}, '{uploads}', coalesce(${events.pageSettings}->'uploads', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('file', ${name}::text, 'at', ${Date.now()}::bigint)))`,
      })
      .where(eq(events.id, id));
    return c.json({ file: name, url: uploadUrl(name) }, 201);
  })

  // Upload (or replace) the cover image. multipart/form-data with a "file" field.
  .post("/:id/page/cover", bodyLimit({ maxSize: FLOOR_MAP_MAX_BYTES + 64 * 1024 }), async (c) => {
    const id = c.req.param("id");
    const check = await editable(id, c.var.user.id);
    if ("error" in check) return c.json(check.error, check.status);
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
    await db.update(events).set({ coverFile: name }).where(eq(events.id, id));
    if (check.coverFile) await deleteUpload(check.coverFile);
    return c.json((await loadPage(id))!);
  })

  .delete("/:id/page/cover", async (c) => {
    const id = c.req.param("id");
    const check = await editable(id, c.var.user.id);
    if ("error" in check) return c.json(check.error, check.status);
    await db.update(events).set({ coverFile: null }).where(eq(events.id, id));
    if (check.coverFile) await deleteUpload(check.coverFile);
    return c.json((await loadPage(id))!);
  });
