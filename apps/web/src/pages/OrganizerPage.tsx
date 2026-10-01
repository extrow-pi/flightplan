import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { eventEndDate, type PublicOrganizerPage, type PublicShow } from "@flightplan/shared";
import { DateTile, Schedule } from "../components/events";
import { ClockIcon, MailIcon, MapPinIcon, TableIcon } from "../components/Icons";
import Logo from "../components/Logo";
import { ApiRequestError, usePublicOrganizer } from "../lib/api";
import { formatDate, formatDateRange, formatMoney, timeRange } from "../lib/format";

// An organizer's public page: their profile and published shows. No sign-in needed.
export default function OrganizerPage() {
  const { handle } = useParams();
  const { data, isPending, error } = usePublicOrganizer(handle);

  useEffect(() => {
    if (data) document.title = `${data.profile.displayName} · Shows on Flightplan`;
    return () => {
      document.title = "Flightplan — Event tools for show organizers";
    };
  }, [data]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <main className="mx-auto max-w-4xl px-4 pt-10 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-ink-muted" role="status">
            Loading…
          </p>
        ) : error || !data ? (
          <section className="rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-ink/5">
            <h1 className="text-2xl font-extrabold">
              {error instanceof ApiRequestError && error.status === 404 ? "Organizer not found" : "Couldn't load this page"}
            </h1>
            <p className="mt-2 text-ink-soft">
              {error instanceof ApiRequestError && error.status === 404
                ? "Check the link, or ask the organizer for their page address."
                : "Please try again in a moment."}
            </p>
          </section>
        ) : (
          <Page data={data} />
        )}
      </main>
      <footer className="border-t border-ink/5 py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 px-4 text-sm text-ink-muted sm:flex-row sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            Shows listed with <Logo className="scale-75" />
          </span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-ink">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Page({ data }: { data: PublicOrganizerPage }) {
  const { profile, upcoming, past } = data;
  const links = [
    profile.websiteUrl && { href: profile.websiteUrl, label: profile.websiteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") },
    profile.instagram && { href: `https://instagram.com/${profile.instagram}`, label: `@${profile.instagram}` },
    profile.contactEmail && { href: `mailto:${profile.contactEmail}`, label: profile.contactEmail },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <header className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
        {profile.logoUrl ? (
          <img src={profile.logoUrl} alt="" className="size-24 shrink-0 rounded-3xl bg-white object-contain shadow-sm ring-1 ring-ink/5" />
        ) : (
          <span className="flex size-24 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-coral to-gold text-4xl font-extrabold text-white shadow-sm">
            {profile.displayName.trim()[0]?.toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{profile.displayName}</h1>
          {profile.bio && <p className="mt-2 max-w-2xl whitespace-pre-line text-ink-soft">{profile.bio}</p>}
          {links.length > 0 && (
            <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-bold sm:justify-start">
              {links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target={l.href.startsWith("mailto:") ? undefined : "_blank"}
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-coral-ink hover:underline"
                  >
                    {l.href.startsWith("mailto:") && <MailIcon className="size-4" />}
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <section className="mt-12" aria-labelledby="upcoming-title">
        <h2 id="upcoming-title" className="text-sm font-bold tracking-wider text-coral-ink uppercase">
          Upcoming shows
        </h2>
        {upcoming.length ? (
          <ul className="mt-4 space-y-4">
            {upcoming.map((s) => (
              <ShowCard key={`${s.name}-${s.startDate}`} show={s} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-3xl bg-white p-6 text-ink-soft ring-1 ring-ink/5">
            No upcoming shows right now. Check back soon!
          </p>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-12" aria-labelledby="past-title">
          <h2 id="past-title" className="text-sm font-bold tracking-wider text-ink-muted uppercase">
            Past shows
          </h2>
          <ul className="mt-4 divide-y divide-ink/5 rounded-3xl bg-white/70 ring-1 ring-ink/5">
            {past.map((s) => (
              <li key={`${s.name}-${s.startDate}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-5 py-3">
                <span className="font-bold">{s.name}</span>
                <span className="text-sm text-ink-soft">
                  {dateLabel(s)} · {s.venueName}, {s.city}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function dateLabel(s: PublicShow) {
  const end = eventEndDate(s)!;
  return s.startDate === end
    ? formatDate(s.startDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : formatDateRange(s.startDate, end);
}

function ShowCard({ show: s }: { show: PublicShow }) {
  const single = s.days.length === 1;
  return (
    <li className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 sm:p-6">
      <div className="flex gap-4">
        <DateTile event={s} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-extrabold">{s.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            <span className="flex items-center gap-1.5">
              <ClockIcon className="size-4 text-ink-muted" />
              {single ? `${dateLabel(s)} · ${timeRange(s.days[0].startTime, s.days[0].endTime)}` : dateLabel(s)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="size-4 text-ink-muted" />
              {[s.venueName, s.address, s.city].filter(Boolean).join(", ")}
            </span>
          </div>
          {!single && (
            <div className="mt-2">
              <Schedule event={s} />
            </div>
          )}
        </div>
      </div>
      {s.description && <p className="mt-4 whitespace-pre-line text-ink-soft">{s.description}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink/5 pt-4">
        <span className="rounded-full bg-cream px-3 py-1 text-sm font-bold text-ink-soft">
          {s.ticketPriceCents > 0 ? `Admission ${formatMoney(s.ticketPriceCents)}` : "Free admission"}
        </span>
        {s.booking ? (
          <>
            <span className="flex items-center gap-1.5 text-sm text-ink-soft">
              <TableIcon className="size-4 text-ink-muted" />
              {s.booking.tablesLeft > 0
                ? `${s.booking.tablesLeft} vendor ${s.booking.tablesLeft === 1 ? "table" : "tables"} left${
                    s.tablePriceCents > 0 ? ` · ${formatMoney(s.tablePriceCents)} each` : ""
                  }`
                : "Vendor tables sold out"}
            </span>
            {s.booking.tablesLeft > 0 && (
              <Link
                to={s.booking.url}
                className="ml-auto rounded-full bg-gradient-to-r from-coral to-coral-deep px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
              >
                Book a vendor table
              </Link>
            )}
          </>
        ) : null}
      </div>
    </li>
  );
}
