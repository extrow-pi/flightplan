import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { organizerSignupSchema, type ApiError } from "@flightplan/shared";
import { db, schema } from "./db/index.js";

const app = new Hono().basePath("/api");

app.use(logger());

app.get("/health", (c) => c.json({ ok: true }));

app.post("/organizers/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = organizerSignupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json<ApiError>(
      { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(parsed.error).fieldErrors },
      400,
    );
  }

  const inserted = await db
    .insert(schema.organizerSignups)
    .values(parsed.data)
    .onConflictDoNothing() // email is unique: a repeat signup is a no-op
    .returning({ id: schema.organizerSignups.id });

  return c.json({ ok: true, alreadyRegistered: inserted.length === 0 }, inserted.length ? 201 : 200);
});

const port = Number(process.env.API_PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => console.log(`API listening on http://localhost:${port}`));
