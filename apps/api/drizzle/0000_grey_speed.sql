CREATE TABLE "organizer_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"event_type" text NOT NULL,
	"events_per_year" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organizer_signups_email_idx" ON "organizer_signups" USING btree ("email");