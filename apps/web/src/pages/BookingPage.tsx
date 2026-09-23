import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { addDays, type PublicBookingPage, type PublicBookingResult, type VendorContactInput } from "@flightplan/shared";
import Logo from "../components/Logo";
import { CheckIcon, ClockIcon, MapPinIcon } from "../components/Icons";
import { ApiRequestError, usePublicBooking, useSubmitBooking, type BookingLinkKind } from "../lib/api";
import { formatDate, formatDateRange, formatMoney, timeRange } from "../lib/format";

// Vendors don't have accounts, so their details are remembered in this browser for next time
const REMEMBER_KEY = "flightplan.vendorDetails";

function loadRemembered(): Partial<VendorContactInput> {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveRemembered(details: VendorContactInput | null) {
  try {
    if (details) localStorage.setItem(REMEMBER_KEY, JSON.stringify(details));
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Storage unavailable (private mode etc.): nothing to remember
  }
}

export default function BookingPage({ kind }: { kind: BookingLinkKind }) {
  const { token = "" } = useParams();
  const { data: page, isPending, error } = usePublicBooking(kind, token);
  const [result, setResult] = useState<{ result: PublicBookingResult; name: string } | null>(null);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <span className="text-sm font-bold text-ink-soft">Vendor table booking</span>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-ink-muted" role="status">
            Loading…
          </p>
        ) : error || !page ? (
          <Notice title="This link isn't working">
            {error instanceof ApiRequestError && error.status === 404
              ? "The booking link may be mistyped, or the show may no longer be taking bookings. Please check with the organizer."
              : "Something went wrong loading this page. Please try again in a moment."}
          </Notice>
        ) : result ? (
          <Confirmation page={page} result={result.result} name={result.name} />
        ) : (
          <BookingForm kind={kind} token={token} page={page} onBooked={(r, name) => setResult({ result: r, name })} />
        )}
      </main>
    </div>
  );
}

function EventHeader({ page }: { page: PublicBookingPage }) {
  const { event } = page;
  const end = addDays(event.startDate, Math.max(...event.days.map((d) => d.dayOffset)));
  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
      <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">Book a vendor table</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-ink-soft">
        <span className="flex items-center gap-1.5">
          <ClockIcon className="size-4 text-ink-muted" />
          {formatDateRange(event.startDate, end)}
          {event.startDate !== end && `, ${formatDate(end, { year: "numeric" })}`}
          {event.startDate === end && `, ${formatDate(event.startDate, { year: "numeric" })}`}
        </span>
        <span className="flex items-center gap-1.5">
          <MapPinIcon className="size-4 text-ink-muted" />
          {event.venueName}
          {event.address && `, ${event.address}`}, {event.city}
        </span>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {event.days.map((d) => (
          <li key={d.dayOffset} className="rounded-lg bg-cream-50 px-2.5 py-1 text-sm ring-1 ring-ink/5">
            <span className="font-bold">{formatDate(addDays(event.startDate, d.dayOffset), { weekday: "short", month: "short", day: "numeric" })}</span>{" "}
            · {timeRange(d.startTime, d.endTime)}
          </li>
        ))}
      </ul>
      {event.description && <p className="mt-4 text-ink-soft">{event.description}</p>}
      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-peach px-3 py-1.5 font-bold text-coral-ink">
          {event.tablePriceCents ? `${formatMoney(event.tablePriceCents)} per table` : "Free tables"}
        </span>
        {event.requiresApproval && (
          <span className="rounded-full bg-[#fff4cc] px-3 py-1.5 font-bold text-gold-ink">Organizer approves each request</span>
        )}
        {event.tablePriceCents > 0 && event.paymentDueDays && (
          <span className="rounded-full bg-cream px-3 py-1.5 font-bold text-ink-soft">
            Pay within {event.paymentDueDays} day{event.paymentDueDays > 1 ? "s" : ""}
            {event.requiresApproval ? " of approval" : " of booking"}
          </span>
        )}
      </div>
    </section>
  );
}

function BookingForm({
  kind,
  token,
  page,
  onBooked,
}: {
  kind: BookingLinkKind;
  token: string;
  page: PublicBookingPage;
  onBooked: (result: PublicBookingResult, name: string) => void;
}) {
  const submit = useSubmitBooking(kind, token);
  const [tableId, setTableId] = useState<string | null>(null);
  const [details, setDetails] = useState(() => {
    const remembered = loadRemembered();
    // An invite's name/email (if the organizer filled them in) take priority
    return {
      name: page.invite?.name || remembered.name || "",
      businessName: remembered.businessName || "",
      email: page.invite?.email || remembered.email || "",
      phone: remembered.phone || "",
      message: "",
    };
  });
  const [remember, setRemember] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  const selected = page.tables.find((t) => t.id === tableId);
  const availableCount = page.tables.filter((t) => t.available).length;
  const fieldErrors = submit.error instanceof ApiRequestError ? submit.error.body.fieldErrors : undefined;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!tableId) return setLocalError("Pick a table first.");
    const { message, ...contact } = details;
    submit.mutate(
      { tableId, ...details },
      {
        onSuccess: (result) => {
          saveRemembered(remember ? contact : null);
          onBooked(result, details.name);
        },
        // If someone else just took this table, make them pick again
        onError: (err) => {
          if (err instanceof ApiRequestError && err.status === 409) setTableId(null);
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <EventHeader page={page} />

      {page.closedReason ? (
        <Notice title="Booking isn't available">{page.closedReason}</Notice>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1.3fr_1fr]" noValidate>
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
            <h2 className="text-lg font-extrabold">1. Pick your table</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {availableCount} of {page.tables.length} tables available. Use the map to find the spot you want.
            </p>
            {page.event.floorMapUrl && (
              <a
                href={page.event.floorMapUrl}
                target="_blank"
                rel="noreferrer"
                title="Open full size"
                className="mt-4 block overflow-hidden rounded-2xl ring-1 ring-ink/10"
              >
                <img src={page.event.floorMapUrl} alt="Floor map with table numbers" className="w-full bg-cream-50 object-contain" />
              </a>
            )}
            <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2" role="radiogroup" aria-label="Tables">
              {page.tables.map((t) => {
                const isSelected = t.id === tableId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`Table ${t.label}${t.available ? "" : " (taken)"}`}
                    disabled={!t.available}
                    onClick={() => setTableId(t.id)}
                    className={`aspect-square rounded-xl text-sm font-extrabold transition ${
                      isSelected
                        ? "bg-coral text-white shadow-md ring-4 ring-coral/25"
                        : t.available
                          ? "bg-white text-ink ring-2 ring-ink/10 hover:ring-coral"
                          : "cursor-not-allowed bg-ink/5 text-ink-muted/60 line-through"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-ink-soft">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded bg-white ring-2 ring-ink/10" /> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded bg-ink/10" /> Taken
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded bg-coral" /> Your pick
              </span>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
            <h2 className="text-lg font-extrabold">2. Your details</h2>
            <div className="mt-4 space-y-3">
              <Input label="Your name" id="name" autoComplete="name" value={details.name} error={fieldErrors?.name?.[0]} onChange={(v) => setDetails((d) => ({ ...d, name: v }))} />
              <Input label="Business name" id="businessName" optional autoComplete="organization" value={details.businessName} onChange={(v) => setDetails((d) => ({ ...d, businessName: v }))} />
              <Input label="Email" id="email" type="email" autoComplete="email" value={details.email} error={fieldErrors?.email?.[0]} onChange={(v) => setDetails((d) => ({ ...d, email: v }))} />
              <Input label="Phone" id="phone" type="tel" optional autoComplete="tel" value={details.phone} onChange={(v) => setDetails((d) => ({ ...d, phone: v }))} />
              <div>
                <label htmlFor="message" className="text-sm font-bold">
                  Note for the organizer <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <textarea
                  id="message"
                  rows={2}
                  className={`${inputClass} resize-y`}
                  placeholder="What you sell, power needs, a neighbour you'd like to be near…"
                  value={details.message}
                  onChange={(e) => setDetails((d) => ({ ...d, message: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" className="size-4 accent-coral" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember my details on this device
              </label>
            </div>

            {(localError || (submit.error && !fieldErrors)) && (
              <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
                {localError ?? submit.error?.message}
              </p>
            )}

            <button
              type="submit"
              disabled={submit.isPending}
              className="mt-5 w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
            >
              {submit.isPending
                ? "Sending…"
                : selected
                  ? `${page.event.requiresApproval ? "Request" : "Book"} table ${selected.label}`
                  : "Pick a table to continue"}
            </button>
          </section>
        </form>
      )}
    </div>
  );
}

function Confirmation({ page, result, name }: { page: PublicBookingPage; result: PublicBookingResult; name: string }) {
  const due =
    result.paymentDueAt &&
    new Date(result.paymentDueAt).toLocaleString("en-CA", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const title =
    result.status === "pending"
      ? "Request sent!"
      : result.status === "paid"
        ? "You're booked!"
        : `Table ${result.tableLabel} is held for you`;

  return (
    <section className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-ink/5 sm:p-10" role="status">
      <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-coral to-gold text-white shadow-lg">
        <CheckIcon className="size-8" />
      </span>
      <h1 className="mt-6 text-3xl font-extrabold">{title}</h1>
      <p className="mt-3 text-ink-soft">
        {result.status === "pending" ? (
          <>
            Thanks, {name.split(" ")[0]}. The organizer of <strong>{page.event.name}</strong> will review your request for
            table {result.tableLabel} and be in touch.
          </>
        ) : result.status === "paid" ? (
          <>
            Table {result.tableLabel} at <strong>{page.event.name}</strong> is yours. See you there!
          </>
        ) : (
          <>
            Please pay {formatMoney(page.event.tablePriceCents)} for table {result.tableLabel} at <strong>{page.event.name}</strong>
            {due ? (
              <>
                {" "}
                by <strong>{due}</strong>. Unpaid tables may be released after that.
              </>
            ) : (
              "."
            )}
          </>
        )}
      </p>
      {result.status !== "paid" && result.paymentInstructions && (
        <div className="mt-6 rounded-2xl bg-cream-50 p-5 text-left ring-1 ring-ink/5">
          <p className="text-xs font-bold tracking-wider text-ink-muted uppercase">How to pay</p>
          <p className="mt-2 whitespace-pre-line">{result.paymentInstructions}</p>
          {result.status === "pending" && <p className="mt-2 text-sm text-ink-soft">Once you're approved, of course.</p>}
        </div>
      )}
    </section>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-ink/5">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      <p className="mt-2 text-ink-soft">{children}</p>
    </section>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-4 py-2.5 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none aria-invalid:border-coral-ink";

function Input({
  label,
  id,
  value,
  onChange,
  type = "text",
  optional,
  autoComplete,
  error,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  optional?: boolean;
  autoComplete?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold">
        {label} {optional && <span className="font-normal text-ink-muted">(optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        className={inputClass}
        value={value}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="mt-1 text-sm font-semibold text-coral-ink">{error}</p>}
    </div>
  );
}
