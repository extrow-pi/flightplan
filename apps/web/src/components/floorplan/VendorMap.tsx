import { useMemo, useState } from "react";
import type { PublicEventMap } from "@flightplan/shared";
import { SearchIcon } from "../Icons";
import MapViewer from "./MapViewer";

/** A show's floorplan with its vendors: search for a vendor (or table) and see where they are. */
export default function VendorMap({ data, className = "max-h-[70dvh] min-h-64" }: { data: PublicEventMap; className?: string }) {
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

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <MapViewer
        plan={floorplan}
        className={className}
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

      <aside className="rounded-3xl bg-white p-4 text-ink shadow-sm ring-1 ring-ink/5 lg:max-h-[70dvh] lg:overflow-y-auto">
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
                  <span className="shrink-0 rounded-lg bg-slate px-2 py-0.5 text-xs font-extrabold text-white">{v.tables.map((t) => t.label).join(", ")}</span>
                </button>
              </li>
            );
          })}
          {!shown.length && (
            <li className="px-2 py-3 text-sm text-ink-muted">{vendors.length ? `No vendors match “${query.trim()}”.` : "Vendors will appear here once tables are booked."}</li>
          )}
        </ul>
      </aside>
    </div>
  );
}
