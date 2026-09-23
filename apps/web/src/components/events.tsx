import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { addDays, eventDayDates, eventEndDate, type EventRecord } from "@flightplan/shared";
import { useDeleteEvent, useSetEventStatus, useSpawnFromTemplate } from "../lib/api";
import { daysUntil, formatDate, formatDateRange, timeRange, todayISO } from "../lib/format";
import { ClockIcon, CloseIcon, CopyIcon, MapPinIcon, PencilIcon, TableIcon, TrashIcon } from "./Icons";

// ── Helpers ──────────────────────────────────────────────────────────────

/** A show is past once its last day has gone by. Templates are never past. */
export function isPast(event: EventRecord) {
  const end = eventEndDate(event);
  return end !== null && daysUntil(end) < 0;
}

export function isTemplate(event: EventRecord) {
  return event.status === "template";
}

function dayCount(event: EventRecord) {
  return event.days.length === 1 ? "1 day" : `${event.days.length} days`;
}

// ── Display pieces ───────────────────────────────────────────────────────

/** Calendar tile like the event cards on jetlaggedcards.ca. Shows a range for multi-day shows. */
export function DateTile({ event, size = "md" }: { event: EventRecord; size?: "md" | "lg" }) {
  const start = event.startDate;
  const end = eventEndDate(event);
  const big = size === "lg";

  if (!start || !end) {
    // Templates have no dates
    return (
      <div
        className={`flex shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-coral/40 bg-peach/40 text-coral-ink ${
          big ? "size-20" : "size-16"
        }`}
      >
        <CopyIcon className="size-5" />
        <span className="mt-1 text-[11px] font-bold">{dayCount(event)}</span>
      </div>
    );
  }

  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const days =
    start === end
      ? formatDate(start, { day: "numeric" })
      : sameMonth
        ? `${formatDate(start, { day: "numeric" })}–${formatDate(end, { day: "numeric" })}`
        : null;

  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow-sm ${
        isPast(event) ? "bg-gradient-to-br from-sky to-slate" : "bg-gradient-to-br from-gold to-coral"
      } ${big ? "size-20" : "size-16"}`}
    >
      {days ? (
        <>
          <span className="text-[11px] font-bold tracking-wider uppercase">{formatDate(start, { month: "short" })}</span>
          <span
            className={`leading-none font-extrabold ${
              days.length > 3 ? (big ? "text-2xl" : "text-lg") : big ? "text-4xl" : "text-2xl"
            }`}
          >
            {days}
          </span>
        </>
      ) : (
        // Crosses a month boundary, e.g. Oct 31 – Nov 2
        <span className="text-center text-[11px] leading-tight font-extrabold uppercase">
          {formatDate(start, { month: "short", day: "numeric" })}
          <br />–<br />
          {formatDate(end, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}

export function StatusBadge({ event }: { event: EventRecord }) {
  if (isTemplate(event)) {
    return <span className="rounded-full bg-peach px-2.5 py-1 text-xs font-bold text-coral-ink">Template</span>;
  }
  if (isPast(event)) {
    return <span className="rounded-full bg-ink/5 px-2.5 py-1 text-xs font-bold text-ink-soft">Past</span>;
  }
  return event.status === "published" ? (
    <span className="rounded-full bg-[#e8f8f5] px-2.5 py-1 text-xs font-bold text-[#2d7a6a]">Published</span>
  ) : (
    <span className="rounded-full bg-[#fff4cc] px-2.5 py-1 text-xs font-bold text-gold-ink">Draft</span>
  );
}

/** Each show day with its hours, e.g. "Fri Oct 10 · 2pm–8pm" (or "Day 1 · 2pm–8pm" for templates). */
export function Schedule({ event, tone = "light" }: { event: EventRecord; tone?: "light" | "dark" }) {
  const dates = eventDayDates(event);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {event.days.map((d, i) => (
        <li
          key={d.dayOffset}
          className={`rounded-lg px-2 py-1 text-xs font-semibold ${
            tone === "dark" ? "bg-white/10 text-white/90" : "bg-cream-50 text-ink-soft ring-1 ring-ink/5"
          }`}
        >
          <span className={tone === "dark" ? "font-bold text-white" : "font-bold text-ink"}>
            {dates[i] ? formatDate(dates[i], { weekday: "short", month: "short", day: "numeric" }) : `Day ${d.dayOffset + 1}`}
          </span>{" "}
          · {timeRange(d.startTime, d.endTime)}
        </li>
      ))}
    </ul>
  );
}

export function EventMeta({ event, tone = "light" }: { event: EventRecord; tone?: "light" | "dark" }) {
  const end = eventEndDate(event);
  const iconClass = tone === "dark" ? "size-4 text-white/60" : "size-4 text-ink-muted";
  const single = event.days.length === 1;

  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${tone === "dark" ? "text-white/80" : "text-ink-soft"}`}>
        <span className="flex items-center gap-1.5">
          <ClockIcon className={iconClass} />
          {event.startDate && end
            ? single
              ? `${formatDate(event.startDate, { weekday: "short", month: "short", day: "numeric" })} · ${timeRange(event.days[0].startTime, event.days[0].endTime)}`
              : `${formatDateRange(event.startDate, end)} · ${dayCount(event)}`
            : single
              ? `1 day · ${timeRange(event.days[0].startTime, event.days[0].endTime)}`
              : `${dayCount(event)}`}
        </span>
        <span className="flex items-center gap-1.5">
          <MapPinIcon className={iconClass} />
          {event.venueName}, {event.city}
        </span>
        <span className="flex items-center gap-1.5">
          <TableIcon className={iconClass} />
          {event.vendorTables} vendor tables
        </span>
      </div>
      {!single && <Schedule event={event} tone={tone} />}
    </div>
  );
}

/** Switch between an event's settings and its table bookings. */
export function EventTabs({ eventId }: { eventId: string }) {
  const tabs = [
    { to: `/dashboard/events/${eventId}`, label: "Details", end: true },
    { to: `/dashboard/events/${eventId}/tables`, label: "Tables & vendors", end: false },
  ];
  return (
    <nav className="mt-6 flex gap-1 border-b border-ink/10" aria-label="Event sections">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `-mb-px border-b-4 px-4 py-2.5 text-sm font-bold transition ${
              isActive ? "border-coral text-coral-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────

function DeleteConfirm({ onConfirm, onCancel, pending }: { onConfirm: () => void; onCancel: () => void; pending: boolean }) {
  return (
    <>
      <span className="text-sm font-semibold text-coral-ink">Delete permanently?</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="rounded-full bg-coral-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full px-3 py-2 text-sm font-bold text-ink-soft hover:bg-cream"
      >
        Cancel
      </button>
    </>
  );
}

function IconActions({ event, editTo, onDelete }: { event: EventRecord; editTo: string; onDelete: () => void }) {
  return (
    <>
      <Link
        to={editTo}
        className="rounded-full p-2.5 text-ink-soft transition hover:bg-cream hover:text-ink"
        aria-label={`Edit ${event.name}`}
        title="Edit"
      >
        <PencilIcon className="size-4" />
      </Link>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-full p-2.5 text-ink-soft transition hover:bg-peach hover:text-coral-ink"
        aria-label={`Delete ${event.name}`}
        title="Delete"
      >
        <TrashIcon className="size-4" />
      </button>
    </>
  );
}

const rowClass =
  "flex flex-col gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 sm:flex-row sm:flex-wrap sm:items-center";

/** A dated event in a list, with publish / edit / delete actions. */
export function EventRow({ event }: { event: EventRecord }) {
  const setStatus = useSetEventStatus();
  const del = useDeleteEvent();
  const [confirming, setConfirming] = useState(false);
  const editTo = `/dashboard/events/${event.id}`;

  return (
    <li className={rowClass}>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <DateTile event={event} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={editTo} className="truncate text-lg font-extrabold text-ink hover:text-coral-ink">
              {event.name}
            </Link>
            <StatusBadge event={event} />
          </div>
          <div className="mt-1.5">
            <EventMeta event={event} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:shrink-0">
        {confirming ? (
          <DeleteConfirm pending={del.isPending} onConfirm={() => del.mutate(event.id)} onCancel={() => setConfirming(false)} />
        ) : (
          <>
            {!isPast(event) && (
              <button
                type="button"
                onClick={() =>
                  setStatus.mutate({ id: event.id, status: event.status === "published" ? "draft" : "published" })
                }
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
              to={`/dashboard/events/${event.id}/tables`}
              className="rounded-full px-3 py-2 text-sm font-bold text-slate transition hover:bg-cream"
            >
              Tables
            </Link>
            <IconActions event={event} editTo={editTo} onDelete={() => setConfirming(true)} />
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

/** A template in a list, with "Use template" / edit / delete actions. */
export function TemplateRow({ event }: { event: EventRecord }) {
  const del = useDeleteEvent();
  const [confirming, setConfirming] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const editTo = `/dashboard/templates/${event.id}`;

  return (
    <li className={rowClass}>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <DateTile event={event} />
        <div className="min-w-0">
          <Link to={editTo} className="truncate text-lg font-extrabold text-ink hover:text-coral-ink">
            {event.name}
          </Link>
          <div className="mt-1.5">
            <EventMeta event={event} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:shrink-0">
        {confirming ? (
          <DeleteConfirm pending={del.isPending} onConfirm={() => del.mutate(event.id)} onCancel={() => setConfirming(false)} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSpawning(true)}
              className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-bold text-white transition hover:bg-coral-deep"
            >
              <CopyIcon className="size-4" /> Use template
            </button>
            <IconActions event={event} editTo={editTo} onDelete={() => setConfirming(true)} />
          </>
        )}
      </div>
      {del.error && (
        <p className="text-sm font-semibold text-coral-ink sm:basis-full" role="alert">
          {del.error.message}
        </p>
      )}
      {spawning && <SpawnDialog template={event} onClose={() => setSpawning(false)} />}
    </li>
  );
}

// ── Use template ─────────────────────────────────────────────────────────

/** Pick the first day's date, preview the schedule, and create a draft from a template. */
export function SpawnDialog({ template, onClose }: { template: EventRecord; onClose: () => void }) {
  const navigate = useNavigate();
  const spawn = useSpawnFromTemplate();
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dateRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function create() {
    if (!startDate) return setError("Pick the date of the first day");
    spawn.mutate(
      { templateId: template.id, startDate },
      {
        onSuccess: (draft) =>
          navigate(`/dashboard/events/${draft.id}`, { state: { fromTemplate: template.name } }),
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="spawn-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream"
          aria-label="Close"
        >
          <CloseIcon className="size-5" />
        </button>
        <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">Use template</p>
        <h2 id="spawn-title" className="mt-1 pr-8 text-2xl font-extrabold">
          {template.name}
        </h2>
        <p className="mt-2 text-ink-soft">
          This creates a draft you can customize before publishing. The template itself won't change.
        </p>

        <label htmlFor="spawn-date" className="mt-6 block text-sm font-bold">
          First day of the show
        </label>
        <input
          ref={dateRef}
          id="spawn-date"
          type="date"
          min={todayISO()}
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setError(null);
          }}
          className="mt-2 w-full rounded-xl border-2 border-cream bg-white px-4 py-3 text-ink transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none"
        />

        <div className="mt-5 rounded-2xl bg-cream-50 p-4 ring-1 ring-ink/5">
          <p className="text-xs font-bold tracking-wider text-ink-muted uppercase">Schedule</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {template.days.map((d) => (
              <li key={d.dayOffset} className="flex justify-between gap-4">
                <span className="font-bold">
                  {startDate
                    ? formatDate(addDays(startDate, d.dayOffset), { weekday: "long", month: "short", day: "numeric" })
                    : `Day ${d.dayOffset + 1}`}
                </span>
                <span className="text-ink-soft">{timeRange(d.startTime, d.endTime)}</span>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-3 font-bold text-ink-soft hover:bg-cream"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={spawn.isPending}
            className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] disabled:opacity-60"
          >
            {spawn.isPending ? "Creating draft…" : "Create draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
