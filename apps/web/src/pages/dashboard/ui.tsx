import type { ReactNode } from "react";
import { Link } from "react-router";
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
  /** Defaults to a "Create event" button */
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-ink-soft">{subtitle}</p>}
      </div>
      {action ?? (
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
