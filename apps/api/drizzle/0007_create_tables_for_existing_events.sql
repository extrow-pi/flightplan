-- Existing events get table rows 1..vendor_tables, labelled with their number.
INSERT INTO "event_tables" ("event_id", "number", "label")
SELECT e."id", n, n::text
FROM "events" e, generate_series(1, e."vendor_tables") AS n
ON CONFLICT ("event_id", "number") DO NOTHING;
