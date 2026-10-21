import { and, eq, inArray, sql } from "drizzle-orm";
import { ACTIVE_BOOKING_STATUSES, MAX_TABLES, type FloorplanGroup, type FloorplanInput, type FloorplanItem } from "@flightplan/shared";
import type { Tx } from "./bookings.js";
import { schema } from "./db/index.js";

// An event's (or event template's) own floorplan. When an event has a plan, the plan's tables are its
// bookable tables: saving the plan adds, renames, renumbers and removes the event's tables to match.

const { bookings, events, eventTables, floorplans } = schema;

export class PlanTablesInUseError extends Error {
  constructor(labels: string[]) {
    super(
      labels.length === 1
        ? `Table ${labels[0]} has a booking, so it has to stay on the plan. Keep a table labelled ${labels[0]}, or release the booking first.`
        : `Tables ${labels.join(", ")} have bookings, so they have to stay on the plan. Keep tables with those labels, or release the bookings first.`,
    );
  }
}

export class TooManyTablesError extends Error {
  constructor() {
    super(`An event can have up to ${MAX_TABLES} tables`);
  }
}

/** The plan's tables in label order (2 before 10, then A1…), which is how the event lists its tables */
const planTables = (items: FloorplanItem[]) =>
  items
    .filter((i): i is Extract<FloorplanItem, { kind: "table" }> => i.kind === "table")
    .map((t) => ({ id: t.id, label: t.label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));

/**
 * Make the event's tables match its plan's tables, in label order. Existing tables are matched by
 * plan item first, then by label, so bookings stay on their table (the first time a plan is added,
 * table "5" stays table "5"). Tables left over are removed, unless they have an active booking.
 */
export async function syncTablesFromPlan(tx: Tx, eventId: string, items: FloorplanItem[]) {
  const wanted = planTables(items);
  if (wanted.length > MAX_TABLES) throw new TooManyTablesError();
  const existing = await tx
    .select({ id: eventTables.id, label: eventTables.label, planItemId: eventTables.planItemId })
    .from(eventTables)
    .where(eq(eventTables.eventId, eventId));

  const used = new Set<string>();
  const matched = new Map<string, (typeof existing)[number]>();
  for (const t of wanted) {
    const row = existing.find((r) => r.planItemId === t.id && !used.has(r.id));
    if (row) {
      matched.set(t.id, row);
      used.add(row.id);
    }
  }
  for (const t of wanted) {
    if (matched.has(t.id)) continue;
    const row = existing.find((r) => !used.has(r.id) && r.label.toLowerCase() === t.label.toLowerCase());
    if (row) {
      matched.set(t.id, row);
      used.add(row.id);
    }
  }

  const removed = existing.filter((r) => !used.has(r.id));
  if (removed.length) {
    const held = await tx
      .select({ tableId: bookings.tableId })
      .from(bookings)
      .where(and(inArray(bookings.tableId, removed.map((r) => r.id)), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])));
    if (held.length) {
      const heldIds = new Set(held.map((h) => h.tableId));
      throw new PlanTablesInUseError(removed.filter((r) => heldIds.has(r.id)).map((r) => r.label));
    }
    // Past (closed) bookings on removed tables go with them
    await tx.delete(eventTables).where(inArray(eventTables.id, removed.map((r) => r.id)));
  }

  // Renumber in label order. Park the kept tables on negative numbers first so the unique
  // (event, number) index never sees two tables with the same number mid-way.
  const kept = [...matched.values()].map((r) => r.id);
  if (kept.length) {
    await tx
      .update(eventTables)
      .set({ number: sql`-${eventTables.number} - 1000000` })
      .where(inArray(eventTables.id, kept));
  }
  const inserts: (typeof eventTables.$inferInsert)[] = [];
  for (const [i, t] of wanted.entries()) {
    const row = matched.get(t.id);
    if (row) await tx.update(eventTables).set({ number: i + 1, label: t.label, planItemId: t.id }).where(eq(eventTables.id, row.id));
    else inserts.push({ eventId, number: i + 1, label: t.label, planItemId: t.id });
  }
  if (inserts.length) await tx.insert(eventTables).values(inserts);
  await tx.update(events).set({ vendorTables: wanted.length }).where(eq(events.id, eventId));
}

/** Create or replace an event's plan and sync its tables. `ownerId` is the event owner. */
export async function saveEventPlan(tx: Tx, eventId: string, ownerId: string, plan: FloorplanInput & { items: FloorplanItem[]; groups: FloorplanGroup[] }) {
  const [row] = await tx
    .insert(floorplans)
    .values({ organizerId: ownerId, eventId, ...plan })
    .onConflictDoUpdate({ target: floorplans.eventId, set: { ...plan, updatedAt: new Date() } })
    .returning();
  await syncTablesFromPlan(tx, eventId, plan.items);
  return row;
}

/** Give a new event (or template) a copy of another event's plan, if it has one. */
export async function copyEventPlan(tx: Tx, fromEventId: string, toEventId: string, ownerId: string) {
  const [source] = await tx.select().from(floorplans).where(eq(floorplans.eventId, fromEventId));
  if (!source) return null;
  const { name, units, widthMm, depthMm, items, groups } = source;
  return saveEventPlan(tx, toEventId, ownerId, { name, units, widthMm, depthMm, items, groups });
}

/** Take the plan off an event. Its tables stay, as plain numbered tables. */
export async function removeEventPlan(tx: Tx, eventId: string) {
  await tx.delete(floorplans).where(eq(floorplans.eventId, eventId));
  await tx.update(eventTables).set({ planItemId: null }).where(eq(eventTables.eventId, eventId));
}
