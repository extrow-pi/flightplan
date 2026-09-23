import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import Logo from "../components/Logo";
import { PlaneIcon } from "../components/Icons";
import { safeRedirect, signIn, signUp, useAuthConfig, useSession } from "../lib/auth-client";

type Mode = "login" | "signup";

const copy = {
  login: {
    title: "Welcome back",
    subtitle: "Log in to manage your shows.",
    submit: "Log in",
    pending: "Logging in…",
    switchText: "New to Flightplan?",
    switchLink: "Create an account",
  },
  signup: {
    title: "Create your organizer account",
    subtitle: "Set up your first show in minutes. Free during early access.",
    submit: "Create account",
    pending: "Creating account…",
    switchText: "Already have an account?",
    switchLink: "Log in",
  },
} satisfies Record<Mode, Record<string, string>>;

// Better Auth error codes → friendly messages
const errorMessages: Record<string, string> = {
  USER_ALREADY_EXISTS: "An account with this email already exists. Try logging in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Try logging in instead.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match. Please try again.",
  PASSWORD_TOO_SHORT: "Your password needs at least 8 characters.",
  INVALID_EMAIL: "Please enter a valid email address.",
  // OAuth redirect errors (?error=…)
  access_denied: "Google sign-in was cancelled.",
  account_not_linked: "This Google account couldn't be linked to your existing account.",
};

function friendlyError(code?: string, fallback?: string) {
  return (code && errorMessages[code]) || fallback || "Something went wrong. Please try again.";
}

export default function AuthPage({ mode }: { mode: Mode }) {
  const t = copy[mode];
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = safeRedirect(params.get("redirect"));
  const { data: session, isPending: sessionPending } = useSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const oauthError = params.get("error");
    return oauthError ? friendlyError(oauthError, "Google sign-in failed. Please try again.") : null;
  });

  if (!sessionPending && session) return <Navigate to={redirectTo} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && name.trim().length < 2) return setError("Please enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Please enter a valid email address.");
    if (mode === "signup" && password.length < 8) return setError("Your password needs at least 8 characters.");

    setPending(true);
    const { error } =
      mode === "signup"
        ? await signUp.email({ name: name.trim(), email, password })
        : await signIn.email({ email, password });
    setPending(false);

    if (error) return setError(friendlyError(error.code, error.message));
    navigate(redirectTo, { replace: true });
  }

  const switchTo = `${mode === "login" ? "/signup" : "/login"}${params.get("redirect") ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`;

  return (
    <div className="grid min-h-dvh bg-cream-50 lg:grid-cols-2">
      <BrandPanel />

      <main className="flex flex-col px-4 py-8 sm:px-8">
        <Logo className="lg:hidden" />

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-extrabold tracking-tight">{t.title}</h1>
          <p className="mt-2 text-ink-soft">{t.subtitle}</p>

          <GoogleButton redirectTo={redirectTo} mode={mode} onError={setError} />

          <div className="my-6 flex items-center gap-4 text-sm font-semibold text-ink-muted">
            <span className="h-px flex-1 bg-ink/10" />
            or with email
            <span className="h-px flex-1 bg-ink/10" />
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {mode === "signup" && (
              <Field label="Your name" htmlFor="name">
                <input
                  id="name"
                  autoComplete="name"
                  className={inputClass}
                  placeholder="Alex Chen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}

            <Field label="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={inputClass}
                placeholder="alex@yourshow.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className={`${inputClass} pr-20`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-2 my-auto h-9 rounded-lg px-3 text-sm font-bold text-slate hover:bg-cream"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            {error && (
              <p className="rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-8 py-3.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-coral/30 focus-visible:outline-none disabled:translate-y-0 disabled:opacity-60"
            >
              {pending ? t.pending : t.submit}
            </button>
          </form>

          <p className="mt-8 text-center text-ink-soft">
            {t.switchText}{" "}
            <Link to={switchTo} className="font-bold text-coral-ink hover:underline">
              {t.switchLink}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function GoogleButton({
  mode,
  redirectTo,
  onError,
}: {
  mode: Mode;
  redirectTo: string;
  onError: (message: string) => void;
}) {
  const { data: config } = useAuthConfig();
  const [pending, setPending] = useState(false);
  const enabled = config?.google ?? false;

  async function onClick() {
    setPending(true);
    const origin = window.location.origin;
    const { error } = await signIn.social({
      provider: "google",
      callbackURL: origin + redirectTo,
      errorCallbackURL: `${origin}/${mode}`,
    });
    // On success the browser is already navigating to Google
    if (error) {
      setPending(false);
      onError(friendlyError(error.code, error.message));
    }
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={onClick}
        disabled={!enabled || pending}
        className="flex w-full items-center justify-center gap-3 rounded-full border-2 border-ink/10 bg-white px-6 py-3 font-bold text-ink shadow-sm transition hover:border-ink/20 hover:bg-cream-50 focus-visible:ring-4 focus-visible:ring-coral/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
      >
        <GoogleLogo />
        {pending ? "Redirecting to Google…" : mode === "signup" ? "Sign up with Google" : "Continue with Google"}
      </button>
      {config && !enabled && (
        <p className="mt-2 text-center text-xs text-ink-muted">
          Google sign-in isn't configured yet. Add Google credentials to <code>apps/api/.env</code>.
        </p>
      )}
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-coral via-[#ec9a6c] to-gold p-12 text-white lg:flex lg:flex-col">
      <svg
        className="pointer-events-none absolute -right-10 bottom-24 w-[560px] text-white/30"
        viewBox="0 0 560 260"
        fill="none"
        aria-hidden="true"
      >
        <path d="M0 240 C 180 240, 260 40, 550 30" stroke="currentColor" strokeWidth="3" strokeDasharray="10 12" />
      </svg>

      <Link to="/" className="flex items-center gap-2.5 text-xl font-extrabold">
        <span className="flex size-10 items-center justify-center rounded-full bg-white/25">
          <PlaneIcon className="size-5" />
        </span>
        Flightplan
      </Link>

      <div className="relative mt-auto max-w-md">
        <p className="text-4xl leading-tight font-extrabold">Your show's flight deck is one step away.</p>
        <ul className="mt-8 space-y-3 text-lg font-semibold text-white/90">
          <li>✈️ Sell vendor tables with a shareable floor plan</li>
          <li>🎟️ Sell tickets and check guests in from your phone</li>
          <li>📊 See every table and ticket sale in one place</li>
        </ul>
      </div>

      <p className="relative mt-auto pt-12 text-sm text-white/80">A Jetlagged Cards project · Vancouver, BC</p>
    </aside>
  );
}

const inputClass =
  "w-full rounded-xl border-2 border-cream bg-white px-4 py-3 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm font-bold">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
