CREATE TABLE "event_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"day_offset" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "events_organizer_date_idx";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "start_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "end_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "event_days" ADD CONSTRAINT "event_days_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_days_event_offset_idx" ON "event_days" USING btree ("event_id","day_offset");--> statement-breakpoint
CREATE INDEX "events_organizer_start_date_idx" ON "events" USING btree ("organizer_id","start_date");