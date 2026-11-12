import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { EventRecord, WaitlistEntry } from "@flightplan/shared";
import BannedBadge from "../../components/BannedBadge";
import { canEdit, EventTabs, SharedBadge } from "../../components/events";
import { ArrowLeftIcon } from "../../components/Icons";
import { ApiRequestError, useEvent, useEventWaitlist, useWaitlistAction, type WaitlistAction } from "../../lib/api";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

const tablesCount = (n: number) => `${n} ${n > 1 ? "tables" : "table"}`;

/** Vendors waiting for a table at a full show: offer them a spot, withdraw an offer, or take them off. */
export default function WaitlistPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const waitlist = useEventWaitlist(event?.id);

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
              <p className="rounded-2xl bg-[#e8f8f5] px-5 py-4 font-semibold text-[#2d7a6a]" role="status">
                {data.openTables === 1 ? "A table is" : `${data.openTables} tables are`} open. Offer{" "}
                {data.openTables === 1 ? "it" : "them"} to the next vendors in line.
              </p>
            )}
            <Card title={`In line (${inLine.length})`}>
              {inLine.length ? (
                <ol className="divide-y divide-ink/5">
                  {inLine.map((e) => (
                    <EntryRow key={e.id} event={event} entry={e} />
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-soft">
                  Nobody's waiting. When every table is taken, vendors who open your booking link can join the waitlist instead.
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
                <li>Vendors join from your booking link once every table is taken, and get an email with their place in line.</li>
                <li>
                  When a table frees up, <strong className="text-ink">Offer a table</strong> emails that vendor a personal link that works once.
                </li>
                <li>When they book, they move to <em>Booked</em> here. If they don't, withdraw the offer and offer it to the next vendor.</li>
              </ol>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-extrabold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StatusBadge({ entry }: { entry: WaitlistEntry }) {
  const [label, tone] =
    entry.status === "offered"
      ? entry.offerCancelled
        ? ["Link cancelled", "bg-ink/5 text-ink-soft"]
        : [`Offered ${shortDate(entry.offeredAt!)}`, "bg-[#fff4cc] text-gold-ink"]
      : entry.status === "booked"
        ? ["Booked", "bg-[#e8f8f5] text-[#2d7a6a]"]
        : entry.status === "removed"
          ? ["Removed", "bg-ink/5 text-ink-soft"]
          : ["Waiting", "bg-sky/20 text-slate"];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${tone}`}>{label}</span>;
}

function EntryRow({ event, entry: e }: { event: EventRecord; entry: WaitlistEntry }) {
  const act = useWaitlistAction(event.id);
  const [confirming, setConfirming] = useState(false);
  const editable = canEdit(event) && e.position !== null;
  // A live offer can be withdrawn; otherwise (waiting, or the link was cancelled) a table can be offered
  const liveOffer = e.status === "offered" && !e.offerCancelled;
  const run = (action: WaitlistAction) => act.mutate({ entryId: e.id, action }, { onSuccess: () => setConfirming(false) });

  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
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
              {liveOffer ? (
                <button
                  type="button"
                  onClick={() => run("withdraw")}
                  disabled={act.isPending}
                  className="rounded-full border-2 border-slate/30 px-3 py-1 text-sm font-bold text-slate transition hover:border-slate disabled:opacity-60"
                >
                  Withdraw offer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => run("offer")}
                  disabled={act.isPending}
                  className="rounded-full bg-coral px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-coral-deep disabled:opacity-60"
                >
                  {act.isPending ? "Sending…" : e.offerCancelled ? "Offer again" : "Offer a table"}
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
