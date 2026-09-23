import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import Logo from "../../components/Logo";
import {
  CalendarIcon,
  CloseIcon,
  CopyIcon,
  HomeIcon,
  MailIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  TicketIcon,
  UsersIcon,
} from "../../components/Icons";
import { signOut, useSession } from "../../lib/auth-client";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
  soon?: boolean;
};

const nav: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: HomeIcon, end: true },
  { to: "/dashboard/events", label: "Events", icon: CalendarIcon },
  { to: "/dashboard/templates", label: "Templates", icon: CopyIcon },
  { to: "/dashboard/emails", label: "Email log", icon: MailIcon },
  { to: "/dashboard/vendors", label: "Vendors", icon: UsersIcon, soon: true },
  { to: "/dashboard/tickets", label: "Tickets", icon: TicketIcon, soon: true },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon, soon: true },
];

/** Signed-in shell for all /dashboard pages: auth guard, sidebar, and page outlet. */
export default function DashboardLayout() {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu after navigating
  useEffect(() => setMenuOpen(false), [location.pathname]);

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

  const sidebar = <Sidebar user={session.user} />;

  return (
    <div className="min-h-dvh bg-cream-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-ink/5 bg-white lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink/5 bg-white/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="rounded-full p-2 text-ink"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="dashboard-menu"
        >
          <MenuIcon className="size-6" />
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" id="dashboard-menu">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="absolute top-4 right-3 rounded-full p-2 text-ink"
              aria-label="Close menu"
            >
              <CloseIcon className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Sidebar({ user }: { user: { name: string; email: string; image?: string | null } }) {
  return (
    <div className="flex h-full flex-col px-4 py-5">
      <div className="px-2">
        <Logo />
      </div>

      <nav className="mt-8 flex flex-col gap-1" aria-label="Dashboard">
        {nav.map((item) =>
          item.soon ? (
            <span
              key={item.to}
              className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 font-semibold text-ink-muted/80"
              aria-disabled="true"
            >
              <item.icon className="size-5" />
              {item.label}
              <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold-ink uppercase">
                Soon
              </span>
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold transition ${
                  isActive ? "bg-peach/70 text-coral-ink" : "text-ink-soft hover:bg-cream-50 hover:text-ink"
                }`
              }
            >
              <item.icon className="size-5" />
              {item.label}
            </NavLink>
          ),
        )}
      </nav>

      <UserCard user={user} />
    </div>
  );
}

function UserCard({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const initials = user.name
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
    <div className="mt-auto rounded-2xl bg-cream-50 p-3 ring-1 ring-ink/5">
      <div className="flex items-center gap-3">
        {user.image ? (
          <img src={user.image} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate text-sm font-bold text-white">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{user.name}</p>
          <p className="truncate text-xs text-ink-muted">{user.email}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate/20 py-2 text-sm font-bold text-slate transition hover:border-slate disabled:opacity-60"
      >
        <LogOutIcon className="size-4" />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
