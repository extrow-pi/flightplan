import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker } from "react-router";
import { FLOOR_MAP_MAX_BYTES, FLOOR_MAP_TYPES } from "@flightplan/shared";
import { PlusIcon } from "../../components/Icons";

// Building blocks shared by the dashboard pages

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Defaults to a "Create event" button; pass null for none */
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-ink-soft">{subtitle}</p>}
      </div>
      {action !== undefined ? action : (
        <Link
          to="/dashboard/events/new"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full whitespace-nowrap bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
        >
          <PlusIcon className="size-4" strokeWidth={3} />
          Create event
        </Link>
      )}
    </div>
  );
}

export function LoadingCards() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-3xl bg-white ring-1 ring-ink/5" />
      ))}
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <p className="rounded-3xl bg-peach px-6 py-5 font-semibold text-coral-ink" role="alert">
      Couldn't load your events: {message}
    </p>
  );
}

// ── Form building blocks (event form, show page) ─────────────────────────

export function PrimaryButton({ onClick, pending, children }: { onClick: () => void; pending: boolean; children: ReactNode }) {
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

export const inputClass =
  "w-full rounded-xl border-2 border-cream bg-white px-4 py-3 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none aria-invalid:border-coral-ink";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
      <legend className="sr-only">{title}</legend>
      <h2 className="text-lg font-extrabold" aria-hidden="true">
        {title}
      </h2>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function Field({
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

export function Toggle({
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

// ── Unsaved changes ──────────────────────────────────────────────────────

/**
 * Stop the user leaving a form with unsaved changes: links and back/forward inside the app show our
 * own dialog (Keep editing / Discard and leave), and closing or reloading the tab asks the browser to
 * confirm. Render `dialog`, and call `allowLeaving()` just before navigating away after a save.
 */
export function useUnsavedChanges(dirty: boolean) {
  const leaving = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const dialog =
    blocker.state === "blocked" ? <UnsavedChangesDialog onStay={() => blocker.reset()} onLeave={() => blocker.proceed()} /> : null;
  return { dialog, allowLeaving: () => (leaving.current = true) };
}

function UnsavedChangesDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onStay();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStay]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onStay}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-body"
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="unsaved-title" className="text-xl font-extrabold">
          You have unsaved changes
        </h2>
        <p id="unsaved-body" className="mt-2 text-ink-soft">
          Your changes haven't been saved. Keep editing to save them, or leave and discard them.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onLeave}
            className="rounded-full px-5 py-3 font-bold text-coral-ink transition hover:bg-peach"
          >
            Discard and leave
          </button>
          <button
            ref={stayRef}
            type="button"
            onClick={onStay}
            className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)]"
          >
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Unsaved changes · Discard changes" for a form's save bar (nothing when there are no changes). */
export function SaveStatus({ dirty, onDiscard }: { dirty: boolean; onDiscard: () => void }) {
  if (!dirty) return null;
  return (
    <span className="flex items-center gap-3 text-sm sm:mr-auto">
      <span className="flex items-center gap-1.5 font-bold text-gold-ink">
        <span className="size-2 rounded-full bg-gold" aria-hidden="true" />
        Unsaved changes
      </span>
      <button type="button" onClick={onDiscard} className="rounded-full px-3 py-1.5 font-bold text-ink-soft transition hover:bg-cream hover:text-ink">
        Discard changes
      </button>
    </span>
  );
}

const IMAGE_MAX_MB = FLOOR_MAP_MAX_BYTES / 1024 / 1024;

/**
 * Choose images with a hidden file input (call `open`) or by dropping them (`take`). Checks each
 * file's type and size before handing them over. Render `input` somewhere in the component.
 */
export function useImagePicker({ label, multiple = false, onFiles }: { label: string; multiple?: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function take(list: FileList | null | undefined) {
    setError(null);
    const files = [...(list ?? [])].slice(0, multiple ? undefined : 1);
    if (!files.length) return;
    const prefix = (f: File) => (files.length > 1 ? `${f.name}: ` : "");
    const wrongType = files.find((f) => !(FLOOR_MAP_TYPES as readonly string[]).includes(f.type));
    if (wrongType) return setError(`${prefix(wrongType)}Upload a PNG, JPEG or WebP image`);
    const tooBig = files.find((f) => f.size > FLOOR_MAP_MAX_BYTES);
    if (tooBig) return setError(`${prefix(tooBig)}Images can be up to ${IMAGE_MAX_MB} MB`);
    onFiles(files);
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple={multiple}
      accept={FLOOR_MAP_TYPES.join(",")}
      className="sr-only"
      tabIndex={-1}
      aria-label={label}
      onChange={(e) => {
        take(e.target.files);
        e.target.value = "";
      }}
    />
  );
  return { open: () => inputRef.current?.click(), take, input, error, setError };
}

/** The dashed "click or drop an image here" box. */
export function ImageDropzone({
  label,
  hint,
  busy,
  multiple,
  picker,
  className = "py-10",
}: {
  label: string;
  hint?: string;
  busy?: boolean;
  multiple?: boolean;
  picker: ReturnType<typeof useImagePicker>;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={picker.open}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        picker.take(e.dataTransfer.files);
      }}
      disabled={busy}
      className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-coral/40 bg-peach/20 px-6 text-center transition hover:border-coral hover:bg-peach/40 disabled:opacity-60 ${className}`}
    >
      <span className="font-bold text-coral-ink">{busy ? "Uploading…" : label}</span>
      <span className="mt-1 text-sm text-ink-soft">
        {hint ? `${hint} ` : ""}PNG, JPEG or WebP, up to {IMAGE_MAX_MB} MB. Click or drop {multiple ? "files" : "a file"} here.
      </span>
    </button>
  );
}
