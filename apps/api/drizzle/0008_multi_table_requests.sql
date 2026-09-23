ALTER TABLE "bookings" ADD COLUMN "request_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "max_tables_per_request" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
CREATE INDEX "bookings_request_idx" ON "bookings" USING btree ("request_id");