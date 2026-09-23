import { Link } from "react-router";
import { PlaneIcon } from "./Icons";

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 font-extrabold text-ink ${className}`}>
      <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-coral to-gold text-white shadow-sm">
        <PlaneIcon className="size-5" />
      </span>
      <span className="text-xl tracking-tight">Flightplan</span>
    </Link>
  );
}
