-- Floorplans (stages 1-3, renumbered after main's 0017-0019). Written to be safe on development
-- databases that already ran the floorplan branch's own 0017-0020 migrations.
CREATE TABLE IF NOT EXISTS "floorplans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" text NOT NULL,
	"event_id" uuid,
	"name" text NOT NULL,
	"units" text DEFAULT 'ft' NOT NULL,
	"width_mm" integer NOT NULL,
	"depth_mm" integer NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floorplans" ADD COLUMN IF NOT EXISTS "groups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_tables" ADD COLUMN IF NOT EXISTS "plan_item_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "public_map" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_organizer_id_user_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "floorplans_organizer_idx" ON "floorplans" USING btree ("organizer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "floorplans_event_idx" ON "floorplans" USING btree ("event_id");
