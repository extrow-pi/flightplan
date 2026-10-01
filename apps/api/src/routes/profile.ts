import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import {
  ACTIVE_BOOKING_STATUSES,
  addDays,
  FLOOR_MAP_MAX_BYTES,
  HANDLE_PATTERN,
  organizerProfileSchema,
  suggestHandle,
  type ApiError,
  type EventDay,
  type OrganizerProfile,
  type PublicOrganizerPage,
  type PublicShow,
} from "@flightplan/shared";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { deleteUpload, saveImage, UploadError, uploadUrl } from "../uploads.js";

// An organizer's public page (/o/:handle): a profile and their published shows. Organizers set it up
// in Settings; it's hidden until they switch it on.

const { bookings, eventDays, events, eventTables, organizerProfiles } = schema;

const TIME_ZONE = process.env.APP_TIMEZONE ?? "America/Vancouver";
/** How many past shows the public page lists */
const PAST_LIMIT = 12;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const handleTaken = {
  error: "That handle is taken",
  fieldErrors: { handle: ["Already taken. Try another."] },
} satisfies ApiError;

function toProfile(p: typeof organizerProfiles.$inferSelect): OrganizerProfile {
  return {
    handle: p.handle,
    displayName: p.displayName,
    bio: p.bio,
    websiteUrl: p.websiteUrl,
    instagram: p.instagram,
    contactEmail: p.contactEmail,
    published: p.published,
    logoUrl: uploadUrl(p.logoFile),
  };
}

async function findProfile(userId: string) {
  const [row] = await db.select().from(organizerProfiles).where(eq(organizerProfiles.userId, userId));
  return row ?? null;
}

/** A free handle based on the organizer's name, e.g. "jetlagged-cards" or "jetlagged-cards-2" */
async function suggestFreeHandle(name: string) {
  const base = suggestHandle(name).slice(0, 26) || "organizer";
  const padded = base.length >= 3 ? base : `${base}-shows`;
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? padded : `${padded}-${n}`;
    const [taken] = await db.select({ h: organizerProfiles.handle }).from(organizerProfiles).where(eq(organizerProfiles.handle, candidate));
    if (!taken) return candidate;
  }
  return "";
}

// ── Signed in: /api/profile ──────────────────────────────────────────────

export const profileRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  // The organizer's page settings (null until first saved), with a handle suggestion
  .get("/", async (c) => {
    const row = await findProfile(c.var.user.id);
    return c.json({
      profile: row ? toProfile(row) : null,
      suggestedHandle: row ? row.handle : await suggestFreeHandle(c.var.user.name),
    });
  })

  .get("/handle-available", async (c) => {
    const handle = (c.req.query("handle") ?? "").trim().toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) return c.json({ valid: false, available: false });
    const [row] = await db
      .select({ userId: organizerProfiles.userId })
      .from(organizerProfiles)
      .where(eq(organizerProfiles.handle, handle));
    return c.json({ valid: true, available: !row || row.userId === c.var.user.id });
  })

  // Create or update the page
  .put("/", async (c) => {
    const parsed = organizerProfileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    try {
      const [row] = await db
        .insert(organizerProfiles)
        .values({ userId: c.var.user.id, ...parsed.data })
        .onConflictDoUpdate({ target: organizerProfiles.userId, set: parsed.data })
        .returning();
      return c.json({ profile: toProfile(row) });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(handleTaken, 409);
      throw err;
    }
  })

  // Upload (or replace) the logo. multipart/form-data with a "file" field. The page must be saved first.
  .post("/logo", bodyLimit({ maxSize: FLOOR_MAP_MAX_BYTES + 64 * 1024 }), async (c) => {
    const existing = await findProfile(c.var.user.id);
    if (!existing) return c.json<ApiError>({ error: "Save your page first, then add a logo" }, 400);
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
    const [row] = await db
      .update(organizerProfiles)
      .set({ logoFile: name })
      .where(eq(organizerProfiles.userId, c.var.user.id))
      .returning();
    if (existing.logoFile) await deleteUpload(existing.logoFile);
    return c.json({ profile: toProfile(row) });
  })

  .delete("/logo", async (c) => {
    const existing = await findProfile(c.var.user.id);
    if (!existing) return c.json<ApiError>({ error: "Page not found" }, 404);
    const [row] = await db
      .update(organizerProfiles)
      .set({ logoFile: null })
      .where(eq(organizerProfiles.userId, c.var.user.id))
      .returning();
    if (existing.logoFile) await deleteUpload(existing.logoFile);
    return c.json({ profile: toProfile(row) });
  });

// ── Public: /api/public/organizers/:handle ───────────────────────────────

/** Today's date (YYYY-MM-DD) in the app's timezone, so a show stays "upcoming" through its last day. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const publicOrganizerRoutes = new Hono().get("/:handle", async (c) => {
  const handle = c.req.param("handle").toLowerCase();
  const notFound = { error: "Organizer not found" } satisfies ApiError;
  if (!HANDLE_PATTERN.test(handle)) return c.json(notFound, 404);
  const [profile] = await db
    .select()
    .from(organizerProfiles)
    .where(and(eq(organizerProfiles.handle, handle), eq(organizerProfiles.published, true)));
  if (!profile) return c.json(notFound, 404);

  // Published, dated shows only: drafts and templates never appear
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.organizerId, profile.userId), eq(events.status, "published"), isNotNull(events.startDate)))
    .orderBy(asc(events.startDate));
  const ids = rows.map((e) => e.id);
  const [dayRows, tableCounts, heldCounts] = ids.length
    ? await Promise.all([
        db
          .select({ eventId: eventDays.eventId, dayOffset: eventDays.dayOffset, startTime: eventDays.startTime, endTime: eventDays.endTime })
          .from(eventDays)
          .where(inArray(eventDays.eventId, ids))
          .orderBy(asc(eventDays.dayOffset)),
        db.select({ eventId: eventTables.eventId, n: count() }).from(eventTables).where(inArray(eventTables.eventId, ids)).groupBy(eventTables.eventId),
        db
          .select({ eventId: bookings.eventId, n: count() })
          .from(bookings)
          .where(and(inArray(bookings.eventId, ids), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])))
          .groupBy(bookings.eventId),
      ])
    : [[], [], []];

  const daysOf = new Map<string, EventDay[]>();
  for (const { eventId, ...d } of dayRows) daysOf.set(eventId, [...(daysOf.get(eventId) ?? []), d]);
  const tablesOf = new Map(tableCounts.map((t) => [t.eventId, t.n]));
  const heldOf = new Map(heldCounts.map((h) => [h.eventId, h.n]));

  const now = today();
  const upcoming: PublicShow[] = [];
  const past: PublicShow[] = [];
  for (const e of rows) {
    const days = daysOf.get(e.id) ?? [];
    const end = addDays(e.startDate!, Math.max(0, ...days.map((d) => d.dayOffset)));
    const isUpcoming = end >= now;
    const tablesLeft = (tablesOf.get(e.id) ?? 0) - (heldOf.get(e.id) ?? 0);
    const show: PublicShow = {
      name: e.name,
      description: e.description,
      venueName: e.venueName,
      address: e.address,
      city: e.city,
      startDate: e.startDate!,
      days,
      ticketPriceCents: e.ticketPriceCents,
      tablePriceCents: e.tablePriceCents,
      booking: isUpcoming && e.bookingOpen ? { url: `/book/${e.bookingToken}`, tablesLeft: Math.max(0, tablesLeft) } : null,
    };
    (isUpcoming ? upcoming : past).push(show);
  }

  const { handle: _h, published: _p, ...publicProfile } = toProfile(profile);
  const body: PublicOrganizerPage = { profile: publicProfile, upcoming, past: past.reverse().slice(0, PAST_LIMIT) };
  return c.json(body);
});
