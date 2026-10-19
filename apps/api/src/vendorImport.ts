import { and, eq, inArray } from "drizzle-orm";
import {
  ACTIVE_BOOKING_STATUSES,
  VENDOR_IMPORT_FIELDS,
  vendorImportRowSchema,
  type VendorImportConflict,
  type VendorImportField,
  type VendorImportInput,
  type VendorImportResult,
} from "@flightplan/shared";
import { z } from "zod";
import type { Tx } from "./bookings.js";
import { db, schema } from "./db/index.js";

const { bookings, eventVendors, vendors } = schema;

type Row = z.infer<typeof vendorImportRowSchema>;

/**
 * Import vendors from a CSV file into an organizer's vendor list, matching existing vendors by email.
 * Nothing is ever deleted. Existing vendors keep their details unless their email is in `overwrite`
 * (or it's "all"); even then, blank cells in the file never clear a saved detail.
 *
 * With `eventId`, every imported vendor is also added to that show without a table, unless they're
 * already on it. `canOverwrite` is false for collaborators: they can't see or change the owner's
 * existing vendor records, so existing vendors are just linked and no conflicts are reported.
 */
export async function importVendors(args: {
  organizerId: string;
  input: Required<Pick<VendorImportInput, "rows">> & { overwrite: "all" | string[]; preview: boolean };
  eventId?: string;
  canOverwrite?: boolean;
}): Promise<VendorImportResult> {
  const { organizerId, input, eventId, canOverwrite = true } = args;

  // Check each row; the first row with an email wins over later duplicates
  const invalid: VendorImportResult["invalid"] = [];
  const rows: Row[] = [];
  const firstLine = new Map<string, number>();
  input.rows.forEach((raw, i) => {
    const parsed = vendorImportRowSchema.safeParse({ line: i + 2, ...raw });
    const line = parsed.success ? parsed.data.line : typeof raw.line === "number" ? raw.line : i + 2;
    if (!parsed.success) {
      invalid.push({ line, error: parsed.error.issues[0]?.message ?? "Can't read this row" });
      return;
    }
    const seen = firstLine.get(parsed.data.email);
    if (seen !== undefined) {
      invalid.push({ line, error: `Same email as line ${seen}` });
      return;
    }
    firstLine.set(parsed.data.email, line);
    rows.push(parsed.data);
  });

  const run = async (tx: Tx) => {
    const emails = rows.map((r) => r.email);
    const existing = new Map<string, typeof vendors.$inferSelect>();
    for (const part of chunks(emails, 500)) {
      const found = await tx
        .select()
        .from(vendors)
        .where(and(eq(vendors.organizerId, organizerId), inArray(vendors.email, part)));
      for (const v of found) existing.set(v.email, v);
    }

    const overwriteAll = input.overwrite === "all";
    const overwriteSet = new Set(overwriteAll ? [] : input.overwrite);
    const conflicts: VendorImportConflict[] = [];
    const leftAsIs: VendorImportConflict[] = [];
    const toCreate: Row[] = [];
    let updated = 0;
    let unchanged = 0;

    for (const row of rows) {
      const current = existing.get(row.email);
      if (!current) {
        toCreate.push(row);
        continue;
      }
      const fields = canOverwrite
        ? VENDOR_IMPORT_FIELDS.filter((f) => row[f] !== "" && row[f] !== current[f])
        : [];
      if (!fields.length) {
        unchanged++;
        continue;
      }
      const conflict: VendorImportConflict = {
        email: row.email,
        line: row.line,
        fields,
        current: pick(current),
        incoming: pick(row),
      };
      conflicts.push(conflict);
      if (overwriteAll || overwriteSet.has(row.email)) {
        updated++;
        if (!input.preview) {
          await tx
            .update(vendors)
            .set(Object.fromEntries(fields.map((f) => [f, row[f]])))
            .where(eq(vendors.id, current.id));
        }
      } else {
        unchanged++;
        leftAsIs.push(conflict);
      }
    }

    // New vendors
    const vendorIds = rows.map((r) => existing.get(r.email)?.id).filter((id): id is string => Boolean(id));
    if (!input.preview && toCreate.length) {
      for (const part of chunks(toCreate, 500)) {
        const created = await tx
          .insert(vendors)
          .values(part.map(({ line: _line, ...v }) => ({ organizerId, ...v })))
          .onConflictDoNothing()
          .returning({ id: vendors.id });
        vendorIds.push(...created.map((v) => v.id));
      }
    }

    const result: VendorImportResult = {
      preview: input.preview,
      total: input.rows.length,
      invalid,
      created: toCreate.length,
      updated,
      unchanged,
      conflicts: input.preview ? conflicts : leftAsIs,
    };

    if (eventId) {
      // Already on the show: holding a table there, or added without one
      const onShow = new Set<string>();
      const existingIds = rows.map((r) => existing.get(r.email)?.id).filter((id): id is string => Boolean(id));
      for (const part of chunks(existingIds, 500)) {
        const [held, waiting] = await Promise.all([
          tx
            .selectDistinct({ id: bookings.vendorId })
            .from(bookings)
            .where(
              and(eq(bookings.eventId, eventId), inArray(bookings.vendorId, part), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])),
            ),
          tx
            .select({ id: eventVendors.vendorId })
            .from(eventVendors)
            .where(and(eq(eventVendors.eventId, eventId), inArray(eventVendors.vendorId, part))),
        ]);
        for (const r of [...held, ...waiting]) onShow.add(r.id);
      }
      const toAdd = input.preview
        ? rows.filter((r) => !onShow.has(existing.get(r.email)?.id ?? "")).length
        : vendorIds.filter((id) => !onShow.has(id)).length;
      if (!input.preview) {
        const ids = vendorIds.filter((id) => !onShow.has(id));
        for (const part of chunks(ids, 500)) {
          await tx
            .insert(eventVendors)
            .values(part.map((vendorId) => ({ eventId, vendorId })))
            .onConflictDoNothing();
        }
      }
      result.addedToShow = toAdd;
      result.alreadyAtShow = rows.length - toAdd;
    }
    return result;
  };

  return input.preview ? run(db as unknown as Tx) : db.transaction(run);
}

function pick(v: Record<VendorImportField, string>) {
  return Object.fromEntries(VENDOR_IMPORT_FIELDS.map((f) => [f, v[f]])) as Record<VendorImportField, string>;
}

function chunks<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
