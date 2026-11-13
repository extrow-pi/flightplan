import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Vendor } from "@flightplan/shared";
import { smallInput } from "./Dialog";
import { SearchIcon } from "./Icons";

/** Search the vendor list and pick one. */
export default function VendorPicker({
  vendors,
  value,
  onChange,
  badge,
  isDisabled,
}: {
  vendors: Vendor[];
  value: string;
  onChange: (id: string) => void;
  /** Shown after each vendor, e.g. where they stand at this show */
  badge?: (v: Vendor) => ReactNode;
  /** Vendors that can't be picked here, with the reason */
  isDisabled?: (v: Vendor) => string | null;
}) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const q = search.trim().toLowerCase();
  // A vendor picked before the dialog opened may be far down the list
  useEffect(() => {
    const list = listRef.current;
    const picked = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (list && picked) list.scrollTop = picked.offsetTop - list.offsetTop - 6;
  }, []);
  const shown = vendors.filter(
    (v) => !q || [v.name, v.businessName, v.email, v.phone].some((f) => f.toLowerCase().includes(q)),
  );

  return (
    <div className="mt-3">
      <label className="relative block">
        <span className="sr-only">Search your vendors</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, business or email"
          className={`${smallInput} mt-0 pl-9`}
        />
      </label>
      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Vendor"
        className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-cream-50 p-1.5 ring-1 ring-ink/5"
      >
        {shown.map((v) => {
          const reason = isDisabled?.(v) ?? null;
          const on = v.id === value;
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={Boolean(reason)}
              title={reason ?? undefined}
              onClick={() => onChange(v.id)}
              className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-left transition disabled:opacity-50 ${
                on ? "bg-white ring-2 ring-coral" : "hover:bg-white"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {v.favourite && <span className="text-gold-ink">★ </span>}
                  {v.businessName || v.name}
                  {v.businessName && <span className="font-semibold text-ink-soft"> · {v.name}</span>}
                </span>
                <span className="block truncate text-xs text-ink-muted">{v.email}</span>
              </span>
              {v.banned && <span className="rounded-full bg-coral-ink px-2 py-0.5 text-xs font-bold text-white">Banned</span>}
              {badge?.(v)}
            </button>
          );
        })}
        {!shown.length && <p className="px-3 py-2 text-sm text-ink-muted">No vendors match “{search.trim()}”.</p>}
      </div>
    </div>
  );
}
