import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import {
  FLOORPLAN_ITEM_MIN_MM,
  FLOORPLAN_UNITS,
  LANDMARK_TYPES,
  landmarkLabels,
  MAX_FLOORPLAN_ITEMS,
  type FloorplanInput,
  type FloorplanItem,
  type FloorplanLandmark,
  type FloorplanTable,
  type FloorplanUnits,
  type FloorplanWall,
  type LandmarkType,
} from "@flightplan/shared";
import {
  defaultTableSize,
  formatLength,
  formatSize,
  fromUnits,
  isLandmark,
  isTable,
  isWall,
  moveItem,
  newId,
  nextTableLabel,
  renumberTables,
  snap,
  snapStep,
  toUnits,
  unitLabel,
  wallLength,
} from "../../lib/floorplan";
import { Landmark, planPadding, Room, Table, Wall } from "./FloorplanDrawing";

// The floorplan editor: an SVG canvas in millimetres with a toolbar and a properties panel.
// Used for library plans and (later) each event's own plan.

export type Draft = FloorplanInput & { items: FloorplanItem[] };
type View = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "move"; start: Pt; base: Draft; ids: string[]; moved: boolean }
  | { kind: "resize"; base: Draft; id: string }
  | { kind: "rotate"; base: Draft; id: string }
  | { kind: "wallEnd"; base: Draft; id: string; end: 1 | 2 }
  | { kind: "pan"; startClient: Pt; startView: View; perPx: number }
  | { kind: "drawWall"; start: Pt };
type Pt = { x: number; y: number };

const defaultWallThickness: Record<FloorplanUnits, number> = { ft: 152, m: 150 };
const defaultLandmarkSize: Record<FloorplanUnits, { w: number; h: number }> = { ft: { w: 2438, h: 1829 }, m: { w: 2500, h: 2000 } };

const btn =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold whitespace-nowrap transition disabled:opacity-40";
const btnPlain = `${btn} bg-white text-slate ring-1 ring-ink/10 hover:ring-slate`;
const btnOn = `${btn} bg-slate text-white`;
const fieldClass =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-2.5 py-1.5 text-base text-ink transition focus:border-coral focus:outline-none sm:text-sm";

export default function FloorplanEditor({
  initial,
  saving,
  saveError,
  onSave,
  header,
}: {
  initial: Draft;
  saving: boolean;
  saveError: string | null;
  /** Resolves once saved; the editor then treats the current draft as saved */
  onSave: (draft: Draft) => Promise<unknown>;
  /** Shown above the toolbar (back link, title…) */
  header?: (state: { dirty: boolean }) => ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<Draft>(initial);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<"select" | "wall">("select");
  const [snapOn, setSnapOn] = useState(true);
  const [wallPreview, setWallPreview] = useState<FloorplanWall | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const units = draft.units;

  const fitView = useCallback((d: { widthMm: number; depthMm: number }): View => {
    const pad = planPadding(d) * 1.8;
    return { x: -pad, y: -pad, w: d.widthMm + pad * 2, h: d.depthMm + pad * 2 };
  }, []);
  const [view, setView] = useState<View>(() => fitView(initial));

  // Size of one screen pixel in millimetres, for handles and hit areas that stay the same size on screen
  const [box, setBox] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }));
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const perPx = Math.max(view.w / box.w, view.h / box.h);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  // ── History ──
  const commit = useCallback(
    (next: Draft, base: Draft = draft) => {
      if (JSON.stringify(next) === JSON.stringify(base)) return;
      setPast((p) => [...p.slice(-99), base]);
      setFuture([]);
      setDraft(next);
    },
    [draft],
  );
  const updateItems = (fn: (items: FloorplanItem[]) => FloorplanItem[]) => commit({ ...draft, items: fn(draft.items) });
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [draft, ...f]);
    setDraft(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, draft]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, draft]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, draft]);

  const selectedItems = draft.items.filter((i) => selected.includes(i.id));
  const single = selectedItems.length === 1 ? selectedItems[0] : null;

  // ── Coordinates ──
  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const viewCenter = (): Pt => ({ x: snap(view.x + view.w / 2, units, snapOn), y: snap(view.y + view.h / 2, units, snapOn) });

  // ── Adding things ──
  const full = draft.items.length >= MAX_FLOORPLAN_ITEMS;
  function addTable(shape: "rect" | "round") {
    const size = defaultTableSize[units];
    const ref = single && isTable(single) ? single : null;
    // Next to the selected table (same size and angle), or in the middle of the view
    const w = ref ? ref.w : shape === "round" ? size.round : size.w;
    const h = ref ? ref.h : shape === "round" ? size.round : size.h;
    const rotation = ref?.rotation ?? 0;
    const a = (rotation * Math.PI) / 180;
    const at = ref ? { x: Math.round(ref.x + Math.cos(a) * w), y: Math.round(ref.y + Math.sin(a) * w) } : viewCenter();
    const t: FloorplanTable = { id: newId(), kind: "table", label: nextTableLabel(draft.items), shape: ref?.shape ?? shape, w, h: (ref?.shape ?? shape) === "round" ? w : h, rotation, ...at };
    updateItems((items) => [...items, t]);
    setSelected([t.id]);
  }
  function addLandmark(type: LandmarkType) {
    const s = type === "pillar" ? { w: fromUnits(units === "ft" ? 2 : 0.6, units), h: fromUnits(units === "ft" ? 2 : 0.6, units) } : defaultLandmarkSize[units];
    const l: FloorplanLandmark = { id: newId(), kind: "landmark", type, label: "", rotation: 0, ...s, ...viewCenter() };
    updateItems((items) => [...items, l]);
    setSelected([l.id]);
    setTool("select");
  }
  function addRow(count: number, direction: "right" | "down", gapMm: number) {
    const size = defaultTableSize[units];
    const ref = single && isTable(single) ? single : null;
    const base = ref ?? { shape: "rect" as const, w: size.w, h: size.h, rotation: 0, ...viewCenter() };
    const stepX = direction === "right" ? base.w + gapMm : 0;
    const stepY = direction === "down" ? (base.shape === "round" ? base.w : base.h) + gapMm : 0;
    let items = draft.items;
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const t: FloorplanTable = {
        id: newId(),
        kind: "table",
        label: nextTableLabel(items),
        shape: base.shape,
        w: base.w,
        h: base.shape === "round" ? base.w : base.h,
        rotation: base.rotation,
        // Start next to the selected table, or at the view centre
        x: Math.round(base.x + stepX * (ref ? i : i - 1)),
        y: Math.round(base.y + stepY * (ref ? i : i - 1)),
      };
      items = [...items, t];
      ids.push(t.id);
    }
    commit({ ...draft, items: items.slice(0, MAX_FLOORPLAN_ITEMS) });
    setSelected(ids);
  }
  function duplicateSelected() {
    if (!selectedItems.length) return;
    const offset = snapStep[units] * 4;
    let items = draft.items;
    const ids: string[] = [];
    for (const item of selectedItems) {
      const copy = { ...moveItem(item, offset, offset), id: newId() } as FloorplanItem;
      if (isTable(copy)) copy.label = nextTableLabel(items);
      items = [...items, copy];
      ids.push(copy.id);
    }
    commit({ ...draft, items });
    setSelected(ids);
  }
  function deleteSelected() {
    if (!selected.length) return;
    updateItems((items) => items.filter((i) => !selected.includes(i.id)));
    setSelected([]);
  }
  function rotateSelected(by: number) {
    updateItems((items) =>
      items.map((i) => {
        if (!selected.includes(i.id)) return i;
        if (isWall(i)) {
          // Turn a wall around its middle
          const cx = (i.x1 + i.x2) / 2, cy = (i.y1 + i.y2) / 2;
          const a = (by * Math.PI) / 180;
          const r = (x: number, y: number) => ({ x: Math.round(cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a)), y: Math.round(cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)) });
          const p1 = r(i.x1, i.y1), p2 = r(i.x2, i.y2);
          return { ...i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
        }
        return { ...i, rotation: (((i.rotation + by) % 360) + 360) % 360 };
      }),
    );
  }
  function nudge(dx: number, dy: number) {
    updateItems((items) => items.map((i) => (selected.includes(i.id) ? moveItem(i, dx, dy) : i)));
  }

  // ── Pointer handling ──
  function onBackgroundDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    if (tool === "wall") {
      if (full) return;
      const p = toPlan(e);
      const start = { x: snap(p.x, units, snapOn), y: snap(p.y, units, snapOn) };
      drag.current = { kind: "drawWall", start };
      setWallPreview({ id: "preview", kind: "wall", x1: start.x, y1: start.y, x2: start.x, y2: start.y, thickness: defaultWallThickness[units] });
      return;
    }
    if (!e.shiftKey) setSelected([]);
    drag.current = { kind: "pan", startClient: { x: e.clientX, y: e.clientY }, startView: view, perPx };
  }
  function onItemDown(e: ReactPointerEvent, item: FloorplanItem) {
    if (e.button !== 0 || tool !== "select") return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    let ids = selected;
    if (e.shiftKey) {
      ids = selected.includes(item.id) ? selected.filter((x) => x !== item.id) : [...selected, item.id];
    } else if (!selected.includes(item.id)) {
      ids = [item.id];
    }
    setSelected(ids);
    if (ids.includes(item.id)) drag.current = { kind: "move", start: toPlan(e), base: draft, ids, moved: false };
  }
  function onHandleDown(e: ReactPointerEvent, d: Drag) {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = d;
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const dx = (e.clientX - d.startClient.x) * d.perPx, dy = (e.clientY - d.startClient.y) * d.perPx;
      setView({ ...d.startView, x: d.startView.x - dx, y: d.startView.y - dy });
      return;
    }
    const p = toPlan(e);
    if (d.kind === "drawWall") {
      let end = { x: snap(p.x, units, snapOn), y: snap(p.y, units, snapOn) };
      // Shift keeps it straight across or up and down
      if (e.shiftKey) end = Math.abs(end.x - d.start.x) >= Math.abs(end.y - d.start.y) ? { x: end.x, y: d.start.y } : { x: d.start.x, y: end.y };
      setWallPreview((w) => w && { ...w, x2: end.x, y2: end.y });
      return;
    }
    if (d.kind === "move") {
      const first = d.base.items.find((i) => i.id === d.ids[0])!;
      const anchor = isWall(first) ? { x: first.x1, y: first.y1 } : { x: first.x, y: first.y };
      const dx = snap(anchor.x + p.x - d.start.x, units, snapOn) - anchor.x;
      const dy = snap(anchor.y + p.y - d.start.y, units, snapOn) - anchor.y;
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 3 * perPx) return;
      d.moved = true;
      setDraft({ ...d.base, items: d.base.items.map((i) => (d.ids.includes(i.id) ? moveItem(i, dx, dy) : i)) });
      return;
    }
    const base = d.base.items.find((i) => i.id === d.id);
    if (!base) return;
    if (d.kind === "wallEnd" && isWall(base)) {
      const other = d.end === 1 ? { x: base.x2, y: base.y2 } : { x: base.x1, y: base.y1 };
      let at = { x: snap(p.x, units, snapOn), y: snap(p.y, units, snapOn) };
      if (e.shiftKey) at = Math.abs(at.x - other.x) >= Math.abs(at.y - other.y) ? { x: at.x, y: other.y } : { x: other.x, y: at.y };
      const next = d.end === 1 ? { ...base, x1: at.x, y1: at.y } : { ...base, x2: at.x, y2: at.y };
      setDraft({ ...d.base, items: d.base.items.map((i) => (i.id === d.id ? next : i)) });
      return;
    }
    if (isWall(base)) return;
    if (d.kind === "rotate") {
      let deg = (Math.atan2(p.y - base.y, p.x - base.x) * 180) / Math.PI + 90;
      // Steps of 15° unless Shift is held
      if (!e.shiftKey) deg = Math.round(deg / 15) * 15;
      const rotation = ((Math.round(deg) % 360) + 360) % 360;
      setDraft({ ...d.base, items: d.base.items.map((i) => (i.id === d.id ? { ...base, rotation } : i)) });
      return;
    }
    if (d.kind === "resize") {
      // Keep the opposite corner where it is
      const a = (base.rotation * Math.PI) / 180;
      const rx = p.x - base.x, ry = p.y - base.y;
      const lx = rx * Math.cos(-a) - ry * Math.sin(-a), ly = rx * Math.sin(-a) + ry * Math.cos(-a);
      const round = isTable(base) && base.shape === "round";
      const baseH = round ? base.w : base.h;
      let w = Math.max(FLOORPLAN_ITEM_MIN_MM, snap(lx + base.w / 2, units, snapOn));
      let h = Math.max(FLOORPLAN_ITEM_MIN_MM, snap(ly + baseH / 2, units, snapOn));
      if (round) w = h = Math.max(w, h);
      const cx = -base.w / 2 + w / 2, cy = -baseH / 2 + h / 2;
      const x = Math.round(base.x + cx * Math.cos(a) - cy * Math.sin(a));
      const y = Math.round(base.y + cx * Math.sin(a) + cy * Math.cos(a));
      setDraft({ ...d.base, items: d.base.items.map((i) => (i.id === d.id ? { ...base, w, h, x, y } : i)) });
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "drawWall") {
      const w = wallPreview;
      setWallPreview(null);
      if (w && wallLength(w) >= snapStep[units]) {
        const wall = { ...w, id: newId() };
        commit({ ...draft, items: [...draft.items, wall] });
        setSelected([wall.id]);
      }
      return;
    }
    if (d.kind === "pan") return;
    // One history step per drag
    commit(draft, d.base);
  }

  // ── Zoom ──
  const zoomBy = useCallback(
    (factor: number, around?: Pt) => {
      setView((v) => {
        const max = Math.max(draft.widthMm, draft.depthMm) * 4;
        const min = Math.max(draft.widthMm, draft.depthMm) / 40;
        const f = Math.min(Math.max(factor, min / v.w), max / v.w);
        const c = around ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
        return { x: c.x - (c.x - v.x) * f, y: c.y - (c.y - v.y) * f, w: v.w * f, h: v.h * f };
      });
    },
    [draft.widthMm, draft.depthMm],
  );
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      const p = ctm ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()) : undefined;
      zoomBy(Math.pow(1.0015, e.deltaY), p ? { x: p.x, y: p.y } : undefined);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // ── Save ──
  const save = useCallback(async () => {
    const snapshot = draft;
    try {
      await onSave(snapshot);
      setSaved(snapshot);
    } catch {
      // The page shows saveError
    }
  }, [draft, onSave]);

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) void save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(draft.items.map((i) => i.id));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.length) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === "Escape") {
        setSelected([]);
        setTool("select");
        setWallPreview(null);
        drag.current = null;
      } else if (e.key.toLowerCase() === "r" && selected.length) {
        rotateSelected(e.shiftKey ? -90 : 90);
      } else if (e.key.startsWith("Arrow") && selected.length) {
        e.preventDefault();
        const step = snapStep[units] * (e.shiftKey ? 4 : 1);
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        nudge(dx, dy);
      } else if (e.key.toLowerCase() === "w" && !mod) {
        setTool((t) => (t === "wall" ? "select" : "wall"));
      } else if (e.key.toLowerCase() === "t" && !mod) {
        addTable("rect");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Rendering ──
  const counts = {
    tables: draft.items.filter(isTable).length,
    walls: draft.items.filter(isWall).length,
    landmarks: draft.items.filter(isLandmark).length,
  };
  const handle = 7 * perPx;
  const walls = wallPreview ? [...draft.items.filter(isWall), wallPreview] : draft.items.filter(isWall);

  return (
    <div className="space-y-3">
      {header?.({ dirty })}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Floorplan tools">
        <button type="button" className={tool === "select" ? btnOn : btnPlain} onClick={() => setTool("select")} aria-pressed={tool === "select"} title="Select and move (Esc)">
          Select
        </button>
        <button type="button" className={btnPlain} onClick={() => addTable("rect")} disabled={full} title="Add a table (T)">
          + Table
        </button>
        <button type="button" className={btnPlain} onClick={() => addTable("round")} disabled={full}>
          + Round table
        </button>
        <button type="button" className={btnPlain} onClick={() => setAddingRow(true)} disabled={full}>
          + Row of tables
        </button>
        <button
          type="button"
          className={tool === "wall" ? btnOn : btnPlain}
          onClick={() => setTool((t) => (t === "wall" ? "select" : "wall"))}
          aria-pressed={tool === "wall"}
          disabled={full}
          title="Draw walls: drag from one end to the other (W). Hold Shift for straight lines."
        >
          + Wall
        </button>
        <label className="relative">
          <span className="sr-only">Add a landmark</span>
          <select
            value=""
            disabled={full}
            onChange={(e) => e.target.value && addLandmark(e.target.value as LandmarkType)}
            className={`${btnPlain} cursor-pointer appearance-none pr-7 text-base sm:text-sm`}
          >
            <option value="">+ Landmark</option>
            {LANDMARK_TYPES.map((t) => (
              <option key={t} value={t}>
                {landmarkLabels[t]}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate">▾</span>
        </label>
        <span className="mx-1 hidden h-6 w-px bg-ink/10 sm:block" />
        <button type="button" className={btnPlain} onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" className={btnPlain} onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <label className="ml-1 flex items-center gap-1.5 text-sm font-semibold text-ink-soft" title={`Snap to ${units === "ft" ? "6 inches" : "10 cm"}`}>
          <input type="checkbox" className="size-4 accent-coral" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
          Snap
        </label>
        <div className="ml-auto flex items-center gap-2">
          {saveError && (
            <span className="max-w-64 truncate text-sm font-semibold text-coral-ink" role="alert" title={saveError}>
              {saveError}
            </span>
          )}
          <span className="text-sm text-ink-muted" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-5 py-2 font-bold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Canvas */}
        <div className="relative overflow-hidden rounded-3xl bg-cream ring-1 ring-ink/10">
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            className={`block h-[62dvh] min-h-96 w-full touch-none select-none ${tool === "wall" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
            onPointerDown={onBackgroundDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="application"
            aria-label="Floorplan canvas. Use the toolbar to add items; select an item to edit it in the panel."
            fontFamily="inherit"
          >
            <Room plan={draft} dimensions />
            {draft.items.filter(isLandmark).map((l) => (
              <Landmark key={l.id} landmark={l} onPointerDown={(e) => onItemDown(e, l)} className={tool === "select" ? "cursor-move" : undefined} />
            ))}
            {walls.map((w) => (
              <g key={w.id}>
                <Wall wall={w} />
                {/* Wider invisible line so thin walls are easy to grab */}
                {w.id !== "preview" && (
                  <line
                    x1={w.x1}
                    y1={w.y1}
                    x2={w.x2}
                    y2={w.y2}
                    stroke="transparent"
                    strokeWidth={Math.max(w.thickness, 12 * perPx)}
                    onPointerDown={(e) => onItemDown(e, w)}
                    className={tool === "select" ? "cursor-move" : undefined}
                  />
                )}
              </g>
            ))}
            {draft.items.filter(isTable).map((t) => (
              <Table key={t.id} table={t} onPointerDown={(e) => onItemDown(e, t)} className={tool === "select" ? "cursor-move" : undefined} />
            ))}

            {/* Selection outlines and handles */}
            {selectedItems.map((i) => (
              <SelectionOutline key={i.id} item={i} perPx={perPx} />
            ))}
            {single && !isWall(single) && tool === "select" && (
              <ShapeHandles
                item={single}
                size={handle}
                onResize={(e) => onHandleDown(e, { kind: "resize", base: draft, id: single.id })}
                onRotate={(e) => onHandleDown(e, { kind: "rotate", base: draft, id: single.id })}
              />
            )}
            {single && isWall(single) && tool === "select" && (
              <>
                {([1, 2] as const).map((end) => (
                  <circle
                    key={end}
                    cx={end === 1 ? single.x1 : single.x2}
                    cy={end === 1 ? single.y1 : single.y2}
                    r={handle}
                    fill="#ffffff"
                    stroke="#e8856a"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-crosshair"
                    onPointerDown={(e) => onHandleDown(e, { kind: "wallEnd", base: draft, id: single.id, end })}
                  />
                ))}
              </>
            )}
          </svg>

          <div className="absolute right-3 bottom-3 flex gap-1 rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-ink/10">
            <button type="button" onClick={() => zoomBy(1 / 1.25)} className="size-8 rounded-full font-bold text-slate hover:bg-cream" aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => zoomBy(1.25)} className="size-8 rounded-full font-bold text-slate hover:bg-cream" aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={() => setView(fitView(draft))} className="rounded-full px-3 text-xs font-bold text-slate hover:bg-cream">
              Fit
            </button>
          </div>
          <p className="pointer-events-none absolute bottom-3 left-3 hidden rounded-full bg-white/90 px-3 py-1 text-xs text-ink-soft shadow-sm ring-1 ring-ink/10 sm:block">
            {tool === "wall"
              ? "Drag to draw a wall · Shift for straight · Esc when done"
              : "Drag the floor to pan · scroll to zoom · Shift+click to select several"}
          </p>
        </div>

        {/* Properties */}
        <aside className="space-y-4">
          {single ? (
            <ItemPanel
              key={single.id}
              item={single}
              units={units}
              items={draft.items}
              onChange={(next) => updateItems((items) => items.map((i) => (i.id === next.id ? next : i)))}
              onDelete={deleteSelected}
              onDuplicate={duplicateSelected}
              onRotate={() => rotateSelected(90)}
            />
          ) : selectedItems.length > 1 ? (
            <Panel title={`${selectedItems.length} items selected`}>
              <p className="text-sm text-ink-soft">Drag any of them to move them together, or use the arrow keys.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnPlain} onClick={() => rotateSelected(90)}>
                  Rotate 90°
                </button>
                <button type="button" className={btnPlain} onClick={duplicateSelected}>
                  Duplicate
                </button>
                <button type="button" className={`${btn} text-coral-ink hover:bg-peach`} onClick={deleteSelected}>
                  Delete
                </button>
              </div>
            </Panel>
          ) : (
            <PlanPanel draft={draft} counts={counts} onChange={(d) => commit(d)} onFit={() => setView(fitView(draft))} />
          )}
          <Panel title="Shortcuts">
            <ul className="space-y-0.5 text-xs text-ink-soft">
              <li>
                <Kbd>T</Kbd> add table · <Kbd>W</Kbd> draw walls
              </li>
              <li>
                <Kbd>R</Kbd> rotate 90° · arrows nudge (Shift: more)
              </li>
              <li>
                <Kbd>Ctrl</Kbd>+<Kbd>D</Kbd> duplicate · <Kbd>Del</Kbd> delete
              </li>
              <li>
                <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> save
              </li>
            </ul>
          </Panel>
        </aside>
      </div>

      {addingRow && (
        <RowDialog
          units={units}
          fromSelected={Boolean(single && isTable(single))}
          onAdd={(count, direction, gap) => {
            addRow(count, direction, gap);
            setAddingRow(false);
          }}
          onClose={() => setAddingRow(false)}
        />
      )}
    </div>
  );
}

// ── Canvas overlays ──────────────────────────────────────────────────────

function SelectionOutline({ item, perPx }: { item: FloorplanItem; perPx: number }) {
  const pad = 4 * perPx;
  const common = { fill: "none", stroke: "#e8856a", strokeWidth: 2, strokeDasharray: "6 4", vectorEffect: "non-scaling-stroke" as const, pointerEvents: "none" as const };
  if (isWall(item)) {
    return <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="#e8856a" strokeOpacity={0.5} strokeWidth={item.thickness + pad * 2} pointerEvents="none" />;
  }
  if (isTable(item) && item.shape === "round") return <circle cx={item.x} cy={item.y} r={item.w / 2 + pad} {...common} />;
  return (
    <rect
      x={item.x - item.w / 2 - pad}
      y={item.y - item.h / 2 - pad}
      width={item.w + pad * 2}
      height={item.h + pad * 2}
      transform={`rotate(${item.rotation} ${item.x} ${item.y})`}
      {...common}
    />
  );
}

function ShapeHandles({
  item,
  size,
  onResize,
  onRotate,
}: {
  item: FloorplanTable | FloorplanLandmark;
  size: number;
  onResize: (e: ReactPointerEvent) => void;
  onRotate: (e: ReactPointerEvent) => void;
}) {
  const h = isTable(item) && item.shape === "round" ? item.w : item.h;
  const round = isTable(item) && item.shape === "round";
  return (
    <g transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}>
      {!round && (
        <>
          <line x1={0} y1={-h / 2} x2={0} y2={-h / 2 - size * 3} stroke="#e8856a" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle cx={0} cy={-h / 2 - size * 3} r={size} fill="#e8856a" className="cursor-grab" onPointerDown={onRotate}>
            <title>Drag to rotate (Shift for any angle)</title>
          </circle>
        </>
      )}
      <rect
        x={item.w / 2 - size}
        y={h / 2 - size}
        width={size * 2}
        height={size * 2}
        fill="#ffffff"
        stroke="#e8856a"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        className="cursor-nwse-resize"
        onPointerDown={onResize}
      >
        <title>Drag to resize</title>
      </rect>
    </g>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-extrabold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink/15 bg-cream-50 px-1 font-sans text-[11px] font-bold text-ink">{children}</kbd>;
}

/** A length in the plan's units, applied when the field loses focus or Enter is pressed. */
function LengthField({
  label,
  mm,
  units,
  min = FLOORPLAN_ITEM_MIN_MM,
  onCommit,
}: {
  label: string;
  mm: number;
  units: FloorplanUnits;
  min?: number;
  onCommit: (mm: number) => void;
}) {
  const shown = String(toUnits(mm, units));
  const [value, setValue] = useState(shown);
  useEffect(() => setValue(shown), [shown]);
  const apply = () => {
    const n = Number(value);
    if (!Number.isFinite(n) || fromUnits(n, units) < min) return setValue(shown);
    const next = fromUnits(n, units);
    if (next !== mm) onCommit(next);
  };
  return (
    <label className="block text-xs font-bold text-ink-soft">
      {label} ({unitLabel[units]})
      <input
        className={fieldClass}
        type="number"
        inputMode="decimal"
        step={units === "ft" ? 0.5 : 0.1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

function TextField({
  label,
  value: initial,
  maxLength,
  placeholder,
  validate,
  onCommit,
}: {
  label: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  validate?: (v: string) => string | null;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const error = validate?.(value.trim()) ?? null;
  const apply = () => {
    if (error) return;
    if (value.trim() !== initial) onCommit(value.trim());
  };
  return (
    <label className="block text-xs font-bold text-ink-soft">
      {label}
      <input
        className={`${fieldClass} ${error ? "border-coral-ink" : ""}`}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        aria-invalid={Boolean(error)}
      />
      {error && <span className="mt-1 block font-semibold text-coral-ink">{error}</span>}
    </label>
  );
}

function PlanPanel({
  draft,
  counts,
  onChange,
  onFit,
}: {
  draft: Draft;
  counts: { tables: number; walls: number; landmarks: number };
  onChange: (d: Draft) => void;
  onFit: () => void;
}) {
  return (
    <Panel title="Plan">
      <div className="space-y-3">
        <TextField label="Name" value={draft.name} maxLength={80} validate={(v) => (v ? null : "Give the plan a name")} onCommit={(name) => onChange({ ...draft, name })} />
        <div>
          <span className="text-xs font-bold text-ink-soft">Units</span>
          <div className="mt-1 flex gap-1 rounded-full bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Units">
            {FLOORPLAN_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={draft.units === u}
                onClick={() => onChange({ ...draft, units: u })}
                className={`flex-1 rounded-full px-3 py-1 text-sm font-bold transition ${draft.units === u ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
              >
                {u === "ft" ? "Feet" : "Metres"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <LengthField label="Room width" mm={draft.widthMm} units={draft.units} min={1000} onCommit={(widthMm) => (onChange({ ...draft, widthMm }), onFit())} />
          <LengthField label="Room depth" mm={draft.depthMm} units={draft.units} min={1000} onCommit={(depthMm) => (onChange({ ...draft, depthMm }), onFit())} />
        </div>
        <p className="text-sm text-ink-soft">
          {counts.tables} {counts.tables === 1 ? "table" : "tables"} · {counts.walls} {counts.walls === 1 ? "wall" : "walls"} · {counts.landmarks}{" "}
          {counts.landmarks === 1 ? "landmark" : "landmarks"}
        </p>
        {counts.tables > 1 && (
          <button type="button" className={btnPlain} onClick={() => onChange({ ...draft, items: renumberTables(draft.items) })} title="Number tables 1, 2, 3… row by row from the top left">
            Renumber tables
          </button>
        )}
        <p className="text-xs text-ink-muted">Select something on the plan to edit it.</p>
      </div>
    </Panel>
  );
}

function ItemPanel({
  item,
  units,
  items,
  onChange,
  onDelete,
  onDuplicate,
  onRotate,
}: {
  item: FloorplanItem;
  units: FloorplanUnits;
  items: FloorplanItem[];
  onChange: (i: FloorplanItem) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRotate: () => void;
}) {
  const actions = (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-ink/5 pt-3">
      {!(isTable(item) && item.shape === "round") && (
        <button type="button" className={btnPlain} onClick={onRotate}>
          Rotate 90°
        </button>
      )}
      <button type="button" className={btnPlain} onClick={onDuplicate}>
        Duplicate
      </button>
      <button type="button" className={`${btn} text-coral-ink hover:bg-peach`} onClick={onDelete}>
        Delete
      </button>
    </div>
  );

  if (isWall(item)) {
    return (
      <Panel title="Wall">
        <p className="text-sm text-ink-soft">{formatLength(wallLength(item), units)} long. Drag its ends to change it.</p>
        <div className="mt-3">
          <LengthField label="Thickness" mm={item.thickness} units={units} min={20} onCommit={(thickness) => onChange({ ...item, thickness })} />
        </div>
        {actions}
      </Panel>
    );
  }

  const rotationField = (
    <label className="block text-xs font-bold text-ink-soft">
      Rotation (°)
      <input
        className={fieldClass}
        type="number"
        min={0}
        max={359}
        step={15}
        defaultValue={item.rotation}
        key={item.rotation}
        onBlur={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange({ ...item, rotation: ((n % 360) + 360) % 360 });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );

  if (isTable(item)) {
    const round = item.shape === "round";
    return (
      <Panel title={`Table ${item.label}`}>
        <div className="space-y-3">
          <TextField
            label="Label"
            value={item.label}
            maxLength={12}
            validate={(v) =>
              !v ? "Every table needs a label" : items.some((i) => isTable(i) && i.id !== item.id && i.label.toLowerCase() === v.toLowerCase()) ? "Another table has this label" : null
            }
            onCommit={(label) => onChange({ ...item, label })}
          />
          <div>
            <span className="text-xs font-bold text-ink-soft">Shape</span>
            <div className="mt-1 flex gap-1 rounded-full bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Shape">
              {(["rect", "round"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={item.shape === s}
                  onClick={() => onChange({ ...item, shape: s, h: s === "round" ? item.w : item.h === item.w ? Math.round(item.w / 2.4) : item.h })}
                  className={`flex-1 rounded-full px-3 py-1 text-sm font-bold transition ${item.shape === s ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
                >
                  {s === "rect" ? "Rectangle" : "Round"}
                </button>
              ))}
            </div>
          </div>
          {round ? (
            <LengthField label="Diameter" mm={item.w} units={units} onCommit={(w) => onChange({ ...item, w, h: w })} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <LengthField label="Length" mm={item.w} units={units} onCommit={(w) => onChange({ ...item, w })} />
              <LengthField label="Depth" mm={item.h} units={units} onCommit={(h) => onChange({ ...item, h })} />
            </div>
          )}
          {!round && rotationField}
          <p className="text-xs text-ink-muted">{round ? formatLength(item.w, units) + " round" : formatSize(item.w, item.h, units)}</p>
        </div>
        {actions}
      </Panel>
    );
  }

  return (
    <Panel title={item.label || landmarkLabels[item.type]}>
      <div className="space-y-3">
        <label className="block text-xs font-bold text-ink-soft">
          Type
          <select className={fieldClass} value={item.type} onChange={(e) => onChange({ ...item, type: e.target.value as LandmarkType })}>
            {LANDMARK_TYPES.map((t) => (
              <option key={t} value={t}>
                {landmarkLabels[t]}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Label (optional)" value={item.label} maxLength={40} placeholder={landmarkLabels[item.type]} onCommit={(label) => onChange({ ...item, label })} />
        <div className="grid grid-cols-2 gap-2">
          <LengthField label="Width" mm={item.w} units={units} onCommit={(w) => onChange({ ...item, w })} />
          <LengthField label="Depth" mm={item.h} units={units} onCommit={(h) => onChange({ ...item, h })} />
        </div>
        {rotationField}
      </div>
      {actions}
    </Panel>
  );
}

function RowDialog({
  units,
  fromSelected,
  onAdd,
  onClose,
}: {
  units: FloorplanUnits;
  fromSelected: boolean;
  onAdd: (count: number, direction: "right" | "down", gapMm: number) => void;
  onClose: () => void;
}) {
  const [count, setCount] = useState("5");
  const [direction, setDirection] = useState<"right" | "down">("right");
  const [gap, setGap] = useState("0");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const n = Math.round(Number(count));
  const valid = Number.isFinite(n) && n >= 1 && n <= 50 && Number(gap) >= 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="row-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <form
        className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onAdd(n, direction, fromUnits(Number(gap), units));
        }}
      >
        <h2 id="row-title" className="text-xl font-extrabold">
          Add a row of tables
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {fromSelected ? "Continues from the selected table, with the same size." : "Starts in the middle of the view, with standard tables."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-xs font-bold text-ink-soft">
            How many
            <input className={fieldClass} type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} autoFocus />
          </label>
          <label className="block text-xs font-bold text-ink-soft">
            Gap ({unitLabel[units]})
            <input className={fieldClass} type="number" min={0} step={units === "ft" ? 0.5 : 0.1} value={gap} onChange={(e) => setGap(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex gap-1 rounded-full bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Direction">
          {(["right", "down"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => setDirection(d)}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${direction === d ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
            >
              {d === "right" ? "Across →" : "Down ↓"}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 font-bold text-ink-soft hover:bg-cream">
            Cancel
          </button>
          <button type="submit" disabled={!valid} className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-5 py-2.5 font-bold text-white disabled:opacity-50">
            Add {valid ? n : ""} tables
          </button>
        </div>
      </form>
    </div>
  );
}
