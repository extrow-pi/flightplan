import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FLOOR_MAP_MAX_BYTES, FLOOR_MAP_TYPES, HANDLE_PATTERN, type OrganizerProfile } from "@flightplan/shared";
import CopyButton from "../../components/CopyButton";
import { useSession } from "../../lib/auth-client";
import { ApiRequestError, useHandleAvailable, useProfile, useProfileLogo, useSaveProfile } from "../../lib/api";
import { PageHeader } from "./ui";

const inputClass =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none aria-invalid:border-coral";

export default function SettingsPage() {
  const profile = useProfile();
  const { data: session } = useSession();

  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" action={null} />
      {profile.error ? (
        <p className="rounded-3xl bg-peach px-6 py-5 font-semibold text-coral-ink" role="alert">
          Couldn't load your settings: {profile.error.message}
        </p>
      ) : profile.isPending || !session ? (
        <p className="text-ink-muted" role="status">
          Loading…
        </p>
      ) : (
        <PublicPageForm
          saved={profile.data.profile}
          suggestedHandle={profile.data.suggestedHandle}
          defaultName={session.user.name}
        />
      )}
    </>
  );
}

function PublicPageForm({
  saved,
  suggestedHandle,
  defaultName,
}: {
  saved: OrganizerProfile | null;
  suggestedHandle: string;
  defaultName: string;
}) {
  const save = useSaveProfile();
  const [form, setForm] = useState({
    handle: saved?.handle ?? suggestedHandle,
    displayName: saved?.displayName ?? defaultName,
    bio: saved?.bio ?? "",
    websiteUrl: saved?.websiteUrl ?? "",
    instagram: saved?.instagram ?? "",
    contactEmail: saved?.contactEmail ?? "",
    published: saved?.published ?? false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: Exclude<keyof typeof form, "published">) => (e: { target: { value: string } }) => {
    setNotice(null);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  // Check the handle as they type (after a short pause)
  const [debounced, setDebounced] = useState(form.handle);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(form.handle.trim().toLowerCase()), 400);
    return () => clearTimeout(t);
  }, [form.handle]);
  const availability = useHandleAvailable(debounced);
  const handleOk = HANDLE_PATTERN.test(form.handle.trim().toLowerCase());

  const errors = save.error instanceof ApiRequestError ? (save.error.body.fieldErrors ?? {}) : {};
  const pageUrl = `${window.location.origin}/o/${saved?.handle ?? ""}`;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(form, {
      onSuccess: (p) => setNotice(p.published ? "Saved. Your page is live." : "Saved. Your page is hidden until you switch it on."),
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form onSubmit={onSubmit} className="space-y-6">
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
          <h2 className="text-lg font-extrabold">Public page</h2>
          <p className="mt-1 text-sm text-ink-soft">
            A page listing your published shows for vendors and visitors, with a booking button whenever a show's booking
            link is open. Drafts and templates never appear.
          </p>

          <label className="mt-6 flex items-start gap-3 rounded-2xl bg-cream-50 p-4 ring-1 ring-ink/5">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-coral"
              checked={form.published}
              onChange={(e) => {
                setNotice(null);
                setForm((f) => ({ ...f, published: e.target.checked }));
              }}
            />
            <span>
              <span className="block font-bold">Show my public page</span>
              <span className="block text-sm text-ink-soft">When off, the address shows "not found".</span>
            </span>
          </label>

          <div className="mt-5 grid grid-cols-1 gap-4">
            <Field label="Page address" error={errors.handle?.[0]}>
              <div className="mt-1 flex items-center overflow-hidden rounded-xl border-2 border-cream bg-white focus-within:border-coral">
                <span className="shrink-0 bg-cream-50 px-3 py-2 text-sm text-ink-muted">/o/</span>
                <input
                  value={form.handle}
                  onChange={set("handle")}
                  required
                  maxLength={30}
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!errors.handle || (form.handle.length > 0 && !handleOk)}
                  className="min-w-0 flex-1 px-3 py-2 text-ink focus:outline-none"
                />
              </div>
              <HandleStatus
                handle={form.handle}
                ok={handleOk}
                checking={availability.isFetching || debounced !== form.handle.trim().toLowerCase()}
                available={availability.data?.available}
              />
            </Field>
            <Field label="Name shown on the page" error={errors.displayName?.[0]}>
              <input className={inputClass} value={form.displayName} onChange={set("displayName")} required maxLength={80} />
            </Field>
            <Field label="About (optional)" error={errors.bio?.[0]}>
              <textarea
                className={inputClass}
                rows={4}
                maxLength={1000}
                value={form.bio}
                onChange={set("bio")}
                placeholder="What kind of shows you run, where, and who they're for."
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Website" error={errors.websiteUrl?.[0]}>
                <input className={inputClass} value={form.websiteUrl} onChange={set("websiteUrl")} placeholder="jetlaggedcards.ca" />
              </Field>
              <Field label="Instagram" error={errors.instagram?.[0]}>
                <input className={inputClass} value={form.instagram} onChange={set("instagram")} placeholder="@yourshow" />
              </Field>
              <Field label="Public email" error={errors.contactEmail?.[0]}>
                <input className={inputClass} type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="hello@yourshow.com" />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-ink-muted">Everything on this page is public, including the email if you add one.</p>
          </div>

          {save.error && !Object.keys(errors).length && (
            <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
              {save.error.message}
            </p>
          )}
          {notice && (
            <p className="mt-4 rounded-xl bg-[#e8f8f5] px-4 py-3 text-sm font-semibold text-[#2d7a6a]" role="status">
              {notice}
            </p>
          )}
          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-7 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      </form>

      <aside className="space-y-6">
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
          <h2 className="font-extrabold">Your page</h2>
          {saved?.published ? (
            <>
              <p className="mt-2 truncate rounded-xl bg-cream-50 px-3 py-2 font-mono text-xs text-ink-soft ring-1 ring-ink/5" title={pageUrl}>
                {pageUrl}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <CopyButton text={pageUrl} />
                <a href={`/o/${saved.handle}`} target="_blank" rel="noreferrer" className="text-sm font-bold text-coral-ink hover:underline">
                  View page
                </a>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">
              {saved ? "Hidden. Switch on “Show my public page” and save." : "Save the form to create your page."}
            </p>
          )}
        </section>
        <LogoCard saved={saved} />
      </aside>
    </div>
  );
}

function HandleStatus({ handle, ok, checking, available }: { handle: string; ok: boolean; checking: boolean; available?: boolean }) {
  if (!handle) return null;
  const [tone, text] = !ok
    ? ["text-coral-ink", "3–30 lowercase letters, numbers and hyphens"]
    : checking
      ? ["text-ink-muted", "Checking…"]
      : available
        ? ["text-[#2d7a6a]", "Available"]
        : ["text-coral-ink", "Already taken"];
  return (
    <span className={`mt-1 block text-xs font-semibold ${tone}`} aria-live="polite">
      {text}
    </span>
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

function LogoCard({ saved }: { saved: OrganizerProfile | null }) {
  const { upload, remove } = useProfileLogo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? upload.error?.message ?? remove.error?.message;

  function onFile(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!(FLOOR_MAP_TYPES as readonly string[]).includes(file.type)) return setLocalError("Upload a PNG, JPEG or WebP image");
    if (file.size > FLOOR_MAP_MAX_BYTES) return setLocalError("Images can be up to 10 MB");
    upload.mutate(file);
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-extrabold">Logo</h2>
      {!saved ? (
        <p className="mt-2 text-sm text-ink-soft">Save your page first, then add a logo.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-4">
            {saved.logoUrl ? (
              <img src={saved.logoUrl} alt="Your logo" className="size-20 rounded-2xl bg-cream-50 object-contain ring-1 ring-ink/10" />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-2xl bg-cream-50 text-xs font-semibold text-ink-muted ring-1 ring-ink/10">
                No logo
              </span>
            )}
            <div className="flex flex-col items-start gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={upload.isPending}
                className="rounded-full border-2 border-slate/30 px-3.5 py-1.5 text-sm font-bold text-slate hover:border-slate disabled:opacity-60"
              >
                {upload.isPending ? "Uploading…" : saved.logoUrl ? "Replace" : "Upload"}
              </button>
              {saved.logoUrl && (
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="px-1 text-sm font-bold text-coral-ink hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Square images look best. PNG, JPEG or WebP.</p>
          <input
            ref={inputRef}
            type="file"
            accept={FLOOR_MAP_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label="Logo image"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}
      {error && (
        <p className="mt-2 text-sm font-semibold text-coral-ink" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
