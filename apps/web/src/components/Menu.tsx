import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./Icons";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  /** Shown in red, for things like Release or Reject */
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip with more detail */
  title?: string;
};

/**
 * A "More" button with a short list of less common actions. Opens below the button, closes on
 * Escape, outside click or picking an item, and supports arrow keys like a native menu.
 */
export default function Menu({
  label = "More",
  items,
  align = "end",
  disabled = false,
}: {
  label?: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    // Focus the first item so arrow keys work straight away
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  function onMenuKey(e: React.KeyboardEvent) {
    const all = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? all[0] : all[all.length - 1])?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold text-ink-soft transition hover:bg-cream hover:text-ink disabled:opacity-60"
      >
        {label}
        <ChevronDownIcon className={`size-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={onMenuKey}
          className={`absolute top-full z-30 mt-1 min-w-48 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-ink/10 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition disabled:opacity-50 ${
                item.danger ? "text-coral-ink hover:bg-peach focus-visible:bg-peach" : "text-ink hover:bg-cream focus-visible:bg-cream"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
