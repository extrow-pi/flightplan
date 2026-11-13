ALTER TABLE "waitlist_entries" ADD COLUMN "sort_order" double precision DEFAULT extract(epoch from now()) NOT NULL;--> statement-breakpoint
-- Existing entries keep their order: first to join, first in line
UPDATE "waitlist_entries" SET "sort_order" = extract(epoch from "created_at");
