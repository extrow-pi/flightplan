import {
  MM_PER_UNIT,
  type FloorplanItem,
  type FloorplanLandmark,
  type FloorplanTable,
  type FloorplanUnits,
  type FloorplanWall,
  type LandmarkType,
} from "@flightplan/shared";

// Helpers for floorplans. Everything is stored in millimetres; units only change what's shown.

export const unitLabel: Record<FloorplanUnits, string> = { ft: "ft", m: "m" };

/** Millimetres as a number in the plan's units, rounded for display (0.1 ft or 0.01 m). */
export function toUnits(mm: number, units: FloorplanUnits) {
  const v = mm / MM_PER_UNIT[units];
  return units === "ft" ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
}

export function fromUnits(value: number, units: FloorplanUnits) {
  return Math.round(value * MM_PER_UNIT[units]);
}

/** "6 ft", "1.8 m" */
export function formatLength(mm: number, units: FloorplanUnits) {
  return `${toUnits(mm, units)} ${unitLabel[units]}`;
}

/** "6 × 2.5 ft" */
export function formatSize(w: number, h: number, units: FloorplanUnits) {
  return `${toUnits(w, units)} × ${toUnits(h, units)} ${unitLabel[units]}`;
}

/** What things snap to: 6 inches, or 10 cm */
export const snapStep: Record<FloorplanUnits, number> = { ft: 152.4, m: 100 };
export const snap = (v: number, units: FloorplanUnits, on = true) =>
  on ? Math.round(Math.round(v / snapStep[units]) * snapStep[units]) : Math.round(v);

/** Grid lines: every foot (bold every 10), or every half metre (bold every 5 m) */
export const gridStep: Record<FloorplanUnits, { minor: number; major: number }> = {
  ft: { minor: 304.8, major: 3048 },
  m: { minor: 500, major: 5000 },
};

/** A standard 6 × 2.5 ft (or 1.8 × 0.75 m) vendor table, and a 5 ft (1.5 m) round one */
export const defaultTableSize: Record<FloorplanUnits, { w: number; h: number; round: number }> = {
  ft: { w: 1829, h: 762, round: 1524 },
  m: { w: 1800, h: 750, round: 1500 },
};

export const newId = () => crypto.randomUUID();

export const isTable = (i: FloorplanItem): i is FloorplanTable => i.kind === "table";
export const isWall = (i: FloorplanItem): i is FloorplanWall => i.kind === "wall";
export const isLandmark = (i: FloorplanItem): i is FloorplanLandmark => i.kind === "landmark";

/** The next free table number: one more than the highest numbered label. */
export function nextTableLabel(items: FloorplanItem[]) {
  const numbers = items.filter(isTable).map((t) => Number.parseInt(t.label, 10)).filter((n) => Number.isFinite(n));
  const taken = new Set(items.filter(isTable).map((t) => t.label.toLowerCase()));
  let n = (numbers.length ? Math.max(...numbers) : 0) + 1;
  while (taken.has(String(n))) n++;
  return String(n);
}

/** Number every table 1…N, in reading order: rows from the top, then left to right. */
export function renumberTables(items: FloorplanItem[]): FloorplanItem[] {
  const tables = items.filter(isTable);
  // Tables whose centres are within half a table's depth of each other count as one row
  const rowTolerance = Math.max(300, Math.min(...tables.map((t) => t.h), 1000) / 2);
  const sorted = [...tables].sort((a, b) => (Math.abs(a.y - b.y) <= rowTolerance ? a.x - b.x : a.y - b.y));
  const labels = new Map(sorted.map((t, i) => [t.id, String(i + 1)]));
  return items.map((i) => (isTable(i) ? { ...i, label: labels.get(i.id)! } : i));
}

/** Axis-aligned box around an item (rotation included), for fitting the view and placing things. */
export function itemBounds(i: FloorplanItem) {
  if (isWall(i)) {
    const t = i.thickness / 2;
    return { minX: Math.min(i.x1, i.x2) - t, minY: Math.min(i.y1, i.y2) - t, maxX: Math.max(i.x1, i.x2) + t, maxY: Math.max(i.y1, i.y2) + t };
  }
  const h = isTable(i) && i.shape === "round" ? i.w : i.h;
  const a = (i.rotation * Math.PI) / 180;
  const hw = (Math.abs(Math.cos(a)) * i.w + Math.abs(Math.sin(a)) * h) / 2;
  const hh = (Math.abs(Math.sin(a)) * i.w + Math.abs(Math.cos(a)) * h) / 2;
  return { minX: i.x - hw, minY: i.y - hh, maxX: i.x + hw, maxY: i.y + hh };
}

/** Move an item by dx/dy. */
export function moveItem<T extends FloorplanItem>(i: T, dx: number, dy: number): T {
  if (isWall(i)) return { ...i, x1: Math.round(i.x1 + dx), y1: Math.round(i.y1 + dy), x2: Math.round(i.x2 + dx), y2: Math.round(i.y2 + dy) };
  const shaped = i as FloorplanTable | FloorplanLandmark;
  return { ...shaped, x: Math.round(shaped.x + dx), y: Math.round(shaped.y + dy) } as T;
}

const overlaps = (a: FloorplanItem, b: FloorplanItem) => {
  const x = itemBounds(a), y = itemBounds(b);
  return x.minX < y.maxX && y.minX < x.maxX && x.minY < y.maxY && y.minY < x.maxY;
};

export type LayerMove = "front" | "back" | "forward" | "backward";

/**
 * Change which items sit on top. The items list is the drawing order (last is on top).
 * "front"/"back" move the selection to the very top/bottom; "forward"/"backward" move each
 * selected item past the next item it overlaps, so the change is always visible.
 */
export function moveLayer(items: FloorplanItem[], ids: string[], move: LayerMove): FloorplanItem[] {
  const picked = new Set(ids);
  if (move === "front") return [...items.filter((i) => !picked.has(i.id)), ...items.filter((i) => picked.has(i.id))];
  if (move === "back") return [...items.filter((i) => picked.has(i.id)), ...items.filter((i) => !picked.has(i.id))];
  const list = [...items];
  const order = list.map((i, n) => [i, n] as const).filter(([i]) => picked.has(i.id));
  // Move the item nearest the edge first so selected items don't jump over each other
  if (move === "forward") order.reverse();
  for (const [item] of order) {
    const from = list.indexOf(item);
    if (move === "forward") {
      const past = list.findIndex((other, n) => n > from && !picked.has(other.id) && overlaps(item, other));
      if (past < 0) continue;
      list.splice(from, 1);
      list.splice(past, 0, item);
    } else {
      let past = -1;
      for (let n = from - 1; n >= 0; n--) if (!picked.has(list[n].id) && overlaps(item, list[n])) { past = n; break; }
      if (past < 0) continue;
      list.splice(from, 1);
      list.splice(past, 0, item);
    }
  }
  return list;
}

export const wallLength = (w: FloorplanWall) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);

/** Fill / ink colours for each kind of landmark */
export const landmarkColors: Record<LandmarkType, { fill: string; ink: string }> = {
  walkway: { fill: "#f4f7f8", ink: "#6f8a92" },
  shelf: { fill: "#eadcc4", ink: "#7a5a3a" },
  entrance: { fill: "#d9f2ec", ink: "#2d7a6a" },
  exit: { fill: "#d9f2ec", ink: "#2d7a6a" },
  washroom: { fill: "#dcecf2", ink: "#3d6b78" },
  stairs: { fill: "#e6e2f3", ink: "#5a4d8a" },
  elevator: { fill: "#e6e2f3", ink: "#5a4d8a" },
  stage: { fill: "#ffe0d8", ink: "#c0442a" },
  food: { fill: "#fff4cc", ink: "#9a7000" },
  info: { fill: "#dcecf2", ink: "#3d6b78" },
  atm: { fill: "#fff4cc", ink: "#9a7000" },
  first_aid: { fill: "#ffe0d8", ink: "#c0442a" },
  storage: { fill: "#efe8dc", ink: "#7a6555" },
  pillar: { fill: "#d8d0c4", ink: "#4a3728" },
  other: { fill: "#efe8dc", ink: "#7a6555" },
};
