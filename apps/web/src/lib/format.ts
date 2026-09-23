// Event dates are local wall-clock values ("2026-10-25", "11:00"), so parse them as local time.

export function parseDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from today until `date` (0 = today, negative = past). */
export function daysUntil(date: string) {
  return Math.round((parseDate(date).getTime() - parseDate(todayISO()).getTime()) / 86_400_000);
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  return parseDate(date).toLocaleDateString("en-CA", opts);
}

export function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

export function formatMoney(cents: number) {
  if (cents === 0) return "Free";
  return money.format(cents / 100).replace(/\.00$/, "");
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "2pm", "10:30am" */
export function shortTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${suffix}`;
}

/** "2pm–8pm" */
export function timeRange(start: string, end: string) {
  return `${shortTime(start)}–${shortTime(end)}`;
}

/** "Oct 10", or "Oct 10 – 12", or "Oct 31 – Nov 2" */
export function formatDateRange(start: string, end: string) {
  const s = formatDate(start, { month: "short", day: "numeric" });
  if (start === end) return s;
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const e = formatDate(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${s} – ${e}`;
}
