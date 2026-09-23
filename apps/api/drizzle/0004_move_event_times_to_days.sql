-- Existing single-day events become one-day shows: date -> start_date, times -> event_days (day 1).
UPDATE "events" SET "start_date" = "date" WHERE "start_date" IS NULL;--> statement-breakpoint
INSERT INTO "event_days" ("event_id", "day_offset", "start_time", "end_time")
SELECT "id", 0, "start_time", "end_time" FROM "events"
WHERE "start_time" IS NOT NULL AND "end_time" IS NOT NULL;
