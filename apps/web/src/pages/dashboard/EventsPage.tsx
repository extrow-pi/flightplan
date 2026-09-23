import { useState } from "react";
import { Link } from "react-router";
import type { EventRecord } from "@flightplan/shared";
import { EventRow } from "../../components/events";
import { useEvents } from "../../lib/api";
import { daysUntil } from "../../lib/format";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

const filters = {
  upcoming: { label: "Upcoming", test: (e: EventRecord) => daysUntil(e.date) >= 0 },
  drafts: { label: "Drafts", test: (e: EventRecord) => daysUntil(e.date) >= 0 && e.status === "draft" },
  past: { label: "Past", test: (e: EventRecord) => daysUntil(e.date) < 0 },
  all: { label: "All", test: () => true },
} satisfies Record<string, { label: string; test: (e: EventRecord) => boolean }>;

type Filter = keyof typeof filters;

export default function EventsPage() {
  const { data: events, isPending, error } = useEvents();
  const [filter, setFilter] = useState<Filter>("upcoming");

  const shown = (events ?? []).filter(filters[filter].test);
  // Past events read best newest-first
  if (filter === "past") shown.reverse();

  return (
    <>
      <PageHeader eyebrow="Events" title="Your shows" subtitle="Create, publish and manage your events." />

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter events">
        {(Object.keys(filters) as Filter[]).map((key) => {
          const count = (events ?? []).filter(filters[key].test).length;
          const active = key === filter;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(key)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
                active ? "bg-slate text-white" : "bg-white text-ink-soft ring-1 ring-ink/10 hover:text-ink"
              }`}
            >
              {filters[key].label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20" : "bg-cream"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <ErrorCard message={error.message} />
      ) : isPending ? (
        <LoadingCards />
      ) : shown.length ? (
        <ul className="space-y-3">
          {shown.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </ul>
      ) : (
        <div className="rounded-3xl border-2 border-dashed border-coral/30 bg-white px-6 py-14 text-center">
          <p className="text-lg font-extrabold">
            {filter === "past" ? "No past events yet" : filter === "drafts" ? "No drafts" : "No events here yet"}
          </p>
          {filter !== "past" && (
            <Link
              to="/dashboard/events/new"
              className="mt-4 inline-block rounded-full bg-coral px-6 py-3 font-bold text-white transition hover:bg-coral-deep"
            >
              Create an event
            </Link>
          )}
        </div>
      )}
    </>
  );
}
