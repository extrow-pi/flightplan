import type { ReactNode, SVGProps } from "react";
import { landmarkLabels, type FloorplanItem, type FloorplanLandmark, type FloorplanTable, type FloorplanUnits } from "@flightplan/shared";
import { formatLength, gridStep, isLandmark, isTable, isWall, landmarkColors } from "../../lib/floorplan";

// Drawing a floorplan as SVG, in millimetres. Shared by the editor, thumbnails and the maps.

export type PlanShape = { units: FloorplanUnits; widthMm: number; depthMm: number; items: FloorplanItem[] };

/** How to colour one table, e.g. by booking status on the organizer's map */
export type TableStyle = { fill: string; stroke: string; ink: string; sublabel?: string; title?: string; dim?: boolean };

export const defaultTableStyle: TableStyle = { fill: "#ffffff", stroke: "#5c6b8a", ink: "#4b5875" };

/** Space around the room so dimensions and edges have room to breathe */
export const planPadding = (p: { widthMm: number; depthMm: number }) => Math.max(p.widthMm, p.depthMm) * 0.06;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The room: its floor, grid and outline. */
export function Room({ plan, grid = true, dimensions = false }: { plan: PlanShape; grid?: boolean; dimensions?: boolean }) {
  const { widthMm: w, depthMm: d, units } = plan;
  const step = gridStep[units];
  const lines: ReactNode[] = [];
  if (grid) {
    // Skip the fine grid on big rooms; it would be a wash of lines
    const minor = w / step.minor > 150 || d / step.minor > 150 ? step.major : step.minor;
    for (let x = minor, i = 1; x < w; x += minor, i++) {
      const major = Math.abs(x / step.major - Math.round(x / step.major)) < 1e-6;
      lines.push(<line key={`x${i}`} x1={x} y1={0} x2={x} y2={d} stroke={major ? "#e8d9bd" : "#f3ead8"} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    }
    for (let y = minor, i = 1; y < d; y += minor, i++) {
      const major = Math.abs(y / step.major - Math.round(y / step.major)) < 1e-6;
      lines.push(<line key={`y${i}`} x1={0} y1={y} x2={w} y2={y} stroke={major ? "#e8d9bd" : "#f3ead8"} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    }
  }
  const font = Math.max(w, d) * 0.022;
  return (
    <g>
      <rect x={0} y={0} width={w} height={d} fill="#ffffff" />
      {lines}
      <rect x={0} y={0} width={w} height={d} fill="none" stroke="#4a3728" strokeWidth={3} vectorEffect="non-scaling-stroke" />
      {dimensions && (
        <g fill="#7a6555" fontSize={font} fontWeight={700} fontFamily="inherit">
          <text x={w / 2} y={-font * 0.6} textAnchor="middle">
            {formatLength(w, units)}
          </text>
          <text x={-font * 0.6} y={d / 2} textAnchor="middle" transform={`rotate(-90 ${-font * 0.6} ${d / 2})`}>
            {formatLength(d, units)}
          </text>
        </g>
      )}
    </g>
  );
}

export function Wall({ wall, ...rest }: { wall: Extract<FloorplanItem, { kind: "wall" }> } & SVGProps<SVGLineElement>) {
  return (
    <line
      x1={wall.x1}
      y1={wall.y1}
      x2={wall.x2}
      y2={wall.y2}
      stroke="#4a3728"
      strokeWidth={wall.thickness}
      strokeLinecap="square"
      {...rest}
    />
  );
}

export function Landmark({ landmark: l, ...rest }: { landmark: FloorplanLandmark } & SVGProps<SVGGElement>) {
  const c = landmarkColors[l.type];
  const text = l.label || landmarkLabels[l.type];
  // Fit the label inside the shape (upright, whatever the rotation)
  const font = clamp(Math.min(l.h * 0.32, (l.w * 1.6) / Math.max(text.length, 3)), 80, 900);
  return (
    <g {...rest}>
      <g transform={`translate(${l.x} ${l.y}) rotate(${l.rotation})`}>
        <rect x={-l.w / 2} y={-l.h / 2} width={l.w} height={l.h} rx={Math.min(l.w, l.h) * 0.08} fill={c.fill} stroke={c.ink} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {l.type === "stairs" && <StairTreads w={l.w} h={l.h} ink={c.ink} />}
      </g>
      {l.type !== "pillar" && (
        <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontSize={font} fontWeight={700} fill={c.ink} style={{ pointerEvents: "none" }}>
          {text}
        </text>
      )}
    </g>
  );
}

/** Stair treads: evenly spaced lines across the landmark */
function StairTreads({ w, h, ink }: { w: number; h: number; ink: string }) {
  const count = Math.max(2, Math.floor(w / Math.max(h * 0.25, 150)));
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const x = -w / 2 + ((i + 1) * w) / (count + 1);
        return <line key={i} x1={x} y1={-h / 2} x2={x} y2={h / 2} stroke={ink} strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
    </>
  );
}

export function Table({
  table: t,
  style = defaultTableStyle,
  ...rest
}: { table: FloorplanTable; style?: TableStyle } & SVGProps<SVGGElement>) {
  const h = t.shape === "round" ? t.w : t.h;
  const font = clamp(Math.min(h, t.w) * 0.42, 80, 700);
  return (
    <g opacity={style.dim ? 0.35 : 1} {...rest}>
      {style.title && <title>{style.title}</title>}
      {t.shape === "round" ? (
        <circle cx={t.x} cy={t.y} r={t.w / 2} fill={style.fill} stroke={style.stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : (
        <rect
          x={t.x - t.w / 2}
          y={t.y - t.h / 2}
          width={t.w}
          height={t.h}
          rx={Math.min(t.w, t.h) * 0.08}
          transform={`rotate(${t.rotation} ${t.x} ${t.y})`}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text
        x={t.x}
        y={style.sublabel ? t.y - font * 0.35 : t.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font}
        fontWeight={800}
        fill={style.ink}
        style={{ pointerEvents: "none" }}
      >
        {t.label}
      </text>
      {style.sublabel && (
        <text x={t.x} y={t.y + font * 0.55} textAnchor="middle" dominantBaseline="central" fontSize={font * 0.55} fontWeight={600} fill={style.ink} style={{ pointerEvents: "none" }}>
          {style.sublabel}
        </text>
      )}
    </g>
  );
}

/**
 * A whole plan as a responsive, read-only SVG. Pass `tableStyle` to colour tables (e.g. by status)
 * and `onTableClick` to make them clickable.
 */
export function FloorplanView({
  plan,
  tableStyle,
  onTableClick,
  grid = false,
  dimensions = false,
  className = "",
  label,
}: {
  plan: PlanShape;
  tableStyle?: (t: FloorplanTable) => TableStyle;
  onTableClick?: (t: FloorplanTable) => void;
  grid?: boolean;
  dimensions?: boolean;
  className?: string;
  /** Accessible name for the drawing */
  label?: string;
}) {
  const pad = planPadding(plan) * (dimensions ? 1.6 : 1);
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${plan.widthMm + pad * 2} ${plan.depthMm + pad * 2}`}
      className={`block h-auto w-full ${className}`}
      role="img"
      aria-label={label ?? "Floorplan"}
      fontFamily="inherit"
    >
      <Room plan={plan} grid={grid} dimensions={dimensions} />
      {plan.items.filter(isLandmark).map((l) => (
        <Landmark key={l.id} landmark={l} />
      ))}
      {plan.items.filter(isWall).map((w) => (
        <Wall key={w.id} wall={w} />
      ))}
      {plan.items.filter(isTable).map((t) => {
        const style = tableStyle?.(t);
        return (
          <Table
            key={t.id}
            table={t}
            style={style}
            onClick={onTableClick ? () => onTableClick(t) : undefined}
            className={onTableClick ? "cursor-pointer" : undefined}
          />
        );
      })}
    </svg>
  );
}
