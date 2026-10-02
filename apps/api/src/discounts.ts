import { and, countDistinct, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import {
  priceRequest,
  type BulkDiscountTier,
  type DiscountCode,
  type QuoteResponse,
} from "@flightplan/shared";
import { db, schema } from "./db/index.js";

// Discount codes and multi-table discounts. Prices are worked out by priceRequest (shared with the
// booking page's preview); this module checks codes and counts their uses.
//
// A code "use" is a request that applied the code and wasn't rejected or cancelled, so a rejected
// request gives its use back. Released requests still count (the vendor did book with it).

const { bookings, discountCodeEvents, discountCodes } = schema;

const TIME_ZONE = process.env.APP_TIMEZONE ?? "America/Vancouver";

/** Today's date (YYYY-MM-DD) in the app's timezone; codes work through their expiry day. */
export function todayInAppTz() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Bookings that count as uses of a code */
export const countsAsUse = notInArray(bookings.status, ["rejected", "cancelled"]);

// Queries here run either on `db` or inside a caller's transaction: with PGlite's single connection,
// a query on `db` while a transaction is open would wait forever.
type Executor = Pick<typeof db, "select">;

type CodeRow = typeof discountCodes.$inferSelect;

/** Uses so far for each code */
export async function usesOf(codeIds: string[], ex: Executor = db) {
  if (!codeIds.length) return new Map<string, { uses: number; discountCents: number }>();
  const rows = await ex
    .select({
      codeId: bookings.discountCodeId,
      uses: countDistinct(bookings.requestId),
      discountCents: sql<number>`coalesce(sum(${bookings.basePriceCents} - ${bookings.priceCents}), 0)::int`,
    })
    .from(bookings)
    .where(and(inArray(bookings.discountCodeId, codeIds), countsAsUse))
    .groupBy(bookings.discountCodeId);
  return new Map(rows.map((r) => [r.codeId!, { uses: r.uses, discountCents: r.discountCents }]));
}

export function codeStatus(c: CodeRow, uses: number): DiscountCode["status"] {
  if (!c.active) return "paused";
  if (c.expiresOn && c.expiresOn < todayInAppTz()) return "expired";
  if (c.maxUses !== null && uses >= c.maxUses) return "used_up";
  return "active";
}

/**
 * Check that `text` is a usable code of the event owner's for this event (and this vendor, for
 * once-per-vendor codes). Returns the code, or a message to show the vendor.
 */
export async function validateCode(
  args: { organizerId: string; eventId: string; text: string; email?: string },
  ex: Executor = db,
): Promise<{ code: CodeRow; error: null } | { code: null; error: string }> {
  const text = args.text.trim().toUpperCase();
  const invalid = { code: null, error: "That code isn't valid" } as const;
  if (!text) return invalid;
  const [code] = await ex
    .select()
    .from(discountCodes)
    .where(and(eq(discountCodes.organizerId, args.organizerId), eq(discountCodes.code, text)));
  if (!code || !code.active) return invalid;
  if (code.expiresOn && code.expiresOn < todayInAppTz()) return { code: null, error: "This code has expired" };

  const scope = await ex.select({ eventId: discountCodeEvents.eventId }).from(discountCodeEvents).where(eq(discountCodeEvents.codeId, code.id));
  if (scope.length && !scope.some((s) => s.eventId === args.eventId)) {
    return { code: null, error: "This code doesn't apply to this show" };
  }
  if (code.maxUses !== null) {
    const uses = (await usesOf([code.id], ex)).get(code.id)?.uses ?? 0;
    if (uses >= code.maxUses) return { code: null, error: "This code has been fully used" };
  }
  if (code.oncePerVendor && args.email) {
    const [used] = await ex
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.discountCodeId, code.id), sql`lower(${bookings.email}) = ${args.email.toLowerCase()}`, countsAsUse))
      .limit(1);
    if (used) return { code: null, error: "You've already used this code" };
  }
  return { code, error: null };
}

/** Whether the owner has any code that could apply to this event (shows the code field on the booking page). */
export async function eventAcceptsCodes(organizerId: string, eventId: string) {
  // Unscoped codes work for every show; scoped ones only for theirs
  const inScope: SQL = or(
    sql`not exists (select 1 from ${discountCodeEvents} where ${discountCodeEvents.codeId} = ${discountCodes.id})`,
    inArray(discountCodes.id, db.select({ codeId: discountCodeEvents.codeId }).from(discountCodeEvents).where(eq(discountCodeEvents.eventId, eventId))),
  )!;
  const [row] = await db
    .select({ id: discountCodes.id })
    .from(discountCodes)
    .where(
      and(
        eq(discountCodes.organizerId, organizerId),
        eq(discountCodes.active, true),
        or(sql`${discountCodes.expiresOn} is null`, sql`${discountCodes.expiresOn} >= ${todayInAppTz()}`),
        inScope,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Price a request, checking the code if one was given. Used for the booking page preview. */
export async function quote(args: {
  event: { id: string; organizerId: string; tablePriceCents: number; bulkDiscounts: BulkDiscountTier[] };
  tableCount: number;
  codeText: string;
  email?: string;
}): Promise<QuoteResponse> {
  const { event } = args;
  const checked = args.codeText
    ? await validateCode({ organizerId: event.organizerId, eventId: event.id, text: args.codeText, email: args.email })
    : null;
  const priced = priceRequest({
    tablePriceCents: event.tablePriceCents,
    tableCount: args.tableCount,
    tiers: event.bulkDiscounts,
    code: checked?.code ?? null,
  });
  return {
    ...priced,
    codeError: checked?.error ?? null,
    codeNotBest: Boolean(checked?.code && priced.source !== "code"),
  };
}
