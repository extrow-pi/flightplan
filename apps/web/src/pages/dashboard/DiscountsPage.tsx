import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { DiscountCode, DiscountCodeKind } from "@flightplan/shared";
import { CloseIcon, PencilIcon, PlusIcon, TableIcon } from "../../components/Icons";
import {
  ApiRequestError,
  useDeleteDiscountCode,
  useDiscountCodes,
  useDiscountCodeUses,
  useEvents,
  useSaveDiscountCode,
} from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { closedLabel } from "../../components/bookings";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

const inputClass =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";

const statusStyles: Record<DiscountCode["status"], [string, string]> = {
  active: ["Active", "bg-[#e8f8f5] text-[#2d7a6a]"],
  paused: ["Paused", "bg-ink/5 text-ink-soft"],
  expired: ["Expired", "bg-ink/5 text-ink-soft"],
  used_up: ["Used up", "bg-[#fff4cc] text-gold-ink"],
};

const amountLabel = (c: { kind: DiscountCodeKind; value: number }) =>
  c.kind === "percent" ? `${c.value}% off` : `${formatMoney(c.value)} off`;

/** The organizer's discount codes, with usage. Multi-table discounts live on each show. */
export default function DiscountsPage() {
  const codes = useDiscountCodes();
  const [editing, setEditing] = useState<DiscountCode | "new" | null>(null);
  const [viewingUses, setViewingUses] = useState<DiscountCode | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Discounts"
        title="Discount codes"
        subtitle="Codes vendors enter when booking a table. Each takes a percentage or a fixed amount off their request."
        action={
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold whitespace-nowrap text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
          >
            <PlusIcon className="size-4" strokeWidth={3} /> New code
          </button>
        }
      />

      <p className="mb-6 flex items-start gap-3 rounded-2xl bg-cream px-5 py-4 text-sm text-ink-soft">
        <TableIcon className="mt-0.5 size-5 shrink-0 text-gold-ink" />
        <span>
          <strong className="text-ink">Multi-table discounts</strong> (e.g. 3+ tables 10% off) are set on each show's{" "}
          <Link to="/dashboard/events" className="font-bold text-coral-ink hover:underline">
            details page
          </Link>
          . When a vendor has both, they get whichever saves more.
        </span>
      </p>

      {codes.error ? (
        <ErrorCard message={codes.error.message} />
      ) : codes.isPending ? (
        <LoadingCards />
      ) : !codes.data.length ? (
        <div className="rounded-3xl bg-white p-8 text-center ring-1 ring-ink/5">
          <p className="text-lg font-extrabold">No codes yet</p>
          <p className="mt-1 text-ink-soft">
            Create one like <strong>EARLYBIRD</strong> for 15% off, or <strong>RETURNING</strong> for $20 off.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {codes.data.map((c) => (
            <CodeRow key={c.id} code={c} onEdit={() => setEditing(c)} onUses={() => setViewingUses(c)} />
          ))}
        </ul>
      )}

      {editing && <CodeDialog code={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {viewingUses && <UsesDialog code={viewingUses} onClose={() => setViewingUses(null)} />}
    </>
  );
}

function CodeRow({ code: c, onEdit, onUses }: { code: DiscountCode; onEdit: () => void; onUses: () => void }) {
  const [label, tone] = statusStyles[c.status];
  const limits = [
    c.maxUses !== null && `${c.maxUses} ${c.maxUses === 1 ? "use" : "uses"} max`,
    c.expiresOn && `until ${formatDate(c.expiresOn, { month: "short", day: "numeric", year: "numeric" })}`,
    c.oncePerVendor && "once per vendor",
    c.eventIds.length > 0 && `${c.eventIds.length} ${c.eventIds.length === 1 ? "show" : "shows"} only`,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-slate px-2.5 py-1 font-mono text-sm font-extrabold tracking-wide text-white">{c.code}</span>
          <span className="font-extrabold">{amountLabel(c)}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`}>{label}</span>
        </div>
        {c.description && <p className="mt-1.5 text-sm text-ink-soft">{c.description}</p>}
        <p className="mt-1.5 text-xs text-ink-muted">{limits.length ? limits.join(" · ") : "No limits · all your shows"}</p>
      </div>
      <div className="flex items-center gap-3 sm:shrink-0">
        <button type="button" onClick={onUses} className="text-left text-sm sm:text-right">
          <span className="block font-extrabold">
            {c.uses}
            {c.maxUses !== null && ` / ${c.maxUses}`} {c.uses === 1 && c.maxUses === null ? "use" : "uses"}
          </span>
          <span className="block text-xs font-semibold text-coral-ink hover:underline">
            {c.discountGivenCents > 0 ? `${formatMoney(c.discountGivenCents)} given · ` : ""}View
          </span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${c.code}`}
          className="ml-auto rounded-full p-2.5 text-ink-soft transition hover:bg-cream hover:text-ink"
        >
          <PencilIcon className="size-4" />
        </button>
      </div>
    </li>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="code-dialog-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl focus:outline-none sm:p-8">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="code-dialog-title" className="pr-8 text-2xl font-extrabold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function LimitToggle({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-cream-50 p-3 ring-1 ring-ink/5">
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" className="size-4 accent-coral" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {checked && children && <div className="mt-2 pl-6">{children}</div>}
    </div>
  );
}

function CodeDialog({ code, onClose }: { code: DiscountCode | null; onClose: () => void }) {
  const save = useSaveDiscountCode(code?.id);
  const del = useDeleteDiscountCode();
  const events = useEvents();
  // Codes work for the organizer's own dated shows
  const shows = (events.data ?? []).filter((e) => e.access.role === "owner" && e.status !== "template");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    code: code?.code ?? "",
    kind: code?.kind ?? ("percent" as DiscountCodeKind),
    value: code ? (code.kind === "percent" ? String(code.value) : (code.value / 100).toString()) : "",
    description: code?.description ?? "",
    limitUses: code?.maxUses != null,
    maxUses: code?.maxUses != null ? String(code.maxUses) : "",
    limitDate: Boolean(code?.expiresOn),
    expiresOn: code?.expiresOn ?? "",
    oncePerVendor: code?.oncePerVendor ?? false,
    limitShows: Boolean(code?.eventIds.length),
    eventIds: code?.eventIds ?? [],
    active: code?.active ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = save.error instanceof ApiRequestError ? (save.error.body.fieldErrors ?? {}) : {};

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = form.kind === "percent" ? Math.round(Number(form.value)) : Math.round(Number(form.value) * 100);
    save.mutate(
      {
        code: form.code,
        kind: form.kind,
        value: Number.isFinite(value) ? value : 0,
        description: form.description,
        maxUses: form.limitUses && form.maxUses ? Math.round(Number(form.maxUses)) : null,
        expiresOn: form.limitDate && form.expiresOn ? form.expiresOn : null,
        oncePerVendor: form.oncePerVendor,
        eventIds: form.limitShows ? form.eventIds : [],
        active: form.active,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog title={code ? `Edit ${code.code}` : "New discount code"} onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-bold">Code</span>
          <input
            className={`${inputClass} font-mono uppercase`}
            value={form.code}
            onChange={(e) => set("code", e.target.value.toUpperCase())}
            placeholder="EARLYBIRD"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={30}
          />
          {errors.code && <span className="mt-1 block text-sm font-semibold text-coral-ink">{errors.code[0]}</span>}
          {code && code.uses > 0 && (
            <span className="mt-1 block text-xs text-ink-muted">Already used {code.uses} times. Changes apply to new bookings only.</span>
          )}
        </label>

        <div>
          <span className="text-sm font-bold">Discount</span>
          <div className="mt-1 flex gap-2">
            <div className="flex rounded-xl bg-cream-50 p-1 ring-1 ring-ink/5" role="radiogroup" aria-label="Discount type">
              {(["percent", "amount"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === k}
                  onClick={() => set("kind", k)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${form.kind === k ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
                >
                  {k === "percent" ? "% off" : "$ off"}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              {form.kind === "amount" && <span className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted">$</span>}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={form.kind === "percent" ? 1 : 0.01}
                className={`${inputClass} mt-0 ${form.kind === "amount" ? "pl-7" : ""}`}
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                aria-label={form.kind === "percent" ? "Percent off" : "Dollars off"}
                required
              />
            </div>
          </div>
          <span className="mt-1 block text-xs text-ink-muted">
            {form.kind === "percent" ? "Percent off the vendor's whole request." : "Taken off the vendor's whole request total."}
          </span>
          {errors.value && <span className="mt-1 block text-sm font-semibold text-coral-ink">{errors.value[0]}</span>}
        </div>

        <label className="block">
          <span className="text-sm font-bold">
            Note <span className="font-normal text-ink-muted">(optional, only you see it)</span>
          </span>
          <input className={inputClass} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={200} placeholder="Early bird for returning vendors" />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Limits (all optional)</legend>
          <LimitToggle label="Limit how many times it can be used" checked={form.limitUses} onChange={(v) => set("limitUses", v)}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              className={`${inputClass} mt-0 w-32`}
              value={form.maxUses}
              onChange={(e) => set("maxUses", e.target.value)}
              aria-label="Maximum uses"
            />
            <span className="mt-1 block text-xs text-ink-muted">Rejected or cancelled requests give their use back.</span>
          </LimitToggle>
          <LimitToggle label="Expires" checked={form.limitDate} onChange={(v) => set("limitDate", v)}>
            <input type="date" className={`${inputClass} mt-0 w-48`} value={form.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} aria-label="Last day it works" />
            <span className="mt-1 block text-xs text-ink-muted">Works through the end of this day.</span>
          </LimitToggle>
          <LimitToggle label="One use per vendor" checked={form.oncePerVendor} onChange={(v) => set("oncePerVendor", v)} />
          <LimitToggle label="Only for specific shows" checked={form.limitShows} onChange={(v) => set("limitShows", v)}>
            {shows.length ? (
              <div className="space-y-1">
                {shows.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-coral"
                      checked={form.eventIds.includes(s.id)}
                      onChange={(e) =>
                        set("eventIds", e.target.checked ? [...form.eventIds, s.id] : form.eventIds.filter((id) => id !== s.id))
                      }
                    />
                    <span className="truncate">
                      {s.name}
                      {s.startDate && <span className="text-ink-muted"> · {formatDate(s.startDate, { month: "short", day: "numeric" })}</span>}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="text-sm text-ink-muted">You don't have any shows yet.</span>
            )}
          </LimitToggle>
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="size-4 accent-coral" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          Active (uncheck to pause it)
        </label>

        {save.error && !Object.keys(errors).length && (
          <p className="text-sm font-semibold text-coral-ink" role="alert">
            {save.error.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center">
          {code &&
            (confirmDelete ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => del.mutate(code.id, { onSuccess: onClose })}
                  disabled={del.isPending}
                  className="rounded-full bg-coral-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                >
                  {del.isPending ? "Deleting…" : "Delete code"}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-sm font-bold text-ink-soft">
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-bold text-coral-ink hover:underline">
                Delete
              </button>
            ))}
          <div className="flex gap-3 sm:ml-auto">
            <button type="button" onClick={onClose} className="flex-1 rounded-full px-5 py-2.5 font-bold text-ink-soft hover:bg-cream sm:flex-none">
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="flex-1 rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-2.5 font-bold text-white disabled:opacity-60 sm:flex-none"
            >
              {save.isPending ? "Saving…" : code ? "Save" : "Create code"}
            </button>
          </div>
        </div>
        {code && (
          <p className="text-xs text-ink-muted">Deleting a code doesn't change bookings that already used it.</p>
        )}
      </form>
    </Dialog>
  );
}

function UsesDialog({ code, onClose }: { code: DiscountCode; onClose: () => void }) {
  const uses = useDiscountCodeUses(code.id);
  const statusText = (s: string) =>
    s === "paid" ? "Paid" : s === "awaiting_payment" ? "Awaiting payment" : s === "pending" ? "Waiting for approval" : closedLabel(s as never);
  return (
    <Dialog title={`${code.code} usage`} onClose={onClose}>
      <p className="mt-1 text-sm text-ink-soft">
        {code.uses} {code.uses === 1 ? "request" : "requests"} used it
        {code.discountGivenCents > 0 && `, saving vendors ${formatMoney(code.discountGivenCents)} in total`}. Rejected and
        cancelled requests aren't counted.
      </p>
      {uses.isPending ? (
        <p className="mt-4 text-ink-muted">Loading…</p>
      ) : uses.data?.length ? (
        <ul className="mt-4 divide-y divide-ink/5 rounded-2xl bg-cream-50 px-4 ring-1 ring-ink/5">
          {uses.data.map((u) => (
            <li key={u.requestId} className="py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-bold">{u.vendorName}</span>
                <span className="font-semibold">
                  {formatMoney(u.totalCents)} <span className="text-[#2d7a6a]">(−{formatMoney(u.discountCents)})</span>
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-soft">
                <span>
                  <Link to={`/dashboard/events/${u.eventId}/tables`} className="font-semibold text-coral-ink hover:underline">
                    {u.eventName}
                  </Link>{" "}
                  · {u.tableLabels.length > 1 ? "tables" : "table"} {u.tableLabels.join(", ")}
                </span>
                <span>
                  {statusText(u.status)} · {new Date(u.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-soft">Not used yet.</p>
      )}
    </Dialog>
  );
}
