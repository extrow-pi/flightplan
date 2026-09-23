import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { z } from "zod";
import {
  addDays,
  daysBetween,
  eventInputSchema,
  FLOOR_MAP_MAX_BYTES,
  FLOOR_MAP_TYPES,
  MAX_EVENT_DAYS,
  type EventInput,
  type EventRecord,
  type EventStatus,
} from "@flightplan/shared";
import { EventTabs, SpawnDialog } from "../../components/events";
import { ArrowLeftIcon, CloseIcon, CopyIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import {
  ApiRequestError,
  useDeleteEvent,
  useEvent,
  useRemoveFloorMap,
  useSaveEvent,
  useUploadFloorMap,
} from "../../lib/api";
import { formatDate, todayISO } from "../../lib/format";

type Kind = "event" | "template";

// One schedule row. Events use `date`; templates use `day` (1 = first day).
type DayRow = { key: number; date: string; day: string; startTime: string; endTime: string };

// The form edits strings; prices are dollars here and cents in the API
type FormState = {
  name: string;
  description: string;
  venueName: string;
  address: string;
  city: string;
  days: DayRow[];
  vendorTables: string;
  tablePrice: string;
  ticketPrice: string;
  // Vendor booking
  requiresApproval: boolean;
  paymentDueDays: string;
  noDeadline: boolean;
  bookingOpen: boolean;
  paymentInstructions: string;
};

type Errors = Partial<Record<Exclude<keyof FormState, "days" | "requiresApproval" | "noDeadline" | "bookingOpen">, string>> & {
  days?: string;
  rows?: Record<number, Partial<Record<"date" | "day" | "startTime" | "endTime", string>>>;
};

let nextKey = 1;
const row = (r: Omit<DayRow, "key">): DayRow => ({ key: nextKey++, ...r });

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  venueName: "",
  address: "",
  city: "",
  days: [row({ date: "", day: "1", startTime: "11:00", endTime: "16:00" })],
  vendorTables: "",
  tablePrice: "",
  ticketPrice: "0",
  requiresApproval: false,
  paymentDueDays: "7",
  noDeadline: false,
  bookingOpen: false,
  paymentInstructions: "",
});

function fromEvent(e: EventRecord): FormState {
  return {
    name: e.name,
    description: e.description,
    venueName: e.venueName,
    address: e.address,
    city: e.city,
    days: e.days.map((d) =>
      row({
        date: e.startDate ? addDays(e.startDate, d.dayOffset) : "",
        day: String(d.dayOffset + 1),
        startTime: d.startTime,
        endTime: d.endTime,
      }),
    ),
    vendorTables: String(e.vendorTables),
    tablePrice: (e.tablePriceCents / 100).toString(),
    ticketPrice: (e.ticketPriceCents / 100).toString(),
    requiresApproval: e.requiresApproval,
    paymentDueDays: String(e.paymentDueDays ?? 7),
    noDeadline: e.paymentDueDays === null,
    bookingOpen: e.bookingOpen,
    paymentInstructions: e.paymentInstructions,
  };
}

const toCents = (dollars: string) => (dollars.trim() === "" ? NaN : Math.round(Number(dollars) * 100));
const toInt = (s: string) => (s.trim() === "" ? NaN : Number(s));

/**
 * Build the API payload. Rows are stored as offsets from the first day: dated rows use their
 * distance from the earliest date, template rows use their day number.
 */
function toInput(f: FormState, status: EventStatus, rowsAreDated: boolean): EventInput {
  let startDate: string | null = null;
  let offsets: number[];
  if (rowsAreDated) {
    startDate = f.days.map((d) => d.date).sort()[0];
    offsets = f.days.map((d) => daysBetween(startDate!, d.date));
  } else {
    offsets = f.days.map((d) => Number(d.day) - 1);
  }
  return {
    name: f.name,
    description: f.description,
    venueName: f.venueName,
    address: f.address,
    city: f.city,
    startDate: status === "template" ? null : startDate,
    days: f.days.map((d, i) => ({ dayOffset: offsets[i], startTime: d.startTime, endTime: d.endTime })),
    vendorTables: toInt(f.vendorTables),
    tablePriceCents: toCents(f.tablePrice),
    ticketPriceCents: toCents(f.ticketPrice),
    status,
    requiresApproval: f.requiresApproval,
    paymentDueDays: f.noDeadline ? null : toInt(f.paymentDueDays),
    // Templates never take bookings; drafts made from them start closed
    bookingOpen: status === "template" ? false : f.bookingOpen,
    paymentInstructions: f.paymentInstructions,
  };
}

/** Turn Zod issues into per-field and per-schedule-row messages. */
function toErrors(issues: z.core.$ZodIssue[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const [field, index, sub] = issue.path;
    if (field === "days" && typeof index === "number" && typeof sub === "string") {
      errors.rows ??= {};
      errors.rows[index] ??= {};
      const key = sub === "dayOffset" ? "day" : (sub as "startTime" | "endTime");
      errors.rows[index][key] ??= issue.message;
    } else if (field === "tablePriceCents") errors.tablePrice ??= issue.message;
    else if (field === "ticketPriceCents") errors.ticketPrice ??= issue.message;
    else if (field === "startDate") errors.days ??= "Pick a date for every day";
    else if (typeof field === "string") (errors as Record<string, string>)[field] ??= issue.message;
  }
  return errors;
}

/** The API returns flattened errors (top-level field names only). */
function fromServerErrors(fieldErrors: Record<string, string[] | undefined>): Errors {
  const errors: Errors = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const message = messages?.[0];
    if (!message) continue;
    if (field === "tablePriceCents") errors.tablePrice = message;
    else if (field === "ticketPriceCents") errors.ticketPrice = message;
    else if (field === "days" || field === "startDate") errors.days = message;
    else (errors as Record<string, string>)[field] = message;
  }
  return errors;
}

export default function EventFormPage({ kind: newKind = "event" }: { kind?: Kind }) {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);

  if (!id) return <EventForm key={`new-${newKind}`} kind={newKind} />;
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
  return <EventForm key={event.id} kind={event.status === "template" ? "template" : "event"} event={event} />;
}

function EventForm({ kind, event }: { kind: Kind; event?: EventRecord }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromTemplate = (location.state as { fromTemplate?: string } | null)?.fromTemplate;
  const save = useSaveEvent(event?.id);
  const saveAsTemplate = useSaveEvent(undefined, { floorMapFrom: event?.id });
  const del = useDeleteEvent();
  const [initial] = useState<FormState>(() => (event ? fromEvent(event) : emptyForm()));
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<EventRecord | null>(null);
  const [spawning, setSpawning] = useState(false);

  const isNew = !event;
  const isTemplateForm = kind === "template";
  const listPath = isTemplateForm ? "/dashboard/templates" : "/dashboard/events";
  const dirty = JSON.stringify({ ...form, days: form.days.map(({ key: _k, ...d }) => d) }) !==
    JSON.stringify({ ...initial, days: initial.days.map(({ key: _k, ...d }) => d) });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key !== "days" && errors[key as keyof Errors]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function updateDay(key: number, patch: Partial<DayRow>) {
    update(
      "days",
      form.days.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
    setErrors((e) => ({ ...e, days: undefined, rows: undefined }));
  }

  function addDay() {
    const last = form.days[form.days.length - 1];
    const latestDate = form.days.map((d) => d.date).filter(Boolean).sort().at(-1);
    const nextDay = Math.max(...form.days.map((d) => Number(d.day) || 0)) + 1;
    update("days", [
      ...form.days,
      row({
        date: latestDate ? addDays(latestDate, 1) : "",
        day: String(nextDay),
        startTime: last?.startTime ?? "10:00",
        endTime: last?.endTime ?? "17:00",
      }),
    ]);
  }

  function removeDay(key: number) {
    update(
      "days",
      form.days.filter((d) => d.key !== key),
    );
    setErrors((e) => ({ ...e, days: undefined, rows: undefined }));
  }

  /** Validate the form as `status`; returns the payload or shows errors. */
  function validate(status: EventStatus, rowsAreDated: boolean): EventInput | null {
    // Dated rows need a date before we can work out offsets
    if (rowsAreDated) {
      const missing = Object.fromEntries(
        form.days.flatMap((d, i) => (d.date ? [] : [[i, { date: "Pick a date" }]])),
      );
      if (Object.keys(missing).length) {
        setErrors({ rows: missing });
        return null;
      }
    }
    const input = toInput(form, status, rowsAreDated);
    const parsed = eventInputSchema.safeParse(input);
    if (!parsed.success) {
      const next = toErrors(parsed.error.issues);
      setErrors(next);
      const first = Object.keys(next).find((k) => k !== "rows" && k !== "days");
      if (first) document.getElementById(first)?.focus();
      else document.getElementById("schedule")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return null;
    }
    return input;
  }

  function submit(status: EventStatus) {
    setSavedTemplate(null);
    const input = validate(status, !isTemplateForm);
    if (!input) return;
    save.mutate(input, {
      onSuccess: () => navigate(listPath),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.body.fieldErrors) {
          setErrors(fromServerErrors(err.body.fieldErrors));
        }
      },
    });
  }

  /** Copy this event's current setup (including unsaved edits) into a new template. */
  function onSaveAsTemplate() {
    setSavedTemplate(null);
    const input = validate("template", true);
    if (!input) return;
    saveAsTemplate.mutate(input, { onSuccess: setSavedTemplate });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter keeps the current status
    submit(isTemplateForm ? "template" : (event?.status ?? "draft"));
  }

  const saveError = save.error ?? saveAsTemplate.error;
  const generalError = saveError && !(saveError instanceof ApiRequestError && saveError.body.fieldErrors);

  return (
    <>
      <Link
        to={listPath}
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" /> {isTemplateForm ? "All templates" : "All events"}
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {isTemplateForm
            ? isNew
              ? "Create a template"
              : `Edit template`
            : isNew
              ? "Create an event"
              : `Edit ${event.name}`}
        </h1>
        {isTemplateForm && (
          <span className="rounded-full bg-peach px-3 py-1 text-sm font-bold text-coral-ink">Template</span>
        )}
      </div>
      <p className="mt-2 text-ink-soft">
        {isTemplateForm
          ? "Templates have no dates, just the days and hours. Use one to create a dated draft whenever you plan the next show."
          : isNew
            ? "Save it as a draft while you plan. Publish when you're ready to open vendor tables."
            : event.status === "published"
              ? "This event is published."
              : "This event is a draft. Only you can see it."}
      </p>

      {!isNew && !isTemplateForm && <EventTabs eventId={event.id} />}

      {fromTemplate && !isTemplateForm && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#e8f8f5] px-5 py-4 text-[#2d7a6a]" role="status">
          <CopyIcon className="mt-0.5 size-5 shrink-0" />
          <p className="font-semibold">
            Draft created from template “{fromTemplate}”. Customize anything below, then publish when you're ready.
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-6">
        <Section title="The basics">
          <Field label={isTemplateForm ? "Template name" : "Event name"} id="name" error={errors.name} className="sm:col-span-2">
            <input
              id="name"
              className={inputClass}
              placeholder={isTemplateForm ? "Layover Weekend" : "Layover Card Show"}
              value={form.name}
              aria-invalid={!!errors.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field label="Description" id="description" optional error={errors.description} className="sm:col-span-2">
            <textarea
              id="description"
              rows={3}
              className={`${inputClass} resize-y`}
              placeholder="What makes this show worth the trip? Singles, sealed, tournaments…"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>
        </Section>

        <ScheduleEditor
          days={form.days}
          dated={!isTemplateForm}
          errors={errors}
          minDate={isNew ? todayISO() : undefined}
          onChange={updateDay}
          onAdd={addDay}
          onRemove={removeDay}
        />

        <Section title="Where">
          <Field label="Venue" id="venueName" error={errors.venueName}>
            <input
              id="venueName"
              className={inputClass}
              placeholder="RRGC Hall"
              value={form.venueName}
              aria-invalid={!!errors.venueName}
              onChange={(e) => update("venueName", e.target.value)}
            />
          </Field>
          <Field label="City" id="city" error={errors.city}>
            <input
              id="city"
              className={inputClass}
              placeholder="Richmond, BC"
              value={form.city}
              aria-invalid={!!errors.city}
              onChange={(e) => update("city", e.target.value)}
            />
          </Field>
          <Field label="Street address" id="address" optional error={errors.address} className="sm:col-span-2">
            <input
              id="address"
              autoComplete="street-address"
              className={inputClass}
              placeholder="7400 River Rd"
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Vendors & tickets">
          <Field label="Vendor tables" id="vendorTables" error={errors.vendorTables}>
            <input
              id="vendorTables"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className={inputClass}
              placeholder="48"
              value={form.vendorTables}
              aria-invalid={!!errors.vendorTables}
              onChange={(e) => update("vendorTables", e.target.value)}
            />
          </Field>
          <Field label="Price per table" id="tablePrice" error={errors.tablePrice} hint="For the whole show">
            <MoneyInput
              id="tablePrice"
              value={form.tablePrice}
              invalid={!!errors.tablePrice}
              onChange={(v) => update("tablePrice", v)}
              placeholder="80"
            />
          </Field>
          <Field label="Admission ticket" id="ticketPrice" error={errors.ticketPrice} hint="Use 0 for free entry">
            <MoneyInput
              id="ticketPrice"
              value={form.ticketPrice}
              invalid={!!errors.ticketPrice}
              onChange={(v) => update("ticketPrice", v)}
              placeholder="5"
            />
          </Field>
        </Section>

        <Section title="Vendor booking">
          <Toggle
            id="requiresApproval"
            className="sm:col-span-2"
            checked={form.requiresApproval}
            onChange={(v) => update("requiresApproval", v)}
            label="Approve vendors before they get a table"
            description="Requests from booking links wait for your approval. Tables you assign yourself are always approved."
          />
          <Field label="Vendors pay within" id="paymentDueDays" error={errors.paymentDueDays}>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  id="paymentDueDays"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={90}
                  disabled={form.noDeadline}
                  className={`${inputClass} pr-14 disabled:bg-cream-50 disabled:text-ink-muted`}
                  value={form.noDeadline ? "" : form.paymentDueDays}
                  aria-invalid={!!errors.paymentDueDays}
                  onChange={(e) => update("paymentDueDays", e.target.value)}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-ink-muted">
                  days
                </span>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="size-4 accent-coral"
                  checked={form.noDeadline}
                  onChange={(e) => update("noDeadline", e.target.checked)}
                />
                No deadline
              </label>
            </div>
          </Field>
          <p className="self-end text-xs text-ink-muted sm:pb-3">
            The clock starts when a table is approved. If it runs out, you'll see it on your dashboard and can release
            the table or give more time.
          </p>
          {!isTemplateForm && (
            <Toggle
              id="bookingOpen"
              className="sm:col-span-2"
              checked={form.bookingOpen}
              onChange={(v) => update("bookingOpen", v)}
              label="Public booking link is open"
              description="Anyone with the event's booking link can request a table once the event is published. Personal invite links work either way."
            />
          )}
          <Field
            label="Payment instructions"
            id="paymentInstructions"
            optional
            error={errors.paymentInstructions}
            className="sm:col-span-2"
            hint="Shown to vendors after they book, e.g. where to send an e-transfer."
          >
            <textarea
              id="paymentInstructions"
              rows={2}
              className={`${inputClass} resize-y`}
              placeholder="E-transfer the table fee to tables@yourshow.com with your business name in the message."
              value={form.paymentInstructions}
              onChange={(e) => update("paymentInstructions", e.target.value)}
            />
          </Field>
        </Section>

        <FloorMapSection event={event} />

        {generalError && (
          <p className="rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {saveError?.message}
          </p>
        )}

        {savedTemplate && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-[#e8f8f5] px-5 py-4 font-semibold text-[#2d7a6a]" role="status">
            <CopyIcon className="size-5" />
            Saved “{savedTemplate.name}” as a template.
            <Link to="/dashboard/templates" className="font-bold underline">
              View templates
            </Link>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-ink/10 pt-6 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            {!isNew &&
              (confirmDelete ? (
                <>
                  <span className="text-sm font-semibold text-coral-ink">Delete permanently?</span>
                  <button
                    type="button"
                    disabled={del.isPending}
                    onClick={() => del.mutate(event.id, { onSuccess: () => navigate(listPath) })}
                    className="rounded-full bg-coral-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {del.isPending ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-full px-3 py-2 text-sm font-bold text-ink-soft hover:bg-cream"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-coral-ink hover:bg-peach"
                >
                  <TrashIcon className="size-4" /> Delete {isTemplateForm ? "template" : "event"}
                </button>
              ))}
            {!isNew && !isTemplateForm && (
              <button
                type="button"
                onClick={onSaveAsTemplate}
                disabled={saveAsTemplate.isPending}
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-slate hover:bg-cream disabled:opacity-60"
              >
                <CopyIcon className="size-4" /> {saveAsTemplate.isPending ? "Saving template…" : "Save as template"}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:ml-auto">
            {isTemplateForm ? (
              <>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => setSpawning(true)}
                    disabled={dirty}
                    title={dirty ? "Save your changes first" : undefined}
                    className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-slate px-6 py-3 font-bold text-slate transition hover:bg-slate hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate"
                  >
                    <CopyIcon className="size-4" /> Use template
                  </button>
                )}
                <PrimaryButton onClick={() => submit("template")} pending={save.isPending}>
                  {isNew ? "Save template" : "Save changes"}
                </PrimaryButton>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => submit("draft")}
                  disabled={save.isPending}
                  className="rounded-full border-2 border-slate px-6 py-3 font-bold text-slate transition hover:bg-slate hover:text-white disabled:opacity-60"
                >
                  {save.isPending && save.variables?.status === "draft"
                    ? "Saving…"
                    : event?.status === "published"
                      ? "Save & unpublish"
                      : "Save as draft"}
                </button>
                <PrimaryButton onClick={() => submit("published")} pending={save.isPending && save.variables?.status === "published"}>
                  {event?.status === "published" ? "Save changes" : "Publish event"}
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
        {isTemplateForm && !isNew && dirty && (
          <p className="text-right text-xs text-ink-muted">Save your changes before using this template.</p>
        )}
      </form>

      {spawning && event && <SpawnDialog template={event} onClose={() => setSpawning(false)} />}
    </>
  );
}

function ScheduleEditor({
  days,
  dated,
  errors,
  minDate,
  onChange,
  onAdd,
  onRemove,
}: {
  days: DayRow[];
  dated: boolean;
  errors: Errors;
  minDate?: string;
  onChange: (key: number, patch: Partial<DayRow>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  return (
    <fieldset id="schedule" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
      <legend className="sr-only">Schedule</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold" aria-hidden="true">
          Schedule
        </h2>
        <p className="text-sm text-ink-muted">
          {dated ? "One row per show day, each with its own hours." : "Days are counted from the first day of the show."}
        </p>
      </div>

      <div className="mt-5 hidden grid-cols-[1.4fr_1fr_1fr_auto] gap-3 px-1 text-xs font-bold tracking-wider text-ink-muted uppercase sm:grid">
        <span>{dated ? "Date" : "Day"}</span>
        <span>Opens</span>
        <span>Closes</span>
        <span className="w-10" />
      </div>

      <ol className="mt-2 space-y-3">
        {days.map((d, i) => {
          const rowErrors = errors.rows?.[i] ?? {};
          const label = dated
            ? d.date
              ? formatDate(d.date, { weekday: "long" })
              : `Day ${i + 1}`
            : `Day ${d.day}`;
          return (
            <li
              key={d.key}
              className="grid grid-cols-2 gap-3 rounded-2xl bg-cream-50 p-3 ring-1 ring-ink/5 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-start sm:bg-transparent sm:p-0 sm:ring-0"
            >
              <div className="col-span-2 sm:col-span-1">
                {dated ? (
                  <input
                    type="date"
                    aria-label={`${label}: date`}
                    min={minDate}
                    className={inputClass}
                    value={d.date}
                    aria-invalid={!!rowErrors.date}
                    onChange={(e) => onChange(d.key, { date: e.target.value })}
                  />
                ) : (
                  <select
                    aria-label={`Day ${i + 1}: which day of the show`}
                    className={inputClass}
                    value={d.day}
                    aria-invalid={!!rowErrors.day}
                    onChange={(e) => onChange(d.key, { day: e.target.value })}
                  >
                    {Array.from({ length: MAX_EVENT_DAYS }, (_, n) => (
                      <option key={n} value={n + 1}>
                        Day {n + 1}
                      </option>
                    ))}
                  </select>
                )}
                {dated && d.date && <p className="mt-1 px-1 text-xs font-semibold text-ink-soft">{label}</p>}
                <RowError message={rowErrors.date ?? rowErrors.day} />
              </div>
              <div>
                <input
                  type="time"
                  aria-label={`${label}: opens`}
                  className={inputClass}
                  value={d.startTime}
                  aria-invalid={!!rowErrors.startTime}
                  onChange={(e) => onChange(d.key, { startTime: e.target.value })}
                />
                <RowError message={rowErrors.startTime} />
              </div>
              <div>
                <input
                  type="time"
                  aria-label={`${label}: closes`}
                  className={inputClass}
                  value={d.endTime}
                  aria-invalid={!!rowErrors.endTime}
                  onChange={(e) => onChange(d.key, { endTime: e.target.value })}
                />
                <RowError message={rowErrors.endTime} />
              </div>
              <button
                type="button"
                onClick={() => onRemove(d.key)}
                disabled={days.length === 1}
                className="col-span-2 flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold text-ink-soft transition hover:bg-peach hover:text-coral-ink disabled:invisible sm:col-span-1 sm:size-12 sm:py-0"
                aria-label={`Remove ${label}`}
                title="Remove day"
              >
                <CloseIcon className="size-4" />
                <span className="sm:hidden">Remove day</span>
              </button>
            </li>
          );
        })}
      </ol>

      {errors.days && (
        <p className="mt-3 text-sm font-semibold text-coral-ink" role="alert">
          {errors.days}
        </p>
      )}

      {days.length < MAX_EVENT_DAYS && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-dashed border-coral/40 px-5 py-2.5 text-sm font-bold text-coral-ink transition hover:border-coral hover:bg-peach/40"
        >
          <PlusIcon className="size-4" strokeWidth={3} /> Add another day
        </button>
      )}
    </fieldset>
  );
}

function RowError({ message }: { message?: string }) {
  return message ? <p className="mt-1 px-1 text-sm font-semibold text-coral-ink">{message}</p> : null;
}

function PrimaryButton({ onClick, pending, children }: { onClick: () => void; pending: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-7 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

const inputClass =
  "w-full rounded-xl border-2 border-cream bg-white px-4 py-3 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none aria-invalid:border-coral-ink";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
      <legend className="sr-only">{title}</legend>
      <h2 className="text-lg font-extrabold" aria-hidden="true">
        {title}
      </h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  id,
  optional,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  id: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="text-sm font-bold">
        {label} {optional && <span className="font-normal text-ink-muted">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="text-sm font-semibold text-coral-ink">{error}</p>
      ) : (
        hint && <p className="text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  invalid,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-bold text-ink-muted">$</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        className={`${inputClass} pl-8`}
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
  className = "",
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <label htmlFor={id} className={`flex cursor-pointer items-start gap-4 ${className}`}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-ink/15 transition peer-checked:bg-coral peer-focus-visible:ring-4 peer-focus-visible:ring-coral/25 after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
      />
      <span>
        <span className="block font-bold">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-ink-soft">{description}</span>}
      </span>
    </label>
  );
}

/** Upload, replace or remove the floor map image. Needs a saved event to attach it to. */
function FloorMapSection({ event }: { event?: EventRecord }) {
  return (
    <fieldset className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
      <legend className="sr-only">Floor map</legend>
      <h2 className="text-lg font-extrabold" aria-hidden="true">
        Floor map
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        An image of your floor plan with the table numbers on it. Vendors see it when they pick a table.
      </p>
      {event ? (
        <FloorMapUpload event={event} />
      ) : (
        <p className="mt-4 rounded-2xl bg-cream-50 px-4 py-3 text-sm font-semibold text-ink-soft ring-1 ring-ink/5">
          Save first, then you can upload a floor map here.
        </p>
      )}
    </fieldset>
  );
}

function FloorMapUpload({ event }: { event: EventRecord }) {
  const upload = useUploadFloorMap(event.id);
  const remove = useRemoveFloorMap(event.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? upload.error?.message ?? remove.error?.message;
  const maxMb = FLOOR_MAP_MAX_BYTES / 1024 / 1024;

  function onFile(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!(FLOOR_MAP_TYPES as readonly string[]).includes(file.type)) {
      return setLocalError("Upload a PNG, JPEG or WebP image");
    }
    if (file.size > FLOOR_MAP_MAX_BYTES) return setLocalError(`Images can be up to ${maxMb} MB`);
    upload.mutate(file);
  }

  return (
    <div className="mt-5">
      {event.floorMapUrl ? (
        <a
          href={event.floorMapUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl ring-1 ring-ink/10"
          title="Open full size"
        >
          <img
            src={event.floorMapUrl}
            alt={`Floor map for ${event.name}`}
            className="max-h-96 w-full bg-cream-50 object-contain"
          />
        </a>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
          className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-coral/40 bg-peach/20 px-6 py-10 text-center transition hover:border-coral hover:bg-peach/40"
        >
          <span className="font-bold text-coral-ink">{upload.isPending ? "Uploading…" : "Upload floor map"}</span>
          <span className="mt-1 text-sm text-ink-soft">
            PNG, JPEG or WebP, up to {maxMb} MB. Click or drop a file here.
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={FLOOR_MAP_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Floor map image"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {event.floorMapUrl && (
        <div className="mt-3 flex flex-wrap gap-2">
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
        <p className="mt-3 text-sm font-semibold text-coral-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
