import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  FLOOR_MAP_MAX_BYTES,
  FLOOR_MAP_TYPES,
  MAX_SHOW_PAGE_SECTIONS,
  showPageSchema,
  suggestShowSlug,
  ticketsCandyUrl,
  type EventRecord,
  type ShowPageInput,
  type ShowPageResponse,
} from "@flightplan/shared";
import CopyButton from "../../components/CopyButton";
import { canEdit, EventTabs, SharedBadge } from "../../components/events";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import { ApiRequestError, useEvent, useSaveShowPage, useShowCover, useShowPage } from "../../lib/api";
import { DEFAULT_ACCENT } from "../ShowPage";
import { Field, inputClass, PrimaryButton, Section, Toggle } from "./ui";

// One content section on the page. `key` keeps rows stable while editing.
type SectionRow = { key: number; title: string; body: string };

type FormState = {
  slug: string;
  tagline: string;
  accentColor: string;
  sections: SectionRow[];
  showVendorBooking: boolean;
  tickets: string;
  ticketsHeight: string;
};

type Errors = Partial<Record<Exclude<keyof FormState, "sections" | "showVendorBooking">, string>> & {
  sections?: Record<number, { title?: string; body?: string }>;
  general?: string;
};

let nextKey = 1;

function fromPage(p: ShowPageResponse): FormState {
  return {
    slug: p.slug,
    tagline: p.settings.tagline,
    accentColor: p.settings.accentColor,
    sections: p.settings.sections.map((s) => ({ key: nextKey++, ...s })),
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
    sections: f.sections.map(({ title, body }) => ({ title, body })),
    showVendorBooking: f.showVendorBooking,
    tickets: f.tickets,
    ticketsHeight: f.ticketsHeight.trim() === "" ? NaN : Number(f.ticketsHeight),
  };
}

function toErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const { path, message } of issues) {
    const [field, index, sub] = path;
    if (field === "sections" && typeof index === "number" && (sub === "title" || sub === "body")) {
      errors.sections ??= {};
      errors.sections[index] ??= {};
      errors.sections[index][sub] ??= message;
    } else if (field === "sections") errors.general ??= message;
    else if (typeof field === "string") (errors as Record<string, string>)[field] ??= message;
  }
  return errors;
}

/** The event's public page: address, cover, look, content sections and the TicketsCandy widget. */
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
        <p className="min-w-0 text-sm sm:flex-1 font-semibold text-ink-soft">
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
  const strip = (f: FormState) => JSON.stringify({ ...f, sections: f.sections.map(({ key: _k, ...s }) => s) });
  const dirty = strip(form) !== strip(initial);
  const handlePrefix = page.url ? `${window.location.host}${page.url.replace(/[^/]*$/, "")}` : "";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function updateSection(key: number, patch: Partial<SectionRow>) {
    update(
      "sections",
      form.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
    setErrors((e) => ({ ...e, sections: undefined, general: undefined }));
  }

  function move(index: number, by: -1 | 1) {
    const next = [...form.sections];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    update("sections", next);
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
        const fieldErrors = err instanceof ApiRequestError ? err.body.fieldErrors : undefined;
        setErrors(
          fieldErrors
            ? Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]))
            : { general: err.message },
        );
      },
    });
  }

  const ticketsUrl = ticketsCandyUrl(form.tickets);
  const accent = form.accentColor || DEFAULT_ACCENT;

  return (
    <>
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
            <Field
              label="Page address"
              id="slug"
              className="sm:col-span-2"
              error={errors.slug}
              hint="Leave blank to use the show's name."
            >
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
              <input
                id="tagline"
                className={inputClass}
                maxLength={160}
                value={form.tagline}
                onChange={(e) => update("tagline", e.target.value)}
              />
            </Field>
            <Field label="Accent colour" id="accentColor" error={errors.accentColor} hint="Used for buttons and highlights.">
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
          </Section>

          <Section title="Tickets">
            <p className="text-sm text-ink-soft sm:col-span-2">
              Sell admission with TicketsCandy right on the show page. In TicketsCandy, open your event, go to{" "}
              <strong>Sell Online → Website Widget</strong>, choose <strong>Embed on Page</strong> and copy the code.
            </p>
            <Field
              label="TicketsCandy widget code"
              id="tickets"
              optional
              className="sm:col-span-2"
              error={errors.tickets}
            >
              <textarea
                id="tickets"
                rows={4}
                className={`${inputClass} resize-y font-mono text-sm`}
                placeholder='<iframe src="https://…ticketscandy.com/…"></iframe>'
                value={form.tickets}
                aria-invalid={!!errors.tickets}
                onChange={(e) => update("tickets", e.target.value)}
              />
              {form.tickets.trim() && !errors.tickets && (
                <p className={`text-sm font-semibold ${ticketsUrl ? "text-[#2d7a6a]" : "text-coral-ink"}`}>
                  {ticketsUrl ? (
                    <>
                      ✓ Widget found:{" "}
                      <a href={ticketsUrl} target="_blank" rel="noreferrer" className="break-all underline">
                        {ticketsUrl}
                      </a>
                    </>
                  ) : (
                    "No TicketsCandy address found in that code yet."
                  )}
                </p>
              )}
            </Field>
            <Field label="Widget height" id="ticketsHeight" error={errors.ticketsHeight} hint="In pixels. Make it taller if the widget scrolls.">
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

          <fieldset className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
            <legend className="sr-only">Page sections</legend>
            <h2 className="text-lg font-extrabold" aria-hidden="true">
              Page sections
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Your own content under the show details, e.g. “What to expect”, “Parking”, “FAQ”. Line breaks are kept.
            </p>
            <ol className="mt-5 space-y-4">
              {form.sections.map((s, i) => (
                <li key={s.key} className="rounded-2xl bg-cream-50 p-4 ring-1 ring-ink/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`section-${s.key}-title`} className="sr-only">
                      Section {i + 1} title
                    </label>
                    <input
                      id={`section-${s.key}-title`}
                      className={`${inputClass} min-w-0 flex-1 font-bold`}
                      placeholder="Section title"
                      maxLength={80}
                      value={s.title}
                      aria-invalid={!!errors.sections?.[i]?.title}
                      onChange={(e) => updateSection(s.key, { title: e.target.value })}
                    />
                    <div className="flex gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move section ${i + 1} up`} className="rounded-full px-3 py-2 font-bold text-ink-soft hover:bg-cream disabled:opacity-30">
                        ↑
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === form.sections.length - 1} aria-label={`Move section ${i + 1} down`} className="rounded-full px-3 py-2 font-bold text-ink-soft hover:bg-cream disabled:opacity-30">
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => update("sections", form.sections.filter((x) => x.key !== s.key))}
                        aria-label={`Remove section ${i + 1}`}
                        className="rounded-full p-2.5 text-coral-ink hover:bg-peach"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  </div>
                  <label htmlFor={`section-${s.key}-body`} className="sr-only">
                    Section {i + 1} text
                  </label>
                  <textarea
                    id={`section-${s.key}-body`}
                    rows={4}
                    className={`${inputClass} mt-2 resize-y`}
                    placeholder="Text for this section"
                    value={s.body}
                    aria-invalid={!!errors.sections?.[i]?.body}
                    onChange={(e) => updateSection(s.key, { body: e.target.value })}
                  />
                  {(errors.sections?.[i]?.title || errors.sections?.[i]?.body) && (
                    <p className="mt-1 text-sm font-semibold text-coral-ink">{errors.sections[i].title ?? errors.sections[i].body}</p>
                  )}
                </li>
              ))}
            </ol>
            {form.sections.length < MAX_SHOW_PAGE_SECTIONS && (
              <button
                type="button"
                onClick={() => update("sections", [...form.sections, { key: nextKey++, title: "", body: "" }])}
                className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-dashed border-coral/40 px-4 py-2 text-sm font-bold text-coral-ink hover:border-coral hover:bg-peach/30"
              >
                <PlusIcon className="size-4" /> Add a section
              </button>
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

        {errors.general && (
          <p className="rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {errors.general}
          </p>
        )}

        {!readOnly && (
          <div className="flex flex-col items-stretch gap-3 border-t border-ink/10 pt-6 sm:flex-row sm:items-center sm:justify-end">
            {saved && !dirty && (
              <span className="text-sm font-bold text-[#2d7a6a]" role="status">
                Saved
              </span>
            )}
            {dirty && <span className="text-sm text-ink-muted">Unsaved changes</span>}
            <PrimaryButton onClick={submit} pending={save.isPending}>
              Save page
            </PrimaryButton>
          </div>
        )}
      </form>
    </>
  );
}

function CoverField({ event, page, readOnly }: { event: EventRecord; page: ShowPageResponse; readOnly: boolean }) {
  const { upload, remove } = useShowCover(event.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? upload.error?.message ?? remove.error?.message;
  const maxMb = FLOOR_MAP_MAX_BYTES / 1024 / 1024;

  function onFile(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!(FLOOR_MAP_TYPES as readonly string[]).includes(file.type)) return setLocalError("Upload a PNG, JPEG or WebP image");
    if (file.size > FLOOR_MAP_MAX_BYTES) return setLocalError(`Images can be up to ${maxMb} MB`);
    upload.mutate(file);
  }

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="text-sm font-bold">
        Cover image <span className="font-normal text-ink-muted">(optional)</span>
      </span>
      {page.coverUrl ? (
        <img src={page.coverUrl} alt="" className="aspect-[3/1] w-full rounded-2xl bg-cream-50 object-cover ring-1 ring-ink/10" />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
          className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-coral/40 bg-peach/20 px-6 py-8 text-center transition hover:border-coral hover:bg-peach/40"
        >
          <span className="font-bold text-coral-ink">{upload.isPending ? "Uploading…" : "Upload a cover image"}</span>
          <span className="mt-1 text-sm text-ink-soft">A wide banner (about 3:1) works best. PNG, JPEG or WebP, up to {maxMb} MB.</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={FLOOR_MAP_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Cover image"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {page.coverUrl && !readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
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
