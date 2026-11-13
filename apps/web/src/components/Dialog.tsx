import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { ApiRequestError } from "../lib/api";
import { CloseIcon } from "./Icons";

export const smallInput =
  "mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";

/** Close on Escape and focus the first thing in the dialog. */
export function useDialog(onClose: () => void) {
  const firstRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return firstRef;
}

export function Dialog({
  title,
  intro,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  intro: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 rounded-full p-2 text-ink-soft hover:bg-cream" aria-label="Close">
          <CloseIcon className="size-5" />
        </button>
        <h2 id="dialog-title" className="pr-8 text-2xl font-extrabold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">{intro}</p>
        {children}
      </form>
    </div>
  );
}

export function errorMessage(error: Error) {
  const fieldErrors = error instanceof ApiRequestError ? error.body.fieldErrors : undefined;
  return fieldErrors ? (Object.values(fieldErrors).flat()[0] ?? error.message) : error.message;
}
