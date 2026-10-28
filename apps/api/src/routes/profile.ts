import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, count, eq, inArray, isNotNull, or } from "drizzle-orm";
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
  type PublicShowPage,
  SHOW_SLUG_PATTERN,
} from "@flightplan/shared";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { isUniqueViolation } from "../db/errors.js";
import { requireUser, type AuthEnv } from "../middleware.js";
import { deleteUpload, saveImage, UploadError, uploadUrl } from "../uploads.js";
import { pageSettings } from "./showPages.js";

// An organizer's public page (/o/:handle): a profile and their published shows. Organizers set it up
// in Settings; it's hidden until they switch it on.

const { bookings, eventDays, events, eventTables, organizerProfiles, floorplans } = schema;

const TIME_ZONE = process.env.APP_TIMEZONE ?? "America/Vancouver";
/** How many past shows the public page lists */
const PAST_LIMIT = 12;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}


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

const publishedShows = (organizerId: string) =>
  and(eq(events.organizerId, organizerId), eq(events.status, "published"), isNotNull(events.startDate));

/** Published shows as they appear publicly, each with whether it's still upcoming. */
async function toPublicShows(handle: string, rows: (typeof events.$inferSelect)[]) {
  const ids = rows.map((e) => e.id);
  const [dayRows, tableCounts, heldCounts] = ids.length
    ? await Promise.all([
        db
          .select({ eventId: eventDays.eventId, dayOffset: eventDays.dayOffset, setupTime: eventDays.setupTime, startTime: eventDays.startTime, endTime: eventDays.endTime })
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
  const planned = new Set(
    ids.length
      ? (await db.select({ eventId: floorplans.eventId }).from(floorplans).where(inArray(floorplans.eventId, ids))).map((p) => p.eventId)
      : [],
  );
  const heldOf = new Map(heldCounts.map((h) => [h.eventId, h.n]));

  const now = today();
  return rows.map((e) => {
    const days = daysOf.get(e.id) ?? [];
    const end = addDays(e.startDate!, Math.max(0, ...days.map((d) => d.dayOffset)));
    const upcoming = end >= now;
    const tablesLeft = (tablesOf.get(e.id) ?? 0) - (heldOf.get(e.id) ?? 0);
    const settings = pageSettings(e.pageSettings);
    const show: PublicShow & { upcoming: boolean } = {
      url: `/o/${handle}/${e.pageSlug ?? e.id}`,
      coverUrl: uploadUrl(e.coverFile),
      tagline: settings.tagline,
      hasTickets: upcoming && !!settings.tickets && settings.blocks.some((b) => b.type === "tickets"),
      name: e.name,
      description: e.description,
      venueName: e.venueName,
      address: e.address,
      city: e.city,
      startDate: e.startDate!,
      days,
      ticketPriceCents: e.ticketPriceCents,
      tablePriceCents: e.tablePriceCents,
      tablePriceMaxCents: Math.max(e.tablePriceCents, ...e.tableTypes.map((t) => t.priceCents)),
      booking: upcoming && e.bookingOpen ? { url: `/book/${e.bookingToken}`, tablesLeft: Math.max(0, tablesLeft) } : null,
      mapUrl: upcoming && e.publicMap !== "off" && planned.has(e.id) ? `/map/${e.id}` : null,
      upcoming,
    };
    return show;
  });
}

export async function publishedProfile(rawHandle: string) {
  const handle = rawHandle.toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) return null;
  const [profile] = await db
    .select()
    .from(organizerProfiles)
    .where(and(eq(organizerProfiles.handle, handle), eq(organizerProfiles.published, true)));
  return profile ?? null;
}

const uuidSchema = z.uuid();

export const publicOrganizerRoutes = new Hono()
  .get("/:handle", async (c) => {
    const profile = await publishedProfile(c.req.param("handle"));
    if (!profile) return c.json({ error: "Organizer not found" } satisfies ApiError, 404);

    // Published, dated shows only: drafts and templates never appear
    const rows = await db.select().from(events).where(publishedShows(profile.userId)).orderBy(asc(events.startDate));
    const shows = await toPublicShows(profile.handle, rows);
    const upcoming: PublicShow[] = [];
    const past: PublicShow[] = [];
    for (const { upcoming: isUpcoming, ...show } of shows) (isUpcoming ? upcoming : past).push(show);

    const { handle: _h, published: _p, ...publicProfile } = toProfile(profile);
    const body: PublicOrganizerPage = { profile: publicProfile, upcoming, past: past.reverse().slice(0, PAST_LIMIT) };
    return c.json(body);
  })

  // One show's page, by its page address (or its id, until it has one)
  .get("/:handle/shows/:slug", async (c) => {
    const page = await findPublicShowPage(c.req.param("handle"), c.req.param("slug"));
    return page ? c.json(page) : c.json({ error: "Show not found" } satisfies ApiError, 404);
  });

/** A published show's public page, or null if there's no such page. */
export async function findPublicShowPage(handle: string, rawSlug: string): Promise<PublicShowPage | null> {
  const profile = await publishedProfile(handle);
  if (!profile) return null;
  const slug = rawSlug.toLowerCase();
  if (!SHOW_SLUG_PATTERN.test(slug)) return null;

  const byAddress = uuidSchema.safeParse(slug).success ? or(eq(events.pageSlug, slug), eq(events.id, slug)) : eq(events.pageSlug, slug);
  const [row] = await db
    .select()
    .from(events)
    .where(and(publishedShows(profile.userId), byAddress))
    .limit(1);
  if (!row) return null;

  const [show] = await toPublicShows(profile.handle, [row]);
  const { tagline: _t, ...settings } = pageSettings(row.pageSettings);
  const body: PublicShowPage = {
    organizer: {
      handle: profile.handle,
      displayName: profile.displayName,
      logoUrl: uploadUrl(profile.logoFile),
      websiteUrl: profile.websiteUrl,
      instagram: profile.instagram,
      contactEmail: profile.contactEmail,
    },
    show: { ...show, booking: settings.showVendorBooking ? show.booking : null },
    // Tickets are only sold until the show is over
    page: { ...settings, tickets: show.upcoming ? settings.tickets : "" },
  };
  return body;
}
