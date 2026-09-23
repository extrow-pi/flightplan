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
export const MAX_TABLES = 500;
export const MAX_TABLES_PER_REQUEST = 20;

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
    vendorTables: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Can't be negative").max(MAX_TABLES),
    tablePriceCents: cents,
    ticketPriceCents: cents,
    status: z.enum(EVENT_STATUSES).optional().default("draft"),
    // Vendor booking settings
    requiresApproval: z.boolean().optional().default(false),
    /** Days a vendor has to pay once their table is approved; null = no deadline */
    paymentDueDays: z
      .number({ error: "Enter a number of days" })
      .int("Whole days only")
      .min(1, "At least 1 day")
      .max(90, "Up to 90 days")
      .nullable()
      .optional()
      .default(7),
    /** Whether the public booking link accepts bookings (personal invites work either way) */
    bookingOpen: z.boolean().optional().default(false),
    paymentInstructions: z.string().trim().max(1000).optional().default(""),
    /** How many tables a vendor can pick in one request */
    maxTablesPerRequest: z
      .number({ error: "Enter a number" })
      .int("Whole numbers only")
      .min(1, "At least 1")
      .max(MAX_TABLES_PER_REQUEST, `Up to ${MAX_TABLES_PER_REQUEST}`)
      .optional()
      .default(4),
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
  /** URL of the uploaded floor map image, if any */
  floorMapUrl: string | null;
  /** Secret token for the event's public booking link (/book/:token) */
  bookingToken: string;
  createdAt: string;
  updatedAt: string;
};

export type EventFieldErrors = Partial<Record<keyof EventInput, string[]>>;

/** Create a draft from a template, starting on `startDate`. */
export const spawnFromTemplateSchema = z.object({ startDate: z.iso.date("Pick a date") });

// ── Vendor table booking ────────────────────────────────────────────────────

// pending: waiting for organizer approval · awaiting_payment: approved, vendor hasn't paid yet
// paid: confirmed · rejected / released / cancelled: the table is free again
export const BOOKING_STATUSES = ["pending", "awaiting_payment", "paid", "rejected", "released", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold a table. A table can have at most one booking in these. */
export const ACTIVE_BOOKING_STATUSES = ["pending", "awaiting_payment", "paid"] as const satisfies readonly BookingStatus[];

export const BOOKING_SOURCES = ["public_link", "invite", "organizer"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const FLOOR_MAP_MAX_BYTES = 10 * 1024 * 1024;
export const FLOOR_MAP_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** A vendor's contact details, as entered on a booking page or by the organizer. */
export const vendorContactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  businessName: z.string().trim().max(120).optional().default(""),
  email: z.email("Please enter a valid email").trim().toLowerCase().max(254),
  phone: z.string().trim().max(40).optional().default(""),
});
export type VendorContactInput = z.input<typeof vendorContactSchema>;

/** A vendor booking a table from a public or invite link. */
export const vendorBookingSchema = vendorContactSchema.extend({
  tableIds: z
    .array(z.uuid("Pick a table"))
    .min(1, "Pick at least one table")
    .max(MAX_TABLES_PER_REQUEST, `Up to ${MAX_TABLES_PER_REQUEST} tables`)
    .refine((ids) => new Set(ids).size === ids.length, "Each table can only be picked once"),
  message: z.string().trim().max(1000).optional().default(""),
});
export type VendorBookingInput = z.input<typeof vendorBookingSchema>;

/** The organizer assigning a table: an existing vendor from their list, or new contact details. */
export const assignTableSchema = z
  .object({
    tableId: z.uuid("Pick a table"),
    vendorId: z.uuid().optional(),
    contact: vendorContactSchema.optional(),
    /** Mark as paid straight away (e.g. paid at the door or in advance) */
    paid: z.boolean().optional().default(false),
  })
  .refine((a) => a.vendorId || a.contact, { message: "Pick a vendor or enter their details", path: ["vendorId"] });
export type AssignTableInput = z.input<typeof assignTableSchema>;

export const createInviteSchema = z.object({
  name: z.string().trim().max(100).optional().default(""),
  email: z.union([z.literal(""), z.email("Enter a valid email").trim().toLowerCase()]).optional().default(""),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

/** Keep an overdue booking: extend the deadline by some days, or drop the deadline entirely. */
export const keepBookingSchema = z.object({
  extendDays: z.number().int().min(1).max(90).nullable().optional().default(null),
});

/** Release one table, or every table in the vendor's request. */
export const releaseBookingSchema = z.object({
  wholeRequest: z.boolean().optional().default(false),
});

export type Vendor = {
  id: string;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  notes: string;
  createdAt: string;
};

/**
 * One table in a vendor's request. A request for several tables is several bookings sharing a
 * requestId: they're approved, paid and kept together, and can be released one by one.
 */
export type Booking = {
  id: string;
  requestId: string;
  tableId: string;
  vendorId: string;
  status: BookingStatus;
  source: BookingSource;
  // Contact details as submitted for this booking
  name: string;
  businessName: string;
  email: string;
  phone: string;
  message: string;
  createdAt: string;
  approvedAt: string | null;
  paymentDueAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
  /** True when awaiting payment and the deadline has passed */
  overdue: boolean;
};

export type EventTable = {
  id: string;
  number: number;
  label: string;
  /** The table's active booking, if any */
  booking: Booking | null;
};

export type Invite = {
  id: string;
  token: string;
  name: string;
  email: string;
  createdAt: string;
  /** Set once the invite has been used to book */
  bookingId: string | null;
  revokedAt: string | null;
};

/** Everything the organizer's Tables page needs for one event. */
export type EventTablesResponse = {
  tables: EventTable[];
  /** Past bookings (rejected / released / cancelled), newest first */
  history: Booking[];
  invites: Invite[];
};

/** A vendor request that needs the organizer's attention on the dashboard. */
export type BookingAlert = {
  kind: "overdue" | "pending";
  /** One of the request's bookings (they share status, vendor and deadline) */
  booking: Booking;
  eventId: string;
  eventName: string;
  tableLabels: string[];
};

/** What a vendor sees on a public booking page. No other vendors' details. */
export type PublicBookingPage = {
  event: {
    name: string;
    description: string;
    venueName: string;
    address: string;
    city: string;
    startDate: string;
    days: EventDay[];
    tablePriceCents: number;
    requiresApproval: boolean;
    paymentDueDays: number | null;
    floorMapUrl: string | null;
    maxTablesPerRequest: number;
  };
  tables: { id: string; label: string; available: boolean }[];
  /** For invite links: who it was sent to, and whether it's been used */
  invite: { name: string; email: string; used: boolean } | null;
  /** Why booking isn't possible right now, if it isn't */
  closedReason: string | null;
};

export type PublicBookingResult = {
  /** For the vendor status page, /booking/:requestId */
  requestId: string;
  status: BookingStatus;
  tableLabels: string[];
  paymentDueAt: string | null;
  paymentInstructions: string;
};

/** A vendor's private status page for one request (/booking/:requestId, linked from emails). */
export type PublicRequestStatus = {
  event: {
    name: string;
    venueName: string;
    address: string;
    city: string;
    startDate: string;
    days: EventDay[];
    tablePriceCents: number;
    floorMapUrl: string | null;
  };
  organizerName: string;
  vendorName: string;
  /** The request's shared status; "closed" once none of its tables are held */
  status: "pending" | "awaiting_payment" | "paid" | "closed";
  /** How it ended, when status is "closed" */
  closedAs: BookingStatus | null;
  /** Tables the request still holds */
  tableLabels: string[];
  paymentDueAt: string | null;
  overdue: boolean;
  paymentInstructions: string;
};

// ── Email log ───────────────────────────────────────────────────────────────

export type EmailStatus = "queued" | "sent" | "failed" | "logged";

export type EmailLogEntry = {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: EmailStatus;
  eventId: string | null;
  eventName: string | null;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
};

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
