/** Grey placeholder shapes shown while a page loads, roughly where its content will appear. */

const block = "animate-pulse rounded-xl bg-ink/[0.07]";

export function SkeletonLine({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`block h-4 ${block} ${className}`} style={style} />;
}

/** A white card with a heading and a few lines */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5">
      <SkeletonLine className="h-5 w-1/3" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonLine key={i} className={i === lines - 1 ? "w-2/3" : "w-full"} />
        ))}
      </div>
    </div>
  );
}

/** A dashboard page: back link, title, tabs and two columns of cards */
export function PageSkeleton({ tabs = true }: { tabs?: boolean }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="mt-4 h-9 w-2/3 max-w-md" />
      {tabs && (
        <div className="mt-7 flex gap-3">
          {[16, 28, 20, 20, 16].map((w, i) => (
            <SkeletonLine key={i} className="h-5" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
      )}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </div>
        <div className="hidden space-y-6 lg:block">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </div>
      </div>
    </div>
  );
}

/** A single centred card, for public pages */
export function CardSkeleton() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-3xl space-y-6">
      <span className="sr-only">Loading…</span>
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </div>
  );
}
