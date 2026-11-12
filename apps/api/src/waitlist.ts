import { and, asc, eq, inArray } from "drizzle-orm";
import { ACTIVE_WAITLIST_STATUSES } from "@flightplan/shared";
import { db, schema } from "./db/index.js";
import type { Tx } from "./bookings.js";

const { waitlistEntries } = schema;

/** Ids of the vendors in line at a show, first in line first. */
export async function waitlistOrder(ex: Tx | typeof db, eventId: string) {
  const rows = await ex
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.eventId, eventId), inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES])))
    .orderBy(asc(waitlistEntries.createdAt), asc(waitlistEntries.id));
  return rows.map((r) => r.id);
}

/** An entry's place in line (1 = next), or null if it isn't in line. */
export async function waitlistPosition(ex: Tx | typeof db, eventId: string, entryId: string) {
  const i = (await waitlistOrder(ex, eventId)).indexOf(entryId);
  return i === -1 ? null : i + 1;
}
