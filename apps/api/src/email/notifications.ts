import { and, asc, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { addDays } from "@flightplan/shared";
import { db, schema } from "../db/index.js";
import { requestTotals } from "../bookings.js";
import { enqueueEmails, type OutgoingEmail } from "./outbox.js";
import { button, details, esc, layout, note, p, type EmailContent } from "./templates.js";

const { bookings, eventCollaborators, eventDays, events, eventTables, user, vendors } = schema;

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
  // Everyone on the event gets organizer notifications: the owner and all collaborators
  const collaborators = await db
    .select({ email: user.email })
    .from(eventCollaborators)
    .innerJoin(user, eq(user.id, eventCollaborators.userId))
    .where(eq(eventCollaborators.eventId, event.id))
    .orderBy(asc(eventCollaborators.createdAt));
  const days = await db
    .select({ dayOffset: eventDays.dayOffset, startTime: eventDays.startTime, endTime: eventDays.endTime })
    .from(eventDays)
    .where(eq(eventDays.eventId, event.id))
    .orderBy(asc(eventDays.dayOffset));
  const [vendorRow] = await db
    .select({ bannedAt: vendors.bannedAt, banReason: vendors.banReason })
    .from(vendors)
    .where(eq(vendors.id, first.vendorId));

  const active = rows.filter((r) => ["pending", "awaiting_payment", "paid"].includes(r.booking.status));
  return {
    requestId,
    event,
    organizer,
    /** Email addresses for organizer notifications: the owner first, then collaborators */
    team: [organizer.email, ...collaborators.map((c) => c.email)],
    days,
    vendor: { name: first.name, businessName: first.businessName, email: first.email, phone: first.phone, message: first.message },
    /** On the owner's ban list (only ever shown to organizers) */
    ban: vendorRow?.bannedAt ? { reason: vendorRow.banReason } : null,
    source: first.source,
    /** Tables the request still holds, with the request's shared status and deadline */
    activeLabels: active.map((r) => r.tableLabel),
    status: active[0]?.booking.status ?? first.status,
    paymentDueAt: active[0]?.booking.paymentDueAt ?? null,
    allLabels: rows.map((r) => r.tableLabel),
    /** Each table's price snapshot, by label */
    prices: new Map(rows.map((r) => [r.tableLabel, r.booking])),
  };
}

/** What the given tables of a request cost, from their price snapshot */
function totalsFor(r: RequestInfo, labels: string[]) {
  return requestTotals(labels.flatMap((l) => (r.prices.has(l) ? [r.prices.get(l)!] : [])));
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
  const t = totalsFor(r, labels);
  if (t.subtotalCents > 0) {
    if (t.discountCents > 0) {
      rows.push(["Price", formatMoney(t.subtotalCents)]);
      rows.push(["Discount", `${t.discountLabel} (−${formatMoney(t.discountCents)})`]);
    }
    rows.push(["Total", formatMoney(t.totalCents)]);
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

/** One copy of an organizer notification for each person on the event's team. */
function toOrganizers(r: RequestInfo, kind: string, content: EmailContent): OutgoingEmail[] {
  return r.team.map((to) => ({
    kind,
    to,
    replyTo: r.vendor.email,
    organizerId: r.event.organizerId,
    eventId: r.event.id,
    requestId: r.requestId,
    ...content,
  }));
}

const firstName = (name: string) => esc(name.split(" ")[0]);

// ── Vendor emails ────────────────────────────────────────────────────────

/** "Please pay by …" block, shared by approval, assignment and reminder emails. */
function paymentBlocks(r: RequestInfo, labels: string[]) {
  const blocks = [];
  const total = formatMoney(totalsFor(r, labels).totalCents);
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

/** A warning for organizer emails when the vendor is on the ban list. */
const banWarning = (r: RequestInfo) =>
  r.ban
    ? [
        note(
          "This vendor is on your ban list",
          `${r.ban.reason ? `Reason: ${r.ban.reason}\n` : ""}Their request was held for your approval. The vendor wasn't told.`,
        ),
      ]
    : [];

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
        ...toOrganizers(
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
              ...banWarning(r),
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
    await send(requestId, (r) =>
      toOrganizers(
        r,
        "organizer.payment_overdue",
        layout(
          `Payment overdue: ${r.vendor.businessName || r.vendor.name} (${r.event.name})`,
          "A vendor payment is overdue",
          [
            p(`${esc(r.vendor.name)} hasn't paid for ${esc(tablesLabel(r.activeLabels))} at <strong>${esc(r.event.name)}</strong>. The deadline was ${esc(r.paymentDueAt ? formatDeadline(r.paymentDueAt) : "")}`),
            p("You can release the tables for other vendors, or keep them and give more time."),
            ...banWarning(r),
            vendorSummary(r),
            tablesPageLink(r),
          ],
          organizerFooter(r),
        ),
      ),
    );
  }
  return overdue.length;
}

// ── Collaborator invites ─────────────────────────────────────────────────

/** Email someone an invitation to collaborate on an event or template. */
export async function sendCollaboratorInvite(invite: {
  to: string;
  token: string;
  role: "editor" | "viewer";
  expiresAt: Date;
  event: { id: string; name: string; status: string; organizerId: string };
  inviter: { name: string; email: string };
}) {
  const { event, inviter } = invite;
  const what = event.status === "template" ? "template" : "show";
  const canDo =
    invite.role === "editor"
      ? `You'll be able to edit the ${what} and manage its vendor tables.`
      : `You'll be able to see the ${what} and its vendor tables, but not change anything.`;
  try {
    await enqueueEmails([
      {
        kind: "organizer.collaborator_invite",
        to: invite.to,
        replyTo: inviter.email,
        organizerId: event.organizerId,
        eventId: event.id,
        ...layout(
          `${inviter.name} invited you to ${event.name} on Flightplan`,
          `Join ${event.name}`,
          [
            p(
              `${esc(inviter.name)} invited you to help organize the ${what} <strong>${esc(event.name)}</strong> as ${invite.role === "editor" ? "an editor" : "a viewer"}. ${canDo}`,
            ),
            button("Accept invitation", `${APP_URL}/collaborate/${invite.token}`),
            p(
              `Sign in or create a Flightplan account with this email address (${esc(invite.to)}) to accept. The invitation expires ${esc(formatDeadline(invite.expiresAt))}.`,
            ),
          ],
          `You're receiving this because ${inviter.name} (${inviter.email}) invited you on Flightplan. If you weren't expecting it, you can ignore this email.`,
        ),
      },
    ]);
  } catch (err) {
    console.error(`Couldn't queue collaborator invite for event ${event.id}:`, err);
  }
}

// ── Vendor invites (sent in bulk to a group or favourites) ───────────────

/** Email vendors their personal booking links for a show. */
export async function sendVendorInvites(args: {
  event: { id: string; name: string; organizerId: string; startDate: string | null; venueName: string; address: string; city: string };
  days: { dayOffset: number; startTime: string; endTime: string }[];
  organizer: { name: string; email: string };
  invites: { name: string; email: string; token: string }[];
}) {
  const { event, days, organizer } = args;
  const schedule = event.startDate
    ? days
        .map((d) => `${formatDay(addDays(event.startDate!, d.dayOffset), { weekday: "short", month: "short", day: "numeric" })}: ${timeLabel(d.startTime)}–${timeLabel(d.endTime)}`)
        .join("\n")
    : "";
  try {
    await enqueueEmails(
      args.invites.map((inv) => ({
        kind: "vendor.invite",
        to: inv.email,
        replyTo: organizer.email,
        organizerId: event.organizerId,
        eventId: event.id,
        ...layout(
          `You're invited to book a table at ${event.name}`,
          "You're invited to book a table",
          [
            p(`Hi ${firstName(inv.name)}, ${esc(organizer.name)} invited you to book a vendor table at <strong>${esc(event.name)}</strong>.`),
            details([
              ["Show", event.name],
              ["When", schedule],
              ["Where", [event.venueName, event.address, event.city].filter(Boolean).join(", ")],
            ]),
            button("Pick your table", `${APP_URL}/invite/${inv.token}`),
            p("This link is just for you and can be used once."),
          ],
          `You're receiving this because ${organizer.name} invited you to their show on Flightplan. Reply to this email to contact them.`,
        ),
      })),
    );
  } catch (err) {
    console.error(`Couldn't queue vendor invites for event ${event.id}:`, err);
  }
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

