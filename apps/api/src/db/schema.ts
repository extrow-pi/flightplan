import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { BOOKING_SOURCES, BOOKING_STATUSES, EVENT_STATUSES } from "@flightplan/shared";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("vendors_organizer_email_idx").on(t.organizerId, t.email)],
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
    // When it was rejected / released / cancelled
    closedAt: timestamp("closed_at", { withTimezone: true }),
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
