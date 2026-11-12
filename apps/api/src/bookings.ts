import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  ACTIVE_BOOKING_STATUSES,
  type Booking,
  type BookingSource,
  type BookingStatus,
  type BulkDiscountTier,
  type PaymentMethod,
  type Vendor,
  type VendorContactInput,
  vendorContactSchema,
  priceRequest,
  tableLabels,
  type TableType,
} from "@flightplan/shared";
import { db, schema } from "./db/index.js";
import { validateCode } from "./discounts.js";

const { bookings, eventTables, eventVendors, vendors } = schema;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BookingRow = typeof bookings.$inferSelect;

/** Thrown when a table already has an active booking (two vendors picked it at once, etc.). */
export class TableTakenError extends Error {
  constructor(labels: string[] = []) {
    super(
      labels.length > 1
        ? `Sorry, tables ${labels.join(", ")} were just taken. Please pick other tables.`
        : labels.length === 1
          ? `Sorry, table ${labels[0]} was just taken. Please pick another one.`
          : "Sorry, one of those tables was just taken. Please pick again.",
    );
  }
}

/** Thrown when reducing the table count would remove tables that are booked. */
/** Changing table counts would renumber booked tables; pairs are [current label, new label] */
export class TablesRenumberedError extends Error {
  constructor(public changes: [string, string][]) {
    const list = changes.map(([from, to]) => `${from} → ${to}`).join(", ");
    super(
      `That would renumber ${changes.length === 1 ? "a booked table" : "booked tables"} (${list}). Add new tables to the last table type, or give the later types a prefix (e.g. L1, L2…) so their numbers don't move.`,
    );
  }
}

export class TablesInUseError extends Error {
  constructor(labels: string[]) {
    super(
      labels.length === 1
        ? `Table ${labels[0]} has a booking. Release it before removing it.`
        : `Tables ${labels.join(", ")} have bookings. Release them before removing them.`,
    );
  }
}

const DAY_MS = 86_400_000;

export function toBooking(b: BookingRow): Booking {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: b.id,
    requestId: b.requestId,
    tableId: b.tableId,
    vendorId: b.vendorId,
    status: b.status,
    source: b.source,
    name: b.name,
    businessName: b.businessName,
    email: b.email,
    phone: b.phone,
    message: b.message,
    createdAt: b.createdAt.toISOString(),
    approvedAt: iso(b.approvedAt),
    paymentDueAt: iso(b.paymentDueAt),
    paidAt: iso(b.paidAt),
    paymentMethod: b.paymentMethod,
    basePriceCents: b.basePriceCents,
    priceCents: b.priceCents,
    discountLabel: b.discountLabel,
    closedAt: iso(b.closedAt),
    overdue: b.status === "awaiting_payment" && b.paymentDueAt !== null && b.paymentDueAt.getTime() < Date.now(),
  };
}

export function isActive(status: BookingStatus) {
  return (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Status and timestamps for a booking that's just been approved (or didn't need approval).
 * Free tables are paid straight away; otherwise the pay-by clock starts now.
 */
export function approvedFields(request: { free: boolean; paymentDueDays: number | null }, now = new Date()) {
  if (request.free) {
    return { status: "paid" as const, approvedAt: now, paidAt: now, paymentDueAt: null };
  }
  return {
    status: "awaiting_payment" as const,
    approvedAt: now,
    paidAt: null,
    paymentDueAt: request.paymentDueDays ? new Date(now.getTime() + request.paymentDueDays * DAY_MS) : null,
  };
}

export function toVendor(v: typeof vendors.$inferSelect): Vendor {
  return {
    id: v.id,
    name: v.name,
    businessName: v.businessName,
    email: v.email,
    phone: v.phone,
    notes: v.notes,
    createdAt: v.createdAt.toISOString(),
    favourite: v.favourite,
    banned: v.bannedAt !== null,
  };
}

/**
 * Find the organizer's vendor with this email, or add them to the vendor list.
 * Existing vendors' saved details are never overwritten from a booking form.
 * `banned` says whether they're on the organizer's ban list.
 */
export async function findOrCreateVendor(tx: Tx, organizerId: string, input: VendorContactInput) {
  const contact = vendorContactSchema.parse(input);
  const [created] = await tx
    .insert(vendors)
    .values({ organizerId, ...contact })
    .onConflictDoNothing()
    .returning({ id: vendors.id });
  if (created) return { id: created.id, banned: false };

  const [existing] = await tx
    .select({ id: vendors.id, bannedAt: vendors.bannedAt })
    .from(vendors)
    .where(and(eq(vendors.organizerId, organizerId), eq(vendors.email, contact.email)));
  return { id: existing.id, banned: existing.bannedAt !== null };
}

type BookingEvent = {
  id: string;
  organizerId: string;
  requiresApproval: boolean;
  tableTypes: TableType[];
  paymentDueDays: number | null;
  bulkDiscounts: BulkDiscountTier[];
};

/** Each table's list price, from its table type, in the order given. */
export async function tablePrices(ex: Tx | typeof db, event: { tableTypes: TableType[] }, tableIds: string[]) {
  if (!tableIds.length) return [];
  const rows = await ex.select({ id: eventTables.id, typeId: eventTables.typeId }).from(eventTables).where(inArray(eventTables.id, tableIds));
  const typeOf = new Map(rows.map((r) => [r.id, r.typeId]));
  const priceOf = new Map(event.tableTypes.map((t) => [t.id, t.priceCents]));
  const fallback = Math.min(...event.tableTypes.map((t) => t.priceCents), Number.MAX_SAFE_INTEGER);
  return tableIds.map((id) => priceOf.get(typeOf.get(id) ?? "") ?? (fallback === Number.MAX_SAFE_INTEGER ? 0 : fallback));
}

/** What a request's tables add up to: list price, discount, and what to pay (from the price snapshot). */
export function requestTotals(rows: { basePriceCents: number; priceCents: number; discountLabel: string }[]) {
  const subtotalCents = rows.reduce((n, r) => n + r.basePriceCents, 0);
  const totalCents = rows.reduce((n, r) => n + r.priceCents, 0);
  return { subtotalCents, discountCents: subtotalCents - totalCents, totalCents, discountLabel: rows[0]?.discountLabel ?? "" };
}

/** A discount code that can't be used; the message is for the vendor */
export class DiscountCodeError extends Error {}

/**
 * Book one or more tables as a single request (all or nothing).
 * Throws TableTakenError, naming the tables, if any of them is already held.
 */
export async function createBookings(
  tx: Tx,
  args: {
    event: BookingEvent;
    tableIds: string[];
    vendorId: string;
    contact: VendorContactInput;
    message?: string;
    source: BookingSource;
    /** Organizer only: record as already paid */
    paid?: boolean;
    /** With `paid`: how they paid */
    paymentMethod?: PaymentMethod | null;
    /** Optional discount code (checked here); throws DiscountCodeError if it can't be used */
    discountCode?: string;
  },
): Promise<BookingRow[]> {
  const { event, source, tableIds } = args;
  const contact = vendorContactSchema.parse(args.contact);
  const now = new Date();

  // Check first so we can say which tables are taken; the unique index still guards races
  const held = await tx
    .select({ label: eventTables.label })
    .from(bookings)
    .innerJoin(eventTables, eq(eventTables.id, bookings.tableId))
    .where(and(inArray(bookings.tableId, tableIds), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])))
    .orderBy(asc(eventTables.number));
  if (held.length) throw new TableTakenError(held.map((h) => h.label));

  // Price the request now and store it on each table, so later changes to the show's price or
  // discounts don't change what this vendor owes. The best of the multi-table tier and the code wins.
  let code = null;
  if (args.discountCode) {
    const checked = await validateCode(
      { organizerId: event.organizerId, eventId: event.id, text: args.discountCode, email: contact.email },
      tx,
    );
    if (checked.error) throw new DiscountCodeError(checked.error);
    code = checked.code;
  }
  // Each table at its own type's price
  const prices = await tablePrices(tx, event, tableIds);
  const quote = priceRequest({ prices, tiers: event.bulkDiscounts, code });
  const pricing = {
    discountLabel: quote.label,
    // A code only counts as used when it's the discount that applied
    discountCodeId: quote.source === "code" && code ? code.id : null,
  };

  // Organizer-assigned tables skip approval; vendor requests need it if the event says so
  const fields =
    source !== "organizer" && event.requiresApproval
      ? { status: "pending" as const, approvedAt: null, paidAt: null, paymentDueAt: null }
      : args.paid
        ? { status: "paid" as const, approvedAt: now, paidAt: now, paymentDueAt: null, paymentMethod: args.paymentMethod ?? null }
        : approvedFields({ free: quote.subtotalCents === 0, paymentDueDays: event.paymentDueDays }, now);

  const requestId = randomUUID();
  let rows: BookingRow[];
  try {
    // A savepoint, so a clash on the unique index doesn't abort the caller's transaction
    rows = await tx.transaction((sp) =>
      sp
        .insert(bookings)
        .values(
          tableIds.map((tableId, i) => ({
            requestId,
            eventId: event.id,
            tableId,
            vendorId: args.vendorId,
            source,
            ...contact,
            message: args.message ?? "",
            ...fields,
            ...pricing,
            basePriceCents: prices[i],
            priceCents: quote.perTableCents[i],
          })),
        )
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new TableTakenError();
    throw err;
  }
  // Once booked on a table they're no longer waiting for one
  await tx.delete(eventVendors).where(and(eq(eventVendors.eventId, event.id), eq(eventVendors.vendorId, args.vendorId)));
  return rows;
}

/**
 * Make an event's tables match its table types: each type's count, numbered in one sequence type by
 * type (or prefix + 1…N for prefixed types). Tables are kept per type in order; extra ones come off
 * the end of their type. Booked tables can't be removed, and can't be renumbered either (their vendor
 * was told "table 21"), so changes that would do either are refused with a message saying why.
 */
export async function syncTables(tx: Tx, eventId: string, types: TableType[]) {
  const existing = await tx
    .select({ id: eventTables.id, number: eventTables.number, label: eventTables.label, typeId: eventTables.typeId })
    .from(eventTables)
    .where(eq(eventTables.eventId, eventId))
    .orderBy(asc(eventTables.number));
  const bookedIds = new Set(
    existing.length
      ? (
          await tx
            .select({ tableId: bookings.tableId })
            .from(bookings)
            .where(and(inArray(bookings.tableId, existing.map((t) => t.id)), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])))
        ).map((r) => r.tableId)
      : [],
  );

  // Which existing table becomes each wanted table; anything left over is removed
  const wanted = tableLabels(types);
  const kept = new Map<number, (typeof existing)[number]>();
  const removed: typeof existing = [];
  for (const type of types) {
    const ofType = existing.filter((t) => t.typeId === type.id);
    const slots = wanted.flatMap((w, i) => (w.typeId === type.id ? [i] : []));
    ofType.forEach((t, n) => (n < slots.length ? kept.set(slots[n], t) : removed.push(t)));
  }
  const typeIds = new Set(types.map((t) => t.id));
  removed.push(...existing.filter((t) => !typeIds.has(t.typeId)));

  const removedBooked = removed.filter((t) => bookedIds.has(t.id));
  if (removedBooked.length) throw new TablesInUseError(removedBooked.map((t) => t.label));
  const relabelled = [...kept].filter(([i, t]) => bookedIds.has(t.id) && t.label !== wanted[i].label);
  if (relabelled.length) throw new TablesRenumberedError(relabelled.map(([i, t]) => [t.label, wanted[i].label]));

  if (removed.length) {
    // Past (closed) bookings on removed tables go with them
    await tx.delete(eventTables).where(inArray(eventTables.id, removed.map((t) => t.id)));
  }
  // Park kept tables on negative numbers so the unique (event, number) index never clashes mid-way
  if (kept.size) {
    await tx
      .update(eventTables)
      .set({ number: sql`-${eventTables.number} - 1000000` })
      .where(inArray(eventTables.id, [...kept.values()].map((t) => t.id)));
  }
  const inserts: (typeof eventTables.$inferInsert)[] = [];
  for (const [i, w] of wanted.entries()) {
    const row = kept.get(i);
    if (row) await tx.update(eventTables).set({ number: i + 1, label: w.label, typeId: w.typeId }).where(eq(eventTables.id, row.id));
    else inserts.push({ eventId, number: i + 1, label: w.label, typeId: w.typeId });
  }
  if (inserts.length) await tx.insert(eventTables).values(inserts);
}

/** SQL condition: booking is awaiting payment and past its deadline. */
export const overdueCondition = sql`${bookings.status} = 'awaiting_payment' and ${bookings.paymentDueAt} < now()`;
