import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
