import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ApiError, EmailLogEntry } from "@flightplan/shared";
import { db, schema } from "../db/index.js";
import { emailDeliveryEnabled, retryFailed } from "../email/outbox.js";
import { requireUser, type AuthEnv } from "../middleware.js";

const { emails, events } = schema;

const notFound = { error: "Email not found" } satisfies ApiError;

// The organizer's email log: everything sent to their vendors or to them, newest first
export const emailRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/", async (c) => {
    const rows = await db
      .select({
        id: emails.id,
        kind: emails.kind,
        to: emails.to,
        subject: emails.subject,
        status: emails.status,
        eventId: emails.eventId,
        eventName: events.name,
        createdAt: emails.createdAt,
        sentAt: emails.sentAt,
        lastError: emails.lastError,
      })
      .from(emails)
      .leftJoin(events, eq(events.id, emails.eventId))
      .where(eq(emails.organizerId, c.var.user.id))
      .orderBy(desc(emails.createdAt))
      .limit(200);

    const list: EmailLogEntry[] = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
    }));
    return c.json({ emails: list, deliveryEnabled: emailDeliveryEnabled });
  })

  // The email's HTML, for previewing in the log
  .get("/:id/html", async (c) => {
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success) return c.json(notFound, 404);
    const [row] = await db
      .select({ html: emails.html })
      .from(emails)
      .where(and(eq(emails.id, id), eq(emails.organizerId, c.var.user.id)));
    if (!row) return c.json(notFound, 404);
    // Shown in a sandboxed iframe; block scripts and outside resources just in case
    return c.html(row.html, 200, {
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    });
  })

  .post("/:id/retry", async (c) => {
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success) return c.json(notFound, 404);
    const [row] = await db
      .select({ id: emails.id })
      .from(emails)
      .where(and(eq(emails.id, id), eq(emails.organizerId, c.var.user.id), eq(emails.status, "failed")));
    if (!row) return c.json(notFound, 404);
    await retryFailed([row.id]);
    return c.json({ ok: true });
  });
