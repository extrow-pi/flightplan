import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, like, ne, or, sql } from "drizzle-orm";
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
import { requireUser, type AuthEnv } from "../middleware.js";
import { deleteUpload, saveImage, UploadError, uploadUrl } from "../uploads.js";

// A show's public page (/o/:handle/:slug): its address, cover image, content and TicketsCandy widget.
// Organizers edit it on the event's "Show page" tab.

const { events, organizerProfiles } = schema;

const notFound = { error: "Event not found" } satisfies ApiError;

/** Most images one show can have uploaded at once (used or waiting to be saved) */
const MAX_PAGE_ASSETS = 150;

/** Stored settings with defaults filled in (older rows have none). */
export function pageSettings(stored: StoredShowPage): ShowPageSettings {
  const { slug: _s, ...defaults } = showPageSchema.parse({});
  const { assets: _a, sections, ...rest } = stored;
  const settings = { ...defaults, ...rest };
  // Early versions had text sections instead of blocks
  if (!rest.blocks?.length && sections?.length) {
    settings.blocks = sections.map((s, i) => ({ id: `text-${i + 1}`, type: "text" as const, ...s }));
  }
  // Re-read the saved address with today's rules (an early version kept the widget's loader script)
  settings.tickets = ticketsCandyUrl(settings.tickets) ?? "";
  // Pages with tickets always have somewhere to show them
  if (settings.tickets && !settings.blocks.some((b) => b.type === "tickets")) {
    settings.blocks = [{ id: "tickets", type: "tickets", title: "Tickets" }, ...settings.blocks];
  }
  return settings;
}

/** Every image file a show's page holds: ones uploaded for it, and ones it uses. */
export const pageImages = (stored: StoredShowPage) => [...(stored.assets ?? []), ...showPageImages(pageSettings(stored))];

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/** A free page address for one of the organizer's shows: the name, then name-2, name-3… */
async function freeSlug(organizerId: string, eventId: string, base: string) {
  const taken = new Set(
    (
      await db
        .select({ slug: events.pageSlug })
        .from(events)
        .where(and(eq(events.organizerId, organizerId), ne(events.id, eventId), or(eq(events.pageSlug, base), like(events.pageSlug, `${base}-%`))))
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
    // Pages can only use images uploaded for this show
    const own = new Set(pageImages(check.stored));
    const used = showPageImages(settings);
    if (used.some((f) => !own.has(f))) return c.json<ApiError>({ error: "One of the images is missing. Upload it again." }, 400);
    try {
      await db
        .update(events)
        .set({ pageSlug: slug || null, pageSettings: { ...settings, assets: [...new Set(used)] } })
        .where(eq(events.id, id));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return c.json<ApiError>(
        { error: "That page address is taken", fieldErrors: { slug: ["Another of your shows uses this address"] } },
        409,
      );
    }
    // Images that were uploaded or used before but aren't any more
    for (const f of own) if (!used.includes(f)) await deleteUpload(f);
    // A cleared address goes back to one made from the show's name
    if (!slug) await ensureShowSlug(id);
    return c.json((await loadPage(id))!);
  })

  // Upload an image for the page (flyer, gallery photo, sponsor logo). It's used once the page is saved.
  .post("/:id/page/images", bodyLimit({ maxSize: FLOOR_MAP_MAX_BYTES + 64 * 1024 }), async (c) => {
    const id = c.req.param("id");
    const check = await editable(id, c.var.user.id);
    if ("error" in check) return c.json(check.error, check.status);
    if ((check.stored.assets ?? []).length >= MAX_PAGE_ASSETS) {
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
        pageSettings: sql`jsonb_set(${events.pageSettings}, '{assets}', coalesce(${events.pageSettings}->'assets', '[]'::jsonb) || to_jsonb(${name}::text))`,
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
