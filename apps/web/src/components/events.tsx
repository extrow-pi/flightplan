import { useState } from "react";
import { Link } from "react-router";
import type { EventRecord, EventStatus } from "@flightplan/shared";
import { useDeleteEvent, useSetEventStatus } from "../lib/api";
import { daysUntil, formatDate, formatTime } from "../lib/format";
import { ClockIcon, MapPinIcon, PencilIcon, TableIcon, TrashIcon } from "./Icons";

/** Calendar tile like the event cards on jetlaggedcards.ca */
export function DateTile({ date, size = "md" }: { date: string; size?: "md" | "lg" }) {
  const past = daysUntil(date) < 0;
  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow-sm ${
        past ? "bg-gradient-to-br from-sky to-slate" : "bg-gradient-to-br from-gold to-coral"
      } ${size === "lg" ? "size-20" : "size-16"}`}
    >
      <span className="text-[11px] font-bold tracking-wider uppercase">{formatDate(date, { month: "short" })}</span>
      <span className={`leading-none font-extrabold ${size === "lg" ? "text-4xl" : "text-2xl"}`}>
        {formatDate(date, { day: "numeric" })}
      </span>
    </div>
  );
}

export function StatusBadge({ status, date }: { status: EventStatus; date: string }) {
  if (daysUntil(date) < 0) {
    return <span className="rounded-full bg-ink/5 px-2.5 py-1 text-xs font-bold text-ink-soft">Past</span>;
  }
  return status === "published" ? (
    <span className="rounded-full bg-[#e8f8f5] px-2.5 py-1 text-xs font-bold text-[#2d7a6a]">Published</span>
  ) : (
    <span className="rounded-full bg-[#fff4cc] px-2.5 py-1 text-xs font-bold text-gold-ink">Draft</span>
  );
}

export function DaysToGo({ date }: { date: string }) {
  const days = daysUntil(date);
  if (days < 0) return null;
  return (
    <div className="text-right">
      <p className="text-2xl leading-none font-extrabold text-coral">{days === 0 ? "Today" : days}</p>
      {days > 0 && <p className="mt-1 text-[11px] font-bold tracking-wider text-ink-muted uppercase">days to go</p>}
    </div>
  );
}

export function EventMeta({ event }: { event: EventRecord }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
      <span className="flex items-center gap-1.5">
        <ClockIcon className="size-4 text-ink-muted" />
        {formatDate(event.date, { weekday: "short", month: "short", day: "numeric" })} · {formatTime(event.startTime)}–
        {formatTime(event.endTime)}
      </span>
      <span className="flex items-center gap-1.5">
        <MapPinIcon className="size-4 text-ink-muted" />
        {event.venueName}, {event.city}
      </span>
      <span className="flex items-center gap-1.5">
        <TableIcon className="size-4 text-ink-muted" />
        {event.vendorTables} vendor tables
      </span>
    </div>
  );
}

/** A row in an event list, with publish / edit / delete actions. */
export function EventRow({ event }: { event: EventRecord }) {
  const setStatus = useSetEventStatus();
  const del = useDeleteEvent();
  const [confirming, setConfirming] = useState(false);
  const isPast = daysUntil(event.date) < 0;
  const nextStatus: EventStatus = event.status === "published" ? "draft" : "published";

  return (
    <li className="flex flex-col gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <DateTile date={event.date} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/dashboard/events/${event.id}`}
              className="truncate text-lg font-extrabold text-ink hover:text-coral-ink"
            >
              {event.name}
            </Link>
            <StatusBadge status={event.status} date={event.date} />
          </div>
          <div className="mt-1.5">
            <EventMeta event={event} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:shrink-0">
        {confirming ? (
          <>
            <span className="text-sm font-semibold text-coral-ink">Delete this event?</span>
            <button
              type="button"
              onClick={() => del.mutate(event.id)}
              disabled={del.isPending}
              className="rounded-full bg-coral-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full px-3 py-2 text-sm font-bold text-ink-soft hover:bg-cream"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!isPast && (
              <button
                type="button"
                onClick={() => setStatus.mutate({ id: event.id, status: nextStatus })}
                disabled={setStatus.isPending}
                className={`rounded-full px-4 py-2 text-sm font-bold transition disabled:opacity-60 ${
                  event.status === "published"
                    ? "border-2 border-slate/30 text-slate hover:border-slate"
                    : "bg-coral text-white hover:bg-coral-deep"
                }`}
              >
                {event.status === "published" ? "Unpublish" : "Publish"}
              </button>
            )}
            <Link
              to={`/dashboard/events/${event.id}`}
              className="rounded-full p-2.5 text-ink-soft transition hover:bg-cream hover:text-ink"
              aria-label={`Edit ${event.name}`}
              title="Edit"
            >
              <PencilIcon className="size-4" />
            </Link>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-full p-2.5 text-ink-soft transition hover:bg-peach hover:text-coral-ink"
              aria-label={`Delete ${event.name}`}
              title="Delete"
            >
              <TrashIcon className="size-4" />
            </button>
          </>
        )}
      </div>
      {(setStatus.error || del.error) && (
        <p className="text-sm font-semibold text-coral-ink sm:basis-full" role="alert">
          {(setStatus.error ?? del.error)?.message}
        </p>
      )}
    </li>
  );
}
