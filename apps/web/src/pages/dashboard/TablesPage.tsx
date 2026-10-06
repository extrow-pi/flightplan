import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  MAX_TABLES_PER_REQUEST,
  PAYMENT_METHODS,
  priceRequest,
  paymentMethodLabels,
  type Booking,
  type EventRecord,
  type EventTable,
  type Invite,
  type PaymentMethod,
  type UnassignedVendor,
  type Vendor,
} from "@flightplan/shared";
import {
  BookingActions,
  closedLabel,
  paymentDueLabel,
  ReleaseTableButton,
  sourceLabels,
  TABLE_STATES,
  tableState,
  TableStateBadge,
  tableStateLabel,
} from "../../components/bookings";
import { canEdit, EventTabs, isPast, SharedBadge } from "../../components/events";
import BannedBadge from "../../components/BannedBadge";
import CopyButton from "../../components/CopyButton";
import { ArrowLeftIcon, CheckIcon, CloseIcon, SearchIcon, StarIcon } from "../../components/Icons";
import {
  ApiRequestError,
  eventToInput,
  useAddEventVendor,
  useAssignTable,
  useRemoveEventVendor,
  useCreateInvite,
  useEvent,
  useEventTables,
  useRevokeInvite,
  useBulkInvite,
  useEventVendors,
  useSaveEvent,
  useVendorGroups,
} from "../../lib/api";
import { formatMoney } from "../../lib/format";

type Filter = "all" | "unassigned" | ReturnType<typeof tableState>;

export default function TablesPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const tables = useEventTables(event && event.status !== "template" ? id : undefined);
  // The owner's vendor list, for searching vendors who aren't at this show yet (editors only)
  const vendorList = useEventVendors(id ?? "", Boolean(event && event.status !== "template" && canEdit(event)));
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"vendors" | "tables">("vendors");
  const [query, setQuery] = useState("");
  // A request to point out after clicking "Review" in the table view
  const [highlight, setHighlight] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ tableId?: string; vendorId?: string } | null>(null);
  const [adding, setAdding] = useState<{ vendorId?: string } | null>(null);

  if (isPending) return <p className="text-ink-muted" role="status">Loading…</p>;
  if (error || !event) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
        <p className="text-lg font-extrabold">
          {error instanceof ApiRequestError && error.status === 404 ? "Event not found" : "Couldn't load this event"}
        </p>
        <Link to="/dashboard/events" className="mt-4 inline-block font-bold text-coral-ink hover:underline">
          Back to events
        </Link>
      </div>
    );
  }

  // Viewers see everything but can't change bookings
  const editable = canEdit(event);
  const past = isPast(event);
  const all = tables.data?.tables ?? [];
  const unassigned = tables.data?.unassigned ?? [];
  const requests = groupRequests(all);
  const available = all.filter((t) => !t.booking);
  const atShow = vendorsAtShow(requests, unassigned);

  // Search by vendor name, business, email, phone or table label
  const q = query.trim().toLowerCase();
  const hit = (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));
  const bookingFields = (b: Booking) => [b.name, b.businessName, b.email, b.phone];
  const shownRequests = requests.filter((r) => hit(...bookingFields(r.booking), ...r.tables.map((t) => t.table.label)));
  const shownTables = all.filter((t) => hit(t.label, ...(t.booking ? bookingFields(t.booking) : [])));
  const shownUnassigned = unassigned.filter((u) => hit(u.name, u.businessName, u.email, u.phone, u.note));
  // Vendors from the list who match the search but aren't at this show at all
  const elsewhere =
    q && editable && !past
      ? (vendorList.data ?? []).filter((v) => !atShow.has(v.id) && hit(v.name, v.businessName, v.email, v.phone)).slice(0, 5)
      : [];

  // Filters count tables in the table view and vendors in the vendor view
  const stateOf = (x: EventTable | VendorRequest) => ("requestId" in x ? x.state : tableState(x.booking));
  const items: (EventTable | VendorRequest)[] = view === "tables" ? shownTables : shownRequests;
  const filters = (["all", ...TABLE_STATES, "unassigned"] as Filter[]).filter((f) =>
    view === "vendors" ? f !== "available" : f !== "unassigned",
  );
  const count = (f: Filter) =>
    f === "unassigned"
      ? shownUnassigned.length
      : f === "all"
        ? items.length + (view === "vendors" ? shownUnassigned.length : 0)
        : items.filter((x) => stateOf(x) === f).length;
  const activeFilter = filters.includes(filter) ? filter : "all";
  const matches = (x: EventTable | VendorRequest) => activeFilter === "all" || stateOf(x) === activeFilter;
  const showUnassigned = activeFilter === "all" || activeFilter === "unassigned";
  const vendorCount = requests.length + unassigned.length;
  const nothingShown =
    view === "vendors" ? !shownRequests.some(matches) && !(showUnassigned && shownUnassigned.length) : !shownTables.some(matches);

  function reviewRequest(requestId: string) {
    setView("vendors");
    setFilter("all");
    setQuery("");
    setHighlight(requestId);
    // Wait for the vendor view to render, then bring the card into view
    requestAnimationFrame(() =>
      document.getElementById(`request-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  const actionButtons = (className: string) =>
    editable && (
      <div className={className}>
        <button
          type="button"
          onClick={() => setAssigning({})}
          disabled={!available.length || past}
          className="w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
        >
          Assign tables
        </button>
        <button
          type="button"
          onClick={() => setAdding({})}
          disabled={past}
          className="w-full rounded-full border-2 border-slate/30 bg-white px-6 py-2.5 font-bold text-slate transition hover:border-slate disabled:opacity-50"
        >
          Add vendor without a table
        </button>
      </div>
    );

  return (
    <>
      <Link
        to="/dashboard/events"
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" /> All events
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
        <SharedBadge event={event} />
      </div>
      <EventTabs event={event} />

      {tables.error ? (
        <p className="mt-6 rounded-2xl bg-peach px-5 py-4 font-semibold text-coral-ink" role="alert">
          Couldn't load tables: {tables.error.message}
        </p>
      ) : tables.isPending ? (
        <p className="mt-6 text-ink-muted" role="status">
          Loading tables…
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {/* On phones the side panel sits below the list, so keep the main actions in reach */}
            {actionButtons("grid gap-2 sm:grid-cols-2 lg:hidden")}

            <label className="relative block">
              <span className="sr-only">Search vendors and tables</span>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vendors or tables"
                className="w-full rounded-full border-2 border-cream bg-white py-2.5 pr-4 pl-10 text-ink placeholder:text-ink-muted/70 focus:border-coral focus:outline-none"
              />
            </label>

            <div className="flex w-fit gap-1 rounded-full bg-white p-1 ring-1 ring-ink/10" role="radiogroup" aria-label="View">
              {(
                [
                  ["vendors", `By vendor (${vendorCount})`],
                  ["tables", `By table (${all.length})`],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
                    view === v ? "bg-slate text-white" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Filters double as the summary */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter">
              {filters.map((f) => {
                const n = count(f);
                if (f !== "all" && f !== "available" && !n) return null;
                const active = f === activeFilter;
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(f)}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
                      active ? "bg-slate text-white" : "bg-white text-ink-soft ring-1 ring-ink/10 hover:text-ink"
                    }`}
                  >
                    {f === "all"
                      ? view === "tables"
                        ? "All tables"
                        : "All vendors"
                      : f === "unassigned"
                        ? "No table yet"
                        : tableStateLabel(f)}
                    <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20" : "bg-cream"}`}>{n}</span>
                  </button>
                );
              })}
            </div>

            {elsewhere.length > 0 && (
              <section className="rounded-3xl bg-white p-5 ring-1 ring-ink/5" aria-labelledby="elsewhere-title">
                <h2 id="elsewhere-title" className="text-sm font-bold text-ink-soft">
                  Not at this show yet
                </h2>
                <ul className="mt-2 divide-y divide-ink/5">
                  {elsewhere.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">
                          {v.favourite && (
                            <StarIcon className="mr-1 inline size-4 text-gold-ink" fill="currentColor" aria-label="Favourite" role="img" />
                          )}
                          {v.name}
                          {v.businessName && <span className="font-semibold text-ink-soft"> · {v.businessName}</span>}
                        </p>
                        <p className="truncate text-sm text-ink-soft">{v.email}</p>
                      </div>
                      {v.banned && <BannedBadge />}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAdding({ vendorId: v.id })}
                          className="rounded-full border-2 border-slate/30 px-3.5 py-1 text-sm font-bold text-slate transition hover:border-slate"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssigning({ vendorId: v.id })}
                          disabled={!available.length}
                          className="rounded-full bg-coral px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-coral-deep disabled:opacity-50"
                        >
                          Assign
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {all.length === 0 && view === "tables" ? (
              <p className="rounded-3xl bg-white p-6 text-ink-soft ring-1 ring-ink/5">
                This event has no vendor tables yet. Set the number of tables on the{" "}
                <Link to={`/dashboard/events/${event.id}`} className="font-bold text-coral-ink hover:underline">
                  Details
                </Link>{" "}
                tab.
              </p>
            ) : view === "vendors" ? (
              <div className="space-y-3">
                {shownRequests.filter(matches).map((r) => (
                  <RequestCard
                    key={r.requestId}
                    request={r}
                    event={event}
                    highlighted={r.requestId === highlight}
                    editable={editable}
                    flags={tables.data.vendorFlags[r.booking.vendorId]}
                  />
                ))}
                {showUnassigned &&
                  shownUnassigned.map((u) => (
                    <UnassignedCard
                      key={u.vendorId}
                      vendor={u}
                      event={event}
                      editable={editable}
                      canAssign={available.length > 0 && !past}
                      flags={tables.data.vendorFlags[u.vendorId]}
                      onAssign={() => setAssigning({ vendorId: u.vendorId })}
                      onEdit={() => setAdding({ vendorId: u.vendorId })}
                    />
                  ))}
                {vendorCount === 0 ? (
                  <p className="rounded-3xl bg-white p-6 text-center text-ink-soft ring-1 ring-ink/5">
                    No vendors yet. Share the booking link, assign a table or add a vendor to get started.
                  </p>
                ) : (
                  nothingShown && (
                    <p className="rounded-3xl bg-white p-6 text-center text-ink-soft ring-1 ring-ink/5">
                      {q ? `No vendors at this show match “${query.trim()}”.` : "No vendors match this filter."}
                    </p>
                  )
                )}
              </div>
            ) : (
              <ul className="divide-y divide-ink/5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
                {shownTables.filter(matches).map((t) => (
                  <TableRow
                    key={t.id}
                    table={t}
                    event={event}
                    requestSize={
                      t.booking ? (requests.find((r) => r.requestId === t.booking!.requestId)?.tables.length ?? 1) : 0
                    }
                    editable={editable}
                    onAssign={() => setAssigning({ tableId: t.id })}
                    onReview={() => t.booking && reviewRequest(t.booking.requestId)}
                  />
                ))}
                {nothingShown && <li className="p-6 text-center text-ink-soft">No tables match {q ? "your search" : "this filter"}.</li>}
              </ul>
            )}

            {tables.data.history.length > 0 && (
              <details className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
                <summary className="cursor-pointer font-bold">Past requests ({tables.data.history.length})</summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {tables.data.history.map((b) => (
                    <li key={b.id} className="flex flex-wrap justify-between gap-2 text-ink-soft">
                      <span>
                        <strong className="text-ink">{b.name}</strong>
                        {b.businessName && ` · ${b.businessName}`} · table{" "}
                        {all.find((t) => t.id === b.tableId)?.label ?? "(removed)"}
                      </span>
                      <span>
                        {closedLabel(b.status)}{" "}
                        {b.closedAt && new Date(b.closedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="space-y-6">
            {editable ? (
              actionButtons("hidden space-y-2 lg:block")
            ) : (
              <p className="rounded-2xl bg-sky/15 px-4 py-3 text-sm font-semibold text-slate" role="status">
                You have view-only access. Ask {event.access.ownerName} to make you an editor to manage bookings.
              </p>
            )}
            <BookingLinkCard event={event} editable={editable} />
            <InvitesCard event={event} invites={tables.data.invites} editable={editable} />
            <FloorMapCard event={event} />
          </aside>
        </div>
      )}

      {assigning && (
        <AssignDialog
          event={event}
          tables={all}
          atShow={atShow}
          initialTableId={assigning.tableId}
          initialVendorId={assigning.vendorId}
          onClose={() => setAssigning(null)}
        />
      )}
      {adding && (
        <AddVendorDialog
          event={event}
          atShow={atShow}
          unassigned={unassigned}
          initialVendorId={adding.vendorId}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  );
}

// ── Who's at the show ────────────────────────────────────────────────────

/** Where a vendor stands at this show: the tables they hold, or added without a table yet. */
type VendorAtShow = { tables: string[]; state: ReturnType<typeof tableState> | "unassigned" };

function vendorsAtShow(requests: VendorRequest[], unassigned: UnassignedVendor[]) {
  const map = new Map<string, VendorAtShow>();
  for (const r of requests) {
    const existing = map.get(r.booking.vendorId);
    const labels = r.tables.map((t) => t.table.label);
    // Requests come sorted most urgent first, so the first state seen is the one to show
    if (existing) existing.tables.push(...labels);
    else map.set(r.booking.vendorId, { tables: labels, state: r.state });
  }
  for (const u of unassigned) if (!map.has(u.vendorId)) map.set(u.vendorId, { tables: [], state: "unassigned" });
  return map;
}

/** "Tables 3, 4 · Paid" or "No table yet" */
function atShowLabel(s: VendorAtShow) {
  if (s.state === "unassigned") return "No table yet";
  return `${s.tables.length > 1 ? "Tables" : "Table"} ${s.tables.join(", ")} · ${tableStateLabel(s.state)}`;
}

function AtShowBadge({ status }: { status: VendorAtShow }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
        status.state === "unassigned" ? "bg-cream text-ink-soft" : "bg-slate text-white"
      }`}
    >
      {atShowLabel(status)}
    </span>
  );
}

// ── Vendor requests ──────────────────────────────────────────────────────

/** A vendor's request: one or more tables booked together, sharing status and deadline. */
type VendorRequest = {
  requestId: string;
  /** Representative booking (all bookings in a request share vendor, status and deadline) */
  booking: Booking;
  /** The request's tables that are still held, in floor order */
  tables: { table: EventTable; booking: Booking }[];
  state: ReturnType<typeof tableState>;
};

// Requests needing a decision come first
const stateOrder: Record<ReturnType<typeof tableState>, number> = {
  overdue: 0,
  pending: 1,
  awaiting_payment: 2,
  paid: 3,
  available: 4,
};

function groupRequests(tables: EventTable[]): VendorRequest[] {
  const byId = new Map<string, VendorRequest>();
  for (const t of tables) {
    const b = t.booking;
    if (!b) continue;
    const existing = byId.get(b.requestId);
    if (existing) existing.tables.push({ table: t, booking: b });
    else {
      byId.set(b.requestId, { requestId: b.requestId, booking: b, tables: [{ table: t, booking: b }], state: tableState(b) });
    }
  }
  return [...byId.values()].sort(
    (a, b) => stateOrder[a.state] - stateOrder[b.state] || a.booking.createdAt.localeCompare(b.booking.createdAt),
  );
}

function RequestCard({
  request,
  event,
  highlighted,
  editable,
  flags,
}: {
  request: VendorRequest;
  event: EventRecord;
  highlighted: boolean;
  editable: boolean;
  /** The vendor's favourite / banned flags from the owner's vendor list */
  flags?: { favourite: boolean; banned: boolean };
}) {
  const { booking: b, tables } = request;
  const due = paymentDueLabel(b);
  const labels = tables.map((t) => t.table.label);
  const multiple = tables.length > 1;

  return (
    <article
      id={`request-${request.requestId}`}
      className={`rounded-3xl bg-white p-5 shadow-sm transition ${
        highlighted
          ? "ring-2 ring-coral"
          : request.state === "overdue" || flags?.banned
            ? "ring-2 ring-coral-ink/40"
            : "ring-1 ring-ink/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-extrabold">
            {flags?.favourite && (
              <StarIcon className="size-4 text-gold-ink" fill="currentColor" aria-label="Favourite" role="img" />
            )}
            <span>
              {b.name}
              {b.businessName && <span className="font-semibold text-ink-soft"> · {b.businessName}</span>}
            </span>
            {flags?.banned && <BannedBadge />}
          </h3>
          <p className="mt-0.5 text-sm break-words text-ink-soft">
            <a href={`mailto:${b.email}`} className="hover:underline">
              {b.email}
            </a>
            {b.phone && ` · ${b.phone}`} · {sourceLabels[b.source]}
          </p>
        </div>
        <TableStateBadge state={request.state} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink-soft">{multiple ? `${tables.length} tables:` : "Table:"}</span>
        {tables.map(({ table, booking }) => (
          <span
            key={table.id}
            className={`inline-flex items-center rounded-lg bg-slate py-1 pl-2.5 text-sm font-extrabold text-white ${multiple ? "pr-1" : "pr-2.5"}`}
          >
            {table.label}
            {/* Release one table of a multi-table request; releasing them all is in the actions below */}
            {multiple && editable && (
              <ReleaseTableButton bookingId={booking.id} eventId={event.id} tableLabel={table.label} compact />
            )}
          </span>
        ))}
        {tables.some((t) => t.booking.basePriceCents > 0) && (
          <span className="ml-auto text-right text-sm font-bold text-ink-soft">
            {formatMoney(tables.reduce((n, t) => n + t.booking.priceCents, 0))}
            {b.discountLabel && <span className="block text-xs font-semibold text-[#2d7a6a]">{b.discountLabel}</span>}
          </span>
        )}
      </div>

      {(due || b.message) && (
        <div className="mt-2 space-y-0.5 text-sm text-ink-soft">
          {due && <p className={b.overdue ? "font-bold text-coral-ink" : ""}>{due}</p>}
          {b.message && <p className="italic">“{b.message}”</p>}
        </div>
      )}

      {editable && (
        <div className="mt-4 border-t border-ink/5 pt-3">
          <BookingActions booking={b} eventId={event.id} paymentDueDays={event.paymentDueDays} requestTables={labels} />
        </div>
      )}
    </article>
  );
}

// ── Tables (floor view) ──────────────────────────────────────────────────

function TableRow({
  table,
  event,
  requestSize,
  editable,
  onAssign,
  onReview,
}: {
  table: EventTable;
  event: EventRecord;
  /** How many tables this table's request holds */
  requestSize: number;
  editable: boolean;
  onAssign: () => void;
  onReview: () => void;
}) {
  const b = table.booking;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl font-extrabold ${
          b ? "bg-slate text-white" : "bg-sky/20 text-slate"
        }`}
        title={`Table ${table.label}`}
      >
        {table.label}
      </span>
      <div className="min-w-0 flex-1">
        {b ? (
          <p className="truncate font-bold">
            {b.businessName || b.name}
            {requestSize > 1 && <span className="font-semibold text-ink-muted"> · 1 of {requestSize} tables</span>}
          </p>
        ) : (
          <p className="font-semibold text-ink-muted">Open table</p>
        )}
      </div>
      <TableStateBadge state={tableState(b)} />
      <div className="flex min-w-24 justify-end">
        {!editable ? null : !b ? (
          !isPast(event) && (
            <button
              type="button"
              onClick={onAssign}
              className="rounded-full border-2 border-slate/30 px-3.5 py-1 text-sm font-bold text-slate transition hover:border-slate"
            >
              Assign
            </button>
          )
        ) : b.status === "pending" || b.overdue ? (
          // Decisions happen on the vendor's request card
          <button
            type="button"
            onClick={onReview}
            className="rounded-full bg-coral px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-coral-deep"
          >
            Review
          </button>
        ) : (
          <ReleaseTableButton bookingId={b.id} eventId={event.id} tableLabel={table.label} />
        )}
      </div>
    </li>
  );
}

// ── Side cards ───────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-extrabold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BookingLinkCard({ event, editable }: { event: EventRecord; editable: boolean }) {
  const save = useSaveEvent(event.id);
  const url = `${window.location.origin}/book/${event.bookingToken}`;
  const works = event.bookingOpen && event.status === "published" && !isPast(event);

  return (
    <Card title="Public booking link">
      <p className="text-sm text-ink-soft">Share it anywhere. Vendors pick an open table on the map and send their details.</p>
      <p className="mt-3 truncate rounded-xl bg-cream-50 px-3 py-2 font-mono text-xs text-ink-soft ring-1 ring-ink/5" title={url}>
        {url}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyButton text={url} />
        <a href={url} target="_blank" rel="noreferrer" className="text-sm font-bold text-coral-ink hover:underline">
          Preview
        </a>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-cream-50 px-4 py-3 ring-1 ring-ink/5">
        <span className={`text-sm font-bold ${works ? "text-[#2d7a6a]" : "text-ink-soft"}`}>
          {works
            ? "Taking bookings"
            : event.status !== "published"
              ? "Publish the event to use this link"
              : isPast(event)
                ? "This show is over"
                : "Link is closed"}
        </span>
        {editable && event.status === "published" && !isPast(event) && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ ...eventToInput(event), bookingOpen: !event.bookingOpen })}
            className="rounded-full bg-slate px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-slate-deep disabled:opacity-60"
          >
            {event.bookingOpen ? "Close" : "Open"}
          </button>
        )}
      </div>
      {save.error && (
        <p className="mt-2 text-sm font-semibold text-coral-ink" role="alert">
          {save.error.message}
        </p>
      )}
    </Card>
  );
}

function InvitesCard({ event, invites, editable }: { event: EventRecord; invites: Invite[]; editable: boolean }) {
  const create = useCreateInvite(event.id);
  const revoke = useRevokeInvite(event.id);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name, email },
      {
        onSuccess: (invite) => {
          setName("");
          setEmail("");
          setFresh(invite.id);
        },
      },
    );
  }

  return (
    <Card title="Personal invites">
      <p className="text-sm text-ink-soft">
        A single-use link for one vendor. It works even while the public link is closed.
      </p>
      {editable && (
      <form onSubmit={onSubmit} className="mt-3 space-y-2">
        <input
          className={smallInput}
          placeholder="Vendor name (optional)"
          aria-label="Vendor name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={smallInput}
          type="email"
          placeholder="Email (optional, pre-fills their form)"
          aria-label="Vendor email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={create.isPending || isPast(event)}
          className="w-full rounded-full border-2 border-coral px-4 py-2 text-sm font-bold text-coral-ink transition hover:bg-coral hover:text-white disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create invite link"}
        </button>
        {create.error && (
          <p className="text-sm font-semibold text-coral-ink" role="alert">
            {create.error.message}
          </p>
        )}
      </form>
      )}

      {event.access.role === "owner" && !isPast(event) && <GroupInvite event={event} />}

      {invites.length > 0 && (
        <ul className="mt-4 space-y-2">
          {invites.map((inv) => {
            const status = inv.revokedAt ? "Cancelled" : inv.bookingId ? "Used" : "Not used yet";
            return (
              <li
                key={inv.id}
                className={`rounded-2xl px-3 py-2.5 text-sm ring-1 ${inv.id === fresh ? "bg-[#e8f8f5] ring-[#2d7a6a]/30" : "bg-cream-50 ring-ink/5"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-bold">{inv.name || inv.email || "Unnamed invite"}</span>
                  <span className="shrink-0 text-xs font-semibold text-ink-muted">{status}</span>
                </div>
                {inv.name && inv.email && <p className="truncate text-xs text-ink-soft">{inv.email}</p>}
                {!inv.revokedAt && !inv.bookingId && (
                  <div className="mt-2 flex items-center gap-2">
                    <CopyButton text={inviteUrl(inv.token)} />
                    {editable && (
                    <button
                      type="button"
                      onClick={() => revoke.mutate(inv.id)}
                      disabled={revoke.isPending}
                      className="rounded-full px-2.5 py-1 text-xs font-bold text-coral-ink hover:bg-peach disabled:opacity-60"
                    >
                      Cancel invite
                    </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Send everyone in a vendor group (or all favourites) their own invite link by email. Owner only. */
function GroupInvite({ event }: { event: EventRecord }) {
  const groups = useVendorGroups();
  const bulk = useBulkInvite(event.id);
  const [target, setTarget] = useState("favourites");
  const r = bulk.data;
  const skippedBy = (reason: string) => r?.skipped.filter((x) => x.reason === reason).length ?? 0;

  return (
    <div className="mt-4 border-t border-ink/5 pt-4">
      <p className="text-sm font-bold">Invite a group</p>
      <p className="text-xs text-ink-soft">Everyone gets their own link by email. Banned and already-booked vendors are skipped.</p>
      <div className="mt-2 flex gap-2">
        <select
          aria-label="Vendor group"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            bulk.reset();
          }}
          className="min-w-0 flex-1 rounded-xl border-2 border-cream bg-white px-2 py-1.5 text-base focus:border-coral focus:outline-none sm:text-sm"
        >
          <option value="favourites">★ Favourites</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.vendorCount})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => bulk.mutate(target)}
          disabled={bulk.isPending}
          className="rounded-full bg-slate px-3.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {bulk.isPending ? "Sending…" : "Send"}
        </button>
      </div>
      {r && (
        <p className="mt-2 rounded-xl bg-[#e8f8f5] px-3 py-2 text-xs font-semibold text-[#2d7a6a]" role="status">
          {r.invited ? `Invited ${r.invited} vendor${r.invited > 1 ? "s" : ""}.` : "No new invites sent."}
          {r.skipped.length > 0 &&
            ` Skipped ${[
              skippedBy("invited") && `${skippedBy("invited")} already invited`,
              skippedBy("booked") && `${skippedBy("booked")} already booked`,
              skippedBy("banned") && `${skippedBy("banned")} banned`,
            ]
              .filter(Boolean)
              .join(", ")}.`}
        </p>
      )}
      {bulk.error && (
        <p className="mt-2 text-xs font-semibold text-coral-ink" role="alert">
          {bulk.error.message}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-muted">
        Manage groups on the{" "}
        <Link to="/dashboard/vendors" className="font-bold text-coral-ink hover:underline">
          Vendors
        </Link>{" "}
        page.
      </p>
    </div>
  );
}

function FloorMapCard({ event }: { event: EventRecord }) {
  return (
    <Card title="Floor map">
      {event.floorMapUrl ? (
        <a href={event.floorMapUrl} target="_blank" rel="noreferrer" title="Open full size" className="block overflow-hidden rounded-2xl ring-1 ring-ink/10">
          <img src={event.floorMapUrl} alt={`Floor map for ${event.name}`} className="w-full bg-cream-50 object-contain" />
        </a>
      ) : (
        <p className="text-sm text-ink-soft">
          No floor map yet.{" "}
          <Link to={`/dashboard/events/${event.id}`} className="font-bold text-coral-ink hover:underline">
            Upload one on the Details tab
          </Link>{" "}
          so vendors can see where each table is.
        </p>
      )}
    </Card>
  );
}

// ── Vendors without a table ──────────────────────────────────────────────

function UnassignedCard({
  vendor: u,
  event,
  editable,
  canAssign,
  flags,
  onAssign,
  onEdit,
}: {
  vendor: UnassignedVendor;
  event: EventRecord;
  editable: boolean;
  canAssign: boolean;
  flags?: { favourite: boolean; banned: boolean };
  onAssign: () => void;
  onEdit: () => void;
}) {
  const remove = useRemoveEventVendor(event.id);
  const [confirming, setConfirming] = useState(false);

  return (
    <article className={`rounded-3xl bg-white p-5 shadow-sm ${flags?.banned ? "ring-2 ring-coral-ink/40" : "ring-1 ring-ink/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-extrabold">
            {flags?.favourite && (
              <StarIcon className="size-4 text-gold-ink" fill="currentColor" aria-label="Favourite" role="img" />
            )}
            <span>
              {u.name}
              {u.businessName && <span className="font-semibold text-ink-soft"> · {u.businessName}</span>}
            </span>
            {flags?.banned && <BannedBadge />}
          </h3>
          <p className="mt-0.5 text-sm break-words text-ink-soft">
            <a href={`mailto:${u.email}`} className="hover:underline">
              {u.email}
            </a>
            {u.phone && ` · ${u.phone}`} · Added {new Date(u.addedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
          </p>
        </div>
        <span className="rounded-full bg-cream px-2.5 py-1 text-xs font-bold whitespace-nowrap text-ink-soft">No table yet</span>
      </div>
      {u.note && <p className="mt-2 text-sm text-ink-soft italic">{u.note}</p>}

      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/5 pt-3">
          {confirming ? (
            <>
              <span className="text-sm font-semibold">Take {u.name} off this show?</span>
              <button
                type="button"
                onClick={() => remove.mutate(u.vendorId)}
                disabled={remove.isPending}
                className="rounded-full bg-coral-ink px-3.5 py-1.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {remove.isPending ? "Removing…" : "Remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-full px-3.5 py-1.5 text-sm font-bold text-ink-soft hover:bg-cream"
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onAssign}
                disabled={!canAssign}
                className="rounded-full bg-coral px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-coral-deep disabled:opacity-50"
              >
                Assign tables
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-full px-3.5 py-1.5 text-sm font-bold text-ink-soft hover:bg-cream"
              >
                Edit note
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-full px-3.5 py-1.5 text-sm font-bold text-coral-ink hover:bg-peach"
              >
                Remove from show
              </button>
            </>
          )}
          {remove.error && (
            <p className="w-full text-sm font-semibold text-coral-ink" role="alert">
              {remove.error.message}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// ── Picking a vendor ─────────────────────────────────────────────────────

/** Search the vendor list and pick one. Each vendor shows where they stand at this show. */
function VendorPicker({
  vendors,
  value,
  onChange,
  atShow,
  isDisabled,
}: {
  vendors: Vendor[];
  value: string;
  onChange: (id: string) => void;
  atShow: Map<string, VendorAtShow>;
  /** Vendors that can't be picked here, with the reason */
  isDisabled?: (v: Vendor) => string | null;
}) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const q = search.trim().toLowerCase();
  // A vendor picked before the dialog opened may be far down the list
  useEffect(() => {
    const list = listRef.current;
    const picked = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (list && picked) list.scrollTop = picked.offsetTop - list.offsetTop - 6;
  }, []);
  const shown = vendors.filter(
    (v) => !q || [v.name, v.businessName, v.email, v.phone].some((f) => f.toLowerCase().includes(q)),
  );

  return (
    <div className="mt-3">
      <label className="relative block">
        <span className="sr-only">Search your vendors</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, business or email"
          className={`${smallInput} mt-0 pl-9`}
        />
      </label>
      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Vendor"
        className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-cream-50 p-1.5 ring-1 ring-ink/5"
      >
        {shown.map((v) => {
          const status = atShow.get(v.id);
          const reason = isDisabled?.(v) ?? null;
          const on = v.id === value;
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={Boolean(reason)}
              title={reason ?? undefined}
              onClick={() => onChange(v.id)}
              className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-left transition disabled:opacity-50 ${
                on ? "bg-white ring-2 ring-coral" : "hover:bg-white"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {v.favourite && <span className="text-gold-ink">★ </span>}
                  {v.name}
                  {v.businessName && <span className="font-semibold text-ink-soft"> · {v.businessName}</span>}
                </span>
                <span className="block truncate text-xs text-ink-muted">{v.email}</span>
              </span>
              {v.banned && <span className="rounded-full bg-coral-ink px-2 py-0.5 text-xs font-bold text-white">Banned</span>}
              {status && <AtShowBadge status={status} />}
            </button>
          );
        })}
        {!shown.length && <p className="px-3 py-2 text-sm text-ink-muted">No vendors match “{search.trim()}”.</p>}
      </div>
    </div>
  );
}

/** Contact fields for a vendor who isn't in the list yet. */
function NewVendorFields({
  contact,
  onChange,
}: {
  contact: { name: string; businessName: string; email: string; phone: string };
  onChange: (c: { name: string; businessName: string; email: string; phone: string }) => void;
}) {
  return (
    <div className="mt-3 space-y-2">
      {(
        [
          ["name", "Name", "text", true],
          ["businessName", "Business (optional)", "text", false],
          ["email", "Email", "email", true],
          ["phone", "Phone (optional)", "tel", false],
        ] as const
      ).map(([key, label, type, required]) => (
        <div key={key}>
          <input
            className={smallInput}
            type={type}
            placeholder={label}
            aria-label={label}
            required={required}
            value={contact[key]}
            onChange={(e) => onChange({ ...contact, [key]: e.target.value })}
          />
        </div>
      ))}
      <p className="text-xs text-ink-muted">If this email is already in your vendor list, it's added to that vendor.</p>
    </div>
  );
}

function VendorModeToggle({ mode, onChange }: { mode: "existing" | "new"; onChange: (m: "existing" | "new") => void }) {
  return (
    <div className="mt-5 flex gap-1 rounded-full bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Vendor source">
      {(["existing", "new"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${mode === m ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
        >
          {m === "existing" ? "From your vendors" : "New vendor"}
        </button>
      ))}
    </div>
  );
}

/** Close on Escape and focus the first thing in the dialog. */
function useDialog(onClose: () => void) {
  const firstRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return firstRef;
}

function Dialog({
  title,
  intro,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  intro: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="dialog-title" className="pr-8 text-2xl font-extrabold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">{intro}</p>
        {children}
      </form>
    </div>
  );
}

function errorMessage(error: Error) {
  const fieldErrors = error instanceof ApiRequestError ? error.body.fieldErrors : undefined;
  return fieldErrors ? (Object.values(fieldErrors).flat()[0] ?? error.message) : error.message;
}

const emptyContact = { name: "", businessName: "", email: "", phone: "" };

// ── Add vendor (no table) dialog ─────────────────────────────────────────

function AddVendorDialog({
  event,
  atShow,
  unassigned,
  initialVendorId,
  onClose,
}: {
  event: EventRecord;
  atShow: Map<string, VendorAtShow>;
  unassigned: UnassignedVendor[];
  initialVendorId?: string;
  onClose: () => void;
}) {
  const add = useAddEventVendor(event.id);
  const vendors = useEventVendors(event.id);
  const editing = unassigned.find((u) => u.vendorId === initialVendorId);
  const [chosenMode, setMode] = useState<"existing" | "new" | null>(initialVendorId ? "existing" : null);
  const mode = chosenMode ?? (vendors.data?.length ? "existing" : "new");
  const [vendorId, setVendorId] = useState(initialVendorId ?? "");
  const [contact, setContact] = useState(emptyContact);
  const [note, setNote] = useState(editing?.note ?? "");
  const firstRef = useDialog(onClose);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate({ note, ...(mode === "existing" ? { vendorId } : { contact }) }, { onSuccess: onClose });
  }

  return (
    <Dialog
      title={editing ? `Note for ${editing.name}` : "Add vendor without a table"}
      intro={
        editing
          ? "They're on this show without a table yet."
          : "Put a vendor on this show now and give them tables later. They're not emailed."
      }
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <div ref={firstRef} tabIndex={-1} className="focus:outline-none">
        {!editing && <VendorModeToggle mode={mode} onChange={setMode} />}
        {editing ? null : mode === "existing" ? (
          vendors.data?.length ? (
            <VendorPicker
              vendors={vendors.data}
              value={vendorId}
              onChange={setVendorId}
              atShow={atShow}
              isDisabled={(v) => {
                const s = atShow.get(v.id);
                return s && s.state !== "unassigned" ? "Already has tables at this show" : null;
              }}
            />
          ) : (
            <p className="mt-3 text-sm text-ink-soft">
              {vendors.isPending ? "Loading your vendors…" : "No vendors yet. Add a new one instead."}
            </p>
          )
        ) : (
          <NewVendorFields contact={contact} onChange={setContact} />
        )}
      </div>

      <label className="mt-5 block text-sm font-bold">
        Note <span className="font-normal text-ink-muted">(optional)</span>
        <textarea
          className={`${smallInput} min-h-20 text-base sm:text-sm`}
          value={note}
          maxLength={500}
          placeholder="e.g. Wants a corner spot, confirming on Friday"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {add.error && (
        <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
          {errorMessage(add.error)}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="rounded-full px-5 py-3 font-bold text-ink-soft hover:bg-cream">
          Cancel
        </button>
        <button
          type="submit"
          disabled={add.isPending || (mode === "existing" && !vendorId)}
          className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {add.isPending ? "Saving…" : editing ? "Save note" : "Add to show"}
        </button>
      </div>
    </Dialog>
  );
}

// ── Assign dialog ────────────────────────────────────────────────────────

function AssignDialog({
  event,
  tables,
  atShow,
  initialTableId,
  initialVendorId,
  onClose,
}: {
  event: EventRecord;
  /** All the event's tables; only open ones can be picked */
  tables: EventTable[];
  atShow: Map<string, VendorAtShow>;
  initialTableId?: string;
  initialVendorId?: string;
  onClose: () => void;
}) {
  const assign = useAssignTable(event.id);
  const vendors = useEventVendors(event.id);
  const [tableIds, setTableIds] = useState<string[]>(initialTableId ? [initialTableId] : []);
  const [chosenMode, setMode] = useState<"existing" | "new" | null>(initialVendorId ? "existing" : null);
  // Until the organizer picks, default to their vendor list if they have one
  const mode = chosenMode ?? (vendors.data?.length ? "existing" : "new");
  const [vendorId, setVendorId] = useState(initialVendorId ?? "");
  const [contact, setContact] = useState(emptyContact);
  const [paid, setPaid] = useState(event.tablePriceCents === 0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [discountCode, setDiscountCode] = useState("");
  const firstRef = useDialog(onClose);

  const open = tables.filter((t) => !t.booking);
  // The chosen vendor, or a vendor in the list with the new contact's email
  const chosen =
    mode === "existing"
      ? vendors.data?.find((v) => v.id === vendorId)
      : vendors.data?.find((v) => contact.email && v.email === contact.email.trim().toLowerCase());
  const status = chosen ? atShow.get(chosen.id) : undefined;
  // Show the vendor's own tables in the grid, so it's clear what they already have
  const shown = tables.filter((t) => !t.booking || (chosen && t.booking.vendorId === chosen.id));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    assign.mutate(
      // Keep floor order, whatever order they were clicked in
      {
        tableIds: open.filter((t) => tableIds.includes(t.id)).map((t) => t.id),
        paid,
        paymentMethod: paid ? paymentMethod || null : null,
        discountCode: discountCode.trim().toUpperCase(),
        ...(mode === "existing" ? { vendorId } : { contact }),
      },
      { onSuccess: onClose },
    );
  }

  const toggle = (id: string) =>
    setTableIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < MAX_TABLES_PER_REQUEST ? [...ids, id] : ids));
  const count = tableIds.length;
  const preview = priceRequest({ tablePriceCents: event.tablePriceCents, tableCount: count, tiers: event.bulkDiscounts });

  return (
    <Dialog
      title="Assign tables"
      intro="Pick a vendor and one or more open tables. They're booked together as one request and approved straight away."
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <div ref={firstRef} tabIndex={-1} className="focus:outline-none">
        <VendorModeToggle mode={mode} onChange={setMode} />
        {mode === "existing" ? (
          vendors.data?.length ? (
            <VendorPicker vendors={vendors.data} value={vendorId} onChange={setVendorId} atShow={atShow} />
          ) : (
            <p className="mt-3 text-sm text-ink-soft">
              {vendors.isPending ? "Loading your vendors…" : "No vendors yet. They're added automatically as they book."}
            </p>
          )
        ) : (
          <NewVendorFields contact={contact} onChange={setContact} />
        )}
      </div>

      {chosen && status && (
        <p className="mt-3 rounded-xl bg-sky/15 px-3 py-2 text-sm text-slate" role="status">
          {status.state === "unassigned" ? (
            <>
              <strong>{chosen.name}</strong> is on this show without a table yet.
            </>
          ) : (
            <>
              <strong>{chosen.name}</strong> already has {atShowLabel(status).toLowerCase()}. New tables are added as a
              separate request.
            </>
          )}
        </p>
      )}

      <div className="mt-5 flex items-baseline justify-between gap-2">
        <span id="assign-tables-label" className="text-sm font-bold">
          Tables
        </span>
        <span className="text-sm text-ink-soft" aria-live="polite">
          {count ? `${count} selected` : "None selected"}
          {count > 0 && event.tablePriceCents > 0 && ` · ${formatMoney(preview.totalCents)}`}
          {count > 0 && preview.discountCents > 0 && <span className="block text-xs text-[#2d7a6a]">{preview.label}</span>}
        </span>
      </div>
      <div
        role="group"
        aria-labelledby="assign-tables-label"
        className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-2xl bg-cream-50 p-2 ring-1 ring-ink/5"
      >
        {shown.map((t) => {
          if (t.booking) {
            // One of the chosen vendor's tables: shown for context, not pickable
            return (
              <span
                key={t.id}
                title={`Already ${chosen?.name}'s (${tableStateLabel(tableState(t.booking)).toLowerCase()})`}
                className="inline-flex min-w-11 items-center justify-center gap-1 rounded-lg bg-sky/25 px-2.5 py-1.5 text-sm font-extrabold text-slate"
              >
                <CheckIcon className="size-3.5" aria-hidden="true" />
                {t.label}
                <span className="sr-only"> (already theirs)</span>
              </span>
            );
          }
          const on = tableIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.id)}
              disabled={!on && count >= MAX_TABLES_PER_REQUEST}
              className={`min-w-11 rounded-lg px-2.5 py-1.5 text-sm font-extrabold transition disabled:opacity-40 ${
                on ? "bg-slate text-white" : "bg-white text-slate ring-1 ring-slate/20 hover:ring-slate"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {status && status.tables.length > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
          <CheckIcon className="size-3" aria-hidden="true" /> = already theirs
        </p>
      )}
      {count >= MAX_TABLES_PER_REQUEST && (
        <p className="mt-1 text-xs text-ink-muted">Up to {MAX_TABLES_PER_REQUEST} tables at a time.</p>
      )}

      {event.tablePriceCents > 0 && (
        <label className="mt-5 block text-sm font-bold">
          Discount code <span className="font-normal text-ink-muted">(optional)</span>
          <input
            className={`${smallInput} uppercase`}
            value={discountCode}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDiscountCode(e.target.value)}
          />
          <span className="mt-1 block text-xs font-normal text-ink-muted">
            Applied if it saves more than the multi-table discount.
          </span>
        </label>
      )}

      <label className="mt-5 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-coral" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        Already paid
      </label>
      {paid && event.tablePriceCents > 0 && (
        <label className="mt-2 block text-sm font-semibold">
          How did they pay?
          <select
            className={smallInput}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
          >
            <option value="">Not recorded</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {paymentMethodLabels[m]}
              </option>
            ))}
          </select>
        </label>
      )}

      {assign.error && (
        <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
          {errorMessage(assign.error)}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="rounded-full px-5 py-3 font-bold text-ink-soft hover:bg-cream">
          Cancel
        </button>
        <button
          type="submit"
          disabled={assign.isPending || !count || (mode === "existing" && !vendorId)}
          className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {assign.isPending ? "Assigning…" : count > 1 ? `Assign ${count} tables` : "Assign table"}
        </button>
      </div>
    </Dialog>
  );
}

const smallInput =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";
