import { and, asc, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { addDays } from "@flightplan/shared";
import { db, schema } from "../db/index.js";
import { enqueueEmails, type OutgoingEmail } from "./outbox.js";
import { button, details, esc, layout, note, p, type EmailContent } from "./templates.js";

const { bookings, eventDays, events, eventTables, user } = schema;

// Links in emails point at the web app
const APP_URL = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:5173").replace(/\/$/, "");
// Deadlines are moments in time; show them in the organizers' timezone
const TIME_ZONE = process.env.APP_TIMEZONE ?? "America/Vancouver";

const DAY_MS = 86_400_000;

// ── Formatting ───────────────────────────────────────────────────────────

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const formatMoney = (cents: number) => money.format(cents / 100).replace(/\.00$/, "");

/** "Friday, November 13 at 2:59 p.m. PST" in the app's timezone */
const formatDeadline = (d: Date) =>
  d.toLocaleString("en-CA", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

/** Event dates are wall-clock YYYY-MM-DD strings: format without timezone conversion. */
const formatDay = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", ...opts });

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

const tablesLabel = (labels: string[]) => `${labels.length > 1 ? "tables" : "table"} ${labels.join(", ")}`;
const TablesLabel = (labels: string[]) => `${labels.length > 1 ? "Tables" : "Table"} ${labels.join(", ")}`;

// ── Loading a request ────────────────────────────────────────────────────

type RequestInfo = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

/** Everything an email about one vendor request needs. */
async function loadRequest(requestId: string) {
  const rows = await db
    .select({ booking: bookings, tableLabel: eventTables.label, tableNumber: eventTables.number })
    .from(bookings)
    .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
    .where(eq(bookings.requestId, requestId))
    .orderBy(asc(eventTables.number));
  if (!rows.length) return null;

  const first = rows[0].booking;
  const [event] = await db.select().from(events).where(eq(events.id, first.eventId));
  const [organizer] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, event.organizerId));
  const days = await db
    .select({ dayOffset: eventDays.dayOffset, startTime: eventDays.startTime, endTime: eventDays.endTime })
    .from(eventDays)
    .where(eq(eventDays.eventId, event.id))
    .orderBy(asc(eventDays.dayOffset));

  const active = rows.filter((r) => ["pending", "awaiting_payment", "paid"].includes(r.booking.status));
  return {
    requestId,
    event,
    organizer,
    days,
    vendor: { name: first.name, businessName: first.businessName, email: first.email, phone: first.phone, message: first.message },
    source: first.source,
    /** Tables the request still holds, with the request's shared status and deadline */
    activeLabels: active.map((r) => r.tableLabel),
    status: active[0]?.booking.status ?? first.status,
    paymentDueAt: active[0]?.booking.paymentDueAt ?? null,
    allLabels: rows.map((r) => r.tableLabel),
  };
}

function eventDetails(r: RequestInfo, labels: string[]) {
  const { event, days } = r;
  const schedule = event.startDate
    ? days
        .map((d) => `${formatDay(addDays(event.startDate!, d.dayOffset), { weekday: "short", month: "short", day: "numeric" })}: ${timeLabel(d.startTime)}–${timeLabel(d.endTime)}`)
        .join("\n")
    : "";
  const rows: [string, string][] = [
    ["Show", event.name],
    ["When", schedule],
    ["Where", [event.venueName, event.address, event.city].filter(Boolean).join(", ")],
    [labels.length > 1 ? "Tables" : "Table", labels.join(", ")],
  ];
  if (event.tablePriceCents > 0) {
    rows.push(["Total", formatMoney(event.tablePriceCents * labels.length)]);
  }
  return details(rows);
}

const statusLink = (r: RequestInfo) => button("View your booking", `${APP_URL}/booking/${r.requestId}`);

function vendorFooter(r: RequestInfo) {
  return `You're receiving this because you requested a vendor table at ${r.event.name}. Reply to this email to contact the organizer, ${r.organizer.name}.`;
}

function toVendor(r: RequestInfo, kind: string, content: EmailContent): OutgoingEmail {
  return {
    kind,
    to: r.vendor.email,
    replyTo: r.organizer.email,
    organizerId: r.event.organizerId,
    eventId: r.event.id,
    requestId: r.requestId,
    ...content,
  };
}

function toOrganizer(r: RequestInfo, kind: string, content: EmailContent): OutgoingEmail {
  return {
    kind,
    to: r.organizer.email,
    replyTo: r.vendor.email,
    organizerId: r.event.organizerId,
    eventId: r.event.id,
    requestId: r.requestId,
    ...content,
  };
}

const firstName = (name: string) => esc(name.split(" ")[0]);

// ── Vendor emails ────────────────────────────────────────────────────────

/** "Please pay by …" block, shared by approval, assignment and reminder emails. */
function paymentBlocks(r: RequestInfo, labels: string[]) {
  const blocks = [];
  const total = formatMoney(r.event.tablePriceCents * labels.length);
  blocks.push(
    r.paymentDueAt
      ? p(`Please pay <strong>${total}</strong> by <strong>${esc(formatDeadline(r.paymentDueAt))}</strong> to keep your ${esc(tablesLabel(labels))}. Unpaid tables may be released after the deadline.`)
      : p(`Please pay <strong>${total}</strong> to confirm your ${esc(tablesLabel(labels))}.`),
  );
  if (r.event.paymentInstructions) blocks.push(note("How to pay", r.event.paymentInstructions));
  return blocks;
}

function heldEmail(r: RequestInfo, intro: string): EmailContent {
  const labels = r.activeLabels;
  return layout(
    `Please pay for your ${tablesLabel(labels)} at ${r.event.name}`,
    `${TablesLabel(labels)} ${labels.length > 1 ? "are" : "is"} held for you`,
    [p(`Hi ${firstName(r.vendor.name)}, ${intro}`), eventDetails(r, labels), ...paymentBlocks(r, labels), statusLink(r)],
    vendorFooter(r),
  );
}

function confirmedEmail(r: RequestInfo, intro: string): EmailContent {
  const labels = r.activeLabels;
  return layout(
    `You're booked for ${r.event.name}`,
    "You're booked!",
    [p(`Hi ${firstName(r.vendor.name)}, ${intro}`), eventDetails(r, labels), statusLink(r)],
    vendorFooter(r),
  );
}

// ── Organizer emails ─────────────────────────────────────────────────────

function vendorSummary(r: RequestInfo) {
  const v = r.vendor;
  const rows: [string, string][] = [
    ["Vendor", v.businessName ? `${v.name} · ${v.businessName}` : v.name],
    ["Email", v.email],
  ];
  if (v.phone) rows.push(["Phone", v.phone]);
  rows.push([r.activeLabels.length > 1 ? "Tables" : "Table", r.activeLabels.join(", ")]);
  if (v.message) rows.push(["Note", v.message]);
  return details(rows);
}

const tablesPageLink = (r: RequestInfo) =>
  button("Open Tables & vendors", `${APP_URL}/dashboard/events/${r.event.id}/tables`);

const organizerFooter = (r: RequestInfo) =>
  `You're receiving this because you organize ${r.event.name} on Flightplan. Reply to this email to contact the vendor.`;

// ── Triggers ─────────────────────────────────────────────────────────────

async function send(requestId: string, build: (r: RequestInfo) => OutgoingEmail[]) {
  try {
    const r = await loadRequest(requestId);
    if (r) await enqueueEmails(build(r));
  } catch (err) {
    // Never let an email problem fail the booking action that triggered it
    console.error(`Couldn't queue emails for request ${requestId}:`, err);
  }
}

/** A vendor booked from a link, or the organizer assigned a table. */
export function notifyRequestCreated(requestId: string) {
  return send(requestId, (r) => {
    const labels = r.activeLabels;
    const out: OutgoingEmail[] = [];
    const assigned = r.source === "organizer";

    if (r.status === "pending") {
      out.push(
        toVendor(
          r,
          "vendor.request_received",
          layout(
            `We got your table request for ${r.event.name}`,
            "Request received",
            [
              p(`Hi ${firstName(r.vendor.name)}, thanks for your request for ${esc(tablesLabel(labels))}. The organizer will review it and you'll get an email once it's approved.`),
              eventDetails(r, labels),
              statusLink(r),
            ],
            vendorFooter(r),
          ),
        ),
      );
    } else if (r.status === "awaiting_payment") {
      out.push(
        toVendor(
          r,
          assigned ? "vendor.assigned" : "vendor.booked",
          heldEmail(r, assigned ? `${esc(r.organizer.name)} has assigned you ${esc(tablesLabel(labels))}.` : `thanks for booking ${esc(tablesLabel(labels))}.`),
        ),
      );
    } else if (r.status === "paid") {
      out.push(
        toVendor(
          r,
          "vendor.confirmed",
          confirmedEmail(r, assigned ? `${esc(r.organizer.name)} has booked ${esc(tablesLabel(labels))} for you.` : `${esc(tablesLabel(labels))} ${labels.length > 1 ? "are" : "is"} yours.`),
        ),
      );
    }

    // Tell the organizer about vendor-made bookings (not ones they made themselves)
    if (!assigned) {
      const pending = r.status === "pending";
      out.push(
        toOrganizer(
          r,
          pending ? "organizer.request_pending" : "organizer.new_booking",
          layout(
            pending
              ? `Table request to review: ${r.vendor.businessName || r.vendor.name} (${r.event.name})`
              : `New booking: ${r.vendor.businessName || r.vendor.name} (${r.event.name})`,
            pending ? "A vendor wants a table" : "New table booking",
            [
              p(
                pending
                  ? `${esc(r.vendor.name)} requested ${esc(tablesLabel(labels))} at <strong>${esc(r.event.name)}</strong>. Approve or reject it from your dashboard.`
                  : `${esc(r.vendor.name)} booked ${esc(tablesLabel(labels))} at <strong>${esc(r.event.name)}</strong>.`,
              ),
              vendorSummary(r),
              tablesPageLink(r),
            ],
            organizerFooter(r),
          ),
        ),
      );
    }
    return out;
  });
}

export function notifyApproved(requestId: string) {
  return send(requestId, (r) => {
    const labels = r.activeLabels;
    return [
      r.status === "paid"
        ? toVendor(r, "vendor.confirmed", confirmedEmail(r, `your request for ${esc(tablesLabel(labels))} was approved.`))
        : toVendor(r, "vendor.approved", heldEmail(r, `good news: your request for ${esc(tablesLabel(labels))} was approved.`)),
    ];
  });
}

export function notifyRejected(requestId: string) {
  return send(requestId, (r) => [
    toVendor(
      r,
      "vendor.rejected",
      layout(
        `Your table request for ${r.event.name}`,
        "Your request wasn't approved",
        [
          p(`Hi ${firstName(r.vendor.name)}, unfortunately the organizer wasn't able to approve your request for ${esc(tablesLabel(r.allLabels))} at <strong>${esc(r.event.name)}</strong>.`),
          p("You can reply to this email if you have any questions."),
        ],
        vendorFooter(r),
      ),
    ),
  ]);
}

export function notifyPaid(requestId: string) {
  return send(requestId, (r) => [
    toVendor(r, "vendor.confirmed", confirmedEmail(r, `your payment has been received. ${esc(TablesLabel(r.activeLabels))} ${r.activeLabels.length > 1 ? "are" : "is"} confirmed.`)),
  ]);
}

/** `released` are the tables just freed; anything else in the request is still held. */
export function notifyReleased(requestId: string, released: string[]) {
  return send(requestId, (r) => {
    const stillHeld = r.activeLabels;
    return [
      toVendor(
        r,
        "vendor.released",
        layout(
          `${TablesLabel(released)} at ${r.event.name} ${released.length > 1 ? "have" : "has"} been released`,
          `${TablesLabel(released)} released`,
          [
            p(`Hi ${firstName(r.vendor.name)}, the organizer of <strong>${esc(r.event.name)}</strong> has released ${esc(tablesLabel(released))}, so ${released.length > 1 ? "they're" : "it's"} no longer reserved for you.`),
            ...(stillHeld.length
              ? [p(`You still have ${esc(tablesLabel(stillHeld))}.`), statusLink(r)]
              : [p("If you think this is a mistake, reply to this email to contact the organizer.")]),
          ],
          vendorFooter(r),
        ),
      ),
    ];
  });
}

/** The organizer kept an overdue request, with a new deadline or none. */
export function notifyKept(requestId: string) {
  return send(requestId, (r) => [
    toVendor(
      r,
      "vendor.deadline_extended",
      layout(
        `More time to pay for your ${tablesLabel(r.activeLabels)} at ${r.event.name}`,
        r.paymentDueAt ? "You have more time to pay" : "Your tables are still held",
        [
          p(`Hi ${firstName(r.vendor.name)}, the organizer is holding ${esc(tablesLabel(r.activeLabels))} for you a little longer.`),
          ...paymentBlocks(r, r.activeLabels),
          statusLink(r),
        ],
        vendorFooter(r),
      ),
    ),
  ]);
}

// ── Scheduled: payment reminders and overdue notices ─────────────────────

/** Remind vendors ~24h before their deadline (skipped if they were approved less than a day before it). */
export async function sendPaymentReminders() {
  const now = new Date();
  const due = await db
    .selectDistinct({ requestId: bookings.requestId })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "awaiting_payment"),
        isNull(bookings.reminderSentAt),
        gt(bookings.paymentDueAt, now),
        lte(bookings.paymentDueAt, new Date(now.getTime() + DAY_MS)),
        lt(bookings.approvedAt, new Date(now.getTime() - DAY_MS)),
      ),
    );

  for (const { requestId } of due) {
    // Mark first so a slow send can't cause a duplicate on the next run
    await db
      .update(bookings)
      .set({ reminderSentAt: now })
      .where(and(eq(bookings.requestId, requestId), eq(bookings.status, "awaiting_payment")));
    await send(requestId, (r) => [
      toVendor(
        r,
        "vendor.payment_reminder",
        layout(
          `Reminder: payment due for ${r.event.name}`,
          "Payment due soon",
          [
            p(`Hi ${firstName(r.vendor.name)}, just a reminder that payment for ${esc(tablesLabel(r.activeLabels))} is due soon.`),
            eventDetails(r, r.activeLabels),
            ...paymentBlocks(r, r.activeLabels),
            statusLink(r),
          ],
          vendorFooter(r),
        ),
      ),
    ]);
  }
  return due.length;
}

/** Tell organizers once when a request's payment deadline passes. */
export async function sendOverdueNotices() {
  const now = new Date();
  const overdue = await db
    .selectDistinct({ requestId: bookings.requestId })
    .from(bookings)
    .where(
      and(eq(bookings.status, "awaiting_payment"), isNull(bookings.overdueNotifiedAt), lt(bookings.paymentDueAt, now)),
    );

  for (const { requestId } of overdue) {
    await db
      .update(bookings)
      .set({ overdueNotifiedAt: now })
      .where(and(eq(bookings.requestId, requestId), eq(bookings.status, "awaiting_payment")));
    await send(requestId, (r) => [
      toOrganizer(
        r,
        "organizer.payment_overdue",
        layout(
          `Payment overdue: ${r.vendor.businessName || r.vendor.name} (${r.event.name})`,
          "A vendor payment is overdue",
          [
            p(`${esc(r.vendor.name)} hasn't paid for ${esc(tablesLabel(r.activeLabels))} at <strong>${esc(r.event.name)}</strong>. The deadline was ${esc(r.paymentDueAt ? formatDeadline(r.paymentDueAt) : "")}`),
            p("You can release the tables for other vendors, or keep them and give more time."),
            vendorSummary(r),
            tablesPageLink(r),
          ],
          organizerFooter(r),
        ),
      ),
    ]);
  }
  return overdue.length;
}

/** Run reminders and overdue notices every few minutes. */
export function startNotificationScheduler(intervalMs = 5 * 60_000) {
  const run = async () => {
    try {
      await sendPaymentReminders();
      await sendOverdueNotices();
    } catch (err) {
      console.error("Notification scheduler error:", err);
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  // First run shortly after startup, once migrations are done
  setTimeout(() => void run(), 10_000).unref();
}

