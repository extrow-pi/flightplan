import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FloorplanTable } from "@flightplan/shared";
import { isTable, itemBounds } from "../../lib/floorplan";
import { Landmark, planPadding, Room, Table, Wall, type PlanShape, type TableStyle } from "./FloorplanDrawing";

type View = { x: number; y: number; w: number; h: number };

/**
 * A plan you can look around: drag to pan, pinch or Ctrl/⌘ + scroll to zoom, and +/−/Fit buttons.
 * Plain scrolling still scrolls the page. A quick tap on a table calls `onTableClick`; `focus`
 * zooms to those tables (e.g. a vendor someone searched for).
 */
export default function MapViewer({
  plan,
  tableStyle,
  onTableClick,
  focus,
  className = "max-h-[70dvh] min-h-64",
  label = "Floorplan",
}: {
  plan: PlanShape;
  tableStyle?: (t: FloorplanTable) => TableStyle;
  onTableClick?: (t: FloorplanTable) => void;
  /** Plan item ids of tables to bring into view */
  focus?: string[];
  /** Sizing classes; the box takes the room's shape, so pass a max height rather than a height */
  className?: string;
  label?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fit = useCallback((): View => {
    const pad = planPadding(plan);
    return { x: -pad, y: -pad, w: plan.widthMm + pad * 2, h: plan.depthMm + pad * 2 };
  }, [plan]);
  const [view, setView] = useState<View>(fit);

  // Pointers currently down, for pan and pinch
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startView: View; start: { x: number; y: number }; dist?: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const perPx = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? Math.max(view.w / r.width, view.h / r.height) : 1;
  };
  const toPlan = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const zoom = useCallback(
    (factor: number, around?: { x: number; y: number }) =>
      setView((v) => {
        const size = Math.max(plan.widthMm, plan.depthMm);
        const f = Math.min(Math.max(factor, size / 30 / v.w), (size * 2.5) / v.w);
        const c = around ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
        return { x: c.x - (c.x - v.x) * f, y: c.y - (c.y - v.y) * f, w: v.w * f, h: v.h * f };
      }),
    [plan.widthMm, plan.depthMm],
  );

  // Ctrl/⌘ + scroll (and trackpad pinch, which sends it) zooms; plain scrolling scrolls the page
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      const p = ctm ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()) : undefined;
      zoom(Math.pow(1.002, e.deltaY), p ? { x: p.x, y: p.y } : undefined);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom]);

  // Zoom to the focused tables
  const focusKey = focus?.join(",") ?? "";
  useEffect(() => {
    if (!focusKey) return;
    const ids = new Set(focusKey.split(","));
    const boxes = plan.items.filter((i) => isTable(i) && ids.has(i.id)).map(itemBounds);
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((b) => b.minX)), maxX = Math.max(...boxes.map((b) => b.maxX));
    const minY = Math.min(...boxes.map((b) => b.minY)), maxY = Math.max(...boxes.map((b) => b.maxY));
    // Show some of the room around them, at least a fifth of it
    const span = Math.max(maxX - minX, maxY - minY, Math.max(plan.widthMm, plan.depthMm) / 5) * 1.6;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setView({ x: cx - span / 2, y: cy - span / 2, w: span, h: span });
  }, [focusKey, plan]);

  function onPointerDown(e: ReactPointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      startView: view,
      start: pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : { x: e.clientX, y: e.clientY },
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined,
      moved: false,
    };
    suppressClick.current = false;
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const scale = perPx();
    if (pts.length >= 2 && g.dist) {
      // Pinch: zoom around the middle of the two fingers
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const f = g.dist / Math.max(dist, 1);
      const around = toPlan(mid.x, mid.y);
      const v = g.startView;
      setView({ x: around.x - (around.x - v.x) * f, y: around.y - (around.y - v.y) * f, w: v.w * f, h: v.h * f });
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    if (!g.moved) {
      g.moved = true;
      svgRef.current?.setPointerCapture(e.pointerId);
    }
    setView({ ...g.startView, x: g.startView.x - dx * scale, y: g.startView.y - dy * scale });
  }
  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (gesture.current?.moved) suppressClick.current = true;
    if (!pointers.current.size) gesture.current = null;
    else {
      // One finger left after a pinch: carry on panning from here
      const [p] = [...pointers.current.values()];
      gesture.current = { startView: view, start: p, moved: true };
    }
  }

  const tableClick = (t: FloorplanTable) => () => {
    if (suppressClick.current) return;
    onTableClick?.(t);
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-3xl bg-cream ring-1 ring-ink/10 ${className}`}
      // The room's shape, so the plan fills the width instead of floating in a tall box
      style={{ aspectRatio: `${plan.widthMm + planPadding(plan) * 2} / ${plan.depthMm + planPadding(plan) * 2}` }}
    >
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="block size-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={label}
        fontFamily="inherit"
      >
        <Room plan={plan} grid={false} />
        {plan.items.map((i) =>
          isTable(i) ? (
            <Table
              key={i.id}
              table={i}
              style={tableStyle?.(i)}
              onClick={onTableClick ? tableClick(i) : undefined}
              className={onTableClick ? "cursor-pointer" : undefined}
            />
          ) : i.kind === "wall" ? (
            <Wall key={i.id} wall={i} />
          ) : (
            <Landmark key={i.id} landmark={i} />
          ),
        )}
      </svg>
      <div className="absolute right-3 bottom-3 flex gap-1 rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-ink/10">
        <button type="button" onClick={() => zoom(1 / 1.4)} className="size-8 rounded-full font-bold text-slate hover:bg-cream" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(1.4)} className="size-8 rounded-full font-bold text-slate hover:bg-cream" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setView(fit())} className="rounded-full px-3 text-xs font-bold text-slate hover:bg-cream">
          Fit
        </button>
      </div>
    </div>
  );
}
