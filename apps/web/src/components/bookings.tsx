import { useState } from "react";
import type { Booking } from "@flightplan/shared";
import { useBookingAction } from "../lib/api";

// ── Status ───────────────────────────────────────────────────────────────

type TableState = "available" | "pending" | "awaiting_payment" | "overdue" | "paid";

export function tableState(booking: Booking | null): TableState {
  if (!booking) return "available";
  if (booking.overdue) return "overdue";
  return booking.status as Exclude<TableState, "available" | "overdue">;
}

const stateStyles: Record<TableState, { label: string; className: string }> = {
  available: { label: "Available", className: "bg-sky/20 text-slate" },
  pending: { label: "Needs approval", className: "bg-[#fff4cc] text-gold-ink" },
  awaiting_payment: { label: "Awaiting payment", className: "bg-peach text-coral-ink" },
  overdue: { label: "Payment overdue", className: "bg-coral-ink text-white" },
  paid: { label: "Paid", className: "bg-[#e8f8f5] text-[#2d7a6a]" },
};

export const TABLE_STATES = Object.keys(stateStyles) as TableState[];

export function tableStateLabel(state: TableState) {
  return stateStyles[state].label;
}

export function TableStateBadge({ state }: { state: TableState }) {
  const s = stateStyles[state];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${s.className}`}>{s.label}</span>;
}

const closedLabels: Record<string, string> = {
  rejected: "Rejected",
  released: "Released",
  cancelled: "Cancelled",
};

export function closedLabel(status: Booking["status"]) {
  return closedLabels[status] ?? status;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "Pay by Sep 26, 9:59 a.m." / "Overdue since …" / "No payment deadline" */
export function paymentDueLabel(booking: Booking) {
  if (booking.status !== "awaiting_payment") return null;
  if (!booking.paymentDueAt) return "No payment deadline";
  return `${booking.overdue ? "Overdue since" : "Pay by"} ${dateTime(booking.paymentDueAt)}`;
}

export const sourceLabels: Record<Booking["source"], string> = {
  public_link: "Booking link",
  invite: "Invite",
  organizer: "Assigned by you",
};

// ── Actions ──────────────────────────────────────────────────────────────

const btn = {
  primary: "rounded-full bg-coral px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-coral-deep disabled:opacity-60",
  secondary:
    "rounded-full border-2 border-slate/30 px-3.5 py-1 text-sm font-bold text-slate transition hover:border-slate disabled:opacity-60",
  danger: "rounded-full px-3 py-1.5 text-sm font-bold text-coral-ink transition hover:bg-peach disabled:opacity-60",
};

/**
 * The next steps for a vendor's request, applied to all of its tables: approve / reject, mark paid,
 * release, or for overdue payments, keep them with more time. (ReleaseTableButton frees just one.)
 */
export function BookingActions({
  booking,
  eventId,
  paymentDueDays,
  requestTables,
}: {
  booking: Booking;
  eventId?: string;
  /** Default extension when keeping an overdue booking */
  paymentDueDays: number | null;
  /** Labels of every table still held by this booking's request */
  requestTables: string[];
}) {
  const act = useBookingAction(eventId);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const busy = act.isPending;
  const run = (a: Parameters<typeof act.mutate>[0]) => act.mutate(a);
  const id = booking.id;
  const extend = paymentDueDays ?? 7;
  const count = requestTables.length;
  const all = count > 1 ? ` (${count} tables)` : "";

  if (confirmRelease) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-coral-ink">
          {count > 1 ? `Free tables ${requestTables.join(", ")}?` : "Free this table?"}
        </span>
        <button
          type="button"
          className={btn.primary}
          disabled={busy}
          onClick={() => run({ bookingId: id, action: "release", wholeRequest: true })}
        >
          {busy ? "Releasing…" : count > 1 ? `Release all ${count}` : "Release"}
        </button>
        <button type="button" className={btn.danger} onClick={() => setConfirmRelease(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {booking.status === "pending" && (
        <>
          <button type="button" className={btn.primary} disabled={busy} onClick={() => run({ bookingId: id, action: "approve" })}>
            Approve{all}
          </button>
          <button type="button" className={btn.danger} disabled={busy} onClick={() => run({ bookingId: id, action: "reject" })}>
            Reject{all}
          </button>
        </>
      )}

      {booking.status === "awaiting_payment" && booking.overdue && (
        <>
          <button type="button" className={btn.primary} disabled={busy} onClick={() => setConfirmRelease(true)}>
            {count > 1 ? "Release tables" : "Release table"}
          </button>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy}
            onClick={() => run({ bookingId: id, action: "keep", extendDays: extend })}
          >
            Keep, +{extend} days
          </button>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy}
            onClick={() => run({ bookingId: id, action: "keep", extendDays: null })}
            title="Keep the table with no payment deadline"
          >
            Keep, no deadline
          </button>
        </>
      )}

      {(booking.status === "awaiting_payment" || booking.status === "pending") && (
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => run({ bookingId: id, action: "mark-paid" })}>
          Mark paid{all}
        </button>
      )}

      {booking.status !== "pending" && !(booking.status === "awaiting_payment" && booking.overdue) && (
        <button type="button" className={btn.danger} disabled={busy} onClick={() => setConfirmRelease(true)}>
          {count > 1 ? `Release all ${count}` : "Release"}
        </button>
      )}

      {act.error && (
        <span className="basis-full text-sm font-semibold text-coral-ink" role="alert">
          {act.error.message}
        </span>
      )}
    </div>
  );
}

/** Free a single table (the rest of its request, if any, stays booked). Asks first. */
export function ReleaseTableButton({
  bookingId,
  eventId,
  tableLabel,
  compact = false,
}: {
  bookingId: string;
  eventId: string;
  tableLabel: string;
  /** A small × for use inside a table chip */
  compact?: boolean;
}) {
  const act = useBookingAction(eventId);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${compact ? "ml-1 rounded-full bg-white py-0.5 pr-0.5 pl-2.5 shadow-sm" : ""}`}
      >
        <span className="text-xs font-semibold whitespace-nowrap text-coral-ink">
          {compact ? "Release?" : `Release ${tableLabel}?`}
        </span>
        <button
          type="button"
          disabled={act.isPending}
          onClick={() => act.mutate({ bookingId, action: "release" })}
          className="rounded-full bg-coral px-2.5 py-0.5 text-xs font-bold text-white disabled:opacity-60"
        >
          {act.isPending ? "…" : "Yes"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-full px-2 py-0.5 text-xs font-bold text-ink-soft hover:bg-cream"
        >
          No
        </button>
      </span>
    );
  }

  return compact ? (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="ml-1 flex size-5 items-center justify-center rounded-full bg-white/90 text-sm leading-none font-bold text-ink transition hover:bg-coral hover:text-white"
      aria-label={`Release table ${tableLabel} only`}
      title={`Release table ${tableLabel} only`}
    >
      ×
    </button>
  ) : (
    <button type="button" className={btn.danger} onClick={() => setConfirming(true)}>
      Release
    </button>
  );
}
