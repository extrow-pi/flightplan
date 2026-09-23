import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  EVENTS_PER_YEAR,
  EVENT_TYPES,
  organizerSignupSchema,
  type ApiError,
  type OrganizerSignupInput,
} from "@flightplan/shared";
import { z } from "zod";
import { CheckIcon } from "./Icons";

type FieldErrors = ApiError["fieldErrors"];
type SignupResult = { ok: true; alreadyRegistered: boolean };

class SignupError extends Error {
  constructor(public body: ApiError) {
    super(body.error);
  }
}

async function submitSignup(input: OrganizerSignupInput): Promise<SignupResult> {
  const res = await fetch("/api/organizers/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({ error: "Something went wrong. Please try again." }));
  if (!res.ok) throw new SignupError(body);
  return body;
}

const emptyForm: OrganizerSignupInput = {
  name: "",
  email: "",
  organization: "",
  city: "",
  eventType: "" as OrganizerSignupInput["eventType"],
  eventsPerYear: "" as OrganizerSignupInput["eventsPerYear"],
  message: "",
};

const inputClass =
  "w-full rounded-xl border-2 border-cream bg-white px-4 py-3 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none aria-invalid:border-coral-ink";

export default function SignupForm() {
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: submitSignup,
    onError: (err) => {
      if (err instanceof SignupError) setFieldErrors(err.body.fieldErrors ?? {});
    },
  });

  function update<K extends keyof OrganizerSignupInput>(key: K, value: OrganizerSignupInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors?.[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = organizerSignupSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    mutation.mutate(form);
  }

  if (mutation.isSuccess) {
    return (
      <div className="flex flex-col items-center py-10 text-center" role="status">
        <span className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-coral to-gold text-white shadow-lg">
          <CheckIcon className="size-8" />
        </span>
        <h3 className="mt-6 text-2xl font-extrabold">
          {mutation.data.alreadyRegistered ? "You're already on the list!" : "You're checked in!"}
        </h3>
        <p className="mt-2 max-w-sm text-ink-soft">
          {mutation.data.alreadyRegistered
            ? "We already have your details. We'll be in touch as soon as your seat is ready."
            : `Thanks, ${form.name.split(" ")[0]}! We'll email ${form.email} when early access opens.`}
        </p>
      </div>
    );
  }

  const err = (key: keyof OrganizerSignupInput) => fieldErrors?.[key]?.[0];
  const generalError = mutation.error && !(mutation.error instanceof SignupError && mutation.error.body.fieldErrors);

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
      <Field label="Your name" htmlFor="name" error={err("name")}>
        <input
          id="name"
          autoComplete="name"
          className={inputClass}
          placeholder="Alex Chen"
          value={form.name}
          aria-invalid={!!err("name")}
          onChange={(e) => update("name", e.target.value)}
        />
      </Field>

      <Field label="Email" htmlFor="email" error={err("email")}>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={inputClass}
          placeholder="alex@yourshow.com"
          value={form.email}
          aria-invalid={!!err("email")}
          onChange={(e) => update("email", e.target.value)}
        />
      </Field>

      <Field label="Show or organization" htmlFor="organization" optional error={err("organization")}>
        <input
          id="organization"
          autoComplete="organization"
          className={inputClass}
          placeholder="Layover Card Show"
          value={form.organization}
          onChange={(e) => update("organization", e.target.value)}
        />
      </Field>

      <Field label="City" htmlFor="city" error={err("city")}>
        <input
          id="city"
          autoComplete="address-level2"
          className={inputClass}
          placeholder="Vancouver, BC"
          value={form.city}
          aria-invalid={!!err("city")}
          onChange={(e) => update("city", e.target.value)}
        />
      </Field>

      <Field label="What kind of events do you run?" htmlFor="eventType" error={err("eventType")}>
        <select
          id="eventType"
          className={`${inputClass} ${form.eventType ? "" : "text-ink-muted/70"}`}
          value={form.eventType}
          aria-invalid={!!err("eventType")}
          onChange={(e) => update("eventType", e.target.value as OrganizerSignupInput["eventType"])}
        >
          <option value="" disabled>
            Choose one…
          </option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t} className="text-ink">
              {t}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold">Events per year</legend>
        <div className="grid grid-cols-4 gap-2" role="radiogroup">
          {EVENTS_PER_YEAR.map((n) => {
            const selected = form.eventsPerYear === n;
            return (
              <label
                key={n}
                className={`cursor-pointer rounded-xl border-2 py-3 text-center font-bold transition has-focus-visible:ring-4 has-focus-visible:ring-coral/25 ${
                  selected
                    ? "border-coral bg-coral text-white shadow-sm"
                    : "border-cream bg-white text-ink-soft hover:border-coral/50"
                }`}
              >
                <input
                  type="radio"
                  name="eventsPerYear"
                  value={n}
                  checked={selected}
                  onChange={() => update("eventsPerYear", n)}
                  className="sr-only"
                />
                {n}
              </label>
            );
          })}
        </div>
        {err("eventsPerYear") && <p className="text-sm font-semibold text-coral-ink">{err("eventsPerYear")}</p>}
      </fieldset>

      <div className="sm:col-span-2">
        <Field label="Anything we should know?" htmlFor="message" optional error={err("message")}>
          <textarea
            id="message"
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="Tell us about your next show, how many tables, what's painful today…"
            value={form.message}
            onChange={(e) => update("message", e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col items-start gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">Free during early access. No credit card needed.</p>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-8 py-3.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-6px_rgba(232,133,106,0.8)] focus-visible:ring-4 focus-visible:ring-coral/30 focus-visible:outline-none disabled:translate-y-0 disabled:opacity-60 sm:w-auto"
        >
          {mutation.isPending ? "Checking you in…" : "Request early access"}
        </button>
      </div>

      {generalError && (
        <p className="rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink sm:col-span-2" role="alert">
          {mutation.error.message}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm font-bold">
        {label} {optional && <span className="font-normal text-ink-muted">(optional)</span>}
      </label>
      {children}
      {error && <p className="text-sm font-semibold text-coral-ink">{error}</p>}
    </div>
  );
}
