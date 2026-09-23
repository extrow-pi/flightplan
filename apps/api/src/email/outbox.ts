import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const { emails } = schema;

// Emails are written to the `emails` table first and sent by a background loop, so a slow or
// failing email provider never breaks the request that triggered the email.
//
// With RESEND_API_KEY set, emails go out through Resend (https://resend.com). Without it, they're
// marked "logged": you can read them in the dashboard's Email log, but nothing is delivered.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Flightplan <onboarding@resend.dev>";
const MAX_ATTEMPTS = 5;

export const emailDeliveryEnabled = Boolean(RESEND_API_KEY);

export type OutgoingEmail = {
  kind: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  organizerId?: string | null;
  eventId?: string | null;
  requestId?: string | null;
};

/** Queue emails for sending. */
export async function enqueueEmails(messages: OutgoingEmail[]) {
  if (!messages.length) return;
  await db.insert(emails).values(messages);
  void processQueue();
}

async function sendViaResend(e: typeof emails.$inferSelect): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [e.to],
      reply_to: e.replyTo ?? undefined,
      subject: e.subject,
      html: e.html,
      text: e.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? "unknown error"}`);
  return body.id ?? "";
}

let running = false;

const BATCH_SIZE = 20;

/**
 * Send one batch of queued emails. Safe to call often; only one run happens at a time.
 * Failed sends stay queued and are retried by the worker's next tick.
 */
export async function processQueue() {
  if (running) return;
  running = true;
  let more = false;
  try {
    const batch = await db
      .select()
      .from(emails)
      .where(and(eq(emails.status, "queued"), lt(emails.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(emails.createdAt))
      .limit(BATCH_SIZE);

    for (const e of batch) {
      if (!emailDeliveryEnabled) {
        console.log(`✉️  [not sent: no RESEND_API_KEY] ${e.kind} → ${e.to}: ${e.subject}`);
        await db.update(emails).set({ status: "logged", sentAt: new Date() }).where(eq(emails.id, e.id));
        continue;
      }
      try {
        const providerId = await sendViaResend(e);
        await db
          .update(emails)
          .set({ status: "sent", sentAt: new Date(), providerId, attempts: e.attempts + 1, lastError: null })
          .where(eq(emails.id, e.id));
      } catch (err) {
        const attempts = e.attempts + 1;
        console.error(`Email ${e.id} (${e.kind} → ${e.to}) failed, attempt ${attempts}:`, err);
        await db
          .update(emails)
          .set({ attempts, lastError: String(err), status: attempts >= MAX_ATTEMPTS ? "failed" : "queued" })
          .where(eq(emails.id, e.id));
      }
    }
    // A full batch of first attempts may mean more are waiting
    more = batch.length === BATCH_SIZE && batch.every((e) => e.attempts === 0);
  } catch (err) {
    console.error("Email queue error:", err);
  } finally {
    running = false;
  }
  if (more) setImmediate(() => void processQueue());
}

/** Retry queued emails periodically (e.g. after a provider outage). */
export function startEmailWorker(intervalMs = 30_000) {
  const timer = setInterval(() => void processQueue(), intervalMs);
  timer.unref();
  void processQueue();
}

/** Put failed emails back in the queue. */
export async function retryFailed(ids: string[]) {
  if (!ids.length) return;
  await db
    .update(emails)
    .set({ status: "queued", attempts: 0 })
    .where(and(inArray(emails.id, ids), eq(emails.status, "failed")));
  void processQueue();
}
