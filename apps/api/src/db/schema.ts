import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  COLLABORATOR_ROLES,
  DISCOUNT_CODE_KINDS,
  EVENT_STATUSES,
  PAYMENT_METHODS,
  type BulkDiscountTier,
} from "@flightplan/shared";
import { user } from "./auth-schema.js";

export const organizerSignups = pgTable(
  "organizer_signups",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    organization: text("organization").notNull().default(""),
    city: text("city").notNull(),
    eventType: text("event_type").notNull(),
    eventsPerYear: text("events_per_year").notNull(),
    message: text("message").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organizer_signups_email_idx").on(t.email)],
);

export * from "./auth-schema.js";

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    venueName: text("venue_name").notNull(),
    address: text("address").notNull().default(""),
    city: text("city").notNull(),
    // First day of the show (local date). Null for templates.
    startDate: date("start_date", { mode: "string" }),
    vendorTables: integer("vendor_tables").notNull().default(0),
    tablePriceCents: integer("table_price_cents").notNull().default(0),
    ticketPriceCents: integer("ticket_price_cents").notNull().default(0),
    status: text("status", { enum: EVENT_STATUSES }).notNull().default("draft"),
    // Vendor booking settings
    floorMapFile: text("floor_map_file"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    paymentDueDays: integer("payment_due_days").default(7),
    bookingOpen: boolean("booking_open").notNull().default(false),
    paymentInstructions: text("payment_instructions").notNull().default(""),
    maxTablesPerRequest: integer("max_tables_per_request").notNull().default(4),
    // Multi-table discount tiers, validated by bulkDiscountTierSchema
    bulkDiscounts: jsonb("bulk_discounts").$type<BulkDiscountTier[]>().notNull().default([]),
    // Secret for the public booking link /book/:token
    bookingToken: text("booking_token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("events_organizer_start_date_idx").on(t.organizerId, t.startDate)],
);

// One row per show day. The date is events.start_date + day_offset; times are local wall-clock.
export const eventDays = pgTable(
  "event_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    dayOffset: integer("day_offset").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
  },
  (t) => [uniqueIndex("event_days_event_offset_idx").on(t.eventId, t.dayOffset)],
);

// The vendor tables at an event, numbered 1..events.vendor_tables
export const eventTables = pgTable(
  "event_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    label: text("label").notNull(),
  },
  (t) => [uniqueIndex("event_tables_event_number_idx").on(t.eventId, t.number)],
);

// An organizer's vendor list. Vendors don't have accounts; bookings with the same email
// (per organizer) are linked to the same vendor so their history carries across shows.
export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    businessName: text("business_name").notNull().default(""),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    notes: text("notes").notNull().default(""),
    favourite: boolean("favourite").notNull().default(false),
    // Banned vendors can still request tables, but their requests always need approval and are flagged
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    banReason: text("ban_reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("vendors_organizer_email_idx").on(t.organizerId, t.email)],
);

// Discount codes an organizer gives out: a percentage or a fixed amount off a request. All limits are optional.
export const discountCodes = pgTable(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Uppercase; validated with DISCOUNT_CODE_PATTERN
    code: text("code").notNull(),
    kind: text("kind", { enum: DISCOUNT_CODE_KINDS }).notNull(),
    // Percent for "percent", cents off the request for "amount"
    value: integer("value").notNull(),
    description: text("description").notNull().default(""),
    maxUses: integer("max_uses"),
    // Last day the code works, inclusive, in APP_TIMEZONE
    expiresOn: date("expires_on"),
    oncePerVendor: boolean("once_per_vendor").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("discount_codes_organizer_code_idx").on(t.organizerId, t.code)],
);

// Shows a code is limited to. No rows = it works for all of the organizer's shows.
export const discountCodeEvents = pgTable(
  "discount_code_events",
  {
    codeId: uuid("code_id")
      .notNull()
      .references(() => discountCodes.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.codeId, t.eventId] })],
);

// Organizer-defined vendor groups (e.g. "Pokémon", "Food trucks"). A vendor can be in several.
export const vendorGroups = pgTable(
  "vendor_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vendor_groups_organizer_name_idx").on(t.organizerId, sql`lower(${t.name})`)],
);

export const vendorGroupMembers = pgTable(
  "vendor_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => vendorGroups.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.vendorId] }), index("vendor_group_members_vendor_idx").on(t.vendorId)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Bookings made together (one vendor, several tables) share a request id
    requestId: uuid("request_id").notNull().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => eventTables.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    status: text("status", { enum: BOOKING_STATUSES }).notNull(),
    source: text("source", { enum: BOOKING_SOURCES }).notNull(),
    // Contact details as submitted for this booking (the vendor record may change later)
    name: text("name").notNull(),
    businessName: text("business_name").notNull().default(""),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    message: text("message").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paymentDueAt: timestamp("payment_due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // How the vendor paid (e-transfer, cash…), recorded by the organizer. Same on every table of a request.
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }),
    // Price snapshot taken when the request is made, so later price or discount changes don't
    // change what the vendor owes: the table's list price, its share of the request's total after
    // any discount, and which discount applied (the same on every table of a request)
    basePriceCents: integer("base_price_cents").notNull().default(0),
    priceCents: integer("price_cents").notNull().default(0),
    discountLabel: text("discount_label").notNull().default(""),
    discountCodeId: uuid("discount_code_id").references(() => discountCodes.id, { onDelete: "set null" }),
    // When it was rejected / released / cancelled
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Notification bookkeeping, so each reminder / overdue notice goes out once per deadline
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
  },
  (t) => [
    // At most one booking holds a table at a time
    uniqueIndex("bookings_active_table_idx")
      .on(t.tableId)
      .where(sql`${t.status} in ('pending', 'awaiting_payment', 'paid')`),
    index("bookings_event_idx").on(t.eventId),
    index("bookings_request_idx").on(t.requestId),
    index("bookings_vendor_idx").on(t.vendorId),
  ],
);

// Vendors the organizer has added to a show without a table yet. The row goes away once
// the vendor is booked on a table at that show.
export const eventVendors = pgTable(
  "event_vendors",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.vendorId] }), index("event_vendors_vendor_idx").on(t.vendorId)],
);

// Personal booking links the organizer sends to specific vendors. Single use.
export const vendorInvites = pgTable(
  "vendor_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    token: text("token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("vendor_invites_event_idx").on(t.eventId)],
);

// An organizer's public page at /o/:handle, listing their published shows. One per organizer.
export const organizerProfiles = pgTable(
  "organizer_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    // Lowercase; validated with HANDLE_PATTERN
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    logoFile: text("logo_file"),
    websiteUrl: text("website_url").notNull().default(""),
    instagram: text("instagram").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("organizer_profiles_handle_idx").on(t.handle)],
);

// Other organizers who can see (viewer) or manage (editor) an event or template.
// The owner is events.organizer_id and is never a row here.
export const eventCollaborators = pgTable(
  "event_collaborators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: COLLABORATOR_ROLES }).notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_collaborators_event_user_idx").on(t.eventId, t.userId), index("event_collaborators_user_idx").on(t.userId)],
);

// Emailed invitations to collaborate. Only a hash of the token is stored; the link goes out by
// email and can be accepted only by a signed-in organizer whose email matches.
export const collaboratorInvites = pgTable(
  "collaborator_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: COLLABORATOR_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("collaborator_invites_event_idx").on(t.eventId)],
);

// Every email the app sends: a queue for the background sender and a log organizers can read.
// status: queued → sent | failed (after retries) | logged (no email provider configured)
export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The organizer this email is about (their vendor emails, or emails to them)
    organizerId: text("organizer_id").references(() => user.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    requestId: uuid("request_id"),
    kind: text("kind").notNull(),
    to: text("to").notNull(),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: ["queued", "sent", "failed", "logged"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("emails_status_idx").on(t.status), index("emails_organizer_idx").on(t.organizerId, t.createdAt)],
);
