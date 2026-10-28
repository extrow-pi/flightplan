ALTER TABLE "event_tables" ADD COLUMN "type_id" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "table_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing shows: one "Table" type with their current count and price (their tables already default to it)
UPDATE "events" SET "table_types" = jsonb_build_array(jsonb_build_object('id', 'standard', 'name', 'Table', 'priceCents', "table_price_cents", 'count', "vendor_tables", 'prefix', '')) WHERE "table_types" = '[]'::jsonb;
