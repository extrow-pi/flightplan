ALTER TABLE "events" ADD COLUMN "page_slug" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_file" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "page_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_organizer_page_slug_idx" ON "events" USING btree ("organizer_id","page_slug");--> statement-breakpoint
-- Existing shows get a page address from their name; repeats get part of their id added
UPDATE "events" AS e SET "page_slug" = s."slug"
FROM (
  SELECT "id", CASE WHEN rn = 1 THEN base ELSE trim(both '-' from left(base, 53)) || '-' || left("id"::text, 6) END AS "slug"
  FROM (
    SELECT "id", base, row_number() OVER (PARTITION BY "organizer_id", base ORDER BY "created_at", "id") AS rn
    FROM (
      SELECT "id", "organizer_id", "created_at",
        coalesce(nullif(trim(both '-' from left(trim(both '-' from regexp_replace(translate(lower("name"), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'show') AS base
      FROM "events" WHERE "status" <> 'template' AND "page_slug" IS NULL
    ) b
  ) n
) s
WHERE e."id" = s."id";
