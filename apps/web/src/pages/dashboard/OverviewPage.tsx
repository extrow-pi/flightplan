import { Link } from "react-router";
import type { EventRecord } from "@flightplan/shared";
import { BookingActions, paymentDueLabel } from "../../components/bookings";
import { DateTile, EventMeta, EventRow, isPast, isTemplate, StatusBadge } from "../../components/events";
import { BellIcon, CalendarIcon, CheckIcon, PlusIcon, TableIcon, TicketIcon } from "../../components/Icons";
import { useAlerts, useEvents } from "../../lib/api";
import { useSession } from "../../lib/auth-client";
import { daysUntil, formatMoney, greeting } from "../../lib/format";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

export default function OverviewPage() {
  const { data: session } = useSession();
  const { data: events, isPending, error } = useEvents();
  const firstName = session?.user.name.split(" ")[0];

  const dated = (events ?? []).filter((e) => !isTemplate(e));
  const templates = (events ?? []).filter(isTemplate);
  const upcoming = dated.filter((e) => !isPast(e));
  const nextShow = upcoming.find((e) => e.status === "published") ?? upcoming[0];
  const drafts = upcoming.filter((e) => e.status === "draft");
  const publishedUpcoming = upcoming.filter((e) => e.status === "published");
  const tablesOnSale = publishedUpcoming.reduce((sum, e) => sum + e.vendorTables, 0);
  const laterShows = upcoming.filter((e) => e !== nextShow);
  const tableRevenuePotential = publishedUpcoming.reduce((sum, e) => sum + e.vendorTables * e.tablePriceCents, 0);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`${greeting()}, ${firstName}!`}
        subtitle="Here's what's coming up for your shows."
      />

      {error ? (
        <ErrorCard message={error.message} />
      ) : isPending ? (
        <LoadingCards />
      ) : !dated.length ? (
        <FirstEventCard templates={templates.length} />
      ) : (
        <>
          <AlertsCard events={events} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={CalendarIcon} label="Upcoming shows" value={upcoming.length} />
            <StatCard
              icon={CalendarIcon}
              label="Next show in"
              value={nextShow ? dayLabel(daysUntil(nextShow.startDate!)) : "—"}
            />
            <StatCard icon={TableIcon} label="Vendor tables on sale" value={tablesOnSale} />
            <StatCard
              icon={TicketIcon}
              label="Table sales potential"
              value={tableRevenuePotential ? formatMoney(tableRevenuePotential) : "—"}
              hint="If every published table sells"
            />
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0 space-y-8">
              {nextShow && <NextShowCard event={nextShow} />}

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-extrabold">Later shows</h2>
                  <Link to="/dashboard/events" className="text-sm font-bold text-coral-ink hover:underline">
                    View all events
                  </Link>
                </div>
                {laterShows.length ? (
                  <ul className="mt-4 space-y-3">
                    {laterShows.slice(0, 4).map((e) => (
                      <EventRow key={e.id} event={e} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-3xl bg-white p-6 text-ink-soft ring-1 ring-ink/5">
                    {nextShow ? "Nothing else scheduled yet." : "No upcoming shows."}{" "}
                    <Link to="/dashboard/events/new" className="font-bold text-coral-ink hover:underline">
                      Plan your next one
                    </Link>
                  </p>
                )}
              </section>
            </div>

            <aside className="space-y-6">
              <Checklist events={dated} templates={templates.length} />
              {drafts.length > 0 && (
                <div className="rounded-3xl bg-[#fff4cc] p-5">
                  <p className="font-extrabold text-gold-ink">
                    {drafts.length} draft{drafts.length > 1 ? "s" : ""} waiting
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Drafts are only visible to you. Publish them when you're ready to open vendor tables.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

function dayLabel(days: number) {
  return days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarIcon;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <Icon className="size-4 text-coral" />
        {label}
      </div>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function NextShowCard({ event }: { event: EventRecord }) {
  const days = daysUntil(event.startDate!);
  return (
    <section className="relative overflow-hidden rounded-3xl bg-slate p-6 text-white sm:p-8">
      <svg
        className="pointer-events-none absolute -right-16 -bottom-10 w-[420px] text-white/10"
        viewBox="0 0 420 200"
        fill="none"
        aria-hidden="true"
      >
        <path d="M0 190 C 140 190, 200 30, 410 20" stroke="currentColor" strokeWidth="3" strokeDasharray="10 12" />
      </svg>
      <p className="text-sm font-bold tracking-wider text-gold uppercase">✈️ Next show</p>
      <div className="relative mt-4 flex flex-col gap-6 sm:flex-row sm:items-center">
        <DateTile event={event} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-extrabold">{event.name}</h2>
            <StatusBadge event={event} />
          </div>
          <div className="mt-2">
            <EventMeta event={event} tone="dark" />
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-5xl leading-none font-extrabold text-gold">{days <= 0 ? "Now" : days}</p>
          <p className="mt-1 text-xs font-bold tracking-wider text-white/70 uppercase">
            {days < 0 ? "happening" : days === 0 ? "starts today" : "days to go"}
          </p>
        </div>
      </div>
      <div className="relative mt-6 flex flex-wrap gap-3">
        <Link
          to={`/dashboard/events/${event.id}`}
          className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate transition hover:bg-cream"
        >
          Edit event
        </Link>
        <Link
          to={`/dashboard/events/${event.id}/tables`}
          className="rounded-full border border-white/40 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
        >
          Tables & vendors
        </Link>
      </div>
    </section>
  );
}

function Checklist({ events, templates }: { events: EventRecord[]; templates: number }) {
  const steps = [
    { label: "Create your organizer account", done: true },
    { label: "Create your first event", done: events.length > 0 },
    { label: "Publish an event", done: events.some((e) => e.status === "published") },
    { label: "Save a show as a template", done: templates > 0 },
    { label: "Open vendor table booking", done: events.some((e) => e.bookingOpen && e.status === "published") },
    { label: "Start selling tickets", done: false, soon: true },
  ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-center justify-between">
        <h2 className="font-extrabold">Pre-flight checklist</h2>
        <span className="text-sm font-bold text-ink-muted">
          {completed}/{steps.length}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream">
        <div
          className="h-full rounded-full bg-gradient-to-r from-coral to-gold transition-all"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>
      <ul className="mt-5 space-y-3">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                s.done ? "bg-coral text-white" : "border-2 border-cream bg-white"
              }`}
            >
              {s.done && <CheckIcon className="size-3.5" strokeWidth={3} />}
            </span>
            <span className={s.done ? "font-semibold text-ink-muted line-through" : "font-semibold"}>{s.label}</span>
            {s.soon && (
              <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold-ink uppercase">
                Soon
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FirstEventCard({ templates }: { templates: number }) {
  return (
    <section className="flex flex-col items-center rounded-3xl border-2 border-dashed border-coral/30 bg-white px-6 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-coral to-gold text-white shadow-md">
        <TicketIcon className="size-8" />
      </span>
      <h2 className="mt-5 text-2xl font-extrabold">Plan your first show</h2>
      <p className="mt-2 max-w-md text-ink-soft">
        Add the dates, venue and how many vendor tables you have. You can keep it as a draft until you're ready.
      </p>
      {templates > 0 && (
        <Link to="/dashboard/templates" className="mt-3 text-sm font-bold text-coral-ink hover:underline">
          Or start from one of your {templates} template{templates > 1 ? "s" : ""}
        </Link>
      )}
      <Link
        to="/dashboard/events/new"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3 font-bold text-white transition hover:bg-coral-deep"
      >
        <PlusIcon className="size-4" strokeWidth={3} />
        Create your first event
      </Link>
    </section>
  );
}

/** Overdue payments and table requests waiting for approval, across all events. */
function AlertsCard({ events }: { events: EventRecord[] }) {
  const { data: alerts } = useAlerts();
  if (!alerts?.length) return null;
  const overdue = alerts.filter((a) => a.kind === "overdue").length;
  const pending = alerts.length - overdue;

  return (
    <section className="mb-8 rounded-3xl bg-white p-6 shadow-sm ring-2 ring-coral/40" aria-labelledby="alerts-title">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-coral text-white">
          <BellIcon className="size-5" />
        </span>
        <div>
          <h2 id="alerts-title" className="text-lg font-extrabold">
            Needs your attention
          </h2>
          <p className="text-sm text-ink-soft">
            {[
              overdue && `${overdue} overdue payment${overdue > 1 ? "s" : ""}`,
              pending && `${pending} table request${pending > 1 ? "s" : ""} to review`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-ink/5">
        {alerts.map((a) => {
          const event = events.find((e) => e.id === a.eventId);
          return (
            <li key={a.booking.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {a.booking.name}
                  {a.booking.businessName && <span className="font-semibold text-ink-soft"> · {a.booking.businessName}</span>}
                </p>
                <p className="text-sm text-ink-soft">
                  <Link to={`/dashboard/events/${a.eventId}/tables`} className="font-semibold text-coral-ink hover:underline">
                    {a.eventName}
                  </Link>{" "}
                  · {a.tableLabels.length > 1 ? `tables ${a.tableLabels.join(", ")}` : `table ${a.tableLabels[0]}`} ·{" "}
                  {a.kind === "overdue" ? (
                    <span className="font-bold text-coral-ink">{paymentDueLabel(a.booking)}</span>
                  ) : (
                    a.tableLabels.length > 1 ? "wants these tables" : "wants a table"
                  )}
                </p>
              </div>
              <BookingActions
                booking={a.booking}
                eventId={a.eventId}
                paymentDueDays={event?.paymentDueDays ?? 7}
                requestTables={a.tableLabels}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
