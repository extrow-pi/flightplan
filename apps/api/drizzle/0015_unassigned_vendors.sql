CREATE TABLE "event_vendors" (
	"event_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_vendors_event_id_vendor_id_pk" PRIMARY KEY("event_id","vendor_id")
);
--> statement-breakpoint
ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_vendors_vendor_idx" ON "event_vendors" USING btree ("vendor_id");