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

// ── Pricing and discounts ────────────────────────────────────────────────────

// Multi-table discount tiers, set per show: "3+ tables: 10% off" or "5+ tables: $15 off each table".
// The highest tier a request reaches applies.
export const BULK_DISCOUNT_KINDS = ["percent", "per_table"] as const;
export type BulkDiscountKind = (typeof BULK_DISCOUNT_KINDS)[number];
export const MAX_DISCOUNT_TIERS = 10;

export const bulkDiscountTierSchema = z
  .object({
    minTables: z.number({ error: "Enter a number" }).int("Whole numbers only").min(2, "At least 2 tables").max(20, "Up to 20"),
    kind: z.enum(BULK_DISCOUNT_KINDS),
    /** Percent (1–100) for "percent"; cents off each table for "per_table" */
    value: z.number({ error: "Enter an amount" }).int().min(1, "Must be more than 0").max(1_000_000),
  })
  .refine((t) => t.kind !== "percent" || t.value <= 100, { message: "Up to 100%", path: ["value"] });
export type BulkDiscountTier = z.output<typeof bulkDiscountTierSchema>;

// Discount codes: a percentage or a fixed amount off a whole request
export const DISCOUNT_CODE_KINDS = ["percent", "amount"] as const;
export type DiscountCodeKind = (typeof DISCOUNT_CODE_KINDS)[number];

export type AppliedDiscount = { kind: "percent" | "per_table" | "amount"; value: number };

/** Human label for a discount, e.g. "3+ tables: 10% off" or "Code EARLYBIRD: $20 off" */
export function discountLabel(d: { source: "tier" | "code"; kind: "percent" | "per_table" | "amount"; value: number; minTables?: number; code?: string }) {
  const amount = d.kind === "percent" ? `${d.value}% off` : `${formatCents(d.value)} off${d.kind === "per_table" ? " each table" : ""}`;
  return d.source === "tier" ? `${d.minTables}+ tables: ${amount}` : `Code ${d.code}: ${amount}`;
}

function formatCents(c: number) {
  return "$" + (c / 100).toFixed(2).replace(/\.00$/, "");
}

export type PriceQuote = {
  tableCount: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** What the discount is, e.g. "3+ tables: 10% off"; "" for none */
  label: string;
  /** Which discount won (the bigger one; a tier wins ties) */
  source: "tier" | "code" | null;
  /** Each table's share of the total, in table order (they add up to totalCents) */
  perTableCents: number[];
};

/**
 * Price a request for `tableCount` tables. Applies the best multi-table tier, or the code if it saves
 * more (never both). The code must already be validated.
 */
export function priceRequest(args: {
  /** Each table's list price (its table type's price), in table order */
  prices: number[];
  tiers: BulkDiscountTier[];
  code?: { code: string; kind: DiscountCodeKind; value: number } | null;
}): PriceQuote {
  const { prices } = args;
  const n = prices.length;
  const subtotal = prices.reduce((sum, p) => sum + p, 0);
  // Tiers count every table, whatever its type
  const tier = [...args.tiers].filter((t) => n >= t.minTables).sort((a, b) => b.minTables - a.minTables)[0];
  const tierOff = !tier
    ? 0
    : tier.kind === "percent"
      ? Math.round((subtotal * tier.value) / 100)
      : prices.reduce((sum, p) => sum + Math.min(tier.value, p), 0);
  const codeOff = !args.code
    ? 0
    : args.code.kind === "percent"
      ? Math.round((subtotal * args.code.value) / 100)
      : Math.min(args.code.value, subtotal);

  let source: PriceQuote["source"] = null;
  let discount = 0;
  let label = "";
  if (codeOff > tierOff && args.code) {
    source = "code";
    discount = codeOff;
    label = discountLabel({ source: "code", ...args.code });
  } else if (tierOff > 0 && tier) {
    source = "tier";
    discount = tierOff;
    label = discountLabel({ source: "tier", ...tier });
  }
  discount = Math.min(discount, subtotal);
  const total = subtotal - discount;
  // Each table's share of the total. "$ off each table" comes off each table; other discounts are
  // shared in proportion to each table's price, with leftover cents going to the first tables.
  let perTableCents: number[];
  if (source === "tier" && tier?.kind === "per_table") {
    perTableCents = prices.map((p) => p - Math.min(tier.value, p));
  } else {
    perTableCents = prices.map((p) => (subtotal ? Math.floor((p * total) / subtotal) : 0));
    let left = total - perTableCents.reduce((sum, c) => sum + c, 0);
    for (let i = 0; left > 0 && n; i = (i + 1) % n, left--) perTableCents[i]++;
  }
  return { tableCount: n, subtotalCents: subtotal, discountCents: discount, totalCents: total, label, source, perTableCents };
}

// A show day, as an offset from the show's first day (0 = first day). Times are local wall-clock.
export const eventDaySchema = z
  .object({
    dayOffset: z.number().int().min(0).max(60, "Keep a show within two months"),
    /** When vendors can start setting up ("" = not set) */
    setupTime: z.union([z.literal(""), time]).optional().default(""),
    startTime: time,
    endTime: time,
  })
  .refine((d) => d.endTime > d.startTime, { message: "Must end after it starts", path: ["endTime"] })
  .refine((d) => !d.setupTime || d.setupTime < d.startTime, { message: "Setup should start before opening", path: ["setupTime"] });

export type EventDay = z.output<typeof eventDaySchema>;

// ── Table types ──────────────────────────────────────────────────────────────

export const MAX_TABLE_TYPES = 10;

/**
 * A kind of vendor table at a show, e.g. "6 ft table" at $60 × 20. Tables are numbered in one
 * sequence, type by type; a type with a prefix is labelled prefix + 1…N instead (e.g. L1–L10).
 */
export const tableTypeSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Name this table type").max(40, "Keep the name under 40 characters"),
  priceCents: cents,
  count: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Can't be negative").max(MAX_TABLES),
  prefix: z
    .string()
    .trim()
    .max(4, "Prefixes can be up to 4 characters")
    .regex(/^([A-Za-z][A-Za-z0-9-]*)?$/, "Start the prefix with a letter (e.g. L)")
    .optional()
    .default(""),
});
export type TableType = z.output<typeof tableTypeSchema>;
export type TableTypeInput = z.input<typeof tableTypeSchema>;

/** The single type an event has when it only sets a table count and price */
export const STANDARD_TABLE_TYPE_ID = "standard";

/** Every table's label and type, in order: one running number, except prefixed types (A1, A2…). */
export function tableLabels(types: Pick<TableType, "id" | "count" | "prefix">[]) {
  const out: { typeId: string; label: string }[] = [];
  let next = 1;
  for (const t of types) {
    for (let i = 1; i <= t.count; i++) out.push({ typeId: t.id, label: t.prefix ? `${t.prefix}${i}` : String(next++) });
  }
  return out;
}

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
    /** Table types (6 ft, 8 ft…). Without them, vendorTables and tablePriceCents make one "Table" type. */
    tableTypes: z.array(tableTypeSchema).max(MAX_TABLE_TYPES, `Up to ${MAX_TABLE_TYPES} table types`).optional().default([]),
    /** Worked out from the table types on save: the total number of tables, and the lowest price */
    vendorTables: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Can't be negative").max(MAX_TABLES).optional(),
    tablePriceCents: cents.optional(),
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
    /** Multi-table discounts, e.g. 3+ tables 10% off; the highest tier reached applies */
    bulkDiscounts: z.array(bulkDiscountTierSchema).max(MAX_DISCOUNT_TIERS, `Up to ${MAX_DISCOUNT_TIERS} tiers`).optional().default([]),
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
    const mins = e.bulkDiscounts.map((t) => t.minTables);
    if (new Set(mins).size !== mins.length) {
      ctx.addIssue({ code: "custom", path: ["bulkDiscounts"], message: "Each tier needs a different number of tables" });
    }
    if (e.tableTypes.length) {
      if (new Set(e.tableTypes.map((t) => t.id)).size !== e.tableTypes.length) {
        ctx.addIssue({ code: "custom", path: ["tableTypes"], message: "Two table types share an id" });
      }
      const prefixes = e.tableTypes.map((t) => t.prefix.toLowerCase()).filter(Boolean);
      if (new Set(prefixes).size !== prefixes.length) {
        ctx.addIssue({ code: "custom", path: ["tableTypes"], message: "Each table type needs a different prefix" });
      }
      if (e.tableTypes.reduce((n, t) => n + t.count, 0) > MAX_TABLES) {
        ctx.addIssue({ code: "custom", path: ["tableTypes"], message: `Up to ${MAX_TABLES} tables in all` });
      }
    } else {
      if (e.vendorTables === undefined) ctx.addIssue({ code: "custom", path: ["vendorTables"], message: "Enter a number" });
      if (e.tablePriceCents === undefined) ctx.addIssue({ code: "custom", path: ["tablePriceCents"], message: "Enter an amount" });
    }
  })
  // Templates are undated; days are kept in order
  .transform((e) => {
    const tableTypes: TableType[] = e.tableTypes.length
      ? e.tableTypes
      : [{ id: STANDARD_TABLE_TYPE_ID, name: "Table", priceCents: e.tablePriceCents ?? 0, count: e.vendorTables ?? 0, prefix: "" }];
    return {
    ...e,
    tableTypes,
    vendorTables: tableTypes.reduce((n, t) => n + t.count, 0),
    // The lowest price, for "from $60" (all types count, even ones with no tables yet)
    tablePriceCents: Math.min(...tableTypes.map((t) => t.priceCents)),
    startDate: e.status === "template" ? null : e.startDate,
    days: [...e.days].sort((a, b) => a.dayOffset - b.dayOffset),
    bulkDiscounts: [...e.bulkDiscounts].sort((a, b) => a.minTables - b.minTables),
    };
  });

export type EventInput = z.input<typeof eventInputSchema>;

export type EventRecord = z.output<typeof eventInputSchema> & {
  id: string;
  /** URL of the uploaded floor map image, if any */
  floorMapUrl: string | null;
  /** Secret token for the event's public booking link (/book/:token) */
  bookingToken: string;
  createdAt: string;
  updatedAt: string;
  /** What the signed-in organizer can do with this event, and whose it is */
  access: EventAccess;
  /** The event's own floorplan, if it has one. Its tables are the event's bookable tables. */
  floorplan: { tableCount: number; updatedAt: string } | null;
  /** Who appears on the public visitor map (/map/:id) */
  publicMap: PublicMapMode;
};

// ── Collaborators ───────────────────────────────────────────────────────────

// editor: everything except deleting the event and managing the team · viewer: read-only
export const COLLABORATOR_ROLES = ["editor", "viewer"] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];
export type EventRole = "owner" | CollaboratorRole;

export type EventAccess = {
  role: EventRole;
  ownerName: string;
};

export const canEditEvent = (role: EventRole) => role !== "viewer";

/** Invites expire after this many days */
export const COLLABORATOR_INVITE_DAYS = 7;
/** Collaborators plus pending invites allowed on one event */
export const MAX_COLLABORATORS = 25;

export const inviteCollaboratorSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  role: z.enum(COLLABORATOR_ROLES),
});
export type InviteCollaboratorInput = z.input<typeof inviteCollaboratorSchema>;

export const updateCollaboratorSchema = z.object({ role: z.enum(COLLABORATOR_ROLES) });

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: EventRole;
  /** When they joined; the owner's is the event's creation time */
  addedAt: string;
};

export type CollaboratorInvite = {
  id: string;
  email: string;
  role: CollaboratorRole;
  createdAt: string;
  expiresAt: string;
};

export type EventTeamResponse = {
  /** Owner first, then collaborators in the order they joined */
  members: TeamMember[];
  /** Pending invites (only returned to the owner) */
  invites: CollaboratorInvite[];
  myRole: EventRole;
};

/** What someone opening an invite link sees before accepting. */
export type CollaboratorInvitePreview = {
  eventName: string;
  isTemplate: boolean;
  inviterName: string;
  role: CollaboratorRole;
  email: string;
  status: "pending" | "accepted" | "expired" | "revoked";
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
  /** Optional discount code */
  discountCode: z.string().trim().toUpperCase().max(40).optional().default(""),
});
export type VendorBookingInput = z.input<typeof vendorBookingSchema>;

/** Price preview on the booking page, before submitting */
export const quoteRequestSchema = z.object({
  tableCount: z.number().int().min(1).max(MAX_TABLES_PER_REQUEST),
  /** The picked tables, so each is priced by its type (otherwise tableCount at the lowest price) */
  tableIds: z.array(z.uuid()).max(MAX_TABLES_PER_REQUEST).optional().default([]),
  discountCode: z.string().trim().toUpperCase().max(40).optional().default(""),
  /** Lets "one use per vendor" codes be checked early */
  email: z.union([z.literal(""), z.email().trim().toLowerCase()]).optional().default(""),
});
export type QuoteRequestInput = z.input<typeof quoteRequestSchema>;
export type QuoteResponse = PriceQuote & {
  /** Why the code didn't apply, if one was entered and rejected */
  codeError: string | null;
  /** The code was valid but the multi-table discount saves more, so it wasn't used */
  codeNotBest: boolean;
};

// How a vendor paid. Payments happen outside Flightplan; organizers record the method when marking paid.
export const PAYMENT_METHODS = ["etransfer", "cash", "square", "card", "paypal", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  etransfer: "E-transfer",
  cash: "Cash",
  square: "Square",
  card: "Credit / debit card",
  paypal: "PayPal",
  other: "Other",
};

/** Mark a request paid, optionally saying how (null = not recorded). */
export const markPaidSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional().default(null),
});

/** Change (or clear) how a paid request was paid. */
export const setPaymentMethodSchema = z.object({ paymentMethod: z.enum(PAYMENT_METHODS).nullable() });

/**
 * The organizer assigning one or more tables (as one request) to an existing vendor from their list,
 * or to new contact details. The event's per-vendor limit doesn't apply to the organizer.
 */
export const assignTableSchema = z
  .object({
    tableIds: z
      .array(z.uuid())
      .min(1, "Pick at least one table")
      .max(MAX_TABLES_PER_REQUEST, `Up to ${MAX_TABLES_PER_REQUEST} tables at a time`)
      .refine((ids) => new Set(ids).size === ids.length, "Each table can only be picked once"),
    vendorId: z.uuid().optional(),
    contact: vendorContactSchema.optional(),
    /** Mark as paid straight away (e.g. paid at the door or in advance) */
    paid: z.boolean().optional().default(false),
    /** Optional discount code */
    discountCode: z.string().trim().toUpperCase().max(40).optional().default(""),
    /** How they paid, when `paid` is set */
    paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional().default(null),
  })
  .refine((a) => a.vendorId || a.contact, { message: "Pick a vendor or enter their details", path: ["vendorId"] });
export type AssignTableInput = z.input<typeof assignTableSchema>;

/** Add a vendor to a show without a table yet: one from the organizer's list, or new contact details. */
export const addEventVendorSchema = z
  .object({
    vendorId: z.uuid().optional(),
    contact: vendorContactSchema.optional(),
    note: z.string().trim().max(500, "Keep the note under 500 characters").optional().default(""),
  })
  .refine((a) => a.vendorId || a.contact, { message: "Pick a vendor or enter their details", path: ["vendorId"] });
export type AddEventVendorInput = z.input<typeof addEventVendorSchema>;

/** A vendor added to a show who doesn't have a table there yet. */
export type UnassignedVendor = {
  vendorId: string;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  note: string;
  addedAt: string;
};

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
  favourite: boolean;
  /** On the organizer's ban list: their requests always need approval and are flagged */
  banned: boolean;
};

// ── Vendor list (the Vendors page) ──────────────────────────────────────────

/** A vendor on the organizer's Vendors page, with groups and booking stats. */
export type VendorListItem = Vendor & {
  banReason: string;
  bannedAt: string | null;
  groupIds: string[];
  /** Requests across all of the organizer's shows, and how many shows */
  requestCount: number;
  showCount: number;
  lastRequestAt: string | null;
};

export type VendorGroup = { id: string; name: string; vendorCount: number };

export const MAX_VENDOR_GROUPS = 50;

export const vendorGroupSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name").max(40, "Up to 40 characters"),
});

/** Add a vendor by hand */
export const createVendorSchema = vendorContactSchema.extend({
  name: z.string().trim().min(2, "Enter their name").max(100),
  notes: z.string().trim().max(2000).optional().default(""),
});
export type CreateVendorInput = z.input<typeof createVendorSchema>;

/** Edit a vendor. Every field is optional; groupIds replaces the vendor's groups. */
export const updateVendorSchema = z.object({
  name: z.string().trim().min(2, "Enter their name").max(100).optional(),
  businessName: z.string().trim().max(120).optional(),
  email: z.email("Enter a valid email").trim().toLowerCase().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  favourite: z.boolean().optional(),
  banned: z.boolean().optional(),
  banReason: z.string().trim().max(500).optional(),
  groupIds: z.array(z.uuid()).max(MAX_VENDOR_GROUPS).optional(),
});
export type UpdateVendorInput = z.input<typeof updateVendorSchema>;

// ── Emailing a show's vendors ───────────────────────────────────────────────

/** Who at a show can be emailed, by where their request stands (overdue counts as awaiting payment). */
export const VENDOR_AUDIENCES = ["paid", "awaiting_payment", "pending", "unassigned"] as const;
export type VendorAudience = (typeof VENDOR_AUDIENCES)[number];
export const vendorAudienceLabels: Record<VendorAudience, string> = {
  paid: "Paid",
  awaiting_payment: "Awaiting payment",
  pending: "Needs approval",
  unassigned: "No table yet",
};

// Files sent with a message: PDFs are attached; images can also be shown in the email (for branding)
export const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** All of a message's files together; each vendor's copy carries them all */
export const ATTACHMENTS_TOTAL_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
/** Where an image goes: above the greeting (a banner or logo), below the message, or just attached */
export const ATTACHMENT_PLACEMENTS = ["top", "bottom", "attached"] as const;
export type AttachmentPlacement = (typeof ATTACHMENT_PLACEMENTS)[number];

/** A file uploaded for a message, before it's sent. */
export type MessageAttachment = { id: string; filename: string; contentType: string; size: number };

export const vendorMessageSchema = z.object({
  subject: z.string().trim().min(1, "Add a subject").max(150, "Keep the subject under 150 characters"),
  message: z.string().trim().min(1, "Write a message").max(5000, "Keep the message under 5,000 characters"),
  audience: z
    .array(z.enum(VENDOR_AUDIENCES))
    .min(1, "Pick who to email")
    .refine((a) => new Set(a).size === a.length, "Each group can only be picked once"),
  /** Add each vendor's own tables and status under the message */
  includeDetails: z.boolean().optional().default(true),
  /** Send one copy to the signed-in organizer instead of the vendors */
  test: z.boolean().optional().default(false),
  /** Uploaded files, in order. Only images can be placed in the email; PDFs are always attached. */
  attachments: z
    .array(z.object({ id: z.uuid(), placement: z.enum(ATTACHMENT_PLACEMENTS).optional().default("attached") }))
    .max(MAX_ATTACHMENTS, `Up to ${MAX_ATTACHMENTS} files`)
    .refine((a) => new Set(a.map((x) => x.id)).size === a.length, "Each file can only be added once")
    .optional()
    .default([]),
});
export type VendorMessageInput = z.input<typeof vendorMessageSchema>;
export type VendorMessageResult = { sent: number; test: boolean };

// ── Vendor import (CSV) ─────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 2000;

/** The vendor details an import can set. Email is the key that matches existing vendors. */
export const VENDOR_IMPORT_FIELDS = ["name", "businessName", "phone", "notes"] as const;
export type VendorImportField = (typeof VENDOR_IMPORT_FIELDS)[number];

/** One vendor read from a CSV file. `line` is its line in the file, for error messages. */
export const vendorImportRowSchema = z.object({
  line: z.number().int().min(1),
  name: z.string().trim().min(2, "Name is missing or too short").max(100, "Name is too long"),
  businessName: z.string().trim().max(120, "Business name is too long").optional().default(""),
  email: z.email("Email is missing or not valid").trim().toLowerCase().max(254),
  phone: z.string().trim().max(40, "Phone is too long").optional().default(""),
  notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
});

export const vendorImportSchema = z.object({
  // Rows are checked one by one on the server so a bad row doesn't block the rest
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "The file has no vendors")
    .max(MAX_IMPORT_ROWS, `Up to ${MAX_IMPORT_ROWS} vendors at a time`),
  /** Existing vendors (by email) whose details the file should replace, or "all" of them */
  overwrite: z.union([z.literal("all"), z.array(z.string().trim().toLowerCase()).max(MAX_IMPORT_ROWS)]).optional().default([]),
  /** Work out what would happen without saving anything */
  preview: z.boolean().optional().default(false),
});
export type VendorImportInput = z.input<typeof vendorImportSchema>;

/** An existing vendor whose details differ from the file's. */
export type VendorImportConflict = {
  email: string;
  line: number;
  /** Fields that differ (the file's blank cells never count) */
  fields: VendorImportField[];
  current: Record<VendorImportField, string>;
  incoming: Record<VendorImportField, string>;
};

export type VendorImportResult = {
  preview: boolean;
  /** Rows read from the file */
  total: number;
  /** Rows that can't be imported, by line in the file */
  invalid: { line: number; error: string }[];
  /** New vendors added to the list */
  created: number;
  /** Existing vendors whose details were replaced */
  updated: number;
  /** Existing vendors left as they were (same details, or not overwritten) */
  unchanged: number;
  /** Existing vendors whose details differ. In a preview, all of them; after importing, the ones left as they were. */
  conflicts: VendorImportConflict[];
  /** Importing into a show: vendors added to it without a table, and vendors already on it */
  addedToShow?: number;
  alreadyAtShow?: number;
};

/** One of a vendor's requests, for their history on the Vendors page. */
export type VendorRequestHistory = {
  requestId: string;
  eventId: string;
  eventName: string;
  eventStartDate: string | null;
  tableLabels: string[];
  status: BookingStatus;
  paymentMethod: PaymentMethod | null;
  createdAt: string;
};

/** Send personal booking invites to everyone in a group, or to all favourites. */
export const bulkInviteSchema = z.object({ target: z.union([z.literal("favourites"), z.uuid()]) });
export type BulkInviteResult = {
  invited: number;
  skipped: { name: string; email: string; reason: "banned" | "booked" | "invited" }[];
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
  /** List price of this table when booked, and what this table costs after any discount */
  basePriceCents: number;
  priceCents: number;
  /** The request's discount, e.g. "3+ tables: 10% off" ("" for none) */
  discountLabel: string;
  /** How the request was paid, if recorded (only for paid requests) */
  paymentMethod: PaymentMethod | null;
  /** True when awaiting payment and the deadline has passed */
  overdue: boolean;
};

export type EventTable = {
  id: string;
  number: number;
  label: string;
  /** The table on the event's floorplan, if it has one */
  planItemId: string | null;
  /** Which of the event's table types it is */
  typeId: string;
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
  /** Vendors added to the show who don't have a table yet, oldest first */
  unassigned: UnassignedVendor[];
  /** Favourite / banned flags for the vendors in this event's bookings (and unassigned vendors), by vendor id */
  vendorFlags: Record<string, { favourite: boolean; banned: boolean }>;
};

/** A vendor request that needs the organizer's attention on the dashboard. */
export type BookingAlert = {
  kind: "overdue" | "pending";
  /** One of the request's bookings (they share status, vendor and deadline) */
  booking: Booking;
  eventId: string;
  eventName: string;
  tableLabels: string[];
  /** The signed-in organizer's role on the event (viewers can't act on alerts) */
  role: EventRole;
  /** The vendor is on the event owner's ban list */
  vendorBanned: boolean;
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
    /** The kinds of table and their prices */
    tableTypes: { id: string; name: string; priceCents: number }[];
    bulkDiscounts: BulkDiscountTier[];
    /** Whether the organizer has any discount codes that could apply (shows the code field) */
    acceptsCodes: boolean;
  };
  tables: { id: string; label: string; available: boolean; typeId: string; planItemId: string | null }[];
  /** The show's floorplan, for picking tables on a map (no vendor names) */
  floorplan: PublicFloorplan | null;
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
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  discountLabel: string;
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
  /** For the tables still held: list price, discount and what to pay */
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  discountLabel: string;
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
  /** Names of attached files (images shown in the email included) */
  attachments: string[];
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

// ── Organizer public page (/o/:handle) ──────────────────────────────────────

/** Lowercase letters, digits and single hyphens, 3–30 characters, e.g. "jetlagged-cards" */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

/** Turn a name into a handle suggestion, e.g. "Jetlagged Cards!" → "jetlagged-cards" */
export function suggestHandle(name: string, maxLength = 30) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

const optionalUrl = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s && !/^https?:\/\//i.test(s) ? `https://${s}` : s))
  .pipe(z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "Enter a web address like jetlaggedcards.ca" })]));

export const organizerProfileSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_PATTERN, "3–30 lowercase letters, numbers and hyphens (e.g. jetlagged-cards)"),
  displayName: z.string().trim().min(2, "Enter the name to show").max(80),
  bio: z.string().trim().max(1000, "Up to 1000 characters").optional().default(""),
  websiteUrl: optionalUrl.optional().default(""),
  /** Instagram username, with or without @ */
  instagram: z
    .string()
    .trim()
    .max(31)
    .transform((s) => s.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Enter an Instagram username")]))
    .optional()
    .default(""),
  contactEmail: z.union([z.literal(""), z.email("Enter a valid email").trim().toLowerCase()]).optional().default(""),
  /** The public page is only visible when this is on */
  published: z.boolean().optional().default(false),
});
export type OrganizerProfileInput = z.input<typeof organizerProfileSchema>;

export type OrganizerProfile = z.output<typeof organizerProfileSchema> & {
  logoUrl: string | null;
};

// ── Show pages (/o/:handle/:slug) ───────────────────────────────────────────

/** Lowercase letters, digits and single hyphens, up to 60 characters, e.g. "spring-card-show-2026" */
export const SHOW_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,59}$/;

/** A show name as a page address, e.g. "Red-eye Night Market!" → "red-eye-night-market" */
export function suggestShowSlug(name: string) {
  return suggestHandle(name, 60);
}

export const TICKETSCANDY_ORIGIN = "https://ticketscandy.com";
const isTicketsCandyHost = (host: string) => host === "ticketscandy.com" || host.endsWith(".ticketscandy.com");
const TICKETSCANDY_FRAME = /^https:\/\/ticketscandy\.com\/checkout-widget\/frame\/(\d{1,12})$/;

/** The TicketsCandy event number of a checkout widget address, or null for other links. */
export const ticketsCandyEventId = (url: string) => TICKETSCANDY_FRAME.exec(url)?.[1] ?? null;

/**
 * The TicketsCandy address in what an organizer pasted, or null. Their "Embed on Page" code is a loader
 * script plus `TCCheckout.createWidget({ eventId: '21593', … })`; we keep just the event's checkout
 * frame (https://ticketscandy.com/checkout-widget/frame/21593). A pasted iframe or plain link on
 * ticketscandy.com is kept as is (except scripts and stylesheets). We embed the address ourselves rather
 * than the pasted HTML, so no outside script runs on our pages.
 */
export function ticketsCandyUrl(pasted: string): string | null {
  const text = pasted.trim().replace(/&amp;/g, "&");
  if (!text) return null;
  const eventId =
    /\beventId\s*:\s*["']?(\d{1,12})\b/.exec(text)?.[1] ??
    /ticketscandy\.com\/checkout-widget\/(?:frame|button)\/(\d{1,12})\b/i.exec(text)?.[1] ??
    /\btc-checkout-container-(\d{1,12})\b/.exec(text)?.[1];
  if (eventId) return `${TICKETSCANDY_ORIGIN}/checkout-widget/frame/${eventId}`;

  const iframeSrc = text.match(/<iframe\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
  const candidates = [iframeSrc, ...(text.match(/https:\/\/[^\s"'<>]+/gi) ?? [])].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const url = new URL(c);
      if (url.protocol === "https:" && isTicketsCandyHost(url.hostname.toLowerCase()) && !/\.(js|css)$/i.test(url.pathname)) {
        return url.href;
      }
    } catch {
      // not a URL; keep looking
    }
  }
  return null;
}

/** A YouTube or Vimeo link as an embeddable player address, or null. */
export function videoEmbedUrl(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const id = (s: string | null | undefined, pattern: RegExp) => (s && pattern.test(s) ? s : null);
  const yt = /^[A-Za-z0-9_-]{6,20}$/;
  let youtube: string | null = null;
  if (host === "youtu.be") youtube = id(url.pathname.slice(1), yt);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    youtube = url.pathname === "/watch" ? id(url.searchParams.get("v"), yt) : id(/^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1], yt);
  }
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube}`;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const vimeo = /^\/(?:video\/)?(\d{5,12})(?:\/|$)/.exec(url.pathname)?.[1];
    if (vimeo) return `https://player.vimeo.com/video/${vimeo}`;
  }
  return null;
}

/** Path of an uploaded image (cover, flyer, gallery and sponsor images are public) */
export const uploadPath = (file: string) => `/api/uploads/${file}`;
export const UPLOADED_IMAGE_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

export const SHOW_PAGE_THEMES = ["warm", "light", "dark"] as const;
export type ShowPageTheme = (typeof SHOW_PAGE_THEMES)[number];
export const MAX_SHOW_PAGE_BLOCKS = 20;
export const MAX_BLOCK_ITEMS = 30;

const imageFile = z.string().regex(UPLOADED_IMAGE_PATTERN, "Upload the image again");
const blockId = z.string().min(1).max(40);
const blockTitle = (fallback: string) => z.string().trim().max(80, "Up to 80 characters").optional().default(fallback);
const linkUrl = z
  .string()
  .trim()
  .min(1, "Enter a web address")
  .max(500)
  .transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.url({ protocol: /^https?$/, error: "Enter a web address like example.com" }));

/** The building blocks of a show page, in the organizer's order. */
export const showPageBlockSchema = z.discriminatedUnion("type", [
  /** Where the TicketsCandy widget goes (the code itself is the page's `tickets` setting) */
  z.object({ id: blockId, type: z.literal("tickets"), title: blockTitle("Tickets") }),
  z.object({
    id: blockId,
    type: z.literal("text"),
    title: z.string().trim().min(1, "Give this section a title").max(80, "Up to 80 characters"),
    body: z.string().trim().min(1, "Add some text").max(5000, "Up to 5000 characters"),
  }),
  z.object({
    id: blockId,
    type: z.literal("faq"),
    title: blockTitle("FAQ"),
    items: z
      .array(
        z.object({
          question: z.string().trim().min(1, "Enter a question").max(200, "Up to 200 characters"),
          answer: z.string().trim().min(1, "Enter an answer").max(2000, "Up to 2000 characters"),
        }),
      )
      .min(1, "Add at least one question")
      .max(MAX_BLOCK_ITEMS, `Up to ${MAX_BLOCK_ITEMS} questions`),
  }),
  z.object({
    id: blockId,
    type: z.literal("gallery"),
    title: blockTitle("Photos"),
    images: z.array(imageFile).min(1, "Add at least one photo").max(MAX_BLOCK_ITEMS, `Up to ${MAX_BLOCK_ITEMS} photos`),
  }),
  z.object({
    id: blockId,
    type: z.literal("video"),
    title: blockTitle(""),
    url: z
      .string()
      .trim()
      .refine((s) => videoEmbedUrl(s) !== null, "Paste a YouTube or Vimeo link"),
  }),
  z.object({
    id: blockId,
    type: z.literal("links"),
    title: blockTitle(""),
    links: z
      .array(z.object({ label: z.string().trim().min(1, "Enter a label").max(60, "Up to 60 characters"), url: linkUrl }))
      .min(1, "Add at least one link")
      .max(12, "Up to 12 links"),
  }),
  z.object({
    id: blockId,
    type: z.literal("sponsors"),
    title: blockTitle("Sponsors"),
    items: z
      .array(
        z.object({
          image: imageFile,
          name: z.string().trim().max(80, "Up to 80 characters").optional().default(""),
          url: z.union([z.literal(""), linkUrl]).optional().default(""),
        }),
      )
      .min(1, "Add at least one sponsor")
      .max(MAX_BLOCK_ITEMS, `Up to ${MAX_BLOCK_ITEMS} sponsors`),
  }),
  /** A map of the venue */
  z.object({ id: blockId, type: z.literal("map"), title: blockTitle("Getting there") }),
]);
export type ShowPageBlock = z.output<typeof showPageBlockSchema>;
export type ShowPageBlockInput = z.input<typeof showPageBlockSchema>;
export type ShowPageBlockType = ShowPageBlock["type"];

/** Every uploaded image a page uses (flyer, gallery photos, sponsor logos). */
export function showPageImages(page: { flyer: string; blocks: ShowPageBlock[] }) {
  const files = page.flyer ? [page.flyer] : [];
  for (const b of page.blocks) {
    if (b.type === "gallery") files.push(...b.images);
    if (b.type === "sponsors") files.push(...b.items.map((i) => i.image));
  }
  return files;
}

/** What an organizer can change on a show's public page. */
export const showPageSchema = z.object({
  /** The page address after /o/:handle/; empty uses the show's name */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.string().regex(SHOW_SLUG_PATTERN, "Lowercase letters, numbers and hyphens (e.g. spring-show-2026)")]))
    .optional()
    .default(""),
  tagline: z.string().trim().max(160, "Up to 160 characters").optional().default(""),
  /** Buttons and highlights, e.g. "#e8856a"; empty = Flightplan's coral */
  accentColor: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour")]))
    .optional()
    .default(""),
  theme: z.enum(SHOW_PAGE_THEMES).optional().default("warm"),
  /** The show's flyer, shown under its name */
  flyer: z.union([z.literal(""), imageFile]).optional().default(""),
  blocks: z
    .array(showPageBlockSchema)
    .max(MAX_SHOW_PAGE_BLOCKS, `Up to ${MAX_SHOW_PAGE_BLOCKS} blocks`)
    .optional()
    .default([])
    .superRefine((blocks, ctx) => {
      if (new Set(blocks.map((b) => b.id)).size !== blocks.length) ctx.addIssue({ code: "custom", message: "Two blocks share an id" });
      if (blocks.filter((b) => b.type === "tickets").length > 1) ctx.addIssue({ code: "custom", message: "The page can only have one Tickets block" });
      if (blocks.filter((b) => b.type === "map").length > 1) ctx.addIssue({ code: "custom", message: "The page can only have one Map block" });
    }),
  /** Show the "Book a vendor table" button while the booking link is open */
  showVendorBooking: z.boolean().optional().default(true),
  /** The TicketsCandy widget's embed code, or its link; stored as the address only */
  tickets: z
    .string()
    .max(10_000, "That's too long for a widget code")
    .optional()
    .default("")
    .superRefine((s, ctx) => {
      if (s.trim() && !ticketsCandyUrl(s)) {
        ctx.addIssue({ code: "custom", message: "Paste the widget code from TicketsCandy (Sell Online → Website Widget → Embed on Page)" });
      }
    })
    .transform((s) => ticketsCandyUrl(s) ?? ""),
  /** Height of the embedded ticket widget, in pixels */
  ticketsHeight: z
    .number({ error: "Enter a height" })
    .int("Whole pixels only")
    .min(300, "At least 300 px")
    .max(3000, "Up to 3000 px")
    .optional()
    .default(700),
});
export type ShowPageInput = z.input<typeof showPageSchema>;
/** As stored: `tickets` is the TicketsCandy address (or "") */
export type ShowPageSettings = Omit<z.output<typeof showPageSchema>, "slug">;

/** As kept in the database: also the images uploaded for the page, and the older text sections. */
export type StoredShowPage = Partial<ShowPageSettings> & {
  /** Images uploaded for the page that it doesn't use (yet), with their upload time (ms) */
  uploads?: { file: string; at: number }[];
  /** Older pages: uploaded images, and text sections instead of blocks */
  assets?: string[];
  sections?: { title: string; body: string }[];
};

/** A show's page settings for the dashboard's Show page tab. */
export type ShowPageResponse = {
  settings: ShowPageSettings;
  slug: string;
  coverUrl: string | null;
  /** The public address, once the organizer has a public page (it may still be switched off) */
  url: string | null;
  /** Why the page isn't visible yet, if it isn't */
  hiddenBecause: "no-profile" | "profile-off" | "not-published" | null;
};

/** A published show on an organizer's public page. */
export type PublicShow = {
  /** Path of the show's own page, /o/:handle/:slug */
  url: string;
  coverUrl: string | null;
  tagline: string;
  /** Tickets can be bought on the show's page */
  hasTickets: boolean;
  name: string;
  description: string;
  venueName: string;
  address: string;
  city: string;
  startDate: string;
  days: EventDay[];
  ticketPriceCents: number;
  /** The cheapest and dearest table types ("from $60" when they differ) */
  tablePriceCents: number;
  tablePriceMaxCents: number;
  /** Set while the show's public booking link is open: the booking page path and open tables */
  booking: { url: string; tablesLeft: number } | null;
  /** The show's public vendor map, when the organizer has turned it on */
  mapUrl: string | null;
};

export type PublicOrganizerPage = {
  profile: Omit<OrganizerProfile, "handle" | "published">;
  upcoming: PublicShow[];
  /** Most recent first */
  past: PublicShow[];
};

/** A show's public page. */
export type PublicShowPage = {
  organizer: { handle: string; displayName: string; logoUrl: string | null; websiteUrl: string; instagram: string; contactEmail: string };
  show: PublicShow & { upcoming: boolean };
  page: Omit<ShowPageSettings, "tagline">;
};

// ── Discount codes (the Discounts page) ─────────────────────────────────────

export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

export const discountCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(DISCOUNT_CODE_PATTERN, "3–30 letters, numbers, - or _ (e.g. EARLYBIRD)"),
    kind: z.enum(DISCOUNT_CODE_KINDS),
    /** Percent (1–100) for "percent"; cents off the request for "amount" */
    value: z.number({ error: "Enter an amount" }).int().min(1, "Must be more than 0").max(1_000_000),
    description: z.string().trim().max(200).optional().default(""),
    /** Limits; all optional */
    maxUses: z.number().int().min(1, "At least 1").max(100_000).nullable().optional().default(null),
    /** Last day it works (inclusive), in the app's timezone */
    expiresOn: z.iso.date("Pick a date").nullable().optional().default(null),
    oncePerVendor: z.boolean().optional().default(false),
    /** Shows it works for; empty = all of the organizer's shows */
    eventIds: z.array(z.uuid()).max(200).optional().default([]),
    active: z.boolean().optional().default(true),
  })
  .refine((c) => c.kind !== "percent" || c.value <= 100, { message: "Up to 100%", path: ["value"] });
export type DiscountCodeInput = z.input<typeof discountCodeSchema>;

export type DiscountCode = z.output<typeof discountCodeSchema> & {
  id: string;
  createdAt: string;
  /** Requests that used it and weren't rejected or cancelled */
  uses: number;
  /** Total discount given so far, across those requests */
  discountGivenCents: number;
  status: "active" | "paused" | "expired" | "used_up";
};

/** A request that used a code, for the code's usage list */
export type DiscountCodeUse = {
  requestId: string;
  eventId: string;
  eventName: string;
  vendorName: string;
  vendorEmail: string;
  tableLabels: string[];
  status: BookingStatus;
  discountCents: number;
  totalCents: number;
  createdAt: string;
};

// ── Floorplans ──────────────────────────────────────────────────────────────
// A plan is one room: its size, and the tables, walls and landmarks placed in it. Every length is a
// whole number of millimetres, so switching a plan between feet and metres never drifts.

export const FLOORPLAN_UNITS = ["ft", "m"] as const;
export type FloorplanUnits = (typeof FLOORPLAN_UNITS)[number];
export const MM_PER_UNIT: Record<FloorplanUnits, number> = { ft: 304.8, m: 1000 };

export const LANDMARK_TYPES = [
  "walkway",
  "shelf",
  "entrance",
  "exit",
  "washroom",
  "stairs",
  "elevator",
  "stage",
  "food",
  "info",
  "atm",
  "first_aid",
  "storage",
  "pillar",
  "other",
] as const;
export type LandmarkType = (typeof LANDMARK_TYPES)[number];
export const landmarkLabels: Record<LandmarkType, string> = {
  walkway: "Walkway",
  shelf: "Shelf",
  entrance: "Entrance",
  exit: "Exit",
  washroom: "Washrooms",
  stairs: "Stairs",
  elevator: "Elevator",
  stage: "Stage",
  food: "Food & drink",
  info: "Info desk",
  atm: "ATM",
  first_aid: "First aid",
  storage: "Storage",
  pillar: "Pillar",
  other: "Other",
};

export const MAX_FLOORPLAN_ITEMS = 1000;
/** Rooms from 1 m to 300 m on a side */
export const FLOORPLAN_MIN_MM = 1000;
export const FLOORPLAN_MAX_MM = 300_000;
/** Smallest a table or landmark can be on a side */
export const FLOORPLAN_ITEM_MIN_MM = 100;

const coord = z.number().int().min(-FLOORPLAN_MAX_MM).max(2 * FLOORPLAN_MAX_MM);
const size = z.number().int().min(FLOORPLAN_ITEM_MIN_MM).max(FLOORPLAN_MAX_MM);
const rotation = z.number().int().min(0).max(359);
const itemId = z.string().min(1).max(40);

/** A table. x/y is its centre; w is its length and h its depth (a round table's diameter is w). */
export const floorplanTableSchema = z.object({
  id: itemId,
  kind: z.literal("table"),
  label: z.string().trim().min(1, "Every table needs a label").max(12, "Table labels can be up to 12 characters"),
  shape: z.enum(["rect", "round"]),
  x: coord,
  y: coord,
  w: size,
  h: size,
  rotation,
  /** The table group it belongs to, if any */
  group: z.string().min(1).max(40).optional(),
  /** Its table type on the event (events.table_types[].id), for its price; unset or unknown = the first type */
  type: z.string().min(1).max(40).optional(),
});
/** A wall from one point to another. */
export const floorplanWallSchema = z.object({
  id: itemId,
  kind: z.literal("wall"),
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  thickness: z.number().int().min(20).max(2000),
});
/** A labelled area: entrance, washrooms, stairs… x/y is its centre. */
export const floorplanLandmarkSchema = z.object({
  id: itemId,
  kind: z.literal("landmark"),
  type: z.enum(LANDMARK_TYPES),
  label: z.string().trim().max(40, "Landmark labels can be up to 40 characters"),
  x: coord,
  y: coord,
  w: size,
  h: size,
  rotation,
});
export const floorplanItemSchema = z.discriminatedUnion("kind", [floorplanTableSchema, floorplanWallSchema, floorplanLandmarkSchema]);
export type FloorplanTable = z.infer<typeof floorplanTableSchema>;
export type FloorplanWall = z.infer<typeof floorplanWallSchema>;
export type FloorplanLandmark = z.infer<typeof floorplanLandmarkSchema>;
export type FloorplanItem = z.infer<typeof floorplanItemSchema>;

export const MAX_TABLE_GROUPS = 100;
/**
 * Tables that belong together (an island, a row) and are numbered as one block. With a prefix, the
 * group's tables are labelled prefix + 1…N (e.g. A1–A10) instead of taking the main numbers.
 */
export const floorplanGroupSchema = z.object({
  id: itemId,
  name: z.string().trim().min(1, "Give the group a name").max(40, "Group names can be up to 40 characters"),
  prefix: z
    .string()
    .trim()
    .max(4, "Prefixes can be up to 4 characters")
    .regex(/^([A-Za-z][A-Za-z0-9-]*)?$/, "Start the prefix with a letter (e.g. A or Hall-)"),
});
export type FloorplanGroup = z.infer<typeof floorplanGroupSchema>;

export const floorplanInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give the plan a name").max(80),
    units: z.enum(FLOORPLAN_UNITS),
    widthMm: z.number().int().min(FLOORPLAN_MIN_MM, "The room is too small").max(FLOORPLAN_MAX_MM, "The room is too big"),
    depthMm: z.number().int().min(FLOORPLAN_MIN_MM, "The room is too small").max(FLOORPLAN_MAX_MM, "The room is too big"),
    items: z.array(floorplanItemSchema).max(MAX_FLOORPLAN_ITEMS, `Up to ${MAX_FLOORPLAN_ITEMS} items per plan`),
    groups: z.array(floorplanGroupSchema).max(MAX_TABLE_GROUPS, `Up to ${MAX_TABLE_GROUPS} table groups per plan`).optional().default([]),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    const labels = new Map<string, string>();
    const groupIds = new Set(plan.groups.map((g) => g.id));
    if (groupIds.size !== plan.groups.length) ctx.addIssue({ code: "custom", path: ["groups"], message: "Two groups share an id" });
    for (const item of plan.items) {
      if (item.kind === "table" && item.group && !groupIds.has(item.group)) {
        ctx.addIssue({ code: "custom", path: ["items"], message: `Table ${item.label} is in a group that doesn't exist` });
      }
      if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: ["items"], message: "Two items share an id" });
      ids.add(item.id);
      if (item.kind === "table") {
        const key = item.label.toLowerCase();
        if (labels.has(key)) ctx.addIssue({ code: "custom", path: ["items"], message: `Two tables are labelled “${item.label}”` });
        labels.set(key, item.label);
      }
    }
  });
export type FloorplanInput = z.input<typeof floorplanInputSchema>;

export type Floorplan = {
  id: string;
  name: string;
  units: FloorplanUnits;
  widthMm: number;
  depthMm: number;
  items: FloorplanItem[];
  groups: FloorplanGroup[];
  tableCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Use one of the organizer's library plans for an event (the event gets its own copy). */
export const useLibraryPlanSchema = z.object({ floorplanId: z.uuid() });

/** Copy an event's plan into the organizer's library. */
export const savePlanToLibrarySchema = z.object({ name: z.string().trim().min(1, "Give the plan a name").max(80) });

// ── Maps people use: booking, and the public visitor map ─────────────────────

/** A plan's layout without anything private, for the booking page and the visitor map */
export type PublicFloorplan = { units: FloorplanUnits; widthMm: number; depthMm: number; items: FloorplanItem[] };

/** The public visitor map: off, paid vendors only, or everyone holding a table */
export const PUBLIC_MAP_MODES = ["off", "paid", "all"] as const;
export type PublicMapMode = (typeof PUBLIC_MAP_MODES)[number];
export const publicMapLabels: Record<PublicMapMode, string> = {
  off: "Off",
  paid: "Paid vendors only",
  all: "Everyone with a table",
};
export const publicMapSchema = z.object({ publicMap: z.enum(PUBLIC_MAP_MODES) });

/** /map/:eventId: where each vendor is at a show */
export type PublicEventMap = {
  event: {
    name: string;
    startDate: string;
    days: EventDay[];
    venueName: string;
    address: string;
    city: string;
    organizerName: string;
    /** The organizer's public page, if they have one */
    organizerUrl: string | null;
  };
  floorplan: PublicFloorplan;
  /** One entry per vendor, with every table they hold */
  vendors: { name: string; tables: { planItemId: string; label: string }[] }[];
};
