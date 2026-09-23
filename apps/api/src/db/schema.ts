import { date, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { EVENT_STATUSES } from "@flightplan/shared";
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
    // Local wall-clock date/time of the event
    date: date("date", { mode: "string" }).notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    vendorTables: integer("vendor_tables").notNull().default(0),
    tablePriceCents: integer("table_price_cents").notNull().default(0),
    ticketPriceCents: integer("ticket_price_cents").notNull().default(0),
    status: text("status", { enum: EVENT_STATUSES }).notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("events_organizer_date_idx").on(t.organizerId, t.date)],
);
