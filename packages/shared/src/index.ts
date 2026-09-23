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

export const EVENT_STATUSES = ["draft", "published"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const cents = z.number({ error: "Enter an amount" }).int("Whole cents only").min(0, "Can't be negative").max(1_000_000, "That's too high");

// Dates and times are the event's local wall-clock time, stored as-is (no timezone conversion).
export const eventInputSchema = z
  .object({
    name: z.string().trim().min(3, "Give your event a name").max(120),
    description: z.string().trim().max(2000).optional().default(""),
    venueName: z.string().trim().min(2, "Where is it happening?").max(120),
    address: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().min(2, "Which city?").max(100),
    date: z.iso.date("Pick a date"),
    startTime: time,
    endTime: time,
    vendorTables: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Can't be negative").max(2000),
    tablePriceCents: cents,
    ticketPriceCents: cents,
    status: z.enum(EVENT_STATUSES).optional().default("draft"),
  })
  .refine((e) => e.endTime > e.startTime, { message: "Must end after it starts", path: ["endTime"] });

export type EventInput = z.input<typeof eventInputSchema>;

export type EventRecord = z.output<typeof eventInputSchema> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type EventFieldErrors = Partial<Record<keyof EventInput, string[]>>;
