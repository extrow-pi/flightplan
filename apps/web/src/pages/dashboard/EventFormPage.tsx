import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { eventInputSchema, type EventFieldErrors, type EventInput, type EventRecord, type EventStatus } from "@flightplan/shared";
import { ArrowLeftIcon, TrashIcon } from "../../components/Icons";
import { ApiRequestError, useDeleteEvent, useEvent, useSaveEvent } from "../../lib/api";
import { todayISO } from "../../lib/format";

// The form edits strings; prices are dollars here and cents in the API
type FormState = {
  name: string;
  description: string;
  venueName: string;
  address: string;
  city: string;
  date: string;
  startTime: string;
  endTime: string;
  vendorTables: string;
  tablePrice: string;
  ticketPrice: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  venueName: "",
  address: "",
  city: "",
  date: "",
  startTime: "11:00",
  endTime: "16:00",
  vendorTables: "",
  tablePrice: "",
  ticketPrice: "0",
};

function fromEvent(e: EventRecord): FormState {
  return {
    name: e.name,
    description: e.description,
    venueName: e.venueName,
    address: e.address,
    city: e.city,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    vendorTables: String(e.vendorTables),
    tablePrice: (e.tablePriceCents / 100).toString(),
    ticketPrice: (e.ticketPriceCents / 100).toString(),
  };
}

const toCents = (dollars: string) => (dollars.trim() === "" ? NaN : Math.round(Number(dollars) * 100));
const toInt = (s: string) => (s.trim() === "" ? NaN : Number(s));

function toInput(f: FormState, status: EventStatus): EventInput {
  return {
    name: f.name,
    description: f.description,
    venueName: f.venueName,
    address: f.address,
    city: f.city,
    date: f.date,
    startTime: f.startTime,
    endTime: f.endTime,
    vendorTables: toInt(f.vendorTables),
    tablePriceCents: toCents(f.tablePrice),
    ticketPriceCents: toCents(f.ticketPrice),
    status,
  };
}

// Map API field names back to form field names for error display
const errorField: Partial<Record<keyof EventInput, keyof FormState>> = {
  tablePriceCents: "tablePrice",
  ticketPriceCents: "ticketPrice",
};

export default function EventFormPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);

  if (!id) return <EventForm key="new" />;
  if (isPending) return <p className="text-ink-muted" role="status">Loading event…</p>;
  if (error || !event) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
        <p className="text-lg font-extrabold">
          {error instanceof ApiRequestError && error.status === 404 ? "Event not found" : "Couldn't load this event"}
        </p>
        <Link to="/dashboard/events" className="mt-4 inline-block font-bold text-coral-ink hover:underline">
          Back to events
        </Link>
      </div>
    );
  }
  return <EventForm key={event.id} event={event} />;
}

function EventForm({ event }: { event?: EventRecord }) {
  const navigate = useNavigate();
  const save = useSaveEvent(event?.id);
  const del = useDeleteEvent();
  const [form, setForm] = useState<FormState>(event ? fromEvent(event) : emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !event;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function showFieldErrors(fieldErrors: EventFieldErrors | Record<string, string[] | undefined>) {
    const next: Partial<Record<keyof FormState, string>> = {};
    for (const [key, messages] of Object.entries(fieldErrors)) {
      const field = errorField[key as keyof EventInput] ?? (key as keyof FormState);
      if (messages?.[0]) next[field] = messages[0];
    }
    setErrors(next);
    // Bring the first problem into view
    const first = Object.keys(next)[0];
    if (first) document.getElementById(first)?.focus();
  }

  function submit(status: EventStatus) {
    const input = toInput(form, status);
    const parsed = eventInputSchema.safeParse(input);
    if (!parsed.success) return showFieldErrors(z.flattenError(parsed.error).fieldErrors);

    save.mutate(input, {
      onSuccess: () => navigate("/dashboard/events"),
      onError: (err) => {
        if (err instanceof ApiRequestError && err.body.fieldErrors) showFieldErrors(err.body.fieldErrors);
      },
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter key keeps the event's current status
    submit(event?.status ?? "draft");
  }

  const generalError = save.error && !(save.error instanceof ApiRequestError && save.error.body.fieldErrors);

  return (
    <>
      <Link
        to="/dashboard/events"
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" /> All events
      </Link>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
        {isNew ? "Create an event" : `Edit ${event.name}`}
      </h1>
      <p className="mt-2 text-ink-soft">
        {isNew
          ? "Save it as a draft while you plan. Publish when you're ready to open vendor tables."
          : event.status === "published"
            ? "This event is published."
            : "This event is a draft. Only you can see it."}
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-6">
        <Section title="The basics">
          <Field label="Event name" id="name" error={errors.name} className="sm:col-span-2">
            <input
              id="name"
              className={inputClass}
              placeholder="Layover Card Show"
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

        <Section title="When & where">
          <Field label="Date" id="date" error={errors.date}>
            <input
              id="date"
              type="date"
              min={isNew ? todayISO() : undefined}
              className={inputClass}
              value={form.date}
              aria-invalid={!!errors.date}
              onChange={(e) => update("date", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Doors open" id="startTime" error={errors.startTime}>
              <input
                id="startTime"
                type="time"
                className={inputClass}
                value={form.startTime}
                aria-invalid={!!errors.startTime}
                onChange={(e) => update("startTime", e.target.value)}
              />
            </Field>
            <Field label="Ends" id="endTime" error={errors.endTime}>
              <input
                id="endTime"
                type="time"
                className={inputClass}
                value={form.endTime}
                aria-invalid={!!errors.endTime}
                onChange={(e) => update("endTime", e.target.value)}
              />
            </Field>
          </div>
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
          <Field label="Price per table" id="tablePrice" error={errors.tablePrice}>
            <MoneyInput
              id="tablePrice"
              value={form.tablePrice}
              invalid={!!errors.tablePrice}
              onChange={(v) => update("tablePrice", v)}
              placeholder="80"
            />
          </Field>
          <Field
            label="Admission ticket"
            id="ticketPrice"
            error={errors.ticketPrice}
            hint="Use 0 for free entry"
          >
            <MoneyInput
              id="ticketPrice"
              value={form.ticketPrice}
              invalid={!!errors.ticketPrice}
              onChange={(v) => update("ticketPrice", v)}
              placeholder="5"
            />
          </Field>
        </Section>

        {generalError && (
          <p className="rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {save.error?.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-ink/10 pt-6 sm:flex-row sm:items-center">
          {!isNew &&
            (confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-coral-ink">Delete permanently?</span>
                <button
                  type="button"
                  disabled={del.isPending}
                  onClick={() => del.mutate(event.id, { onSuccess: () => navigate("/dashboard/events") })}
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
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-sm font-bold text-coral-ink hover:bg-peach"
              >
                <TrashIcon className="size-4" /> Delete event
              </button>
            ))}

          <div className="flex flex-col gap-3 sm:ml-auto sm:flex-row">
            {event?.status !== "published" && (
              <button
                type="button"
                onClick={() => submit("draft")}
                disabled={save.isPending}
                className="rounded-full border-2 border-slate px-6 py-3 font-bold text-slate transition hover:bg-slate hover:text-white disabled:opacity-60"
              >
                {save.isPending && save.variables?.status === "draft" ? "Saving…" : "Save as draft"}
              </button>
            )}
            {event?.status === "published" && (
              <button
                type="button"
                onClick={() => submit("draft")}
                disabled={save.isPending}
                className="rounded-full border-2 border-slate px-6 py-3 font-bold text-slate transition hover:bg-slate hover:text-white disabled:opacity-60"
              >
                Save & unpublish
              </button>
            )}
            <button
              type="button"
              onClick={() => submit("published")}
              disabled={save.isPending}
              className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-7 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
            >
              {save.isPending && save.variables?.status === "published"
                ? "Saving…"
                : event?.status === "published"
                  ? "Save changes"
                  : "Publish event"}
            </button>
          </div>
        </div>
      </form>
    </>
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
