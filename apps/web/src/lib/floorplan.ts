import {
  MM_PER_UNIT,
  type FloorplanGroup,
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

/**
 * Sort things in reading order: rows from the top, then left to right. Things whose tops are within
 * `tolerance` of a row's first thing count as part of that row.
 */
function readingOrder<T>(list: T[], at: (t: T) => { x: number; y: number }, tolerance: number): T[] {
  const byY = [...list].sort((p, q) => at(p).y - at(q).y);
  const rows: T[][] = [];
  for (const t of byY) {
    const row = rows.at(-1);
    if (row && at(t).y - at(row[0]).y <= tolerance) row.push(t);
    else rows.push([t]);
  }
  return rows.flatMap((row) => row.sort((p, q) => at(p).x - at(q).x));
}

/** Natural order for labels: 2 before 10, A2 before A10 */
const byLabel = (p: string, q: string) => p.localeCompare(q, undefined, { numeric: true, sensitivity: "base" });

/**
 * Number the tables in reading order. Each table group counts as one block, so an island's tables are
 * numbered together; a group with a prefix is labelled prefix + 1…N (A1–A10) and doesn't use up the
 * main numbers. With `onlyGroup`, just that group is renumbered: a prefixed group gets prefix + 1…N,
 * and other groups shuffle the numbers they already have into reading order.
 */
export function renumberTables(items: FloorplanItem[], groups: FloorplanGroup[] = [], onlyGroup?: string): FloorplanItem[] {
  const tables = items.filter(isTable);
  if (!tables.length) return items;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  // Half a typical table's depth decides what counts as the same row
  const tolerance = Math.max(300, Math.min(...tables.map((t) => t.h), 1000) / 2);
  const inside = (ts: FloorplanTable[]) => readingOrder(ts, (t) => t, tolerance);
  const labels = new Map<string, string>();

  if (onlyGroup) {
    const members = inside(tables.filter((t) => t.group === onlyGroup));
    const prefix = groupById.get(onlyGroup)?.prefix;
    const reuse = [...members.map((t) => t.label)].sort(byLabel);
    members.forEach((t, n) => labels.set(t.id, prefix ? `${prefix}${n + 1}` : reuse[n]));
  } else {
    // Blocks: each group (placed by its top-left corner) and each table on its own
    type Block = { tables: FloorplanTable[]; group?: FloorplanGroup; x: number; y: number };
    const blocks: Block[] = [];
    const grouped = new Map<string, FloorplanTable[]>();
    for (const t of tables) {
      if (t.group && groupById.has(t.group)) grouped.set(t.group, [...(grouped.get(t.group) ?? []), t]);
      else blocks.push({ tables: [t], x: t.x, y: t.y });
    }
    for (const [id, ts] of grouped) {
      const bounds = ts.map(itemBounds);
      const minX = Math.min(...bounds.map((b) => b.minX)), minY = Math.min(...bounds.map((b) => b.minY));
      const first = inside(ts)[0];
      // Use the first table's centre so a group lines up with single tables in the same row
      blocks.push({ tables: ts, group: groupById.get(id), x: Math.max(minX, first.x - first.w / 2), y: Math.max(minY, first.y - first.h / 2) + first.h / 2 });
    }
    let next = 1;
    for (const block of readingOrder(blocks, (b) => b, tolerance)) {
      const prefix = block.group?.prefix;
      inside(block.tables).forEach((t, n) => labels.set(t.id, prefix ? `${prefix}${n + 1}` : String(next++)));
    }
  }
  return items.map((i) => (isTable(i) && labels.has(i.id) ? { ...i, label: labels.get(i.id)! } : i));
}

/** Drop groups that no longer have any tables. */
export function tidyGroups(items: FloorplanItem[], groups: FloorplanGroup[]) {
  const used = new Set(items.filter(isTable).map((t) => t.group));
  return groups.filter((g) => used.has(g.id));
}

/** "Group A", "Group B"… the first name not taken */
export function nextGroupName(groups: FloorplanGroup[]) {
  const taken = new Set(groups.map((g) => g.name.toLowerCase()));
  for (let n = 0; ; n++) {
    const letter = n < 26 ? String.fromCharCode(65 + n) : `${String.fromCharCode(65 + (n % 26))}${Math.floor(n / 26)}`;
    if (!taken.has(`group ${letter}`.toLowerCase())) return `Group ${letter}`;
  }
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
