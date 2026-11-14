import { useSyncExternalStore } from "react";
import { dismiss, getToasts, listeners } from "../lib/toast";
import { CheckIcon, CloseIcon } from "./Icons";

/** Where toasts appear. Mounted once at the app root; screen readers announce new ones. */
export default function Toaster() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    getToasts,
  );
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:top-6 sm:right-6 sm:items-end"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl bg-ink py-2.5 pr-2 pl-4 text-sm font-semibold text-white shadow-lg motion-safe:animate-[toast-in_160ms_ease-out]"
        >
          {t.tone === "success" ? (
            <CheckIcon className="size-4 shrink-0 text-[#8fd6c4]" />
          ) : (
            <span className="size-2 shrink-0 rounded-full bg-coral" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">{t.message}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Dismiss">
            <CloseIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
