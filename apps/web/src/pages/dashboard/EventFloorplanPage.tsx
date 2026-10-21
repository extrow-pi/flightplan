import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { PUBLIC_MAP_MODES, publicMapLabels, type EventRecord, type Floorplan, type FloorplanItem, type FloorplanTable, type PublicMapMode } from "@flightplan/shared";
import CopyButton from "../../components/CopyButton";
import { canEdit, EventTabs, isTemplate, SharedBadge } from "../../components/events";
import FloorplanEditor, { type Draft } from "../../components/floorplan/FloorplanEditor";
import { FloorplanView } from "../../components/floorplan/FloorplanDrawing";
import UnsavedGuard from "../../components/floorplan/UnsavedGuard";
import { ArrowLeftIcon } from "../../components/Icons";
import {
  ApiRequestError,
  useEvent,
  useEventFloorplan,
  useEventTables,
  useFloorplans,
  useRemoveEventFloorplan,
  useSaveEventFloorplan,
  useSavePlanToLibrary,
  useSetPublicMap,
  useUseLibraryPlan,
} from "../../lib/api";
import { defaultTableSize, formatSize, fromUnits, newId } from "../../lib/floorplan";

const btn = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold whitespace-nowrap transition disabled:opacity-50";
const btnPlain = `${btn} bg-white text-slate ring-1 ring-ink/10 hover:ring-slate`;

/** An event's or template's own floorplan. Its tables are the event's bookable tables. */
export default function EventFloorplanPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const plan = useEventFloorplan(event?.id);
  // Bumped when the plan is replaced or removed, so the editor starts fresh
  const [version, setVersion] = useState(0);

  if (isPending) return <p className="text-ink-muted" role="status">Loading…</p>;
  if (error || !event) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
        <p className="text-lg font-extrabold">
          {error instanceof ApiRequestError && error.status === 404 ? "Not found" : "Couldn't load this"}
        </p>
        <Link to="/dashboard" className="mt-4 inline-block font-bold text-coral-ink hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const template = isTemplate(event);
  const editable = canEdit(event);

  return (
    <>
      <Link
        to={template ? "/dashboard/templates" : "/dashboard/events"}
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" /> {template ? "All templates" : "All events"}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
        {template && <span className="rounded-full bg-peach px-3 py-1 text-sm font-bold text-coral-ink">Template</span>}
        <SharedBadge event={event} />
      </div>
      <EventTabs event={event} />

      <div className="mt-6">
        {plan.error ? (
          <p className="rounded-2xl bg-peach px-5 py-4 font-semibold text-coral-ink" role="alert">
            Couldn't load the floorplan: {plan.error.message}
          </p>
        ) : plan.isPending ? (
          <p className="text-ink-muted" role="status">
            Loading floorplan…
          </p>
        ) : !plan.data ? (
          editable ? (
            <ChoosePlan event={event} onChosen={() => setVersion((v) => v + 1)} />
          ) : (
            <p className="rounded-3xl bg-white p-6 text-ink-soft ring-1 ring-ink/5">This {template ? "template" : "show"} doesn't have a floorplan yet.</p>
          )
        ) : editable ? (
          <EventPlanEditor key={`${plan.data.id}-${version}`} event={event} plan={plan.data} onReplaced={() => setVersion((v) => v + 1)} />
        ) : (
          <div className="rounded-3xl bg-cream p-3 ring-1 ring-ink/10">
            <FloorplanView plan={plan.data} grid dimensions label={`${event.name} floorplan`} />
          </div>
        )}
      </div>
    </>
  );
}

// ── With a plan ──────────────────────────────────────────────────────────

function EventPlanEditor({ event, plan, onReplaced }: { event: EventRecord; plan: Floorplan; onReplaced: () => void }) {
  const save = useSaveEventFloorplan(event.id);
  const initial: Draft = { name: plan.name, units: plan.units, widthMm: plan.widthMm, depthMm: plan.depthMm, items: plan.items, groups: plan.groups };
  return (
    <FloorplanEditor
      initial={initial}
      saving={save.isPending}
      saveError={null}
      onSave={(draft) => save.mutateAsync(draft)}
      header={({ dirty }) => (
        <>
          <UnsavedGuard dirty={dirty} />
          <PlanBar event={event} plan={plan} dirty={dirty} onReplaced={onReplaced} />
          {save.error && (
            <p className="rounded-2xl bg-peach px-5 py-3 text-sm font-semibold text-coral-ink" role="alert">
              Not saved: {save.error.message}
            </p>
          )}
        </>
      )}
    />
  );
}

/** What the plan does for the show, and the plan-wide actions. */
function PlanBar({ event, plan, dirty, onReplaced }: { event: EventRecord; plan: Floorplan; dirty: boolean; onReplaced: () => void }) {
  const toLibrary = useSavePlanToLibrary(event.id);
  const remove = useRemoveEventFloorplan(event.id);
  const [mode, setMode] = useState<"idle" | "naming" | "replacing" | "removing">("idle");
  const [name, setName] = useState(plan.name);
  const [savedName, setSavedName] = useState<string | null>(null);
  const kind = isTemplate(event) ? "template" : "show";

  function onSaveToLibrary(e: FormEvent) {
    e.preventDefault();
    toLibrary.mutate(name, {
      onSuccess: (p) => {
        setSavedName(p.name);
        setMode("idle");
      },
    });
  }

  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink/5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-ink-soft">
          The plan's <strong className="text-ink">{plan.tableCount} tables</strong> are this {kind}'s bookable tables. Changes apply when you save; a
          table with a booking has to stay on the plan.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPlain} onClick={() => setMode(mode === "naming" ? "idle" : "naming")} disabled={dirty} title={dirty ? "Save your changes first" : undefined}>
            Save to library
          </button>
          <button type="button" className={btnPlain} onClick={() => setMode(mode === "replacing" ? "idle" : "replacing")}>
            Use a library plan instead
          </button>
          <button type="button" className={`${btn} text-coral-ink hover:bg-peach`} onClick={() => setMode(mode === "removing" ? "idle" : "removing")}>
            Remove floorplan
          </button>
        </div>
      </div>

      {!isTemplate(event) && <VisitorMapSetting event={event} />}

      {savedName && mode === "idle" && (
        <p className="mt-3 text-sm font-semibold text-[#2d7a6a]" role="status">
          Saved “{savedName}” to your{" "}
          <Link to="/dashboard/floorplans" className="underline">
            floorplan library
          </Link>
          .
        </p>
      )}

      {mode === "naming" && (
        <form onSubmit={onSaveToLibrary} className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink/5 pt-3">
          <label className="min-w-48 flex-1 text-xs font-bold text-ink-soft">
            Name in your library
            <input
              className="mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-1.5 text-base text-ink focus:border-coral focus:outline-none sm:text-sm"
              value={name}
              maxLength={80}
              required
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" disabled={toLibrary.isPending || !name.trim()} className="rounded-full bg-slate px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {toLibrary.isPending ? "Saving…" : "Save a copy"}
          </button>
          {toLibrary.error && <span className="w-full text-sm font-semibold text-coral-ink">{toLibrary.error.message}</span>}
        </form>
      )}

      {mode === "replacing" && (
        <div className="mt-3 border-t border-ink/5 pt-3">
          <p className="text-sm text-ink-soft">
            Replaces this {kind}'s plan with a copy of one from your library. Booked tables keep their booking if the new plan has a table with
            the same label.
          </p>
          <LibraryPicker event={event} actionLabel="Use instead" onChosen={onReplaced} />
        </div>
      )}

      {mode === "removing" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/5 pt-3">
          <span className="text-sm font-semibold">
            Remove the floorplan? The {plan.tableCount} tables stay as numbered tables, and you can set the count on the Details tab again.
          </span>
          <button
            type="button"
            onClick={() => remove.mutate(undefined, { onSuccess: onReplaced })}
            disabled={remove.isPending}
            className="rounded-full bg-coral-ink px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="rounded-full px-3 py-1.5 text-sm font-bold text-ink-soft hover:bg-cream">
            Keep it
          </button>
          {remove.error && <span className="w-full text-sm font-semibold text-coral-ink">{remove.error.message}</span>}
        </div>
      )}
    </div>
  );
}

/** Who appears on the public visitor map, and its link. */
function VisitorMapSetting({ event }: { event: EventRecord }) {
  const set = useSetPublicMap(event.id);
  const url = `${window.location.origin}/map/${event.id}`;
  const live = event.publicMap !== "off" && event.status === "published";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink/5 pt-3 text-sm">
      <label className="flex items-center gap-2 font-semibold">
        Visitor map
        <select
          value={event.publicMap}
          disabled={set.isPending}
          onChange={(e) => set.mutate(e.target.value as PublicMapMode)}
          className="rounded-full border-2 border-cream bg-white px-2.5 py-1 text-base font-bold text-ink focus:border-coral focus:outline-none sm:text-sm"
        >
          {PUBLIC_MAP_MODES.map((m) => (
            <option key={m} value={m}>
              {publicMapLabels[m]}
            </option>
          ))}
        </select>
      </label>
      {event.publicMap === "off" ? (
        <span className="text-ink-muted">A public page where visitors can look up where each vendor is.</span>
      ) : live ? (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="truncate font-bold text-coral-ink hover:underline">
            {url.replace(/^https?:\/\//, "")}
          </a>
          <CopyButton text={url} />
        </span>
      ) : (
        <span className="text-ink-muted">Goes live when the show is published.</span>
      )}
      {set.error && <span className="w-full font-semibold text-coral-ink">{set.error.message}</span>}
    </div>
  );
}

// ── Without a plan ───────────────────────────────────────────────────────

function ChoosePlan({ event, onChosen }: { event: EventRecord; onChosen: () => void }) {
  const kind = isTemplate(event) ? "template" : "show";
  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
        <h2 className="text-xl font-extrabold">Give this {kind} a floorplan</h2>
        <p className="mt-1 max-w-2xl text-ink-soft">
          The plan's tables become the {kind}'s bookable tables, with their labels and sizes. Each {kind} gets its own copy, so changing it never
          changes your library. Tables that already have a booking keep it as long as the plan has a table with the same label.
        </p>
        <StartFromTables event={event} onChosen={onChosen} />
      </div>
      <section>
        <h2 className="text-lg font-extrabold">Or use a plan from your library</h2>
        <LibraryPicker event={event} actionLabel="Use this plan" onChosen={onChosen} />
      </section>
    </div>
  );
}

/** Start a plan with the show's current tables laid out in rows, so nothing booked is lost. */
function StartFromTables({ event, onChosen }: { event: EventRecord; onChosen: () => void }) {
  const save = useSaveEventFloorplan(event.id);
  const tables = useEventTables(event.id);
  const labels = tables.data?.tables.map((t) => t.label) ?? [];

  function start() {
    save.mutate(laidOut(event.name, labels), { onSuccess: onChosen });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={start}
        disabled={save.isPending || tables.isPending}
        className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white disabled:opacity-50"
      >
        {save.isPending ? "Creating…" : labels.length ? `Start a plan with these ${labels.length} tables` : "Start an empty plan"}
      </button>
      {labels.length > 0 && <span className="text-sm text-ink-muted">Laid out in rows of 10; move them to match the room.</span>}
      {save.error && (
        <p className="w-full text-sm font-semibold text-coral-ink" role="alert">
          {save.error.message}
        </p>
      )}
    </div>
  );
}

/** A starting plan: the given table labels in rows of 10 with aisles between, in an 80 × 60 ft room (or bigger). */
function laidOut(name: string, labels: string[]): Draft {
  const size = defaultTableSize.ft;
  const margin = fromUnits(6, "ft"), aisle = fromUnits(8, "ft");
  const perRow = 10;
  const rows = Math.ceil(labels.length / perRow);
  const items: FloorplanItem[] = labels.map(
    (label, i): FloorplanTable => ({
      id: newId(),
      kind: "table",
      label: label.slice(0, 12),
      shape: "rect",
      w: size.w,
      h: size.h,
      rotation: 0,
      x: margin + size.w / 2 + (i % perRow) * size.w,
      y: margin + size.h / 2 + Math.floor(i / perRow) * (size.h + aisle),
    }),
  );
  return {
    name,
    units: "ft",
    widthMm: Math.max(fromUnits(80, "ft"), margin * 2 + Math.min(labels.length, perRow) * size.w),
    depthMm: Math.max(fromUnits(60, "ft"), margin * 2 + rows * (size.h + aisle)),
    items,
    groups: [],
  };
}

function LibraryPicker({ event, actionLabel, onChosen }: { event: EventRecord; actionLabel: string; onChosen: () => void }) {
  const plans = useFloorplans();
  const use = useUseLibraryPlan(event.id);
  const [choosing, setChoosing] = useState<string | null>(null);

  if (plans.isPending) return <p className="mt-3 text-sm text-ink-muted">Loading your floorplans…</p>;
  if (plans.error) return <p className="mt-3 text-sm font-semibold text-coral-ink">Couldn't load your floorplans: {plans.error.message}</p>;
  if (!plans.data.length) {
    return (
      <p className="mt-3 text-sm text-ink-soft">
        Your library is empty. Design plans to reuse on the{" "}
        <Link to="/dashboard/floorplans" className="font-bold text-coral-ink hover:underline">
          Floorplans
        </Link>{" "}
        page.
      </p>
    );
  }
  return (
    <>
      {use.error && (
        <p className="mt-3 rounded-2xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
          {use.error.message}
        </p>
      )}
      <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {plans.data.map((p) => (
          <PlanChoice key={p.id} plan={p}>
            <button
              type="button"
              disabled={use.isPending}
              onClick={() => {
                setChoosing(p.id);
                use.mutate(p.id, { onSuccess: onChosen });
              }}
              className="rounded-full bg-slate px-4 py-1.5 text-sm font-bold text-white transition hover:bg-slate-deep disabled:opacity-50"
            >
              {use.isPending && choosing === p.id ? "Copying…" : actionLabel}
            </button>
          </PlanChoice>
        ))}
      </ul>
    </>
  );
}

function PlanChoice({ plan, children }: { plan: Floorplan; children: ReactNode }) {
  return (
    <li className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
      <div className="bg-cream-50 p-3">
        <FloorplanView plan={plan} className="max-h-44" label={`${plan.name} floorplan`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">{plan.name}</p>
          <p className="text-xs text-ink-soft">
            {formatSize(plan.widthMm, plan.depthMm, plan.units)} · {plan.tableCount} {plan.tableCount === 1 ? "table" : "tables"}
          </p>
        </div>
        {children}
      </div>
    </li>
  );
}
