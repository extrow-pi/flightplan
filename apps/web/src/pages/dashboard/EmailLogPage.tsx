import { useState } from "react";
import { Link } from "react-router";
import type { EmailLogEntry, EmailStatus } from "@flightplan/shared";
import { CloseIcon, MailIcon } from "../../components/Icons";
import { useEmailHtml, useEmailLog, useRetryEmail } from "../../lib/api";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

// What each kind of email is, in plain words
const kindLabels: Record<string, string> = {
  "vendor.request_received": "Request received",
  "vendor.booked": "Booking held, payment due",
  "vendor.assigned": "Table assigned, payment due",
  "vendor.approved": "Approved, payment due",
  "vendor.confirmed": "Booking confirmed",
  "vendor.rejected": "Request not approved",
  "vendor.released": "Tables released",
  "vendor.deadline_extended": "More time to pay",
  "vendor.payment_reminder": "Payment reminder",
  "organizer.request_pending": "New request to review",
  "organizer.new_booking": "New booking",
  "organizer.payment_overdue": "Payment overdue",
};

const statusStyles: Record<EmailStatus, { label: string; className: string }> = {
  queued: { label: "Sending…", className: "bg-cream text-ink-soft" },
  sent: { label: "Sent", className: "bg-[#e8f8f5] text-[#2d7a6a]" },
  failed: { label: "Failed", className: "bg-coral-ink text-white" },
  logged: { label: "Not sent", className: "bg-[#fff4cc] text-gold-ink" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function EmailLogPage() {
  const { data, isPending, error } = useEmailLog();
  const [open, setOpen] = useState<EmailLogEntry | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Email log"
        title="Emails"
        subtitle="Every email Flightplan sends to your vendors and to you, newest first."
        action={null}
      />

      {data && !data.deliveryEnabled && (
        <div className="mb-6 rounded-2xl bg-[#fff4cc] px-5 py-4 text-sm text-ink" role="status">
          <p className="font-bold text-gold-ink">Emails aren't being delivered yet</p>
          <p className="mt-1">
            No email service is connected, so these are recorded here but not sent. Add a Resend API key to{" "}
            <code className="rounded bg-white/70 px-1">apps/api/.env</code> to start sending (see the README).
          </p>
        </div>
      )}

      {error ? (
        <ErrorCard message={error.message} />
      ) : isPending ? (
        <LoadingCards />
      ) : !data.emails.length ? (
        <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-coral/30 bg-white px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-peach text-coral-ink">
            <MailIcon className="size-7" />
          </span>
          <p className="mt-4 text-lg font-extrabold">No emails yet</p>
          <p className="mt-2 max-w-md text-ink-soft">
            Emails go out when vendors book tables and when you approve, mark paid or release them.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink/5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
          {data.emails.map((e) => (
            <EmailRow key={e.id} email={e} onOpen={() => setOpen(e)} />
          ))}
        </ul>
      )}

      {open && <EmailPreview email={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function EmailRow({ email: e, onOpen }: { email: EmailLogEntry; onOpen: () => void }) {
  const retry = useRetryEmail();
  const s = statusStyles[e.status];
  const toOrganizer = e.kind.startsWith("organizer.");
  return (
    <li className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate font-bold hover:text-coral-ink">{e.subject}</p>
        <p className="mt-0.5 truncate text-sm text-ink-soft">
          {kindLabels[e.kind] ?? e.kind} · {toOrganizer ? "to you" : `to ${e.to}`}
          {e.eventName && ` · ${e.eventName}`}
        </p>
        {e.status === "failed" && e.lastError && (
          <p className="mt-1 truncate text-xs font-semibold text-coral-ink" title={e.lastError}>
            {e.lastError}
          </p>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs text-ink-muted">{when(e.createdAt)}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${s.className}`}>{s.label}</span>
        {e.status === "failed" && (
          <button
            type="button"
            onClick={() => retry.mutate(e.id)}
            disabled={retry.isPending}
            className="rounded-full border-2 border-slate/30 px-3 py-0.5 text-xs font-bold text-slate hover:border-slate disabled:opacity-60"
          >
            Retry
          </button>
        )}
        {e.eventId && (
          <Link to={`/dashboard/events/${e.eventId}/tables`} className="text-xs font-bold text-coral-ink hover:underline">
            Event
          </Link>
        )}
      </div>
    </li>
  );
}

function EmailPreview({ email, onClose }: { email: EmailLogEntry; onClose: () => void }) {
  const html = useEmailHtml(email.id);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="email-subject">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-ink/5 px-6 py-4">
          <div className="min-w-0">
            <p id="email-subject" className="font-extrabold">
              {email.subject}
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-soft">
              To {email.to} · {when(email.createdAt)} · {statusStyles[email.status].label}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
            <CloseIcon className="size-5" />
          </button>
        </div>
        {html.error ? (
          <p className="p-6 font-semibold text-coral-ink" role="alert">
            {html.error.message}
          </p>
        ) : (
          // Sandboxed: the email's HTML can't run scripts or reach the dashboard
          <iframe
            title={`Email: ${email.subject}`}
            srcDoc={html.data ?? ""}
            sandbox=""
            className="h-[70dvh] w-full bg-[#faf0dc]"
          />
        )}
      </div>
    </div>
  );
}
