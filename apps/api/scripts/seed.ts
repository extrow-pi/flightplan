// Creates a test organizer account with sample events.
// Talks to the running API over HTTP (so it works with PGlite or Postgres), so start `pnpm dev` first.
//
//   pnpm seed
import "../src/env.js";
import type { EventInput, EventRecord } from "@flightplan/shared";

const WEB_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
const API_URL = `http://localhost:${process.env.API_PORT ?? 3001}/api`;

export const TEST_ORGANIZER = {
  name: "Test Organizer",
  email: "organizer@flightplan.test",
  password: "flightplan-test-2026",
};

let cookie = "";

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(API_URL + path, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", Origin: WEB_URL, ...(cookie && { Cookie: cookie }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** YYYY-MM-DD, `days` from today (local time) */
function inDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The first Friday on or after `days` from today */
function fridayAfter(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return inDays(Math.round((d.getTime() - Date.now()) / 86_400_000));
}

const oneDay = (startTime: string, endTime: string) => [{ dayOffset: 0, startTime, endTime }];

// Fri 2pm–8pm, Sat 10am–6pm, Sun 10am–5pm
const weekend = [
  { dayOffset: 0, startTime: "14:00", endTime: "20:00" },
  { dayOffset: 1, startTime: "10:00", endTime: "18:00" },
  { dayOffset: 2, startTime: "10:00", endTime: "17:00" },
];

const sampleEvents: EventInput[] = [
  {
    name: "Layover Card Show",
    description: "Our monthly Pokémon & sports card show. Singles, sealed, slabs, and a trade night corner.",
    venueName: "RRGC Hall",
    address: "7400 River Rd",
    city: "Richmond, BC",
    startDate: inDays(12),
    days: oneDay("11:00", "16:00"),
    vendorTables: 48,
    tablePriceCents: 8000,
    ticketPriceCents: 500,
    status: "published",
  },
  {
    name: "Red-eye Night Market",
    description: "An evening show with food trucks, trade tables and a sealed-product raffle.",
    venueName: "RRGC Hall",
    address: "7400 River Rd",
    city: "Richmond, BC",
    startDate: inDays(33),
    days: oneDay("19:00", "23:00"),
    vendorTables: 30,
    tablePriceCents: 6000,
    ticketPriceCents: 0,
    status: "published",
  },
  {
    name: "The Dreamliner Show",
    description: "Our biggest show of the year: a full weekend with two halls, 120 vendors and a tournament stage.",
    venueName: "Richmond Curling Centre",
    address: "5540 Hollybridge Way",
    city: "Richmond, BC",
    startDate: fridayAfter(70),
    days: weekend,
    vendorTables: 120,
    tablePriceCents: 12500,
    ticketPriceCents: 1000,
    status: "draft",
  },
  {
    name: "Summer Layover",
    description: "Summer edition of the Layover Card Show.",
    venueName: "RRGC Hall",
    address: "7400 River Rd",
    city: "Richmond, BC",
    startDate: inDays(-40),
    days: oneDay("11:00", "16:00"),
    vendorTables: 40,
    tablePriceCents: 7500,
    ticketPriceCents: 500,
    status: "published",
  },
  {
    name: "Layover Weekend",
    description: "Our three-day weekend format. Use it to plan the next one.",
    venueName: "RRGC Hall",
    address: "7400 River Rd",
    city: "Richmond, BC",
    days: weekend,
    vendorTables: 60,
    tablePriceCents: 15000,
    ticketPriceCents: 800,
    status: "template",
  },
];

async function main() {
  const health = await fetch(`${API_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API isn't reachable at ${API_URL}. Start it with \`pnpm dev\` first.`);
    process.exit(1);
  }

  const signUp = await api<{ code?: string; message?: string }>("/auth/sign-up/email", {
    method: "POST",
    body: TEST_ORGANIZER,
  });
  if (signUp.status === 200) {
    console.log(`Created account ${TEST_ORGANIZER.email}`);
  } else {
    const signIn = await api<{ message?: string }>("/auth/sign-in/email", {
      method: "POST",
      body: { email: TEST_ORGANIZER.email, password: TEST_ORGANIZER.password },
    });
    if (signIn.status !== 200) {
      console.error(`Couldn't create or sign in to ${TEST_ORGANIZER.email}:`, signUp.data?.message, signIn.data?.message);
      process.exit(1);
    }
    console.log(`Account ${TEST_ORGANIZER.email} already exists`);
  }

  // Add any sample events and templates the account doesn't have yet (matched by name)
  const existing = await api<{ events: EventRecord[] }>("/events");
  const names = new Set(existing.data.events.map((e) => e.name));
  const missing = sampleEvents.filter((e) => !names.has(e.name));
  for (const event of missing) {
    const res = await api("/events", { method: "POST", body: event });
    if (res.status !== 201) throw new Error(`Failed to create "${event.name}": ${JSON.stringify(res.data)}`);
  }
  console.log(missing.length ? `Added ${missing.map((e) => e.name).join(", ")}` : "All sample events already exist");

  console.log(`\nLog in at ${WEB_URL}/login\n  Email:    ${TEST_ORGANIZER.email}\n  Password: ${TEST_ORGANIZER.password}`);
}

await main();
