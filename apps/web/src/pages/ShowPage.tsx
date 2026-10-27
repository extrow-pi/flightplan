import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  eventEndDate,
  ticketsCandyEventId,
  TICKETSCANDY_ORIGIN,
  uploadPath,
  videoEmbedUrl,
  type PublicShowPage,
  type ShowPageBlock,
  type ShowPageTheme,
} from "@flightplan/shared";
import { DateTile, Schedule } from "../components/events";
import { ArrowLeftIcon, ClockIcon, MailIcon, MapPinIcon, TableIcon, TicketIcon } from "../components/Icons";
import Logo from "../components/Logo";
import { ApiRequestError, usePublicShow } from "../lib/api";
import { formatDate, formatDateRange, formatMoney, timeRange } from "../lib/format";

/** Flightplan's coral, used when the organizer hasn't picked an accent colour */
export const DEFAULT_ACCENT = "#e8856a";

/** White or dark text, whichever reads better on the accent colour. */
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#1f1a16" : "#ffffff";
}

/** Page colours per theme, as CSS variables the page's classes read. */
export const THEMES: Record<ShowPageTheme, { label: string; vars: Record<string, string> }> = {
  warm: {
    label: "Warm",
    vars: { "--bg": "linear-gradient(to bottom, #fff4e2, #fffbf4)", "--card": "#ffffff", "--text": "#4a3728", "--soft": "#7a6555", "--muted": "#9a8070", "--line": "rgba(74,55,40,0.08)", "--chip": "#faf0dc" },
  },
  light: {
    label: "Light",
    vars: { "--bg": "#f4f5f7", "--card": "#ffffff", "--text": "#1f2430", "--soft": "#4b5563", "--muted": "#6b7280", "--line": "rgba(15,23,42,0.08)", "--chip": "#eef0f3" },
  },
  dark: {
    label: "Dark",
    vars: { "--bg": "#14161c", "--card": "#1f222b", "--text": "#f3f4f6", "--soft": "#c7cad1", "--muted": "#9096a1", "--line": "rgba(255,255,255,0.1)", "--chip": "#2a2e39" },
  },
};

/**
 * TicketsCandy's checkout frame. Their loader script does the same: the frame says it's ready, we
 * answer with a handshake asking it to report its height, and it then sends resize messages. We
 * decline their analytics (nothing is passed to Google/Meta/TikTok from our page). Other TicketsCandy
 * links are framed at the organizer's height.
 */
function TicketsWidget({ url, height, title }: { url: string; height: number; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
  const checkout = ticketsCandyEventId(url) !== null;

  useEffect(() => {
    if (!checkout) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== TICKETSCANDY_ORIGIN || !ref.current || e.source !== ref.current.contentWindow) return;
      const data = e.data as { type?: string; height?: unknown; id?: unknown } | null;
      const reply = (message: object) => (e.source as Window).postMessage(message, TICKETSCANDY_ORIGIN);
      switch (data?.type) {
        case "tc-checkout:ready":
          reply({ type: "tc-checkout:handshake", protocol: 1, consent: { managed: false, accepted: null }, autoHeight: true });
          break;
        case "tc-checkout:resize": {
          const h = Number(data.height);
          if (Number.isFinite(h) && h > 0) setAutoHeight(Math.ceil(h));
          break;
        }
        case "tc-checkout:analytics":
          reply({ type: "tc-checkout:analytics:ack", id: data.id, handled: { ga4: false, ads: false, facebook: false, tiktok: false } });
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [checkout]);

  return (
    <iframe
      ref={ref}
      src={checkout ? `${url}?ext=1` : url}
      title={title}
      className="w-full rounded-2xl border-0"
      style={{ height: autoHeight ?? height }}
      allow="payment *"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation"
    />
  );
}

// A show's public page for attendees: details, flyer, and the organizer's blocks (tickets, text, FAQ…).
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

  const theme = THEMES[data?.page.theme ?? "warm"] ?? THEMES.warm;
  const accent = data?.page.accentColor || DEFAULT_ACCENT;
  const vars = { ...theme.vars, "--accent": accent, "--on-accent": textOn(accent) } as CSSProperties;

  return (
    <div className="min-h-dvh text-[var(--text)]" style={{ ...vars, background: "var(--bg)" }}>
      <main className="mx-auto max-w-4xl px-4 pt-6 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-[var(--muted)]" role="status">
            Loading…
          </p>
        ) : error || !data ? (
          <section className="mt-4 rounded-3xl bg-[var(--card)] p-10 text-center shadow-sm ring-1 ring-[var(--line)]">
            <h1 className="text-2xl font-extrabold">
              {error instanceof ApiRequestError && error.status === 404 ? "Show not found" : "Couldn't load this page"}
            </h1>
            <p className="mt-2 text-[var(--soft)]">
              {error instanceof ApiRequestError && error.status === 404
                ? "It may have moved or been taken down."
                : "Please try again in a moment."}
            </p>
            {handle && (
              <Link to={`/o/${handle}`} className="mt-4 inline-block font-bold underline decoration-[var(--accent)] decoration-2">
                See all shows
              </Link>
            )}
          </section>
        ) : (
          <Page data={data} />
        )}
      </main>
      <footer className="border-t border-[var(--line)] py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 px-4 text-sm text-[var(--muted)] sm:flex-row sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            Shows listed with <Logo className="scale-75 text-[var(--text)]!" />
          </span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-[var(--text)]">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-[var(--text)]">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

const card = "rounded-3xl bg-[var(--card)] shadow-sm ring-1 ring-[var(--line)]";
const accentButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 font-bold text-[var(--on-accent)] shadow-sm transition hover:-translate-y-0.5 hover:brightness-105";
const textLink = "font-bold underline decoration-[var(--accent)] decoration-2 underline-offset-2 hover:decoration-4";

function Page({ data }: { data: PublicShowPage }) {
  const { organizer, show: s, page } = data;
  const end = eventEndDate(s)!;
  const single = s.days.length === 1;
  const dates =
    s.startDate === end
      ? formatDate(s.startDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : formatDateRange(s.startDate, end);
  const place = [s.venueName, s.address, s.city].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  const hasTickets = !!page.tickets && page.blocks.some((b) => b.type === "tickets");

  return (
    <div>
      <Link to={`/o/${organizer.handle}`} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--soft)] transition hover:text-[var(--text)]">
        <ArrowLeftIcon className="size-4" />
        {organizer.logoUrl && <img src={organizer.logoUrl} alt="" className="size-6 rounded-md bg-white object-contain" />}
        All shows by {organizer.displayName}
      </Link>

      <article className={`mt-4 overflow-hidden ${card}`}>
        {s.coverUrl ? <img src={s.coverUrl} alt="" className="aspect-[3/1] w-full object-cover" /> : <div className="h-2 bg-[var(--accent)]" />}
        <div className="p-5 sm:p-8">
          <div className="flex gap-4">
            <DateTile event={s} size="xl" accent />
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold tracking-tight break-words sm:text-4xl">{s.name}</h1>
              {s.tagline && <p className="mt-1 text-lg text-[var(--soft)]">{s.tagline}</p>}
            </div>
          </div>

          {page.flyer && (
            <a href={uploadPath(page.flyer)} target="_blank" rel="noreferrer" className="mt-6 block" title="Open the flyer full size">
              <img
                src={uploadPath(page.flyer)}
                alt={`Flyer for ${s.name}`}
                className="mx-auto max-h-[80vh] w-auto max-w-full rounded-2xl shadow-sm ring-1 ring-[var(--line)]"
              />
            </a>
          )}

          {!s.upcoming && (
            <p className="mt-5 rounded-2xl bg-[var(--chip)] px-4 py-3 text-sm font-bold text-[var(--soft)]">This show has ended. Thanks to everyone who came!</p>
          )}

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3">
              <ClockIcon className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
              <div>
                <dt className="sr-only">When</dt>
                <dd className="font-bold">{dates}</dd>
                {single ? (
                  <dd className="text-[var(--soft)]">{timeRange(s.days[0].startTime, s.days[0].endTime)}</dd>
                ) : (
                  <dd className="mt-1.5">
                    <Schedule event={s} tone={page.theme === "dark" ? "dark" : "light"} />
                  </dd>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <MapPinIcon className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0">
                <dt className="sr-only">Where</dt>
                <dd className="font-bold">{s.venueName}</dd>
                <dd className="text-[var(--soft)]">{[s.address, s.city].filter(Boolean).join(", ")}</dd>
                <dd>
                  <a href={mapsUrl} target="_blank" rel="noreferrer noopener" className={`text-sm ${textLink}`}>
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

          {(hasTickets || s.booking) && (
            <div className="mt-6 flex flex-col gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:flex-wrap sm:items-center">
              {hasTickets && (
                <a href="#tickets" className={accentButton}>
                  <TicketIcon className="size-5" /> Get tickets
                </a>
              )}
              {s.booking &&
                (s.booking.tablesLeft > 0 ? (
                  <Link
                    to={s.booking.url}
                    className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[var(--accent)] px-6 py-2.5 font-bold transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
                  >
                    <TableIcon className="size-5" /> Book a vendor table
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-[var(--muted)]">Vendor tables are sold out</span>
                ))}
            </div>
          )}

          {s.description && <p className="mt-6 text-lg whitespace-pre-line text-[var(--soft)]">{s.description}</p>}
        </div>
      </article>

      {page.blocks.map((block) => (
        <Block key={block.id} block={block} data={data} place={place} mapsUrl={mapsUrl} />
      ))}

      <OrganizerCard organizer={organizer} />
    </div>
  );
}

function BlockSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={`mt-6 scroll-mt-4 p-5 sm:p-8 ${card}`} aria-label={title || undefined}>
      {title && (
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-extrabold break-words">
          <span className="h-6 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Block({ block: b, data, place, mapsUrl }: { block: ShowPageBlock; data: PublicShowPage; place: string; mapsUrl: string }) {
  const { page, show: s } = data;
  switch (b.type) {
    case "tickets":
      if (!page.tickets) return null;
      return (
        <BlockSection id="tickets" title={b.title}>
          <TicketsWidget url={page.tickets} height={page.ticketsHeight} title={`Buy tickets for ${s.name}`} />
          <p className="mt-3 text-sm text-[var(--muted)]">
            Ticket sales by TicketsCandy.{" "}
            <a href={page.tickets} target="_blank" rel="noreferrer noopener" className={textLink}>
              Open tickets in a new tab ↗
            </a>
          </p>
        </BlockSection>
      );
    case "text":
      return (
        <BlockSection title={b.title}>
          <p className="whitespace-pre-line break-words text-[var(--soft)]">{b.body}</p>
        </BlockSection>
      );
    case "faq":
      return (
        <BlockSection title={b.title}>
          <div className="divide-y divide-[var(--line)]">
            {b.items.map((item, i) => (
              <details key={i} className="group py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold">
                  {item.question}
                  <span className="text-xl text-[var(--accent)] transition group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-line text-[var(--soft)]">{item.answer}</p>
              </details>
            ))}
          </div>
        </BlockSection>
      );
    case "gallery":
      return (
        <BlockSection title={b.title}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {b.images.map((file) => (
              <a key={file} href={uploadPath(file)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl ring-1 ring-[var(--line)]">
                <img src={uploadPath(file)} alt="" loading="lazy" className="aspect-square w-full object-cover transition hover:scale-105" />
              </a>
            ))}
          </div>
        </BlockSection>
      );
    case "video": {
      const src = videoEmbedUrl(b.url);
      if (!src) return null;
      return (
        <BlockSection title={b.title}>
          <iframe
            src={src}
            title={b.title || `Video for ${s.name}`}
            className="aspect-video w-full rounded-2xl border-0"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </BlockSection>
      );
    }
    case "links":
      return (
        <BlockSection title={b.title}>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {b.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" className={accentButton}>
                {l.label} ↗
              </a>
            ))}
          </div>
        </BlockSection>
      );
    case "sponsors":
      return (
        <BlockSection title={b.title}>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {b.items.map((item, i) => {
              const logo = (
                <>
                  <span className="flex aspect-[3/2] items-center justify-center rounded-2xl bg-white p-3 ring-1 ring-[var(--line)]">
                    <img src={uploadPath(item.image)} alt={item.name} loading="lazy" className="max-h-full max-w-full object-contain" />
                  </span>
                  {item.name && <span className="mt-2 block text-center text-sm font-bold text-[var(--soft)]">{item.name}</span>}
                </>
              );
              return (
                <li key={i}>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer noopener" className="block transition hover:-translate-y-0.5">
                      {logo}
                    </a>
                  ) : (
                    logo
                  )}
                </li>
              );
            })}
          </ul>
        </BlockSection>
      );
    case "map":
      return (
        <BlockSection title={b.title}>
          <iframe
            src={`https://www.google.com/maps?q=${encodeURIComponent(place)}&output=embed`}
            title={`Map of ${s.venueName}`}
            className="aspect-[4/3] w-full rounded-2xl border-0 sm:aspect-[16/7]"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <p className="mt-3 text-[var(--soft)]">
            <span className="font-bold text-[var(--text)]">{s.venueName}</span>
            {[s.address, s.city].filter(Boolean).length > 0 && ` · ${[s.address, s.city].filter(Boolean).join(", ")}`} ·{" "}
            <a href={mapsUrl} target="_blank" rel="noreferrer noopener" className={textLink}>
              Directions ↗
            </a>
          </p>
        </BlockSection>
      );
  }
}

function OrganizerCard({ organizer: o }: { organizer: PublicShowPage["organizer"] }) {
  const links = [
    o.websiteUrl && { href: o.websiteUrl, label: o.websiteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") },
    o.instagram && { href: `https://instagram.com/${o.instagram}`, label: `@${o.instagram}` },
    o.contactEmail && { href: `mailto:${o.contactEmail}`, label: o.contactEmail },
  ].filter(Boolean) as { href: string; label: string }[];
  return (
    <section className={`mt-6 flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:p-6 sm:text-left ${card}`} aria-label="Organizer">
      {o.logoUrl ? (
        <img src={o.logoUrl} alt="" className="size-14 shrink-0 rounded-2xl bg-white object-contain ring-1 ring-[var(--line)]" />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-2xl font-extrabold text-[var(--on-accent)]">
          {o.displayName.trim()[0]?.toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--muted)]">Organized by</p>
        <p className="text-lg font-extrabold">{o.displayName}</p>
        {links.length > 0 && (
          <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm sm:justify-start">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} target={l.href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer noopener" className={`inline-flex items-center gap-1 ${textLink}`}>
                  {l.href.startsWith("mailto:") && <MailIcon className="size-4" />}
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link to={`/o/${o.handle}`} className="shrink-0 rounded-full border-2 border-[var(--accent)] px-5 py-2 text-sm font-bold transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]">
        More shows
      </Link>
    </section>
  );
}
