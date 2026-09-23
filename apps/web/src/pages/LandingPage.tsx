import { useState } from "react";
import { Link } from "react-router";
import BoardingPass from "../components/BoardingPass";
import Logo from "../components/Logo";
import SignupForm from "../components/SignupForm";
import { useSession } from "../lib/auth-client";
import {
  ArrowRightIcon,
  BellIcon,
  CheckIcon,
  CheckInIcon,
  CloseIcon,
  MapIcon,
  MenuIcon,
  PlaneIcon,
  TableIcon,
  TicketIcon,
  WalletIcon,
} from "../components/Icons";

const MAIN_SITE = "https://jetlaggedcards.ca";

const navLinks = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

export default function LandingPage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:shadow"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <SignupSection />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-40 border-b border-ink/5 bg-cream-50/85 backdrop-blur-md">
      <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-peach/60 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
          {session ? (
            <Link
              to="/dashboard"
              className="ml-3 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-coral-deep"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="ml-2 rounded-full px-4 py-2 text-sm font-bold text-slate transition hover:bg-peach/60"
              >
                Log in
              </Link>
              <Link
                to="/signup"
                className="ml-1 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-coral-deep"
              >
                Become an organizer
              </Link>
            </>
          )}
        </nav>

        <button
          type="button"
          className="rounded-full p-2 text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <CloseIcon className="size-6" /> : <MenuIcon className="size-6" />}
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" className="border-t border-ink/5 px-4 pb-4 md:hidden" aria-label="Mobile">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-3 font-semibold text-ink-soft hover:bg-peach/60"
            >
              {l.label}
            </a>
          ))}
          {session ? (
            <Link to="/dashboard" className="mt-2 block rounded-full bg-coral px-5 py-3 text-center font-bold text-white">
              Go to dashboard
            </Link>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link
                to="/login"
                className="block rounded-full border-2 border-slate px-5 py-2.5 text-center font-bold text-slate"
              >
                Log in
              </Link>
              <Link to="/signup" className="block rounded-full bg-coral px-5 py-3 text-center font-bold text-white">
                Sign up
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#fff4e2] via-[#fdebd9] to-[#fbe2cf]">
      {/* Decorative flight path */}
      <svg
        className="pointer-events-none absolute top-16 -left-20 w-[700px] text-coral/25"
        viewBox="0 0 700 300"
        fill="none"
        aria-hidden="true"
      >
        <path d="M0 250 C 200 250, 300 60, 690 40" stroke="currentColor" strokeWidth="3" strokeDasharray="10 12" />
      </svg>

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24 lg:pb-32">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-coral/30 bg-peach/70 px-4 py-1.5 text-sm font-bold text-coral-ink">
            ✈️ For event organizers · Now boarding
          </span>

          <h1 className="mt-6 text-4xl leading-[1.05] font-extrabold tracking-tight text-ink sm:text-6xl">
            Plan the show.
            <br />
            <span className="bg-gradient-to-r from-coral to-[#e9a23b] bg-clip-text text-transparent">
              We'll handle boarding.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft lg:mx-0">
            Flightplan helps card and collectibles show organizers sell vendor tables, sell tickets and run show day,
            all in one place. Built by the team behind the Jetlagged Cards shows.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-coral-deep px-7 py-3.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
            >
              Start organizing
              <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how-it-works"
              className="rounded-full border-2 border-slate px-7 py-3 font-bold text-slate transition hover:bg-slate hover:text-white"
            >
              See how it works
            </a>
          </div>

          <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-semibold text-ink-soft lg:justify-start">
            {["Free during early access", "No setup fees", "Made in Vancouver"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <span className="text-coral">●</span> {t}
              </li>
            ))}
          </ul>
        </div>

        <BoardingPass />
      </div>
    </section>
  );
}

const steps = [
  {
    code: "01",
    tag: "Check in",
    title: "Create your organizer account",
    body: "Tell us about your show. We'll set up your organizer profile and public event page.",
  },
  {
    code: "02",
    tag: "Boarding",
    title: "Map your floor & open tables",
    body: "Lay out your venue, set table prices and tiers, then share one link with vendors.",
  },
  {
    code: "03",
    tag: "Takeoff",
    title: "Sell out and run show day",
    body: "Vendors book and pay online, attendees grab tickets, and check-in goes by in minutes.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-cream-50 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="How it works" title="From idea to sold-out show in three legs" />

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.code} className="relative rounded-3xl bg-white p-7 shadow-sm ring-1 ring-ink/5">
              <div className="flex items-center justify-between">
                <span className="text-4xl font-extrabold text-coral/30">{s.code}</span>
                <span className="rounded-full bg-cream px-3 py-1 text-xs font-bold tracking-wider text-gold-ink uppercase">
                  {s.tag}
                </span>
              </div>
              <h3 className="mt-5 text-xl font-extrabold">{s.title}</h3>
              <p className="mt-2 text-ink-soft">{s.body}</p>
              {i < steps.length - 1 && (
                <PlaneIcon
                  className="absolute top-1/2 -right-5 z-10 hidden size-7 rotate-45 text-coral md:block"
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const features = [
  {
    icon: TableIcon,
    title: "Vendor table booking",
    body: "Interactive floor plans. Vendors pick a spot, pay, and get a confirmation automatically.",
    color: "from-coral to-gold",
  },
  {
    icon: TicketIcon,
    title: "Attendee ticketing",
    body: "Early-bird, general and VIP tiers with QR tickets that scan at the door.",
    color: "from-gold to-coral",
  },
  {
    icon: MapIcon,
    title: "Beautiful event pages",
    body: "A shareable page for every show with the date, venue, vendor list and a countdown.",
    color: "from-sky to-slate",
  },
  {
    icon: CheckInIcon,
    title: "Fast show-day check-in",
    body: "Check in vendors and guests from your phone. See who has arrived at a glance.",
    color: "from-coral to-gold",
  },
  {
    icon: WalletIcon,
    title: "Payouts & reporting",
    body: "Track table and ticket revenue in one dashboard and export it for your books.",
    color: "from-gold to-coral",
  },
  {
    icon: BellIcon,
    title: "Automatic reminders",
    body: "Load-in times, parking notes and day-of updates go out to vendors for you.",
    color: "from-sky to-slate",
  },
];

function Features() {
  return (
    <section id="features" className="bg-slate py-24 text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Everything your show needs, nothing it doesn't"
          subtitle="Built from running real card shows, so it covers the things that actually cause headaches."
          dark
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-3xl border border-white/10 bg-white/[0.07] p-7 transition hover:-translate-y-1 hover:bg-white/10"
            >
              <span
                className={`flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br ${f.color} text-white shadow-md`}
              >
                <f.icon className="size-6" />
              </span>
              <h3 className="mt-5 text-lg font-extrabold">{f.title}</h3>
              <p className="mt-2 text-white/75">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignupSection() {
  return (
    <section id="signup" className="relative bg-gradient-to-b from-cream to-cream-50 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <span className="text-sm font-bold tracking-wider text-coral-ink uppercase">Early access</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Save your seat on the first flight</h2>
          <p className="mt-4 text-lg text-ink-soft">
            We're onboarding a small group of organizers first. Sign up and we'll help you set up your next show
            personally.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              "Hands-on setup help from our team",
              "Free while we're in early access",
              "Help decide which features we build next",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 font-semibold">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-coral text-white">
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-[0_20px_50px_-24px_rgba(74,55,40,0.3)] ring-1 ring-ink/5 sm:p-9">
          <SignupForm />
        </div>
      </div>
    </section>
  );
}

const faqs = [
  {
    q: "Who is Flightplan for?",
    a: "Organizers of trading card, collectibles and hobby shows, from a 20-table community meetup to a multi-hall convention. Other markets and fairs are welcome too.",
  },
  {
    q: "How much does it cost?",
    a: "It's free during early access. When we launch pricing, early organizers will get a founding-member rate, and we'll always tell you well in advance.",
  },
  {
    q: "Do vendors need an account?",
    a: "Vendors can book and pay for a table with just an email. They can create an account later to manage bookings across shows.",
  },
  {
    q: "I already sell tables over DMs and e-transfer. Can I switch mid-season?",
    a: "Yes. We can import the vendors you've already confirmed so everything lives in one place from your next show onward.",
  },
];

function Faq() {
  return (
    <section id="faq" className="bg-cream-50 py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions before takeoff" />
        <div className="mt-12 space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl bg-white p-6 shadow-sm ring-1 ring-ink/5 open:ring-coral/30"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-peach text-coral-ink transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink py-12 text-white/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 text-sm sm:flex-row sm:px-6">
        <div className="flex items-center gap-2.5 font-extrabold text-white">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-coral to-gold">
            <PlaneIcon className="size-4" />
          </span>
          Flightplan
        </div>
        <p>
          A{" "}
          <a href={MAIN_SITE} className="font-semibold text-gold hover:underline">
            Jetlagged Cards
          </a>{" "}
          project · Vancouver, BC · © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  dark,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  dark?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className={`text-sm font-bold tracking-wider uppercase ${dark ? "text-gold" : "text-coral-ink"}`}>
        {eyebrow}
      </span>
      <h2 className={`mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl ${dark ? "text-white" : "text-ink"}`}>
        {title}
      </h2>
      {subtitle && <p className={`mt-4 text-lg ${dark ? "text-white/75" : "text-ink-soft"}`}>{subtitle}</p>}
    </div>
  );
}
