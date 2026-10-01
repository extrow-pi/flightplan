import { BanIcon } from "./Icons";

/** Marks a vendor on the organizer's ban list. Only ever shown to organizers. */
export default function BannedBadge({ reason }: { reason?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-coral-ink px-2 py-0.5 text-xs font-bold text-white"
      title={reason ? `Banned: ${reason}` : "On your ban list"}
    >
      <BanIcon className="size-3" /> Banned
    </span>
  );
}
