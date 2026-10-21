import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { eventEndDate, type PublicEventMap } from "@flightplan/shared";
import MapViewer from "../components/floorplan/MapViewer";
import { MapPinIcon, SearchIcon } from "../components/Icons";
import Logo from "../components/Logo";
import { ApiRequestError, usePublicEventMap } from "../lib/api";
import { formatDate, formatDateRange } from "../lib/format";

// The public vendor map for a show: search for a vendor and see where their table is. No sign-in.
export default function VisitorMapPage() {
  const { eventId } = useParams();
  const { data, isPending, error } = usePublicEventMap(eventId);

  useEffect(() => {
    if (data) document.title = `Vendor map · ${data.event.name}`;
    return () => {
      document.title = "Flightplan — Event tools for show organizers";
    };
  }, [data]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-ink-muted" role="status">
            Loading the map…
          </p>
        ) : error || !data ? (
          <section className="rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-ink/5">
            <h1 className="text-2xl font-extrabold">
              {error instanceof ApiRequestError && error.status === 404 ? "This map isn't available" : "Couldn't load the map"}
            </h1>
            <p className="mt-2 text-ink-soft">
              {error instanceof ApiRequestError && error.status === 404
                ? "The organizer may not have shared a vendor map for this show yet."
                : "Please try again in a moment."}
            </p>
          </section>
        ) : (
          <MapPage data={data} />
        )}
      </main>
      <footer className="border-t border-ink/5 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-sm text-ink-muted sm:flex-row sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            Map by <Logo className="scale-75" />
          </span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-ink">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function MapPage({ data }: { data: PublicEventMap }) {
  const { event, floorplan, vendors } = data;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => vendors.filter((v) => !q || v.name.toLowerCase().includes(q) || v.tables.some((t) => t.label.toLowerCase() === q)),
    [vendors, q],
  );
  // Which vendor holds each table on the plan
  const vendorAt = useMemo(() => new Map(vendors.flatMap((v) => v.tables.map((t) => [t.planItemId, v] as const))), [vendors]);
  const pickedVendor = picked ? vendors.find((v) => v.name === picked) : undefined;
  const highlighted = new Set((pickedVendor ? [pickedVendor] : q ? shown : []).flatMap((v) => v.tables.map((t) => t.planItemId)));
  const end = eventEndDate(event);
  const when = end && end !== event.startDate ? formatDateRange(event.startDate, end) : formatDate(event.startDate);

  return (
    <>
      <header>
        {event.organizerUrl ? (
          <Link to={event.organizerUrl} className="text-sm font-bold text-coral-ink hover:underline">
            {event.organizerName}
          </Link>
        ) : (
          <p className="text-sm font-bold text-coral-ink">{event.organizerName}</p>
        )}
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-ink-soft">
          <span>{when}</span>
          {(event.venueName || event.city) && (
            <span className="flex items-center gap-1">
              <MapPinIcon className="size-4" /> {[event.venueName, event.city].filter(Boolean).join(", ")}
            </span>
          )}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <MapViewer
          plan={floorplan}
          className="max-h-[70dvh] min-h-64"
          label={`Vendor map for ${event.name}`}
          focus={pickedVendor ? pickedVendor.tables.map((t) => t.planItemId) : q && shown.length && shown.length <= 10 ? [...highlighted] : undefined}
          tableStyle={(t) => {
            const v = vendorAt.get(t.id);
            const on = highlighted.has(t.id);
            const name = v?.name ?? "";
            return {
              fill: on ? "#e8856a" : v ? "#ffffff" : "#f6f1e8",
              stroke: on ? "#c0442a" : v ? "#5c6b8a" : "#d8ccb8",
              ink: on ? "#ffffff" : v ? "#4b5875" : "#b3a493",
              sublabel: name ? (name.length > 14 ? `${name.slice(0, 13)}…` : name) : undefined,
              title: v ? `Table ${t.label}: ${v.name}` : `Table ${t.label}`,
              dim: Boolean((q || pickedVendor) && !on),
            };
          }}
          onTableClick={(t) => {
            const v = vendorAt.get(t.id);
            setPicked(v && v.name !== picked ? v.name : null);
          }}
        />

        <aside className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink/5 lg:max-h-[70dvh] lg:overflow-y-auto">
          <label className="relative block">
            <span className="sr-only">Find a vendor</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
              }}
              placeholder="Find a vendor or table"
              className="w-full rounded-full border-2 border-cream bg-white py-2.5 pr-4 pl-10 text-base text-ink placeholder:text-ink-muted/70 focus:border-coral focus:outline-none"
            />
          </label>
          <p className="mt-3 text-xs text-ink-muted" aria-live="polite">
            {q ? `${shown.length} of ${vendors.length} vendors` : `${vendors.length} ${vendors.length === 1 ? "vendor" : "vendors"}`} · tap one to
            find them
          </p>
          <ul className="mt-2 divide-y divide-ink/5">
            {shown.map((v) => {
              const on = picked === v.name;
              return (
                <li key={v.name + v.tables[0]?.planItemId}>
                  <button
                    type="button"
                    onClick={() => setPicked(on ? null : v.name)}
                    aria-pressed={on}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left transition ${on ? "bg-peach" : "hover:bg-cream-50"}`}
                  >
                    <span className="min-w-0 truncate font-semibold">{v.name}</span>
                    <span className="shrink-0 rounded-lg bg-slate px-2 py-0.5 text-xs font-extrabold text-white">
                      {v.tables.map((t) => t.label).join(", ")}
                    </span>
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-2 py-3 text-sm text-ink-muted">No vendors match “{query.trim()}”.</li>}
          </ul>
        </aside>
      </div>
    </>
  );
}
