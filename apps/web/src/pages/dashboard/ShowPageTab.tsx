import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  MAX_BLOCK_ITEMS,
  MAX_SHOW_PAGE_BLOCKS,
  SHOW_PAGE_THEMES,
  showPageSchema,
  suggestShowSlug,
  ticketsCandyEventId,
  ticketsCandyUrl,
  uploadPath,
  videoEmbedUrl,
  type EventRecord,
  type ShowPageBlockInput,
  type ShowPageBlockType,
  type ShowPageInput,
  type ShowPageResponse,
  type ShowPageTheme,
} from "@flightplan/shared";
import CopyButton from "../../components/CopyButton";
import { canEdit, EventTabs, SharedBadge } from "../../components/events";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import { ApiRequestError, useEvent, useSaveShowPage, useShowCover, useShowPage, useUploadPageImage } from "../../lib/api";
import { DEFAULT_ACCENT, THEMES } from "../ShowPage";
import { Field, ImageDropzone, inputClass, PrimaryButton, SaveStatus, Section, Toggle, useImagePicker, useUnsavedChanges } from "./ui";

// One block on the page while editing. `key` keeps rows stable; `id` is saved.
type BlockRow = ShowPageBlockInput & { key: number };

type FormState = {
  slug: string;
  tagline: string;
  accentColor: string;
  theme: ShowPageTheme;
  flyer: string;
  blocks: BlockRow[];
  showVendorBooking: boolean;
  tickets: string;
  ticketsHeight: string;
};

type Errors = Partial<Record<"slug" | "tagline" | "accentColor" | "flyer" | "tickets" | "ticketsHeight" | "general", string>> & {
  blocks?: Record<number, string>;
};

let nextKey = 1;

const blockTypes: { type: ShowPageBlockType; label: string; description: string; once?: boolean; make: () => ShowPageBlockInput }[] = [
  { type: "tickets", label: "Tickets", description: "Your TicketsCandy checkout", once: true, make: () => ({ id: newId(), type: "tickets", title: "Tickets" }) },
  { type: "text", label: "Text", description: "A heading and a paragraph", make: () => ({ id: newId(), type: "text", title: "", body: "" }) },
  { type: "faq", label: "FAQ", description: "Questions and answers", make: () => ({ id: newId(), type: "faq", title: "FAQ", items: [{ question: "", answer: "" }] }) },
  { type: "gallery", label: "Photo gallery", description: "Photos from past shows", make: () => ({ id: newId(), type: "gallery", title: "Photos", images: [] }) },
  { type: "video", label: "Video", description: "A YouTube or Vimeo video", make: () => ({ id: newId(), type: "video", title: "", url: "" }) },
  { type: "links", label: "Link buttons", description: "Instagram, Discord, a sign-up form…", make: () => ({ id: newId(), type: "links", title: "", links: [{ label: "", url: "" }] }) },
  { type: "sponsors", label: "Sponsors", description: "Logos, with links", make: () => ({ id: newId(), type: "sponsors", title: "Sponsors", items: [] }) },
  { type: "map", label: "Venue map", description: "A map of the venue", once: true, make: () => ({ id: newId(), type: "map", title: "Getting there" }) },
];
const makeBlock = (type: ShowPageBlockType) => blockTypes.find((t) => t.type === type)!.make();
const typeLabel = Object.fromEntries(blockTypes.map((t) => [t.type, t.label])) as Record<ShowPageBlockType, string>;

function newId() {
  return crypto.randomUUID();
}

function fromPage(p: ShowPageResponse): FormState {
  return {
    slug: p.slug,
    tagline: p.settings.tagline,
    accentColor: p.settings.accentColor,
    theme: p.settings.theme,
    flyer: p.settings.flyer,
    blocks: p.settings.blocks.map((b) => ({ ...b, key: nextKey++ })),
    showVendorBooking: p.settings.showVendorBooking,
    tickets: p.settings.tickets,
    ticketsHeight: String(p.settings.ticketsHeight),
  };
}

function toInput(f: FormState): ShowPageInput {
  return {
    slug: f.slug,
    tagline: f.tagline,
    accentColor: f.accentColor,
    theme: f.theme,
    flyer: f.flyer,
    blocks: f.blocks.map(({ key: _k, ...b }) => b),
    showVendorBooking: f.showVendorBooking,
    tickets: f.tickets,
    ticketsHeight: f.ticketsHeight.trim() === "" ? NaN : Number(f.ticketsHeight),
  };
}

function toErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const { path, message } of issues) {
    const [field, index] = path;
    if (field === "blocks" && typeof index === "number") {
      errors.blocks ??= {};
      errors.blocks[index] ??= message;
    } else if (field === "blocks") errors.general ??= message;
    else if (typeof field === "string") (errors as Record<string, string>)[field] ??= message;
  }
  return errors;
}

/** The event's public page: address, look, flyer, blocks and the TicketsCandy widget. */
export default function ShowPageTab() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const page = useShowPage(event && event.status !== "template" ? event.id : undefined);

  if (isPending) return <p className="text-ink-muted" role="status">Loading…</p>;
  if (error || !event || event.status === "template") {
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

      {page.error ? (
        <p className="mt-6 rounded-2xl bg-peach px-5 py-4 font-semibold text-coral-ink" role="alert">
          Couldn't load the show page: {page.error.message}
        </p>
      ) : page.isPending ? (
        <p className="mt-6 text-ink-muted" role="status">
          Loading…
        </p>
      ) : (
        <PageForm key={event.id} event={event} page={page.data} />
      )}
    </>
  );
}

const hiddenText: Record<NonNullable<ShowPageResponse["hiddenBecause"]>, string> = {
  "no-profile": "Set up your public organizer page in Settings first. Show pages live under it.",
  "profile-off": "Your organizer page is switched off in Settings, so this page isn't visible yet.",
  "not-published": "This show is a draft. Publish it to make its page visible.",
};

function PageStatus({ page }: { page: ShowPageResponse }) {
  const absolute = page.url ? `${window.location.origin}${page.url}` : null;
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-ink/5 sm:flex-row sm:items-center">
      {page.hiddenBecause ? (
        <p className="min-w-0 text-sm font-semibold text-ink-soft sm:flex-1">
          {hiddenText[page.hiddenBecause]}{" "}
          {page.hiddenBecause !== "not-published" && (
            <Link to="/dashboard/settings" className="font-bold text-coral-ink hover:underline">
              Open Settings
            </Link>
          )}
        </p>
      ) : (
        <p className="min-w-0 text-sm sm:flex-1">
          <span className="font-bold text-[#2d7a6a]">Live</span>
          <span className="text-ink-soft"> at </span>
          <a href={page.url!} target="_blank" rel="noreferrer" className="font-bold break-all text-coral-ink hover:underline">
            {absolute?.replace(/^https?:\/\//, "")}
          </a>
        </p>
      )}
      {page.url && (
        <div className="flex flex-wrap gap-2">
          {absolute && !page.hiddenBecause && <CopyButton text={absolute} />}
          {page.hiddenBecause !== "no-profile" && (
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border-2 border-slate/30 px-3 py-1 text-sm font-bold text-slate transition hover:border-slate"
            >
              {page.hiddenBecause ? "Preview" : "View page"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PageForm({ event, page }: { event: EventRecord; page: ShowPageResponse }) {
  const save = useSaveShowPage(event.id);
  const [initial, setInitial] = useState(() => fromPage(page));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const readOnly = !canEdit(event);
  const strip = (f: FormState) => JSON.stringify({ ...f, blocks: f.blocks.map(({ key: _k, ...b }) => b) });
  const dirty = strip(form) !== strip(initial);
  const guard = useUnsavedChanges(dirty && !readOnly);
  const handlePrefix = page.url ? `${window.location.host}${page.url.replace(/[^/]*$/, "")}` : "";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function setBlocks(blocks: BlockRow[]) {
    update("blocks", blocks);
    setErrors((e) => ({ ...e, blocks: undefined, general: undefined }));
  }

  function updateBlock(key: number, patch: Partial<Record<string, unknown>>) {
    setBlocks(form.blocks.map((b) => (b.key === key ? ({ ...b, ...patch } as BlockRow) : b)));
  }

  function move(index: number, by: -1 | 1) {
    const next = [...form.blocks];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setBlocks(next);
  }

  function onTickets(value: string) {
    update("tickets", value);
    // A pasted widget needs somewhere to go: add a Tickets block at the top
    if (ticketsCandyUrl(value) && !form.blocks.some((b) => b.type === "tickets")) {
      setForm((f) => ({ ...f, tickets: value, blocks: [{ ...makeBlock("tickets"), key: nextKey++ }, ...f.blocks] }));
    }
  }

  function discard() {
    setForm(initial);
    setErrors({});
    setSaved(false);
  }

  function submit() {
    const parsed = showPageSchema.safeParse(toInput(form));
    if (!parsed.success) return setErrors(toErrors(parsed.error.issues));
    save.mutate(toInput(form), {
      onSuccess: (p) => {
        const next = fromPage(p);
        setInitial(next);
        setForm(next);
        setSaved(true);
      },
      onError: (err) => {
        const fieldErrors = err instanceof ApiRequestError ? (err.body.fieldErrors ?? {}) : {};
        const first = (k: string) => fieldErrors[k]?.[0];
        // Block errors come back as one message for the whole list, so they're shown with the general one
        setErrors({
          slug: first("slug"),
          tagline: first("tagline"),
          accentColor: first("accentColor"),
          flyer: first("flyer"),
          tickets: first("tickets"),
          ticketsHeight: first("ticketsHeight"),
          general: first("blocks") ?? err.message,
        });
      },
    });
  }

  const ticketsUrl = ticketsCandyUrl(form.tickets);
  const accent = form.accentColor || DEFAULT_ACCENT;
  const errorCount = Object.keys(errors.blocks ?? {}).length;

  return (
    <>
      {guard.dialog}
      <PageStatus page={page} />
      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <fieldset disabled={readOnly} className="min-w-0 space-y-6">
          <Section title="Look">
            <Field label="Page address" id="slug" className="sm:col-span-2" error={errors.slug} hint="Leave blank to use the show's name.">
              <div className="flex min-w-0 items-center rounded-xl border-2 border-cream bg-white focus-within:border-coral focus-within:ring-4 focus-within:ring-coral/15">
                {handlePrefix && <span className="hidden shrink-0 pl-4 text-ink-muted sm:inline">{handlePrefix}</span>}
                <input
                  id="slug"
                  className="w-full min-w-0 rounded-xl bg-transparent px-4 py-3 focus:outline-none sm:pl-0"
                  placeholder={suggestShowSlug(event.name)}
                  value={form.slug}
                  aria-invalid={!!errors.slug}
                  onChange={(e) => update("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                />
              </div>
            </Field>
            <Field label="Tagline" id="tagline" optional className="sm:col-span-2" error={errors.tagline} hint="A line under the show's name, e.g. “Vancouver's biggest card night”.">
              <input id="tagline" className={inputClass} maxLength={160} value={form.tagline} onChange={(e) => update("tagline", e.target.value)} />
            </Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-sm font-bold" id="theme-label">
                Theme
              </span>
              <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-labelledby="theme-label">
                {SHOW_PAGE_THEMES.map((t) => {
                  const v = THEMES[t].vars;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={form.theme === t}
                      onClick={() => update("theme", t)}
                      className={`overflow-hidden rounded-2xl text-left ring-2 transition ${form.theme === t ? "ring-coral" : "ring-ink/10 hover:ring-ink/30"}`}
                    >
                      <span className="block p-3" style={{ background: v["--bg"] }}>
                        <span className="block rounded-lg p-2" style={{ background: v["--card"] }}>
                          <span className="block h-2 w-3/4 rounded" style={{ background: v["--text"] }} />
                          <span className="mt-1.5 block h-1.5 w-1/2 rounded" style={{ background: v["--muted"] }} />
                          <span className="mt-2 block h-3 w-10 rounded-full" style={{ background: accent }} />
                        </span>
                      </span>
                      <span className="block bg-white px-3 py-1.5 text-sm font-bold">{THEMES[t].label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Accent colour" id="accentColor" error={errors.accentColor} hint="Buttons and highlights.">
              <div className="flex items-center gap-3">
                <input
                  id="accentColor"
                  type="color"
                  className="h-12 w-16 cursor-pointer rounded-xl border-2 border-cream bg-white p-1"
                  value={accent}
                  onChange={(e) => update("accentColor", e.target.value)}
                />
                <span className="font-mono text-sm text-ink-soft">{accent}</span>
                {form.accentColor && (
                  <button type="button" onClick={() => update("accentColor", "")} className="text-sm font-bold text-coral-ink hover:underline">
                    Reset
                  </button>
                )}
              </div>
            </Field>
            <CoverField event={event} page={page} readOnly={readOnly} />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-sm font-bold">
                Flyer <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <p className="text-xs text-ink-muted">Shown full width under the show's name. Visitors can tap it to see it full size.</p>
              {form.flyer ? (
                <div className="flex flex-wrap items-end gap-3">
                  <img src={uploadPath(form.flyer)} alt="Flyer" className="max-h-72 w-auto rounded-2xl ring-1 ring-ink/10" />
                  {!readOnly && (
                    <button type="button" onClick={() => update("flyer", "")} className="rounded-full px-4 py-2 text-sm font-bold text-coral-ink hover:bg-peach">
                      Remove flyer
                    </button>
                  )}
                </div>
              ) : (
                <ImageUpload eventId={event.id} label="Upload a flyer" onUploaded={(files) => update("flyer", files[0])} />
              )}
            </div>
          </Section>

          <Section title="Tickets">
            <p className="text-sm text-ink-soft sm:col-span-2">
              Sell admission with TicketsCandy right on the show page. In TicketsCandy, open your event, go to{" "}
              <strong>Sell Online → Website Widget</strong>, choose <strong>Embed on Page</strong> and copy the code.
            </p>
            <Field label="TicketsCandy widget code" id="tickets" optional className="sm:col-span-2" error={errors.tickets}>
              <textarea
                id="tickets"
                rows={4}
                className={`${inputClass} resize-y font-mono text-sm`}
                placeholder={'<div id="tc-checkout-container-…"></div>\n<script src="https://ticketscandy.com/checkout-widget/loader.js"></script>\n…'}
                value={form.tickets}
                aria-invalid={!!errors.tickets}
                onChange={(e) => onTickets(e.target.value)}
              />
              {ticketsUrl && !form.blocks.some((b) => b.type === "tickets") && (
                <p className="text-sm font-semibold text-coral-ink">
                  The page has no Tickets block, so the widget won't show.{" "}
                  <button
                    type="button"
                    onClick={() => setBlocks([{ ...makeBlock("tickets"), key: nextKey++ }, ...form.blocks])}
                    className="font-bold underline"
                  >
                    Add one at the top
                  </button>
                </p>
              )}
              {form.tickets.trim() && !errors.tickets && (
                <p className={`text-sm font-semibold ${ticketsUrl ? "text-[#2d7a6a]" : "text-coral-ink"}`}>
                  {ticketsUrl ? (
                    <>
                      ✓{" "}
                      <a href={ticketsUrl} target="_blank" rel="noreferrer" className="break-all underline">
                        {ticketsCandyEventId(ticketsUrl) ? `TicketsCandy checkout for event ${ticketsCandyEventId(ticketsUrl)}` : ticketsUrl}
                      </a>
                    </>
                  ) : (
                    "No TicketsCandy address found in that code yet."
                  )}
                </p>
              )}
            </Field>
            <Field label="Widget height" id="ticketsHeight" error={errors.ticketsHeight} hint="In pixels, while it loads. The TicketsCandy checkout then grows to fit.">
              <input
                id="ticketsHeight"
                type="number"
                inputMode="numeric"
                min={300}
                max={3000}
                step={50}
                className={inputClass}
                value={form.ticketsHeight}
                aria-invalid={!!errors.ticketsHeight}
                onChange={(e) => update("ticketsHeight", e.target.value)}
              />
            </Field>
          </Section>

          <fieldset className="min-w-0 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
            <legend className="sr-only">Page blocks</legend>
            <h2 className="text-lg font-extrabold" aria-hidden="true">
              Page blocks
            </h2>
            <p className="mt-1 text-sm text-ink-soft">These appear under the show details, in this order.</p>
            <ol className="mt-5 space-y-4">
              {form.blocks.map((b, i) => (
                <li key={b.key} className={`rounded-2xl bg-cream-50 p-4 ring-1 ${errors.blocks?.[i] ? "ring-coral-ink" : "ring-ink/5"}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold tracking-wider text-coral-ink uppercase ring-1 ring-ink/5">
                      {typeLabel[b.type]}
                    </span>
                    <div className="ml-auto flex gap-1">
                      <IconButton label={`Move ${typeLabel[b.type]} block up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </IconButton>
                      <IconButton label={`Move ${typeLabel[b.type]} block down`} disabled={i === form.blocks.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </IconButton>
                      <IconButton label={`Remove ${typeLabel[b.type]} block`} danger onClick={() => setBlocks(form.blocks.filter((x) => x.key !== b.key))}>
                        <TrashIcon className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <BlockEditor block={b} eventId={event.id} onChange={(patch) => updateBlock(b.key, patch)} hasTickets={!!ticketsUrl} />
                  </div>
                  {errors.blocks?.[i] && <p className="mt-2 text-sm font-semibold text-coral-ink">{errors.blocks[i]}</p>}
                </li>
              ))}
            </ol>
            {form.blocks.length < MAX_SHOW_PAGE_BLOCKS && !readOnly && (
              <AddBlock blocks={form.blocks} onAdd={(block) => setBlocks([...form.blocks, { ...block, key: nextKey++ }])} />
            )}
          </fieldset>

          <Section title="Vendors">
            <Toggle
              id="showVendorBooking"
              className="sm:col-span-2"
              checked={form.showVendorBooking}
              onChange={(v) => update("showVendorBooking", v)}
              label="Show “Book a vendor table” on this page"
              description="Only while the show's booking link is open (Details → Vendor booking)."
            />
          </Section>
        </fieldset>

        {(errors.general || errorCount > 0) && (
          <p className="rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {errors.general ?? `Please fix the highlighted ${errorCount === 1 ? "block" : "blocks"}.`}
          </p>
        )}

        {!readOnly && (
          <div className="sticky bottom-0 -mx-1 flex flex-col items-stretch gap-3 border-t border-ink/10 bg-cream-50/95 px-1 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-end">
            {saved && !dirty && (
              <span className="text-sm font-bold text-[#2d7a6a]" role="status">
                Saved
              </span>
            )}
            <SaveStatus dirty={dirty} onDiscard={discard} />
            <PrimaryButton onClick={submit} pending={save.isPending}>
              Save page
            </PrimaryButton>
          </div>
        )}
      </form>
    </>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex size-9 items-center justify-center rounded-full font-bold disabled:opacity-30 ${danger ? "text-coral-ink hover:bg-peach" : "text-ink-soft hover:bg-cream"}`}
    >
      {children}
    </button>
  );
}

function AddBlock({ blocks, onAdd }: { blocks: BlockRow[]; onAdd: (block: ShowPageBlockInput) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-dashed border-coral/40 px-4 py-2 text-sm font-bold text-coral-ink hover:border-coral hover:bg-peach/30"
      >
        <PlusIcon className="size-4" /> Add a block
      </button>
    );
  }
  return (
    <div className="mt-4 rounded-2xl bg-cream-50 p-4 ring-1 ring-ink/5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">Add a block</p>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-ink-soft hover:underline">
          Cancel
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {blockTypes.map((t) => {
          const taken = t.once && blocks.some((b) => b.type === t.type);
          return (
            <button
              key={t.type}
              type="button"
              disabled={taken}
              onClick={() => {
                onAdd(t.make());
                setOpen(false);
              }}
              className="rounded-xl bg-white px-4 py-3 text-left ring-1 ring-ink/10 transition hover:ring-coral disabled:opacity-40 disabled:hover:ring-ink/10"
            >
              <span className="block font-bold">{t.label}</span>
              <span className="block text-sm text-ink-soft">{taken ? "Already on the page" : t.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const smallInput = `${inputClass} py-2`;

function BlockEditor({
  block: b,
  eventId,
  hasTickets,
  onChange,
}: {
  block: BlockRow;
  eventId: string;
  hasTickets: boolean;
  onChange: (patch: Partial<Record<string, unknown>>) => void;
}) {
  const title = (placeholder: string, required = false) => (
    <input
      className={`${smallInput} font-bold`}
      placeholder={required ? placeholder : `${placeholder} (optional)`}
      aria-label="Block title"
      maxLength={80}
      value={b.title ?? ""}
      onChange={(e) => onChange({ title: e.target.value })}
    />
  );

  switch (b.type) {
    case "tickets":
      return (
        <>
          {title("Heading")}
          {!hasTickets && <p className="text-sm text-ink-soft">Paste your TicketsCandy widget code under Tickets above. Until then this block is hidden.</p>}
        </>
      );
    case "map":
      return (
        <>
          {title("Heading")}
          <p className="text-sm text-ink-soft">A map of the venue address from Details.</p>
        </>
      );
    case "text":
      return (
        <>
          {title("Heading, e.g. What to expect", true)}
          <textarea
            rows={4}
            className={`${inputClass} resize-y`}
            aria-label="Text"
            placeholder="Text. Line breaks are kept."
            value={b.body}
            onChange={(e) => onChange({ body: e.target.value })}
          />
        </>
      );
    case "video":
      return (
        <>
          {title("Heading")}
          <input
            className={smallInput}
            aria-label="Video link"
            placeholder="https://www.youtube.com/watch?v=…"
            value={b.url}
            onChange={(e) => onChange({ url: e.target.value })}
          />
          {b.url.trim() && !videoEmbedUrl(b.url) && <p className="text-sm font-semibold text-coral-ink">Paste a YouTube or Vimeo link.</p>}
        </>
      );
    case "faq": {
      const items = b.items;
      const set = (next: typeof items) => onChange({ items: next });
      return (
        <>
          {title("Heading")}
          {items.map((item, i) => (
            <div key={i} className="rounded-xl bg-white p-3 ring-1 ring-ink/5">
              <div className="flex gap-2">
                <input
                  className={`${smallInput} font-semibold`}
                  aria-label={`Question ${i + 1}`}
                  placeholder="Question"
                  value={item.question}
                  onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                />
                <IconButton label={`Remove question ${i + 1}`} danger disabled={items.length === 1} onClick={() => set(items.filter((_, j) => j !== i))}>
                  <TrashIcon className="size-4" />
                </IconButton>
              </div>
              <textarea
                rows={2}
                className={`${smallInput} mt-2 resize-y`}
                aria-label={`Answer ${i + 1}`}
                placeholder="Answer"
                value={item.answer}
                onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
              />
            </div>
          ))}
          {items.length < MAX_BLOCK_ITEMS && (
            <button type="button" onClick={() => set([...items, { question: "", answer: "" }])} className="text-sm font-bold text-coral-ink hover:underline">
              + Add a question
            </button>
          )}
        </>
      );
    }
    case "links": {
      const links = b.links;
      const set = (next: typeof links) => onChange({ links: next });
      return (
        <>
          {title("Heading")}
          {links.map((l, i) => (
            <div key={i} className="flex flex-col gap-2 sm:flex-row">
              <input
                className={`${smallInput} sm:w-48`}
                aria-label={`Button ${i + 1} label`}
                placeholder="Label, e.g. Instagram"
                value={l.label}
                onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <div className="flex min-w-0 flex-1 gap-2">
                <input
                  className={smallInput}
                  aria-label={`Button ${i + 1} link`}
                  placeholder="https://…"
                  value={l.url}
                  onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <IconButton label={`Remove button ${i + 1}`} danger disabled={links.length === 1} onClick={() => set(links.filter((_, j) => j !== i))}>
                  <TrashIcon className="size-4" />
                </IconButton>
              </div>
            </div>
          ))}
          {links.length < 12 && (
            <button type="button" onClick={() => set([...links, { label: "", url: "" }])} className="text-sm font-bold text-coral-ink hover:underline">
              + Add a button
            </button>
          )}
        </>
      );
    }
    case "gallery": {
      const images = b.images;
      return (
        <>
          {title("Heading")}
          {images.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {images.map((file, i) => (
                <li key={file} className="relative">
                  <img src={uploadPath(file)} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-xl object-cover ring-1 ring-ink/10" />
                  <button
                    type="button"
                    onClick={() => onChange({ images: images.filter((f) => f !== file) })}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-white/90 text-coral-ink shadow"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {images.length < MAX_BLOCK_ITEMS && (
            <ImageUpload eventId={eventId} multiple label="Add photos" onUploaded={(files) => onChange({ images: [...images, ...files].slice(0, MAX_BLOCK_ITEMS) })} />
          )}
        </>
      );
    }
    case "sponsors": {
      const items = b.items;
      const set = (next: typeof items) => onChange({ items: next });
      return (
        <>
          {title("Heading")}
          {items.map((item, i) => (
            <div key={item.image} className="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-ink/5 sm:flex-row sm:items-center">
              <img src={uploadPath(item.image)} alt="" className="h-14 w-24 shrink-0 rounded-lg object-contain ring-1 ring-ink/10" />
              <input
                className={`${smallInput} sm:w-56 sm:shrink-0`}
                aria-label={`Sponsor ${i + 1} name`}
                placeholder="Name (optional)"
                value={item.name ?? ""}
                onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <div className="flex min-w-0 flex-1 gap-2">
                <input
                  className={smallInput}
                  aria-label={`Sponsor ${i + 1} link`}
                  placeholder="Link (optional)"
                  value={item.url ?? ""}
                  onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <IconButton label={`Remove sponsor ${i + 1}`} danger onClick={() => set(items.filter((_, j) => j !== i))}>
                  <TrashIcon className="size-4" />
                </IconButton>
              </div>
            </div>
          ))}
          {items.length < MAX_BLOCK_ITEMS && (
            <ImageUpload
              eventId={eventId}
              multiple
              label="Add sponsor logos"
              onUploaded={(files) => set([...items, ...files.map((image) => ({ image, name: "", url: "" }))].slice(0, MAX_BLOCK_ITEMS))}
            />
          )}
        </>
      );
    }
  }
}

/** Upload one or more images for the page; hands back the stored file names, in the order chosen. */
function ImageUpload({ eventId, label, multiple, onUploaded }: { eventId: string; label: string; multiple?: boolean; onUploaded: (files: string[]) => void }) {
  const upload = useUploadPageImage(eventId);
  const [busy, setBusy] = useState(false);
  const picker = useImagePicker({ label, multiple, onFiles: (files) => void uploadAll(files) });

  async function uploadAll(files: File[]) {
    setBusy(true);
    const results = await Promise.allSettled(files.map((f) => upload.mutateAsync(f)));
    setBusy(false);
    const done = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.file] : []));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) picker.setError(failed.reason instanceof Error ? failed.reason.message : "Upload failed");
    if (done.length) onUploaded(done);
  }

  return (
    <div>
      <ImageDropzone label={label} multiple={multiple} busy={busy} picker={picker} className="py-6" />
      {picker.input}
      {picker.error && (
        <p className="mt-2 text-sm font-semibold text-coral-ink" role="alert">
          {picker.error}
        </p>
      )}
    </div>
  );
}

function CoverField({ event, page, readOnly }: { event: EventRecord; page: ShowPageResponse; readOnly: boolean }) {
  const { upload, remove } = useShowCover(event.id);
  const picker = useImagePicker({ label: "Cover image", onFiles: ([file]) => upload.mutate(file) });
  const error = picker.error ?? upload.error?.message ?? remove.error?.message;

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="text-sm font-bold">
        Cover image <span className="font-normal text-ink-muted">(optional)</span>
      </span>
      <p className="text-xs text-ink-muted">A wide banner across the top of the page and on the show's card. Saved straight away.</p>
      {page.coverUrl ? (
        <img src={page.coverUrl} alt="" className="aspect-[3/1] w-full rounded-2xl bg-cream-50 object-cover ring-1 ring-ink/10" />
      ) : (
        <ImageDropzone label="Upload a cover image" hint="About 3:1 works best." busy={upload.isPending} picker={picker} className="py-8" />
      )}
      {picker.input}
      {page.coverUrl && !readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={picker.open}
            disabled={upload.isPending}
            className="rounded-full border-2 border-slate/30 px-4 py-2 text-sm font-bold text-slate hover:border-slate disabled:opacity-60"
          >
            {upload.isPending ? "Uploading…" : "Replace image"}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="rounded-full px-4 py-2 text-sm font-bold text-coral-ink hover:bg-peach disabled:opacity-60"
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </button>
        </div>
      )}
      {error && (
        <p className="text-sm font-semibold text-coral-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
