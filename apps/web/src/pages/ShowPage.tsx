import { useEffect, type CSSProperties } from "react";
import { Link, useLocation, useParams } from "react-router";
import { eventEndDate, type PublicShowPage } from "@flightplan/shared";
import { DateTile, Schedule } from "../components/events";
import { ArrowLeftIcon, ClockIcon, MapPinIcon, TableIcon, TicketIcon } from "../components/Icons";
import Logo from "../components/Logo";
import { ApiRequestError, usePublicShow } from "../lib/api";
import { formatDate, formatDateRange, formatMoney, timeRange } from "../lib/format";

/** Flightplan's coral, used when the organizer hasn't picked an accent colour */
export const DEFAULT_ACCENT = "#e8856a";

/** White or dark text, whichever reads better on the accent colour. */
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#4a3728" : "#ffffff";
}

// A show's public page for attendees: details, the organizer's own sections, and TicketsCandy tickets.
export default function ShowPage() {
  const { handle, slug } = useParams();
  const { data, isPending, error } = usePublicShow(handle, slug);
  const { hash } = useLocation();

  // "Get tickets" links from the organizer page land on the ticket widget once the page has loaded
  useEffect(() => {
    if (data && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [data, hash]);

  useEffect(() => {
    if (data) document.title = `${data.show.name} · ${data.organizer.displayName}`;
    return () => {
      document.title = "Flightplan — Event tools for show organizers";
    };
  }, [data]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <main className="mx-auto max-w-4xl px-4 pt-6 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-ink-muted" role="status">
            Loading…
          </p>
        ) : error || !data ? (
          <section className="mt-4 rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-ink/5">
            <h1 className="text-2xl font-extrabold">
              {error instanceof ApiRequestError && error.status === 404 ? "Show not found" : "Couldn't load this page"}
            </h1>
            <p className="mt-2 text-ink-soft">
              {error instanceof ApiRequestError && error.status === 404
                ? "It may have moved or been taken down."
                : "Please try again in a moment."}
            </p>
            {handle && (
              <Link to={`/o/${handle}`} className="mt-4 inline-block font-bold text-coral-ink hover:underline">
                See all shows
              </Link>
            )}
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

function Page({ data }: { data: PublicShowPage }) {
  const { organizer, show: s, page } = data;
  const accent = page.accentColor || DEFAULT_ACCENT;
  const vars = { "--accent": accent, "--on-accent": textOn(accent) } as CSSProperties;
  const end = eventEndDate(s)!;
  const single = s.days.length === 1;
  const dates =
    s.startDate === end
      ? formatDate(s.startDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : formatDateRange(s.startDate, end);
  const place = [s.venueName, s.address, s.city].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  const accentButton =
    "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 font-bold text-[var(--on-accent)] shadow-sm transition hover:-translate-y-0.5 hover:brightness-105";

  return (
    <div style={vars}>
      <Link
        to={`/o/${organizer.handle}`}
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" />
        {organizer.logoUrl && <img src={organizer.logoUrl} alt="" className="size-6 rounded-md bg-white object-contain" />}
        All shows by {organizer.displayName}
      </Link>

      <article className="mt-4 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
        {s.coverUrl ? (
          <img src={s.coverUrl} alt="" className="aspect-[3/1] w-full object-cover" />
        ) : (
          <div className="h-2 bg-[var(--accent)]" />
        )}
        <div className="p-5 sm:p-8">
          <div className="flex gap-4">
            <DateTile event={s} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold tracking-tight break-words sm:text-4xl">{s.name}</h1>
              {s.tagline && <p className="mt-1 text-lg text-ink-soft">{s.tagline}</p>}
            </div>
          </div>

          {!s.upcoming && (
            <p className="mt-5 rounded-2xl bg-cream px-4 py-3 text-sm font-bold text-ink-soft">This show has ended. Thanks to everyone who came!</p>
          )}

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3">
              <ClockIcon className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
              <div>
                <dt className="sr-only">When</dt>
                <dd className="font-bold">{dates}</dd>
                {single ? (
                  <dd className="text-ink-soft">{timeRange(s.days[0].startTime, s.days[0].endTime)}</dd>
                ) : (
                  <dd className="mt-1.5">
                    <Schedule event={s} />
                  </dd>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <MapPinIcon className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0">
                <dt className="sr-only">Where</dt>
                <dd className="font-bold">{s.venueName}</dd>
                <dd className="text-ink-soft">{[s.address, s.city].filter(Boolean).join(", ")}</dd>
                <dd>
                  <a href={mapsUrl} target="_blank" rel="noreferrer noopener" className="text-sm font-bold text-coral-ink hover:underline">
                    Open in Maps ↗
                  </a>
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <TicketIcon className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
              <div>
                <dt className="sr-only">Admission</dt>
                <dd className="font-bold">{s.ticketPriceCents > 0 ? `Admission ${formatMoney(s.ticketPriceCents)}` : "Free admission"}</dd>
              </div>
            </div>
          </dl>

          {(page.tickets || s.booking) && (
            <div className="mt-6 flex flex-col gap-3 border-t border-ink/5 pt-6 sm:flex-row sm:flex-wrap sm:items-center">
              {page.tickets && (
                <a href="#tickets" className={accentButton}>
                  <TicketIcon className="size-5" /> Get tickets
                </a>
              )}
              {s.booking &&
                (s.booking.tablesLeft > 0 ? (
                  <Link
                    to={s.booking.url}
                    className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[var(--accent)] px-6 py-2.5 font-bold text-ink transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
                  >
                    <TableIcon className="size-5" /> Book a vendor table
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-ink-muted">Vendor tables are sold out</span>
                ))}
            </div>
          )}

          {s.description && <p className="mt-6 text-lg whitespace-pre-line text-ink-soft">{s.description}</p>}
        </div>
      </article>

      {page.tickets && (
        <section id="tickets" className="mt-6 scroll-mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 sm:p-8" aria-labelledby="tickets-title">
          <h2 id="tickets-title" className="flex items-center gap-2 text-2xl font-extrabold">
            <span className="h-6 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            Tickets
          </h2>
          <iframe
            src={page.tickets}
            title={`Buy tickets for ${s.name}`}
            className="mt-5 w-full rounded-2xl border-0 bg-cream-50"
            style={{ height: page.ticketsHeight }}
            loading="lazy"
            allow="payment"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation"
          />
          <p className="mt-3 text-sm text-ink-muted">
            Ticket sales by TicketsCandy.{" "}
            <a href={page.tickets} target="_blank" rel="noreferrer noopener" className="font-bold text-coral-ink hover:underline">
              Open tickets in a new tab ↗
            </a>
          </p>
        </section>
      )}

      {page.sections.map((section, i) => (
        <section key={i} className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 sm:p-8" aria-labelledby={`section-${i}`}>
          <h2 id={`section-${i}`} className="flex items-center gap-2 text-2xl font-extrabold break-words">
            <span className="h-6 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            {section.title}
          </h2>
          <p className="mt-3 whitespace-pre-line break-words text-ink-soft">{section.body}</p>
        </section>
      ))}
    </div>
  );
}
