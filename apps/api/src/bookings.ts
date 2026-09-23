import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  ACTIVE_BOOKING_STATUSES,
  type Booking,
  type BookingSource,
  type BookingStatus,
  type VendorContactInput,
  vendorContactSchema,
} from "@flightplan/shared";
import { db, schema } from "./db/index.js";

const { bookings, eventTables, vendors } = schema;

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
export class TablesInUseError extends Error {
  constructor(labels: string[]) {
    super(
      labels.length === 1
        ? `Table ${labels[0]} has a booking. Release it before reducing the number of tables.`
        : `Tables ${labels.join(", ")} have bookings. Release them before reducing the number of tables.`,
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
export function approvedFields(event: { tablePriceCents: number; paymentDueDays: number | null }, now = new Date()) {
  if (event.tablePriceCents === 0) {
    return { status: "paid" as const, approvedAt: now, paidAt: now, paymentDueAt: null };
  }
  return {
    status: "awaiting_payment" as const,
    approvedAt: now,
    paidAt: null,
    paymentDueAt: event.paymentDueDays ? new Date(now.getTime() + event.paymentDueDays * DAY_MS) : null,
  };
}

/**
 * Find the organizer's vendor with this email, or add them to the vendor list.
 * Existing vendors' saved details are never overwritten from a booking form.
 */
export async function findOrCreateVendor(tx: Tx, organizerId: string, input: VendorContactInput) {
  const contact = vendorContactSchema.parse(input);
  const [created] = await tx
    .insert(vendors)
    .values({ organizerId, ...contact })
    .onConflictDoNothing()
    .returning({ id: vendors.id });
  if (created) return created.id;

  const [existing] = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.organizerId, organizerId), eq(vendors.email, contact.email)));
  return existing.id;
}

type BookingEvent = {
  id: string;
  requiresApproval: boolean;
  tablePriceCents: number;
  paymentDueDays: number | null;
};

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

  // Organizer-assigned tables skip approval; vendor requests need it if the event says so
  const fields =
    source !== "organizer" && event.requiresApproval
      ? { status: "pending" as const, approvedAt: null, paidAt: null, paymentDueAt: null }
      : args.paid
        ? { status: "paid" as const, approvedAt: now, paidAt: now, paymentDueAt: null }
        : approvedFields(event, now);

  const requestId = randomUUID();
  try {
    // A savepoint, so a clash on the unique index doesn't abort the caller's transaction
    return await tx.transaction((sp) =>
      sp
        .insert(bookings)
        .values(
          tableIds.map((tableId) => ({
            requestId,
            eventId: event.id,
            tableId,
            vendorId: args.vendorId,
            source,
            ...contact,
            message: args.message ?? "",
            ...fields,
          })),
        )
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new TableTakenError();
    throw err;
  }
}

/**
 * Make an event's tables match its table count: add numbered tables at the end, or remove
 * tables from the end. Tables with active bookings can't be removed.
 */
export async function syncTables(tx: Tx, eventId: string, count: number) {
  const existing = await tx
    .select({ id: eventTables.id, number: eventTables.number, label: eventTables.label })
    .from(eventTables)
    .where(eq(eventTables.eventId, eventId))
    .orderBy(asc(eventTables.number));

  if (existing.length < count) {
    const start = (existing.at(-1)?.number ?? 0) + 1;
    const toAdd = Array.from({ length: count - existing.length }, (_, i) => start + i);
    await tx.insert(eventTables).values(toAdd.map((n) => ({ eventId, number: n, label: String(n) })));
  } else if (existing.length > count) {
    const extra = existing.slice(count);
    const held = await tx
      .select({ tableId: bookings.tableId })
      .from(bookings)
      .where(
        and(
          inArray(
            bookings.tableId,
            extra.map((t) => t.id),
          ),
          inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
        ),
      );
    if (held.length) {
      const heldIds = new Set(held.map((h) => h.tableId));
      throw new TablesInUseError(extra.filter((t) => heldIds.has(t.id)).map((t) => t.label));
    }
    // Past (closed) bookings on removed tables are removed with them
    await tx.delete(eventTables).where(
      inArray(
        eventTables.id,
        extra.map((t) => t.id),
      ),
    );
  }
}

/** SQL condition: booking is awaiting payment and past its deadline. */
export const overdueCondition = sql`${bookings.status} = 'awaiting_payment' and ${bookings.paymentDueAt} < now()`;
