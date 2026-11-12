import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { eventEndDate, type PublicEventMap } from "@flightplan/shared";
import VendorMap from "../components/floorplan/VendorMap";
import { MapPinIcon } from "../components/Icons";
import Logo from "../components/Logo";
import { ApiRequestError, usePublicEventMap } from "../lib/api";
import { formatDate, formatDateRange } from "../lib/format";

// The public vendor map for a show: search for a vendor and see where their table is. No sign-in.
export default function VisitorMapPage() {
  const { eventId } = useParams();
  const { data, isPending, error } = usePublicEventMap(eventId);

  useEffect(() => {
    if (data) document.title = `Vendor map · ${data.event.name}`;
    return () => {
      document.title = "Flightplan — Event tools for show organizers";
    };
  }, [data]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6">
        {isPending ? (
          <p className="py-20 text-center text-ink-muted" role="status">
            Loading the map…
          </p>
        ) : error || !data ? (
          <section className="rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-ink/5">
            <h1 className="text-2xl font-extrabold">
              {error instanceof ApiRequestError && error.status === 404 ? "This map isn't available" : "Couldn't load the map"}
            </h1>
            <p className="mt-2 text-ink-soft">
              {error instanceof ApiRequestError && error.status === 404
                ? "The organizer may not have shared a vendor map for this show yet."
                : "Please try again in a moment."}
            </p>
          </section>
        ) : (
          <MapPage data={data} />
        )}
      </main>
      <footer className="border-t border-ink/5 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-sm text-ink-muted sm:flex-row sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            Map by <Logo className="scale-75" />
          </span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-ink">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function MapPage({ data }: { data: PublicEventMap }) {
  const { event } = data;
  const end = eventEndDate(event);
  const when = end && end !== event.startDate ? formatDateRange(event.startDate, end) : formatDate(event.startDate);

  return (
    <>
      <header>
        {event.organizerUrl ? (
          <Link to={event.organizerUrl} className="text-sm font-bold text-coral-ink hover:underline">
            {event.organizerName}
          </Link>
        ) : (
          <p className="text-sm font-bold text-coral-ink">{event.organizerName}</p>
        )}
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-ink-soft">
          <span>{when}</span>
          {(event.venueName || event.city) && (
            <span className="flex items-center gap-1">
              <MapPinIcon className="size-4" /> {[event.venueName, event.city].filter(Boolean).join(", ")}
            </span>
          )}
        </p>
      </header>

      <div className="mt-6">
        <VendorMap data={data} />
      </div>
    </>
  );
}
