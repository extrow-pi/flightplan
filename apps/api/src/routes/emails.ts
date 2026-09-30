import { Hono } from "hono";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { ApiError, EmailLogEntry } from "@flightplan/shared";
import { accessibleEvents, editableEvents } from "../access.js";
import { db, schema } from "../db/index.js";
import { emailDeliveryEnabled, retryFailed } from "../email/outbox.js";
import { requireUser, type AuthEnv } from "../middleware.js";

const { emails, events } = schema;

const notFound = { error: "Email not found" } satisfies ApiError;

/** Emails about the user's own account, or about events in `eventsWhere` (e.g. ones shared with them). */
const visibleEmails = (userId: string, eventsWhere: SQL) =>
  or(eq(emails.organizerId, userId), inArray(emails.eventId, db.select({ id: events.id }).from(events).where(eventsWhere)))!;

// The organizer's email log: everything sent to their vendors or to them, plus emails about
// events shared with them, newest first
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
      .where(visibleEmails(c.var.user.id, accessibleEvents(c.var.user.id)))
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
      .where(and(eq(emails.id, id), visibleEmails(c.var.user.id, accessibleEvents(c.var.user.id))));
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
      .where(and(eq(emails.id, id), visibleEmails(c.var.user.id, editableEvents(c.var.user.id)), eq(emails.status, "failed")));
    if (!row) return c.json(notFound, 404);
    await retryFailed([row.id]);
    return c.json({ ok: true });
  });
