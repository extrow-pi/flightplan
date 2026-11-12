import { Link, useParams } from "react-router";
import FloorplanEditor, { type Draft } from "../../components/floorplan/FloorplanEditor";
import UnsavedGuard from "../../components/floorplan/UnsavedGuard";
import { ArrowLeftIcon } from "../../components/Icons";
import { ApiRequestError, useFloorplan, useSaveFloorplan } from "../../lib/api";
import { formatSize } from "../../lib/floorplan";

/** Edit a plan from the floorplan library. */
export default function FloorplanEditorPage() {
  const { id } = useParams();
  const plan = useFloorplan(id);
  const save = useSaveFloorplan(id);

  if (plan.isPending) return <p className="text-ink-muted" role="status">Loading floorplan…</p>;
  if (plan.error || !plan.data) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
        <p className="text-lg font-extrabold">
          {plan.error instanceof ApiRequestError && plan.error.status === 404 ? "Floorplan not found" : "Couldn't load this floorplan"}
        </p>
        <Link to="/dashboard/floorplans" className="mt-4 inline-block font-bold text-coral-ink hover:underline">
          Back to floorplans
        </Link>
      </div>
    );
  }

  const p = plan.data;
  const initial: Draft = { name: p.name, units: p.units, widthMm: p.widthMm, depthMm: p.depthMm, items: p.items, groups: p.groups };

  return (
    <FloorplanEditor
      key={p.id}
      initial={initial}
      saving={save.isPending}
      saveError={save.error?.message ?? null}
      onSave={(draft) => save.mutateAsync(draft)}
      header={({ dirty }) => (
        <>
          <UnsavedGuard dirty={dirty} />
          <Link to="/dashboard/floorplans" className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink">
            <ArrowLeftIcon className="size-4" /> All floorplans
          </Link>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{p.name}</h1>
            <span className="text-sm text-ink-muted">{formatSize(p.widthMm, p.depthMm, p.units)} room</span>
          </div>
        </>
      )}
    />
  );
}
