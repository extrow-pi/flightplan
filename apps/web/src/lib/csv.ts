// Reading and writing CSV files in the browser (vendor export and import).

type Cell = string | number;

/** Build a CSV file. Every cell is quoted, and text that a spreadsheet would run as a formula is neutralized. */
export function toCsv(rows: Cell[][]) {
  const cell = (v: Cell) => {
    const s = String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Save rows as a .csv download. */
export function downloadCsv(filename: string, rows: Cell[][]) {
  // BOM so Excel reads accents (é) correctly
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Red-eye Night Market" → "red-eye-night-market" */
export function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Parse CSV text (RFC 4180: quoted cells, "" escapes, newlines inside quotes) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  // Excel in some locales saves with semicolons
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Column names we recognize for each vendor field, lowercased with spaces and punctuation removed
const columnNames: Record<VendorColumn, string[]> = {
  name: ["name", "contactname", "contact", "fullname", "vendorname", "vendor"],
  businessName: ["business", "businessname", "company", "companyname", "shop", "store", "brand"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "phonenumber", "mobile", "cell", "telephone", "tel"],
  notes: ["notes", "note", "comments", "comment"],
};
type VendorColumn = "name" | "businessName" | "email" | "phone" | "notes";

export type VendorCsvRow = { line: number; name: string; businessName: string; email: string; phone: string; notes: string };

/**
 * Read vendors from a CSV file's text. The first row must name the columns; Name and Email are
 * required, Business, Phone and Notes are optional, and other columns (like an export's Groups) are ignored.
 */
export function readVendorCsv(text: string): { rows: VendorCsvRow[]; error: string | null } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], error: "The file is empty." };
  const header = table[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const index = Object.fromEntries(
    (Object.keys(columnNames) as VendorColumn[]).map((k) => [k, header.findIndex((h) => columnNames[k].includes(h))]),
  ) as Record<VendorColumn, number>;
  const missing = (["name", "email"] as const).filter((k) => index[k] < 0);
  if (missing.length) {
    return {
      rows: [],
      error: `The first row needs ${missing.map((k) => (k === "name" ? "a Name" : "an Email")).join(" and ")} column.`,
    };
  }
  const get = (r: string[], k: VendorColumn) => {
    const v = index[k] >= 0 ? (r[index[k]] ?? "").trim() : "";
    // Undo the apostrophe our export puts in front of text that looks like a formula
    return /^'[=+-@]/.test(v) ? v.slice(1) : v;
  };
  const rows = table
    .slice(1)
    .map((r, i) => ({
      line: i + 2,
      name: get(r, "name"),
      businessName: get(r, "businessName"),
      email: get(r, "email"),
      phone: get(r, "phone"),
      notes: get(r, "notes"),
    }))
    // Skip blank lines (common at the end of spreadsheet exports)
    .filter((r) => r.name || r.email || r.businessName || r.phone || r.notes);
  if (!rows.length) return { rows, error: "The file has a header row but no vendors." };
  return { rows, error: null };
}

/** A starter file with the columns the import reads. */
export function downloadVendorTemplate() {
  downloadCsv("vendor-import-template.csv", [
    ["Name", "Business", "Email", "Phone", "Notes"],
    ["Alex Example", "Alex's Cards", "alex@example.com", "604-555-0123", "Prefers a corner table"],
  ]);
}
