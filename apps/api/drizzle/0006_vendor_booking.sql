CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"payment_due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"booking_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" text NOT NULL,
	"name" text NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "floor_map_file" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_due_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "booking_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "booking_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_table_id_event_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."event_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tables" ADD CONSTRAINT "event_tables_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invites" ADD CONSTRAINT "vendor_invites_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invites" ADD CONSTRAINT "vendor_invites_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organizer_id_user_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_active_table_idx" ON "bookings" USING btree ("table_id") WHERE "bookings"."status" in ('pending', 'awaiting_payment', 'paid');--> statement-breakpoint
CREATE INDEX "bookings_event_idx" ON "bookings" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "bookings_vendor_idx" ON "bookings" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_tables_event_number_idx" ON "event_tables" USING btree ("event_id","number");--> statement-breakpoint
CREATE INDEX "vendor_invites_event_idx" ON "vendor_invites" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_organizer_email_idx" ON "vendors" USING btree ("organizer_id","email");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_booking_token_unique" UNIQUE("booking_token");