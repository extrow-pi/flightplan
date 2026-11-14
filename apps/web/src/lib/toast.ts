// Short confirmations shown in the corner (see components/Toaster). A tiny store, so any code can
// call toast() without a provider.

export type Toast = { id: number; message: string; tone: "success" | "error" };

let toasts: Toast[] = [];
export const getToasts = () => toasts;
let nextId = 1;
export const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Show a short confirmation in the corner, e.g. toast("Marked paid"). Disappears after a few seconds. */
export function toast(message: string, tone: Toast["tone"] = "success") {
  const id = nextId++;
  // At most three at once; the oldest goes first
  toasts = [...toasts.slice(-2), { id, message, tone }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
}
