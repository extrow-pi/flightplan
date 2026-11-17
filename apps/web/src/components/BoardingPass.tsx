import { CheckIcon, PlaneIcon } from "./Icons";

// Illustrative preview of an event, styled as a boarding pass (sample data).
const tables = Array.from({ length: 24 }, (_, i) => (i % 7 === 3 || i === 22 ? "open" : "booked"));

export default function BoardingPass() {
  const booked = tables.filter((t) => t === "booked").length;

  return (
    <div className="relative mx-auto w-full max-w-md" aria-label="Example event preview" role="img">
      {/* Soft glow behind the card */}
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-coral/30 via-gold/25 to-sky/30 blur-2xl" />

      <div className="overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-ink/5">
        {/* Header strip */}
        <div className="flex items-center justify-between bg-primary px-6 py-4 text-white">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <PlaneIcon className="size-5" />
            Show pass
          </div>
          <span className="rounded-full bg-white/25 px-3 py-1 text-xs font-semibold">Boarding now</span>
        </div>

        <div className="px-6 pt-5 pb-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-wider text-ink-muted uppercase">Event</p>
              <p className="text-2xl font-semibold text-ink">Layover Card Show</p>
            </div>
            <div className="rounded-xl bg-primary px-3 py-2 text-center text-white shadow-card">
              <p className="text-[10px] font-semibold uppercase">Oct</p>
              <p className="text-2xl leading-none font-semibold">25</p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium tracking-wider text-ink-muted uppercase">Gate</dt>
              <dd className="font-semibold">Main Hall</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wider text-ink-muted uppercase">Doors</dt>
              <dd className="font-semibold">11:00 am</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wider text-ink-muted uppercase">Tickets</dt>
              <dd className="font-semibold">312 sold</dd>
            </div>
          </dl>

          {/* Perforation */}
          <div className="relative my-5 border-t-2 border-dashed border-cream">
            <span className="absolute -top-3 -left-9 size-6 rounded-full bg-cream-50" />
            <span className="absolute -top-3 -right-9 size-6 rounded-full bg-cream-50" />
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="font-semibold">Vendor tables</p>
            <p className="font-medium text-ink-soft">
              <span className="text-coral-ink">{booked}</span> / {tables.length} booked
            </p>
          </div>
          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {tables.map((status, i) => (
              <span
                key={i}
                className={
                  status === "booked"
                    ? "aspect-square rounded-md bg-coral/85"
                    : "aspect-square rounded-md border border-dashed border-sky bg-sky/15"
                }
              />
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-ink-soft">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-coral/85" /> Booked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-dashed border-sky bg-sky/15" /> Open
            </span>
          </div>
        </div>
      </div>

      {/* Floating notification */}
      <div className="absolute -bottom-5 -left-3 flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-lg ring-1 ring-ink/5 sm:-left-8">
        <span className="flex size-9 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckIcon className="size-5" />
        </span>
        <div className="text-sm">
          <p className="font-semibold">Table B7 booked</p>
          <p className="text-xs text-ink-muted">Paid · just now</p>
        </div>
      </div>
    </div>
  );
}
