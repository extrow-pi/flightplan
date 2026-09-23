import type { ReactNode } from "react";
import { useParams } from "react-router";
import { addDays, type PublicRequestStatus } from "@flightplan/shared";
import Logo from "../components/Logo";
import { CheckIcon, ClockIcon, MapPinIcon } from "../components/Icons";
import { ApiRequestError, useRequestStatus } from "../lib/api";
import { formatDate, formatMoney, timeRange } from "../lib/format";

// A vendor's private page for one booking request, linked from every email we send them
export default function RequestStatusPage() {
  const { requestId } = useParams();
  const { data, isPending, error } = useRequestStatus(requestId);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <span className="text-sm font-bold text-ink-soft">Your booking</span>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-ink-muted" role="status">
            Loading…
          </p>
        ) : error || !data ? (
          <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-ink/5">
            <h1 className="text-2xl font-extrabold">Booking not found</h1>
            <p className="mt-2 text-ink-soft">
              {error instanceof ApiRequestError && error.status === 404
                ? "This link may be incomplete. Try opening it again from your email."
                : "Something went wrong loading this page. Please try again in a moment."}
            </p>
          </section>
        ) : (
          <Status data={data} />
        )}
      </main>
    </div>
  );
}

const closedCopy: Record<string, { title: string; body: string }> = {
  rejected: { title: "Request not approved", body: "The organizer wasn't able to approve this request." },
  released: { title: "Tables released", body: "These tables are no longer reserved for you." },
  cancelled: { title: "Booking cancelled", body: "This booking was cancelled." },
};

function Status({ data }: { data: PublicRequestStatus }) {
  const { event } = data;
  const count = data.tableLabels.length;
  const tables = `${count > 1 ? "Tables" : "Table"} ${data.tableLabels.join(", ")}`;
  const end = addDays(event.startDate, Math.max(...event.days.map((d) => d.dayOffset)));
  const due =
    data.paymentDueAt &&
    new Date(data.paymentDueAt).toLocaleString("en-CA", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const banner: { tone: string; title: string; body: ReactNode } =
    data.status === "pending"
      ? {
          tone: "bg-[#fff4cc] text-gold-ink",
          title: "Waiting for approval",
          body: `The organizer is reviewing your request for ${tables.toLowerCase()}. You'll get an email when it's approved.`,
        }
      : data.status === "awaiting_payment"
        ? {
            tone: data.overdue ? "bg-coral-ink text-white" : "bg-peach text-coral-ink",
            title: data.overdue ? "Payment overdue" : "Payment due",
            body: (
              <>
                Please pay <strong>{formatMoney(event.tablePriceCents * count)}</strong>
                {due ? (
                  <>
                    {" "}
                    {data.overdue ? "(it was due" : "by"} <strong>{due}</strong>
                    {data.overdue ? "). Please contact the organizer." : " to keep your tables."}
                  </>
                ) : (
                  " to confirm your booking."
                )}
              </>
            ),
          }
        : data.status === "paid"
          ? { tone: "bg-[#e8f8f5] text-[#2d7a6a]", title: "You're booked!", body: "Your payment is received. See you at the show!" }
          : {
              tone: "bg-ink/5 text-ink",
              title: closedCopy[data.closedAs ?? ""]?.title ?? "No longer active",
              body: `${closedCopy[data.closedAs ?? ""]?.body ?? "This booking is no longer active."} Reply to any of our emails to contact the organizer.`,
            };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
        <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">Hi {data.vendorName.split(" ")[0]}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{event.name}</h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-ink-soft">
          <span className="flex items-center gap-1.5">
            <ClockIcon className="size-4 text-ink-muted" />
            {event.startDate === end
              ? formatDate(event.startDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
              : `${formatDate(event.startDate, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPinIcon className="size-4 text-ink-muted" />
            {[event.venueName, event.address, event.city].filter(Boolean).join(", ")}
          </span>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          {event.days.map((d) => (
            <li key={d.dayOffset} className="rounded-lg bg-cream-50 px-2.5 py-1 text-sm ring-1 ring-ink/5">
              <span className="font-bold">
                {formatDate(addDays(event.startDate, d.dayOffset), { weekday: "short", month: "short", day: "numeric" })}
              </span>{" "}
              · {timeRange(d.startTime, d.endTime)}
            </li>
          ))}
        </ul>

        <div className={`mt-6 rounded-2xl px-5 py-4 ${banner.tone}`} role="status">
          <p className="flex items-center gap-2 font-extrabold">
            {data.status === "paid" && <CheckIcon className="size-5" strokeWidth={3} />}
            {banner.title}
          </p>
          <p className="mt-1 text-sm">{banner.body}</p>
        </div>

        {count > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-soft">{count > 1 ? "Your tables:" : "Your table:"}</span>
            {data.tableLabels.map((l) => (
              <span key={l} className="rounded-lg bg-slate px-2.5 py-1 text-sm font-extrabold text-white">
                {l}
              </span>
            ))}
          </div>
        )}

        {data.paymentInstructions && (
          <div className="mt-5 rounded-2xl bg-cream-50 p-5 ring-1 ring-ink/5">
            <p className="text-xs font-bold tracking-wider text-ink-muted uppercase">How to pay</p>
            <p className="mt-2 whitespace-pre-line">{data.paymentInstructions}</p>
            {data.status === "pending" && <p className="mt-2 text-sm text-ink-soft">Once you're approved.</p>}
          </div>
        )}

        {data.organizerName && (
          <p className="mt-6 text-sm text-ink-soft">
            Organized by <strong className="text-ink">{data.organizerName}</strong>. Questions? Reply to any email about this
            booking.
          </p>
        )}
      </section>

      {event.floorMapUrl && count > 0 && (
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
          <h2 className="font-extrabold">Floor map</h2>
          <a
            href={event.floorMapUrl}
            target="_blank"
            rel="noreferrer"
            title="Open full size"
            className="mt-3 block overflow-hidden rounded-2xl ring-1 ring-ink/10"
          >
            <img src={event.floorMapUrl} alt="Floor map with table numbers" className="w-full bg-cream-50 object-contain" />
          </a>
        </section>
      )}
    </div>
  );
}
