import { eventEndDate, uploadPath } from "@flightplan/shared";
import { findPublicShowPage, publishedProfile } from "./routes/profile.js";
import { uploadUrl } from "./uploads.js";

// Link previews for public pages. The web app builds pages in the browser, so when a show page is
// shared (Instagram, Facebook, iMessage, Slack…) the preview would only show Flightplan's own title.
// The server fills in the show's (or organizer's) title, description and image instead.

const APP_URL = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:5173").replace(/\/$/, "");

export type PageMeta = { title: string; description: string; url: string; image: string | null; siteName: string };

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[ch]};`);
const absolute = (path: string | null) => (path ? `${APP_URL}${path}` : null);
const oneLine = (s: string, max = 200) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

function dateLabel(start: string, end: string) {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...opts }).format(new Date(`${d}T12:00:00Z`));
  if (start === end) return fmt(start, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** Preview details for /o/:handle/:slug, or null if there's no such page. */
export async function showPageMeta(handle: string, slug: string): Promise<PageMeta | null> {
  const page = await findPublicShowPage(handle, slug).catch(() => null);
  if (!page) return null;
  const { show: s, organizer, page: settings } = page;
  const when = dateLabel(s.startDate, eventEndDate(s) ?? s.startDate);
  const where = [s.venueName, s.city].filter(Boolean).join(", ");
  const intro = s.tagline || s.description;
  return {
    title: `${s.name} · ${organizer.displayName}`,
    description: oneLine([`${when} · ${where}`, intro].filter(Boolean).join(". ")),
    url: `${APP_URL}${s.url}`,
    // A wide cover suits preview cards best; the flyer, then the organizer's logo, otherwise
    image: absolute(s.coverUrl) ?? absolute(settings.flyer ? uploadPath(settings.flyer) : null) ?? absolute(organizer.logoUrl),
    siteName: organizer.displayName,
  };
}

/** Preview details for /o/:handle, or null if the page isn't public. */
export async function organizerMeta(handle: string): Promise<PageMeta | null> {
  const profile = await publishedProfile(handle).catch(() => null);
  if (!profile) return null;
  return {
    title: `${profile.displayName} · Shows on Flightplan`,
    description: oneLine(profile.bio || `Upcoming shows from ${profile.displayName}.`),
    url: `${APP_URL}/o/${profile.handle}`,
    image: absolute(uploadUrl(profile.logoFile)),
    siteName: profile.displayName,
  };
}

/** The web app's index.html with the page's own title, description and Open Graph tags. */
export function withMeta(html: string, m: PageMeta) {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escape(m.siteName)}" />`,
    `<meta property="og:title" content="${escape(m.title)}" />`,
    `<meta property="og:description" content="${escape(m.description)}" />`,
    `<meta property="og:url" content="${escape(m.url)}" />`,
    m.image && `<meta property="og:image" content="${escape(m.image)}" />`,
    `<meta name="twitter:card" content="${m.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escape(m.title)}" />`,
    `<meta name="twitter:description" content="${escape(m.description)}" />`,
    m.image && `<meta name="twitter:image" content="${escape(m.image)}" />`,
    `<link rel="canonical" href="${escape(m.url)}" />`,
  ].filter(Boolean);
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(m.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escape(m.description)}" />`)
    .replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
}

