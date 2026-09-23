import { z } from "zod";

export const EVENT_TYPES = [
  "Trading card shows",
  "Collectibles & comics",
  "Markets & fairs",
  "Tournaments",
  "Conventions",
  "Other",
] as const;

export const EVENTS_PER_YEAR = ["1-2", "3-6", "7-12", "12+"] as const;

// Shared by the signup form (client-side checks) and the API (the real gatekeeper).
export const organizerSignupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  email: z.email("Please enter a valid email").trim().toLowerCase().max(254),
  organization: z.string().trim().max(120).optional().default(""),
  city: z.string().trim().min(2, "Where are your events?").max(100),
  eventType: z.enum(EVENT_TYPES, { message: "Pick the closest fit" }),
  eventsPerYear: z.enum(EVENTS_PER_YEAR, { message: "Pick one" }),
  message: z.string().trim().max(1000).optional().default(""),
});

export type OrganizerSignupInput = z.input<typeof organizerSignupSchema>;
export type OrganizerSignup = z.output<typeof organizerSignupSchema>;

export type ApiError = {
  error: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

// ── Events ────────────────────────────────────────────────────────────────

// template: reusable, no dates. draft: dated, only visible to the organizer. published: live.
export const EVENT_STATUSES = ["template", "draft", "published"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const MAX_EVENT_DAYS = 14;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");
const cents = z.number({ error: "Enter an amount" }).int("Whole cents only").min(0, "Can't be negative").max(1_000_000, "That's too high");

// A show day, as an offset from the show's first day (0 = first day). Times are local wall-clock.
export const eventDaySchema = z
  .object({
    dayOffset: z.number().int().min(0).max(60, "Keep a show within two months"),
    startTime: time,
    endTime: time,
  })
  .refine((d) => d.endTime > d.startTime, { message: "Must end after it starts", path: ["endTime"] });

export type EventDay = z.output<typeof eventDaySchema>;

// Dates are local wall-clock values, stored as-is (no timezone conversion).
export const eventInputSchema = z
  .object({
    name: z.string().trim().min(3, "Give your event a name").max(120),
    description: z.string().trim().max(2000).optional().default(""),
    venueName: z.string().trim().min(2, "Where is it happening?").max(120),
    address: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().min(2, "Which city?").max(100),
    startDate: z.iso.date("Pick a date").nullable().optional().default(null),
    days: z.array(eventDaySchema).min(1, "Add at least one day").max(MAX_EVENT_DAYS, `Up to ${MAX_EVENT_DAYS} days`),
    vendorTables: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Can't be negative").max(2000),
    tablePriceCents: cents,
    ticketPriceCents: cents,
    status: z.enum(EVENT_STATUSES).optional().default("draft"),
  })
  .superRefine((e, ctx) => {
    if (e.status !== "template" && !e.startDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "Pick a date" });
    }
    const offsets = e.days.map((d) => d.dayOffset);
    if (new Set(offsets).size !== offsets.length) {
      ctx.addIssue({ code: "custom", path: ["days"], message: "Each day can only appear once" });
    }
    if (offsets.length && !offsets.includes(0)) {
      ctx.addIssue({ code: "custom", path: ["days"], message: "The first day must be day 1" });
    }
  })
  // Templates are undated; days are kept in order
  .transform((e) => ({
    ...e,
    startDate: e.status === "template" ? null : e.startDate,
    days: [...e.days].sort((a, b) => a.dayOffset - b.dayOffset),
  }));

export type EventInput = z.input<typeof eventInputSchema>;

export type EventRecord = z.output<typeof eventInputSchema> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type EventFieldErrors = Partial<Record<keyof EventInput, string[]>>;

/** Create a draft from a template, starting on `startDate`. */
export const spawnFromTemplateSchema = z.object({ startDate: z.iso.date("Pick a date") });

// ── Date helpers (YYYY-MM-DD strings, no timezones) ─────────────────────────

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

/** The calendar date of each show day, or null for templates. */
export function eventDayDates(event: { startDate: string | null; days: EventDay[] }) {
  return event.days.map((d) => (event.startDate ? addDays(event.startDate, d.dayOffset) : null));
}

/** Last calendar day of a dated event. */
export function eventEndDate(event: { startDate: string | null; days: EventDay[] }) {
  if (!event.startDate) return null;
  return addDays(event.startDate, Math.max(...event.days.map((d) => d.dayOffset)));
}
