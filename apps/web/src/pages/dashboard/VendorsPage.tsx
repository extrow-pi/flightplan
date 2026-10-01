import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { BookingStatus, VendorGroup, VendorListItem } from "@flightplan/shared";
import BannedBadge from "../../components/BannedBadge";
import { closedLabel } from "../../components/bookings";
import { BanIcon, CloseIcon, DownloadIcon, PencilIcon, PlusIcon, SearchIcon, StarIcon, TrashIcon } from "../../components/Icons";
import {
  ApiRequestError,
  useCreateVendor,
  useCreateVendorGroup,
  useDeleteVendorGroup,
  useRenameVendorGroup,
  useUpdateVendor,
  useVendorGroups,
  useVendorList,
  useVendorRequests,
} from "../../lib/api";
import { formatDate } from "../../lib/format";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

type Filter = { kind: "all" } | { kind: "favourites" } | { kind: "banned" } | { kind: "group"; id: string };

const inputClass =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";

/** The organizer's vendor list: favourites, groups, ban list, history, CSV export. */
export default function VendorsPage() {
  const vendors = useVendorList();
  const groups = useVendorGroups();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const all = vendors.data ?? [];
  const groupList = groups.data ?? [];
  const groupName = useMemo(() => new Map(groupList.map((g) => [g.id, g.name])), [groupList]);

  const matchesFilter = (v: VendorListItem, f: Filter) =>
    f.kind === "all"
      ? true
      : f.kind === "favourites"
        ? v.favourite
        : f.kind === "banned"
          ? v.banned
          : v.groupIds.includes(f.id);
  const q = search.trim().toLowerCase();
  const shown = all.filter(
    (v) =>
      matchesFilter(v, filter) &&
      (!q || [v.name, v.businessName, v.email, v.phone].some((s) => s.toLowerCase().includes(q))),
  );
  // A deleted group can't stay selected
  const activeFilter = filter.kind === "group" && !groupName.has(filter.id) ? { kind: "all" as const } : filter;
  const editingVendor = all.find((v) => v.id === editing);

  const filterLabel =
    activeFilter.kind === "group" ? groupName.get(activeFilter.id)! : activeFilter.kind === "all" ? "all" : activeFilter.kind;

  return (
    <>
      <PageHeader
        eyebrow="Vendors"
        title="Your vendors"
        subtitle="Everyone who has booked a table at your shows, plus vendors you add yourself. Star your regulars, sort them into groups and keep a ban list."
        action={
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => exportCsv(shown, groupName, filterLabel)}
              disabled={!shown.length}
              className="inline-flex items-center gap-2 rounded-full border-2 border-slate/30 px-4 py-2.5 text-sm font-bold text-slate transition hover:border-slate disabled:opacity-50"
            >
              <DownloadIcon className="size-4" /> Export CSV
            </button>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-coral-deep px-5 py-2.5 text-sm font-bold whitespace-nowrap text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
            >
              <PlusIcon className="size-4" strokeWidth={3} /> Add vendor
            </button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <label className="relative block">
            <span className="sr-only">Search vendors</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, business, email or phone"
              className="w-full rounded-full border-2 border-cream bg-white py-2.5 pr-4 pl-10 text-ink placeholder:text-ink-muted/70 focus:border-coral focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter vendors">
            {(
              [
                [{ kind: "all" }, "All", null],
                [{ kind: "favourites" }, "Favourites", <StarIcon key="s" className="size-3.5" fill="currentColor" />],
                [{ kind: "banned" }, "Banned", <BanIcon key="b" className="size-3.5" />],
                ...groupList.map((g) => [{ kind: "group", id: g.id }, g.name, null] as const),
              ] as [Filter, string, ReactNode][]
            ).map(([f, label, icon]) => {
              const active = JSON.stringify(f) === JSON.stringify(activeFilter);
              const n = all.filter((v) => matchesFilter(v, f)).length;
              if (f.kind === "banned" && !n && !active) return null;
              return (
                <button
                  key={JSON.stringify(f)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
                    active ? "bg-slate text-white" : "bg-white text-ink-soft ring-1 ring-ink/10 hover:text-ink"
                  }`}
                >
                  {icon}
                  {label}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20" : "bg-cream"}`}>{n}</span>
                </button>
              );
            })}
          </div>

          {vendors.error ? (
            <ErrorCard message={vendors.error.message} />
          ) : vendors.isPending ? (
            <LoadingCards />
          ) : !all.length ? (
            <div className="rounded-3xl bg-white p-8 text-center ring-1 ring-ink/5">
              <p className="text-lg font-extrabold">No vendors yet</p>
              <p className="mt-1 text-ink-soft">
                Vendors are added automatically when they book a table at one of your shows. You can also{" "}
                <button type="button" onClick={() => setAdding(true)} className="font-bold text-coral-ink hover:underline">
                  add one yourself
                </button>
                .
              </p>
            </div>
          ) : shown.length ? (
            <ul className="divide-y divide-ink/5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5">
              {shown.map((v) => (
                <VendorRow key={v.id} vendor={v} groupName={groupName} onOpen={() => setEditing(v.id)} />
              ))}
            </ul>
          ) : (
            <p className="rounded-3xl bg-white p-6 text-center text-ink-soft ring-1 ring-ink/5">No vendors match.</p>
          )}
        </div>

        <aside className="space-y-6">
          <GroupsCard groups={groupList} onPick={(id) => setFilter({ kind: "group", id })} />
          <section className="rounded-3xl bg-white p-5 text-sm text-ink-soft shadow-sm ring-1 ring-ink/5">
            <h2 className="font-extrabold text-ink">How these work</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li>
                <strong className="text-ink">Favourites</strong> come first when you assign a table.
              </li>
              <li>
                <strong className="text-ink">Groups</strong>: send everyone in a group (or all favourites) a personal booking
                link from a show's <em>Tables &amp; vendors</em> tab.
              </li>
              <li>
                <strong className="text-ink">Banned</strong> vendors can still send requests, but they always wait for your
                approval and are flagged. They aren't told.
              </li>
            </ul>
          </section>
        </aside>
      </div>

      {adding && <AddVendorDialog onClose={() => setAdding(false)} onAdded={(id) => setEditing(id)} />}
      {editingVendor && <VendorDialog vendor={editingVendor} groups={groupList} onClose={() => setEditing(null)} />}
    </>
  );
}

// ── List row ─────────────────────────────────────────────────────────────

function VendorRow({ vendor: v, groupName, onOpen }: { vendor: VendorListItem; groupName: Map<string, string>; onOpen: () => void }) {
  const update = useUpdateVendor();
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:items-center">
      <button
        type="button"
        aria-pressed={v.favourite}
        aria-label={v.favourite ? `Remove ${v.name} from favourites` : `Add ${v.name} to favourites`}
        title={v.favourite ? "Favourite" : "Add to favourites"}
        disabled={update.isPending}
        onClick={() => update.mutate({ id: v.id, favourite: !v.favourite })}
        className={`mt-0.5 rounded-full p-1.5 transition sm:mt-0 ${v.favourite ? "text-gold-ink" : "text-ink-muted/50 hover:text-gold-ink"}`}
      >
        <StarIcon className="size-5" fill={v.favourite ? "currentColor" : "none"} />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-extrabold">{v.name}</span>
          {v.businessName && <span className="font-semibold text-ink-soft">{v.businessName}</span>}
          {v.banned && <BannedBadge reason={v.banReason} />}
        </span>
        <span className="mt-0.5 block truncate text-sm text-ink-soft">
          {v.email}
          {v.phone && ` · ${v.phone}`}
        </span>
        {v.groupIds.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {v.groupIds.map((id) => (
              <span key={id} className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-ink-soft">
                {groupName.get(id)}
              </span>
            ))}
          </span>
        )}
      </button>
      <span className="hidden shrink-0 text-right text-xs text-ink-muted sm:block">
        {v.requestCount ? (
          <>
            {v.requestCount} {v.requestCount === 1 ? "request" : "requests"} · {v.showCount} {v.showCount === 1 ? "show" : "shows"}
            {v.lastRequestAt && (
              <>
                <br />
                Last {new Date(v.lastRequestAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
              </>
            )}
          </>
        ) : (
          "No bookings yet"
        )}
      </span>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit ${v.name}`}
        className="shrink-0 rounded-full p-2 text-ink-soft transition hover:bg-cream hover:text-ink"
      >
        <PencilIcon className="size-4" />
      </button>
    </li>
  );
}

// ── Groups ───────────────────────────────────────────────────────────────

function GroupsCard({ groups, onPick }: { groups: VendorGroup[]; onPick: (id: string) => void }) {
  const create = useCreateVendorGroup();
  const rename = useRenameVendorGroup();
  const del = useDeleteVendorGroup();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const error = create.error ?? rename.error ?? del.error;

  function onCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate(name, { onSuccess: () => setName("") });
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-extrabold">Groups</h2>
      {groups.length ? (
        <ul className="mt-3 space-y-1">
          {groups.map((g) =>
            renaming?.id === g.id ? (
              <li key={g.id}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate(renaming, { onSuccess: () => setRenaming(null) });
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    autoFocus
                    aria-label="Group name"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border-2 border-cream px-2 py-1 text-sm focus:border-coral focus:outline-none"
                  />
                  <button type="submit" className="rounded-full bg-slate px-3 text-xs font-bold text-white">
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="rounded-full px-2 text-xs font-bold text-ink-soft">
                    Cancel
                  </button>
                </form>
              </li>
            ) : (
              <li key={g.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPick(g.id)}
                  className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm font-semibold hover:bg-cream-50"
                >
                  {g.name} <span className="text-ink-muted">({g.vendorCount})</span>
                </button>
                {confirming === g.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => del.mutate(g.id, { onSuccess: () => setConfirming(null) })}
                      className="rounded-full bg-coral-ink px-2.5 py-1 text-xs font-bold text-white"
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="px-1.5 text-xs font-bold text-ink-soft">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setRenaming({ id: g.id, name: g.name })}
                      aria-label={`Rename ${g.name}`}
                      className="rounded-full p-1.5 text-ink-muted hover:bg-cream hover:text-ink"
                    >
                      <PencilIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(g.id)}
                      aria-label={`Delete ${g.name}`}
                      className="rounded-full p-1.5 text-ink-muted hover:bg-peach hover:text-coral-ink"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">Sort vendors into groups like “Pokémon”, “Sports” or “Food trucks”.</p>
      )}
      <form onSubmit={onCreate} className="mt-3 flex gap-2">
        <input
          aria-label="New group name"
          placeholder="New group"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-full border-2 border-cream bg-white px-3 py-1.5 text-sm focus:border-coral focus:outline-none"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-full bg-slate px-3.5 text-sm font-bold text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error && (
        <p className="mt-2 text-sm font-semibold text-coral-ink" role="alert">
          {error.message}
        </p>
      )}
    </section>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="vendor-dialog-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl focus:outline-none sm:p-8"
      >
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="vendor-dialog-title" className="pr-8 text-2xl font-extrabold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm font-semibold text-coral-ink">{error}</span>}
    </label>
  );
}

function fieldErrorsOf(err: Error | null) {
  return err instanceof ApiRequestError ? (err.body.fieldErrors ?? {}) : {};
}

function AddVendorDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const create = useCreateVendor();
  const [form, setForm] = useState({ name: "", businessName: "", email: "", phone: "", notes: "" });
  const errors = fieldErrorsOf(create.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(form, {
      onSuccess: (v) => {
        onClose();
        onAdded(v.id);
      },
    });
  }

  return (
    <Dialog title="Add a vendor" onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <Field label="Name" error={errors.name?.[0]}>
          <input className={inputClass} value={form.name} onChange={set("name")} required />
        </Field>
        <Field label="Business (optional)" error={errors.businessName?.[0]}>
          <input className={inputClass} value={form.businessName} onChange={set("businessName")} />
        </Field>
        <Field label="Email" error={errors.email?.[0]}>
          <input className={inputClass} type="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="Phone (optional)" error={errors.phone?.[0]}>
          <input className={inputClass} type="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Notes (optional)">
          <textarea className={inputClass} rows={2} value={form.notes} onChange={set("notes")} />
        </Field>
        {create.error && !Object.keys(errors).length && (
          <p className="text-sm font-semibold text-coral-ink" role="alert">
            {create.error.message}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 font-bold text-ink-soft hover:bg-cream">
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-2.5 font-bold text-white disabled:opacity-60"
          >
            {create.isPending ? "Adding…" : "Add vendor"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const statusText: Record<BookingStatus, string> = {
  pending: "Waiting for approval",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  rejected: closedLabel("rejected"),
  released: closedLabel("released"),
  cancelled: closedLabel("cancelled"),
};

function VendorDialog({ vendor, groups, onClose }: { vendor: VendorListItem; groups: VendorGroup[]; onClose: () => void }) {
  const update = useUpdateVendor();
  const history = useVendorRequests(vendor.id);
  const [form, setForm] = useState({
    name: vendor.name,
    businessName: vendor.businessName,
    email: vendor.email,
    phone: vendor.phone,
    notes: vendor.notes,
    favourite: vendor.favourite,
    banned: vendor.banned,
    banReason: vendor.banReason,
    groupIds: vendor.groupIds,
  });
  const errors = fieldErrorsOf(update.error);
  const set = (k: "name" | "businessName" | "email" | "phone" | "notes" | "banReason") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleGroup = (id: string) =>
    setForm((f) => ({ ...f, groupIds: f.groupIds.includes(id) ? f.groupIds.filter((g) => g !== id) : [...f.groupIds, id] }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ id: vendor.id, ...form }, { onSuccess: onClose });
  }

  return (
    <Dialog title={vendor.name} onClose={onClose}>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            className="size-4 accent-coral"
            checked={form.favourite}
            onChange={(e) => setForm((f) => ({ ...f, favourite: e.target.checked }))}
          />
          <StarIcon className="size-4 text-gold-ink" fill={form.favourite ? "currentColor" : "none"} /> Favourite
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.[0]}>
            <input className={inputClass} value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="Business" error={errors.businessName?.[0]}>
            <input className={inputClass} value={form.businessName} onChange={set("businessName")} />
          </Field>
          <Field label="Email" error={errors.email?.[0]}>
            <input className={inputClass} type="email" value={form.email} onChange={set("email")} required />
          </Field>
          <Field label="Phone" error={errors.phone?.[0]}>
            <input className={inputClass} type="tel" value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <Field label="Notes (only you see these)">
          <textarea className={inputClass} rows={2} value={form.notes} onChange={set("notes")} />
        </Field>

        <fieldset>
          <legend className="text-sm font-bold">Groups</legend>
          {groups.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = form.groupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGroup(g.id)}
                    className={`rounded-full px-3 py-1 text-sm font-bold transition ${
                      on ? "bg-slate text-white" : "bg-white text-ink-soft ring-1 ring-ink/10 hover:text-ink"
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">No groups yet. Create one in the Groups panel.</p>
          )}
        </fieldset>

        <div className={`rounded-2xl p-4 ring-1 ${form.banned ? "bg-peach/50 ring-coral/30" : "bg-cream-50 ring-ink/5"}`}>
          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              className="size-4 accent-coral"
              checked={form.banned}
              onChange={(e) => setForm((f) => ({ ...f, banned: e.target.checked }))}
            />
            <BanIcon className="size-4 text-coral-ink" /> Ban this vendor
          </label>
          <p className="mt-1 text-xs text-ink-soft">
            Their requests will always wait for your approval and be flagged. They won't be told, and they're skipped
            when you invite a group.
          </p>
          {form.banned && (
            <Field label="Reason (optional, only you see it)">
              <input className={inputClass} value={form.banReason} onChange={set("banReason")} maxLength={500} />
            </Field>
          )}
        </div>

        <section>
          <h3 className="text-sm font-bold">History</h3>
          {history.isPending ? (
            <p className="mt-1 text-sm text-ink-muted">Loading…</p>
          ) : history.data?.length ? (
            <ul className="mt-1.5 divide-y divide-ink/5 rounded-2xl bg-cream-50 px-3 ring-1 ring-ink/5">
              {history.data.map((r) => (
                <li key={r.requestId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link to={`/dashboard/events/${r.eventId}/tables`} className="font-bold text-coral-ink hover:underline">
                      {r.eventName}
                    </Link>
                    {r.eventStartDate && (
                      <span className="text-ink-muted"> · {formatDate(r.eventStartDate, { month: "short", day: "numeric", year: "numeric" })}</span>
                    )}
                    <span className="block text-xs text-ink-soft">
                      {r.tableLabels.length > 1 ? "Tables" : "Table"} {r.tableLabels.join(", ")}
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-ink-soft">{statusText[r.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">No bookings yet.</p>
          )}
        </section>

        {update.error && !Object.keys(errors).length && (
          <p className="text-sm font-semibold text-coral-ink" role="alert">
            {update.error.message}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 font-bold text-ink-soft hover:bg-cream">
            Cancel
          </button>
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-2.5 font-bold text-white disabled:opacity-60"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── CSV export ───────────────────────────────────────────────────────────

function exportCsv(list: VendorListItem[], groupName: Map<string, string>, label: string) {
  const cell = (v: string | number) => {
    const s = String(v);
    // Quote everything; neutralize spreadsheet formulas in user-entered text
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["Name", "Business", "Email", "Phone", "Favourite", "Banned", "Groups", "Requests", "Shows", "Notes"];
  const rows = list.map((v) => [
    v.name,
    v.businessName,
    v.email,
    v.phone,
    v.favourite ? "yes" : "",
    v.banned ? "yes" : "",
    v.groupIds.map((id) => groupName.get(id) ?? "").join("; "),
    v.requestCount,
    v.showCount,
    v.notes,
  ]);
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  // BOM so Excel reads accents (é) correctly
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendors-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
