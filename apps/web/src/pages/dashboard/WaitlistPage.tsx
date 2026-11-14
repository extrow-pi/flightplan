import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { EventRecord, EventWaitlistResponse, WaitlistEntry } from "@flightplan/shared";
import BannedBadge from "../../components/BannedBadge";
import { Dialog, errorMessage, smallInput, useDialog } from "../../components/Dialog";
import { canEdit, EventTabs, SharedBadge } from "../../components/events";
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon } from "../../components/Icons";
import VendorPicker from "../../components/VendorPicker";
import {
  ApiRequestError,
  useAddWaitlistEntry,
  useEvent,
  useEventVendors,
  useEventWaitlist,
  useReorderWaitlist,
  useWaitlistAction,
  type WaitlistAction,
} from "../../lib/api";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

const tablesCount = (n: number) => `${n} ${n > 1 ? "tables" : "table"}`;

/** Vendors waiting for a table at a full show: offer them a spot, withdraw an offer, or take them off. */
export default function WaitlistPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const waitlist = useEventWaitlist(event?.id);
  const reorder = useReorderWaitlist(event?.id ?? "");
  const [adding, setAdding] = useState(false);

  if (isPending) return <p className="text-ink-muted" role="status">Loading…</p>;
  if (error || !event) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
        <p className="text-lg font-extrabold">
          {error instanceof ApiRequestError && error.status === 404 ? "Not found" : "Couldn't load this"}
        </p>
        <Link to="/dashboard" className="mt-4 inline-block font-bold text-coral-ink hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const data = waitlist.data;
  const inLine = data?.entries.filter((e) => e.position !== null) ?? [];
  const done = data?.entries.filter((e) => e.position === null) ?? [];
  /** Swap a vendor with the one above (-1) or below (+1) */
  const move = (index: number, by: -1 | 1) => {
    const ids = inLine.map((e) => e.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <>
      <Link to="/dashboard/events" className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink">
        <ArrowLeftIcon className="size-4" /> All events
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
        <SharedBadge event={event} />
      </div>
      <EventTabs event={event} />

      {waitlist.error ? (
        <p className="mt-6 rounded-2xl bg-peach px-5 py-4 font-semibold text-coral-ink" role="alert">
          Couldn't load the waitlist: {waitlist.error.message}
        </p>
      ) : !data ? (
        <p className="mt-6 text-ink-muted" role="status">
          Loading waitlist…
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {data.openTables > 0 && inLine.some((e) => e.status === "waiting") && canEdit(event) && (
              <p className="rounded-2xl bg-success-soft px-5 py-4 font-semibold text-success" role="status">
                {data.openTables === 1 ? "A table is" : `${data.openTables} tables are`} open. Assign{" "}
                {data.openTables === 1 ? "it" : "them"} to the next vendors in line.
              </p>
            )}
            <Card
              title={`In line (${inLine.length})`}
              action={
                canEdit(event) && (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border-2 border-coral/30 px-3.5 py-1.5 text-sm font-bold text-coral-ink transition hover:border-coral"
                  >
                    <PlusIcon className="size-4" /> Add from your vendors
                  </button>
                )
              }
            >
              {reorder.error && (
                <p className="mb-2 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
                  {reorder.error.message}
                </p>
              )}
              {inLine.length ? (
                <ol className="divide-y divide-ink/5">
                  {inLine.map((e, i) => (
                    <EntryRow
                      key={e.id}
                      event={event}
                      entry={e}
                      tablesHeld={data.tablesByVendor[e.vendorId] ?? 0}
                      openTables={data.openTables}
                      onMoveUp={i > 0 ? () => move(i, -1) : undefined}
                      onMoveDown={i < inLine.length - 1 ? () => move(i, 1) : undefined}
                    />
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-soft">
                  Nobody's waiting. When every table is taken, vendors who open your booking link can join the waitlist
                  instead, or add someone from your vendor list.
                </p>
              )}
            </Card>
            {done.length > 0 && (
              <Card title="Booked or removed">
                <ul className="divide-y divide-ink/5">
                  {done.map((e) => (
                    <EntryRow key={e.id} event={event} entry={e} />
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <aside className="space-y-6">
            <Card title="Tables">
              <p className="text-3xl font-extrabold">
                {data.openTables}
                <span className="text-base font-bold text-ink-soft"> of {data.totalTables} open</span>
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                {data.openTables === 0
                  ? "The show is full, so your booking link offers the waitlist instead of tables."
                  : "Your booking link shows open tables, so new vendors can book them directly."}
              </p>
              <Link to={`/dashboard/events/${event.id}/tables`} className="mt-3 inline-block text-sm font-bold text-coral-ink hover:underline">
                Open Tables & vendors
              </Link>
            </Card>
            <Card title="How it works">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
                <li>
                  Vendors join from your booking link once every table is taken, and get an email with their place in line. You can
                  also add vendors from your list, or move an application here with <strong className="text-ink">Move to waitlist</strong>.
                </li>
                <li>New vendors go to the back of the line. Use the arrows to move someone up or down.</li>
                <li>
                  When a table frees up, <strong className="text-ink">Assign tables</strong> gives them one, and they're emailed the
                  details like any table you assign.
                </li>
                <li>Once they have tables, they move to <em>Booked</em> here.</li>
              </ol>
            </Card>
          </aside>
        </div>
      )}
      {adding && data && <AddDialog event={event} waitlist={data} onClose={() => setAdding(false)} />}
    </>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-extrabold">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Put someone from the vendor list at the back of the line. They're emailed only when offered a table. */
function AddDialog({ event, waitlist, onClose }: { event: EventRecord; waitlist: EventWaitlistResponse; onClose: () => void }) {
  const add = useAddWaitlistEntry(event.id);
  const vendors = useEventVendors(event.id);
  const [vendorId, setVendorId] = useState("");
  const [tablesWanted, setTablesWanted] = useState(1);
  const [message, setMessage] = useState("");
  const firstRef = useDialog(onClose);
  const inLine = new Set(waitlist.entries.filter((e) => e.position !== null).map((e) => e.vendorId));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate({ vendorId, tablesWanted, message }, { onSuccess: onClose });
  }

  return (
    <Dialog
      title="Add to the waitlist"
      intro="They go to the back of the line. They're not emailed until you offer them a table."
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <div ref={firstRef} tabIndex={-1} className="focus:outline-none">
        {vendors.data?.length ? (
          <VendorPicker
            vendors={vendors.data}
            value={vendorId}
            onChange={setVendorId}
            isDisabled={(v) => (inLine.has(v.id) ? "Already on the waitlist" : null)}
            badge={(v) =>
              inLine.has(v.id) ? (
                <span className="rounded-full bg-sky/20 px-2 py-0.5 text-xs font-bold text-slate">In line</span>
              ) : (
                <HasTablesBadge count={waitlist.tablesByVendor[v.id] ?? 0} />
              )
            }
          />
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            {vendors.isPending ? "Loading your vendors…" : "No vendors yet. Add them on the Vendors page first."}
          </p>
        )}
      </div>

      <label className="mt-5 block text-sm font-bold">
        Tables wanted
        <input
          type="number"
          min={1}
          max={event.maxTablesPerRequest}
          value={tablesWanted}
          onChange={(e) => setTablesWanted(Math.max(1, Math.min(event.maxTablesPerRequest, Number(e.target.value) || 1)))}
          className={`${smallInput} block max-w-24 text-base sm:text-sm`}
        />
      </label>

      <label className="mt-4 block text-sm font-bold">
        Note <span className="font-normal text-ink-muted">(optional)</span>
        <textarea
          className={`${smallInput} min-h-20 text-base sm:text-sm`}
          value={message}
          maxLength={1000}
          placeholder="e.g. Asked by phone, wants to be near the entrance"
          onChange={(e) => setMessage(e.target.value)}
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
          disabled={add.isPending || !vendorId}
          className="rounded-full bg-primary hover:bg-primary-hover px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {add.isPending ? "Adding…" : "Add to waitlist"}
        </button>
      </div>
    </Dialog>
  );
}

/** Marks vendors who already have tables at this show (e.g. asking for more) */
function HasTablesBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold whitespace-nowrap text-success">
      Has {tablesCount(count)} here
    </span>
  );
}

function MoveButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-0.5 text-ink-soft transition hover:bg-cream hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function StatusBadge({ entry }: { entry: WaitlistEntry }) {
  const [label, tone] =
    entry.status === "offered"
      ? entry.offerCancelled
        ? ["Link cancelled", "bg-ink/5 text-ink-soft"]
        : [`Offered ${shortDate(entry.offeredAt!)}`, "bg-warning-soft text-gold-ink"]
      : entry.status === "booked"
        ? ["Booked", "bg-success-soft text-success"]
        : entry.status === "removed"
          ? ["Removed", "bg-ink/5 text-ink-soft"]
          : ["Waiting", "bg-sky/20 text-slate"];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${tone}`}>{label}</span>;
}

function EntryRow({
  event,
  entry: e,
  tablesHeld = 0,
  openTables = 0,
  onMoveUp,
  onMoveDown,
}: {
  event: EventRecord;
  entry: WaitlistEntry;
  /** Tables they already have at this show */
  tablesHeld?: number;
  /** Tables free at the show right now; Assign tables is greyed out at 0 */
  openTables?: number;
  /** Missing at the top (or bottom) of the line */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const act = useWaitlistAction(event.id);
  const [confirming, setConfirming] = useState(false);
  const editable = canEdit(event) && e.position !== null;
  // A live offer can be withdrawn; otherwise (waiting, or the link was cancelled) a table can be offered
  const liveOffer = e.status === "offered" && !e.offerCancelled;
  const run = (action: WaitlistAction) => act.mutate({ entryId: e.id, action }, { onSuccess: () => setConfirming(false) });

  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      {editable && (
        <span className="-my-1 flex shrink-0 flex-col">
          <MoveButton label={`Move number ${e.position} up`} onClick={onMoveUp}>
            <ChevronUpIcon className="size-4" />
          </MoveButton>
          <MoveButton label={`Move number ${e.position} down`} onClick={onMoveDown}>
            <ChevronDownIcon className="size-4" />
          </MoveButton>
        </span>
      )}
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
          e.position !== null ? "bg-gradient-to-br from-coral to-gold text-white" : "bg-cream text-ink-muted"
        }`}
        aria-label={e.position !== null ? `Number ${e.position} in line` : undefined}
      >
        {e.position ?? "–"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-extrabold">{e.businessName || e.name}</span>
          {e.businessName && <span className="font-semibold text-ink-soft">· {e.name}</span>}
          <HasTablesBadge count={tablesHeld} />
          {e.banned && <BannedBadge />}
        </p>
        <p className="mt-0.5 text-sm break-words text-ink-soft">
          <a href={`mailto:${e.email}`} className="hover:underline">
            {e.email}
          </a>
          {e.phone && ` · ${e.phone}`} · wants {tablesCount(e.tablesWanted)} · joined {shortDate(e.createdAt)}
        </p>
        {e.message && <p className="mt-1.5 rounded-xl bg-cream-50 px-3 py-2 text-sm whitespace-pre-line ring-1 ring-ink/5">{e.message}</p>}
        {act.error && (
          <p className="mt-1.5 text-sm font-semibold text-coral-ink" role="alert">
            {act.error.message}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge entry={e} />
        {editable &&
          (confirming ? (
            <>
              <button
                type="button"
                onClick={() => run("remove")}
                disabled={act.isPending}
                className="rounded-full bg-coral-ink px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {act.isPending ? "…" : "Remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-full px-2.5 py-1.5 text-sm font-bold text-ink-soft hover:bg-cream"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {openTables > 0 ? (
                <Link
                  to={`/dashboard/events/${event.id}/tables?assign=${e.vendorId}`}
                  className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-primary-hover"
                >
                  Assign tables
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Every table is taken. Free one up on Tables & vendors first."
                  className="cursor-not-allowed rounded-full bg-primary hover:bg-primary-hover px-3.5 py-1.5 text-sm font-bold text-white opacity-40"
                >
                  Assign tables
                </button>
              )}
              {/* Booking links sent from the waitlist before tables were assigned directly */}
              {liveOffer && (
                <button
                  type="button"
                  onClick={() => run("withdraw")}
                  disabled={act.isPending}
                  className="rounded-full border-2 border-slate/30 px-3 py-1 text-sm font-bold text-slate transition hover:border-slate disabled:opacity-60"
                >
                  Withdraw link
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-full px-3 py-1.5 text-sm font-bold text-coral-ink hover:bg-peach"
              >
                Remove
              </button>
            </>
          ))}
      </div>
    </li>
  );
}
