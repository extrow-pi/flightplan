import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { Booking, EventRecord, EventTable, Invite } from "@flightplan/shared";
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
import { EventTabs, isPast } from "../../components/events";
import { ArrowLeftIcon, CloseIcon, CopyIcon } from "../../components/Icons";
import {
  ApiRequestError,
  eventToInput,
  useAssignTable,
  useCreateInvite,
  useEvent,
  useEventTables,
  useRevokeInvite,
  useSaveEvent,
  useVendors,
} from "../../lib/api";
import { formatMoney } from "../../lib/format";

type Filter = "all" | ReturnType<typeof tableState>;

export default function TablesPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const tables = useEventTables(event && event.status !== "template" ? id : undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"vendors" | "tables">("vendors");
  // A request to point out after clicking "Review" in the table view
  const [highlight, setHighlight] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<EventTable | null | "pick">(null);

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

  const all = tables.data?.tables ?? [];
  const requests = groupRequests(all);
  const available = all.filter((t) => !t.booking);

  // Filters count tables in the table view and vendor requests in the vendor view
  const stateOf = (x: EventTable | VendorRequest) => ("requestId" in x ? x.state : tableState(x.booking));
  const items: (EventTable | VendorRequest)[] = view === "tables" ? all : requests;
  const filters = (["all", ...TABLE_STATES] as Filter[]).filter((f) => !(view === "vendors" && f === "available"));
  const count = (f: Filter) => (f === "all" ? items.length : items.filter((x) => stateOf(x) === f).length);
  const activeFilter = filters.includes(filter) ? filter : "all";
  const matches = (x: EventTable | VendorRequest) => activeFilter === "all" || stateOf(x) === activeFilter;

  function reviewRequest(requestId: string) {
    setView("vendors");
    setFilter("all");
    setHighlight(requestId);
    // Wait for the vendor view to render, then bring the card into view
    requestAnimationFrame(() =>
      document.getElementById(`request-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  return (
    <>
      <Link
        to="/dashboard/events"
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" /> All events
      </Link>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
      <EventTabs eventId={event.id} />

      {tables.error ? (
        <p className="mt-6 rounded-2xl bg-peach px-5 py-4 font-semibold text-coral-ink" role="alert">
          Couldn't load tables: {tables.error.message}
        </p>
      ) : tables.isPending ? (
        <p className="mt-6 text-ink-muted" role="status">
          Loading tables…
        </p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-4">
            <div className="flex w-fit gap-1 rounded-full bg-white p-1 ring-1 ring-ink/10" role="radiogroup" aria-label="View">
              {(
                [
                  ["vendors", `By vendor (${requests.length})`],
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
                    {f === "all" ? (view === "tables" ? "All tables" : "All vendors") : tableStateLabel(f)}
                    <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20" : "bg-cream"}`}>{n}</span>
                  </button>
                );
              })}
            </div>

            {all.length === 0 ? (
              <p className="rounded-3xl bg-white p-6 text-ink-soft ring-1 ring-ink/5">
                This event has no vendor tables yet. Set the number of tables on the{" "}
                <Link to={`/dashboard/events/${event.id}`} className="font-bold text-coral-ink hover:underline">
                  Details
                </Link>{" "}
                tab.
              </p>
            ) : view === "vendors" ? (
              <div className="space-y-3">
                {requests.filter(matches).map((r) => (
                  <RequestCard key={r.requestId} request={r} event={event} highlighted={r.requestId === highlight} />
                ))}
                {requests.length === 0 ? (
                  <p className="rounded-3xl bg-white p-6 text-center text-ink-soft ring-1 ring-ink/5">
                    No vendors yet. Share the booking link or assign a table to get started.
                  </p>
                ) : (
                  !requests.some(matches) && (
                    <p className="rounded-3xl bg-white p-6 text-center text-ink-soft ring-1 ring-ink/5">
                      No vendors match this filter.
                    </p>
                  )
                )}
              </div>
            ) : (
              <ul className="divide-y divide-ink/5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
                {all.filter(matches).map((t) => (
                  <TableRow
                    key={t.id}
                    table={t}
                    event={event}
                    requestSize={
                      t.booking ? (requests.find((r) => r.requestId === t.booking!.requestId)?.tables.length ?? 1) : 0
                    }
                    onAssign={() => setAssigning(t)}
                    onReview={() => t.booking && reviewRequest(t.booking.requestId)}
                  />
                ))}
                {!all.some(matches) && <li className="p-6 text-center text-ink-soft">No tables match this filter.</li>}
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
            <button
              type="button"
              onClick={() => setAssigning("pick")}
              disabled={!available.length || isPast(event)}
              className="w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            >
              Assign a table
            </button>
            <BookingLinkCard event={event} />
            <InvitesCard event={event} invites={tables.data.invites} />
            <FloorMapCard event={event} />
          </aside>
        </div>
      )}

      {assigning && (
        <AssignDialog
          event={event}
          tables={available}
          initialTableId={assigning === "pick" ? available[0]?.id : assigning.id}
          onClose={() => setAssigning(null)}
        />
      )}
    </>
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
}: {
  request: VendorRequest;
  event: EventRecord;
  highlighted: boolean;
}) {
  const { booking: b, tables } = request;
  const due = paymentDueLabel(b);
  const labels = tables.map((t) => t.table.label);
  const multiple = tables.length > 1;

  return (
    <article
      id={`request-${request.requestId}`}
      className={`rounded-3xl bg-white p-5 shadow-sm transition ${
        highlighted ? "ring-2 ring-coral" : request.state === "overdue" ? "ring-2 ring-coral-ink/40" : "ring-1 ring-ink/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-extrabold">
            {b.name}
            {b.businessName && <span className="font-semibold text-ink-soft"> · {b.businessName}</span>}
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
            {multiple && (
              <ReleaseTableButton bookingId={booking.id} eventId={event.id} tableLabel={table.label} compact />
            )}
          </span>
        ))}
        {event.tablePriceCents > 0 && (
          <span className="ml-auto text-sm font-bold text-ink-soft">{formatMoney(event.tablePriceCents * tables.length)}</span>
        )}
      </div>

      {(due || b.message) && (
        <div className="mt-2 space-y-0.5 text-sm text-ink-soft">
          {due && <p className={b.overdue ? "font-bold text-coral-ink" : ""}>{due}</p>}
          {b.message && <p className="italic">“{b.message}”</p>}
        </div>
      )}

      <div className="mt-4 border-t border-ink/5 pt-3">
        <BookingActions booking={b} eventId={event.id} paymentDueDays={event.paymentDueDays} requestTables={labels} />
      </div>
    </article>
  );
}

// ── Tables (floor view) ──────────────────────────────────────────────────

function TableRow({
  table,
  event,
  requestSize,
  onAssign,
  onReview,
}: {
  table: EventTable;
  event: EventRecord;
  /** How many tables this table's request holds */
  requestSize: number;
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
        {!b ? (
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

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link:", text);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-slate/30 px-3 py-1 text-sm font-bold text-slate transition hover:border-slate"
    >
      <CopyIcon className="size-3.5" />
      {copied ? "Copied!" : label}
    </button>
  );
}

function BookingLinkCard({ event }: { event: EventRecord }) {
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
        {event.status === "published" && !isPast(event) && (
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

function InvitesCard({ event, invites }: { event: EventRecord; invites: Invite[] }) {
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
                    <button
                      type="button"
                      onClick={() => revoke.mutate(inv.id)}
                      disabled={revoke.isPending}
                      className="rounded-full px-2.5 py-1 text-xs font-bold text-coral-ink hover:bg-peach disabled:opacity-60"
                    >
                      Cancel invite
                    </button>
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

// ── Assign dialog ────────────────────────────────────────────────────────

function AssignDialog({
  event,
  tables,
  initialTableId,
  onClose,
}: {
  event: EventRecord;
  tables: EventTable[];
  initialTableId?: string;
  onClose: () => void;
}) {
  const assign = useAssignTable(event.id);
  const vendors = useVendors();
  const [tableId, setTableId] = useState(initialTableId ?? "");
  const [chosenMode, setMode] = useState<"existing" | "new" | null>(null);
  // Until the organizer picks, default to their vendor list if they have one
  const mode = chosenMode ?? (vendors.data?.length ? "existing" : "new");
  const [vendorId, setVendorId] = useState("");
  const [contact, setContact] = useState({ name: "", businessName: "", email: "", phone: "" });
  const [paid, setPaid] = useState(event.tablePriceCents === 0);
  const firstRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    assign.mutate(
      mode === "existing" ? { tableId, vendorId, paid } : { tableId, contact, paid },
      { onSuccess: onClose },
    );
  }

  const fieldErrors = assign.error instanceof ApiRequestError ? assign.error.body.fieldErrors : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="assign-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="assign-title" className="pr-8 text-2xl font-extrabold">
          Assign a table
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Tables you assign are approved straight away.</p>

        <label htmlFor="assign-table" className="mt-5 block text-sm font-bold">
          Table
        </label>
        <select id="assign-table" ref={firstRef} className={smallInput} value={tableId} onChange={(e) => setTableId(e.target.value)} required>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              Table {t.label}
            </option>
          ))}
        </select>

        <div className="mt-5 flex gap-1 rounded-full bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Vendor">
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${mode === m ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
            >
              {m === "existing" ? "From your vendors" : "New vendor"}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          vendors.data?.length ? (
            <select
              aria-label="Vendor"
              className={`${smallInput} mt-3`}
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              required
            >
              <option value="" disabled>
                Choose a vendor…
              </option>
              {vendors.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.businessName ? ` · ${v.businessName}` : ""} ({v.email})
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">
              {vendors.isPending ? "Loading your vendors…" : "No vendors yet. They're added automatically as they book."}
            </p>
          )
        ) : (
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
                  onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
                />
              </div>
            ))}
            <p className="text-xs text-ink-muted">If this email is already in your vendor list, the booking is added to that vendor.</p>
          </div>
        )}

        <label className="mt-5 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-coral" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          Already paid
        </label>

        {assign.error && (
          <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {fieldErrors ? Object.values(fieldErrors).flat()[0] ?? assign.error.message : assign.error.message}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-3 font-bold text-ink-soft hover:bg-cream">
            Cancel
          </button>
          <button
            type="submit"
            disabled={assign.isPending || !tableId || (mode === "existing" && !vendorId)}
            className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {assign.isPending ? "Assigning…" : "Assign table"}
          </button>
        </div>
      </form>
    </div>
  );
}

const smallInput =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";
