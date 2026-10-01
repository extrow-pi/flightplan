CREATE TABLE "vendor_group_members" (
	"group_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	CONSTRAINT "vendor_group_members_group_id_vendor_id_pk" PRIMARY KEY("group_id","vendor_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "favourite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "ban_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendor_group_members" ADD CONSTRAINT "vendor_group_members_group_id_vendor_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."vendor_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_group_members" ADD CONSTRAINT "vendor_group_members_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_groups" ADD CONSTRAINT "vendor_groups_organizer_id_user_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_group_members_vendor_idx" ON "vendor_group_members" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_groups_organizer_name_idx" ON "vendor_groups" USING btree ("organizer_id",lower("name"));