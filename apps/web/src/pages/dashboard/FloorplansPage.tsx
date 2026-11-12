import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { FLOORPLAN_UNITS, type Floorplan, type FloorplanUnits } from "@flightplan/shared";
import { FloorplanView } from "../../components/floorplan/FloorplanDrawing";
import { CloseIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import { ApiRequestError, useDeleteFloorplan, useDuplicateFloorplan, useFloorplans, useSaveFloorplan } from "../../lib/api";
import { formatSize, fromUnits, unitLabel } from "../../lib/floorplan";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

const inputClass =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";

/** The organizer's floorplan library: room layouts they design once and reuse for their shows. */
export default function FloorplansPage() {
  const plans = useFloorplans();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Floorplans"
        title="Floorplans"
        subtitle="Lay out a venue once: the room's size, tables, walls and landmarks like entrances and washrooms. Reuse a plan for any show."
        action={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold whitespace-nowrap text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
          >
            <PlusIcon className="size-4" strokeWidth={3} /> New floorplan
          </button>
        }
      />

      {plans.isPending ? (
        <LoadingCards />
      ) : plans.error ? (
        <ErrorCard message={plans.error.message} />
      ) : plans.data.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
          <p className="text-lg font-extrabold">No floorplans yet</p>
          <p className="mx-auto mt-1 max-w-md text-ink-soft">
            Start with the room's size, then drop in tables, walls and landmarks. Vendors will be able to pick their table on the map.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-5 rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white"
          >
            Create your first floorplan
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </ul>
      )}

      {creating && <NewPlanDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function PlanCard({ plan }: { plan: Floorplan }) {
  const duplicate = useDuplicateFloorplan();
  const remove = useDeleteFloorplan();
  const [confirming, setConfirming] = useState(false);
  const landmarks = plan.items.filter((i) => i.kind === "landmark").length;

  return (
    <li className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
      <Link to={`/dashboard/floorplans/${plan.id}`} className="block bg-cream-50 p-3" aria-label={`Edit ${plan.name}`}>
        <FloorplanView plan={plan} className="max-h-56" label={`${plan.name} floorplan`} />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="truncate text-lg font-extrabold">{plan.name}</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          {formatSize(plan.widthMm, plan.depthMm, plan.units)} · {plan.tableCount} {plan.tableCount === 1 ? "table" : "tables"}
          {landmarks > 0 && ` · ${landmarks} ${landmarks === 1 ? "landmark" : "landmarks"}`}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          Updated {new Date(plan.updatedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/5 pt-3">
          {confirming ? (
            <>
              <span className="text-sm font-semibold">Delete this plan?</span>
              <button
                type="button"
                onClick={() => remove.mutate(plan.id)}
                disabled={remove.isPending}
                className="rounded-full bg-coral-ink px-3.5 py-1.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {remove.isPending ? "Deleting…" : "Delete"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-full px-3 py-1.5 text-sm font-bold text-ink-soft hover:bg-cream">
                Keep
              </button>
            </>
          ) : (
            <>
              <Link
                to={`/dashboard/floorplans/${plan.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-slate-deep"
              >
                <PencilIcon className="size-4" /> Edit
              </Link>
              <button
                type="button"
                onClick={() => duplicate.mutate(plan.id)}
                disabled={duplicate.isPending}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-slate hover:bg-cream disabled:opacity-50"
              >
                <CopyIcon className="size-4" /> {duplicate.isPending ? "Copying…" : "Duplicate"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-coral-ink hover:bg-peach"
                aria-label={`Delete ${plan.name}`}
              >
                <TrashIcon className="size-4" />
              </button>
            </>
          )}
        </div>
        {(remove.error || duplicate.error) && (
          <p className="mt-2 text-sm font-semibold text-coral-ink" role="alert">
            {(remove.error ?? duplicate.error)!.message}
          </p>
        )}
      </div>
    </li>
  );
}

// Common starting sizes, in each unit
const presets: Record<FloorplanUnits, { label: string; w: number; d: number }[]> = {
  ft: [
    { label: "Small hall · 40 × 30 ft", w: 40, d: 30 },
    { label: "Community hall · 80 × 60 ft", w: 80, d: 60 },
    { label: "Convention hall · 150 × 100 ft", w: 150, d: 100 },
  ],
  m: [
    { label: "Small hall · 12 × 9 m", w: 12, d: 9 },
    { label: "Community hall · 25 × 18 m", w: 25, d: 18 },
    { label: "Convention hall · 45 × 30 m", w: 45, d: 30 },
  ],
};

function NewPlanDialog({ onClose }: { onClose: () => void }) {
  const save = useSaveFloorplan();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [units, setUnits] = useState<FloorplanUnits>("ft");
  const [width, setWidth] = useState("80");
  const [depth, setDepth] = useState("60");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function switchUnits(next: FloorplanUnits) {
    // Keep the same room when switching units
    const convert = (v: string) => {
      const n = Number(v);
      if (!Number.isFinite(n) || !n) return v;
      return String(next === "m" ? Math.round(n * 0.3048 * 10) / 10 : Math.round((n / 0.3048) * 10) / 10);
    };
    setWidth(convert(width));
    setDepth(convert(depth));
    setUnits(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      { name, units, widthMm: fromUnits(Number(width), units), depthMm: fromUnits(Number(depth), units), items: [] },
      { onSuccess: (plan) => navigate(`/dashboard/floorplans/${plan.id}`) },
    );
  }

  const error = save.error instanceof ApiRequestError ? save.error.message : save.error?.message;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="new-plan-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="new-plan-title" className="pr-8 text-2xl font-extrabold">
          New floorplan
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Start with the room. You can change its size later.</p>

        <label className="mt-5 block text-sm font-bold">
          Name
          <input ref={ref} className={inputClass} value={name} required maxLength={80} placeholder="e.g. Legion Hall, main floor" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="mt-4 flex gap-1 rounded-full bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Units">
          {FLOORPLAN_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={units === u}
              onClick={() => units !== u && switchUnits(u)}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${units === u ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
            >
              {u === "ft" ? "Feet" : "Metres"}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm font-bold">
            Width ({unitLabel[units]})
            <input className={inputClass} type="number" inputMode="decimal" min={units === "ft" ? 4 : 1} max={units === "ft" ? 980 : 300} step="any" required value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <label className="block text-sm font-bold">
            Depth ({unitLabel[units]})
            <input className={inputClass} type="number" inputMode="decimal" min={units === "ft" ? 4 : 1} max={units === "ft" ? 980 : 300} step="any" required value={depth} onChange={(e) => setDepth(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {presets[units].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => (setWidth(String(p.w)), setDepth(String(p.d)))}
              className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-ink-soft transition hover:text-ink"
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-3 font-bold text-ink-soft hover:bg-cream">
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white disabled:opacity-50">
            {save.isPending ? "Creating…" : "Create and open editor"}
          </button>
        </div>
      </form>
    </div>
  );
}
