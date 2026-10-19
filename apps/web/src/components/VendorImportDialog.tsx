import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { MAX_IMPORT_ROWS, type VendorImportField, type VendorImportResult } from "@flightplan/shared";
import { CloseIcon, DownloadIcon } from "./Icons";
import { useImportVendors } from "../lib/api";
import { downloadVendorTemplate, readVendorCsv, type VendorCsvRow } from "../lib/csv";

const fieldLabels: Record<VendorImportField, string> = {
  name: "Name",
  businessName: "Business",
  phone: "Phone",
  notes: "Notes",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Import vendors from a CSV file: pick a file, review what will happen (new vendors, rows that can't be
 * read, and existing vendors whose details differ, each with an overwrite checkbox), then import.
 * Into the vendor list by default, or onto a show (`event`), which also adds them without a table.
 */
export default function VendorImportDialog({
  event,
  canOverwrite = true,
  onClose,
}: {
  event?: { id: string; name: string };
  /** Collaborators can't overwrite the owner's vendor records */
  canOverwrite?: boolean;
  onClose: () => void;
}) {
  const importer = useImportVendors(event?.id);
  const [file, setFile] = useState<{ name: string; rows: VendorCsvRow[] } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VendorImportResult | null>(null);
  const [result, setResult] = useState<VendorImportResult | null>(null);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setReadError(null);
    setPreview(null);
    if (picked.size > 5 * 1024 * 1024) return setReadError("That file is over 5 MB. Split it into smaller files.");
    const { rows, error } = readVendorCsv(await picked.text());
    if (error) return setReadError(error);
    if (rows.length > MAX_IMPORT_ROWS) return setReadError(`Up to ${MAX_IMPORT_ROWS} vendors at a time; this file has ${rows.length}.`);
    setFile({ name: picked.name, rows });
    setOverwrite(new Set());
    importer.mutate({ rows, preview: true }, { onSuccess: setPreview });
  }

  function onImport() {
    if (!file || !preview) return;
    const all = preview.conflicts.length > 0 && overwrite.size === preview.conflicts.length;
    importer.mutate({ rows: file.rows, overwrite: all ? "all" : [...overwrite] }, { onSuccess: setResult });
  }

  const conflicts = preview?.conflicts ?? [];
  const allChecked = conflicts.length > 0 && overwrite.size === conflicts.length;
  const someChecked = overwrite.size > 0 && !allChecked;
  const toImport = preview ? preview.total - preview.invalid.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl focus:outline-none sm:p-8"
      >
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="import-title" className="pr-8 text-2xl font-extrabold">
          {event ? `Import vendors to ${event.name}` : "Import vendors"}
        </h2>

        {result ? (
          <Done result={result} event={event} onClose={onClose} />
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-soft">
              {event
                ? "Vendors in the file are added to this show without a table, and to your vendor list. "
                : "Vendors in the file are added to your vendor list. "}
              Nothing is deleted, and vendors already in your list are matched by email.
            </p>

            <div className="mt-5 rounded-2xl bg-cream-50 p-4 text-sm ring-1 ring-ink/5">
              <p>
                <strong>CSV file</strong> with a header row. <strong>Name</strong> and <strong>Email</strong> are required;{" "}
                <strong>Business</strong>, <strong>Phone</strong> and <strong>Notes</strong> are optional. An export from the
                Vendors page works as-is.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center rounded-full bg-slate px-4 py-2 font-bold text-white transition hover:bg-slate/90 focus-within:ring-4 focus-within:ring-coral/30">
                  {file ? "Choose another file" : "Choose CSV file"}
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
                </label>
                <button type="button" onClick={downloadVendorTemplate} className="inline-flex items-center gap-1.5 font-bold text-coral-ink hover:underline">
                  <DownloadIcon className="size-4" /> Template
                </button>
              </div>
              {file && <p className="mt-2 truncate text-ink-soft">{file.name}</p>}
            </div>

            {readError && <Alert>{readError}</Alert>}
            {importer.isPending && !preview && (
              <p className="mt-4 text-sm text-ink-muted" role="status">
                Checking the file…
              </p>
            )}
            {importer.error && <Alert>{importer.error.message}</Alert>}

            {preview && (
              <div className="mt-5 space-y-4" aria-live="polite">
                <ul className="space-y-1 text-sm">
                  <Summary n={preview.created} text="new to your vendor list" />
                  <Summary n={preview.unchanged - conflicts.length} text="already in your list, nothing to change" />
                  {conflicts.length > 0 && <Summary n={conflicts.length} text="already in your list with different details" tone="warn" />}
                  {event && <Summary n={preview.addedToShow ?? 0} text={`to add to ${event.name} without a table`} />}
                  {event && (preview.alreadyAtShow ?? 0) > 0 && <Summary n={preview.alreadyAtShow!} text="already at this show" />}
                  {preview.invalid.length > 0 && <Summary n={preview.invalid.length} text="can't be imported" tone="bad" />}
                </ul>

                {preview.invalid.length > 0 && (
                  <details className="rounded-2xl bg-peach/50 px-4 py-3 text-sm">
                    <summary className="cursor-pointer font-bold text-coral-ink">Rows that will be skipped</summary>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                      {preview.invalid.map((r) => (
                        <li key={r.line}>
                          <span className="font-semibold">Line {r.line}:</span> {r.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {conflicts.length > 0 && (
                  <section aria-labelledby="conflicts-title">
                    <h3 id="conflicts-title" className="font-bold">
                      Overwrite existing vendors?
                    </h3>
                    <p className="text-sm text-ink-soft">
                      Ticked vendors get the file's details. Blank cells in the file never clear what's saved.
                    </p>
                    <label className="mt-3 flex items-center gap-2 rounded-xl bg-cream-50 px-3 py-2 text-sm font-bold ring-1 ring-ink/5">
                      <input
                        type="checkbox"
                        className="size-4 accent-coral"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked;
                        }}
                        onChange={() => setOverwrite(allChecked ? new Set() : new Set(conflicts.map((c) => c.email)))}
                      />
                      Overwrite all {plural(conflicts.length, "conflicting record")}
                    </label>
                    <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                      {conflicts.map((c) => {
                        const on = overwrite.has(c.email);
                        return (
                          <li key={c.email} className={`rounded-xl px-3 py-2 text-sm ring-1 ${on ? "ring-coral" : "ring-ink/10"}`}>
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 shrink-0 accent-coral"
                                checked={on}
                                onChange={() =>
                                  setOverwrite((s) => {
                                    const next = new Set(s);
                                    if (on) next.delete(c.email);
                                    else next.add(c.email);
                                    return next;
                                  })
                                }
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-bold break-all">
                                  {c.current.name} · {c.email}
                                  <span className="font-normal text-ink-muted"> (line {c.line})</span>
                                </span>
                                {c.fields.map((f) => (
                                  <span key={f} className="mt-0.5 block break-words text-ink-soft">
                                    <span className="font-semibold">{fieldLabels[f]}:</span>{" "}
                                    <span className={on ? "line-through" : ""}>{c.current[f] || "(blank)"}</span> →{" "}
                                    <span className={on ? "font-semibold text-ink" : ""}>{c.incoming[f]}</span>
                                  </span>
                                ))}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {!canOverwrite && (
                  <p className="text-xs text-ink-muted">
                    Vendors already in the owner's list keep their saved details; only the owner can overwrite them.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="rounded-full px-5 py-3 font-bold text-ink-soft hover:bg-cream">
                Cancel
              </button>
              <button
                type="button"
                onClick={onImport}
                disabled={!preview || importer.isPending || toImport === 0}
                className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white disabled:opacity-50"
              >
                {importer.isPending && preview ? "Importing…" : preview ? `Import ${plural(toImport, "vendor")}` : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Done({ result, event, onClose }: { result: VendorImportResult; event?: { name: string }; onClose: () => void }) {
  return (
    <>
      <p className="mt-1 text-sm text-ink-soft" role="status">
        Import finished.
      </p>
      <ul className="mt-4 space-y-1 text-sm">
        <Summary n={result.created} text="added to your vendor list" />
        {result.updated > 0 && <Summary n={result.updated} text="existing vendors updated" />}
        {result.unchanged > 0 && <Summary n={result.unchanged} text="already in your list, kept as they were" />}
        {event && <Summary n={result.addedToShow ?? 0} text={`added to ${event.name} without a table`} />}
        {event && (result.alreadyAtShow ?? 0) > 0 && <Summary n={result.alreadyAtShow!} text="were already at this show" />}
        {result.invalid.length > 0 && <Summary n={result.invalid.length} text="rows skipped" tone="bad" />}
      </ul>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white">
          Done
        </button>
      </div>
    </>
  );
}

function Summary({ n, text, tone }: { n: number; text: string; tone?: "warn" | "bad" }) {
  if (n <= 0 && !tone) return null;
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={`min-w-9 rounded-full px-2 py-0.5 text-center text-xs font-extrabold ${
          tone === "bad" ? "bg-coral-ink text-white" : tone === "warn" ? "bg-[#fff4cc] text-gold-ink" : "bg-cream text-ink"
        }`}
      >
        {n}
      </span>
      <span>{text}</span>
    </li>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
      {children}
    </p>
  );
}
