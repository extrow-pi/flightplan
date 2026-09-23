import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import Logo from "../components/Logo";
import { TicketIcon } from "../components/Icons";
import { signOut, useSession } from "../lib/auth-client";

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream-50 text-ink-muted" role="status">
        Loading your dashboard…
      </div>
    );
  }

  if (!session) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const { user } = session;
  const firstName = user.name.split(" ")[0];

  return (
    <div className="min-h-dvh bg-cream-50">
      <header className="border-b border-ink/5 bg-white">
        <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <UserMenu name={user.name} email={user.email} image={user.image} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">Organizer dashboard</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Welcome aboard, {firstName}!</h1>

        <section className="mt-10 flex flex-col items-center rounded-3xl border-2 border-dashed border-coral/30 bg-white px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-coral to-gold text-white shadow-md">
            <TicketIcon className="size-7" />
          </span>
          <h2 className="mt-5 text-xl font-extrabold">No events yet</h2>
          <p className="mt-2 max-w-sm text-ink-soft">
            Your shows will appear here. Creating events is the next thing we're building.
          </p>
          <button
            type="button"
            disabled
            className="mt-6 cursor-not-allowed rounded-full bg-coral px-6 py-3 font-bold text-white opacity-60"
          >
            Create an event · coming soon
          </button>
        </section>
      </main>
    </div>
  );
}

function UserMenu({ name, email, image }: { name: string; email: string; image?: string | null }) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-bold">{name}</p>
        <p className="text-xs text-ink-muted">{email}</p>
      </div>
      {image ? (
        <img src={image} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-full bg-slate text-sm font-bold text-white">
          {initials}
        </span>
      )}
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="rounded-full border-2 border-slate px-4 py-2 text-sm font-bold text-slate transition hover:bg-slate hover:text-white disabled:opacity-60"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
