import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { CollaboratorInvitePreview } from "@flightplan/shared";
import Logo from "../components/Logo";
import { ApiRequestError, useAcceptCollaboratorInvite, useCollaboratorInvite } from "../lib/api";
import { signOut, useSession } from "../lib/auth-client";

// Where a collaborator invitation email links to. Shows what they're invited to, then sends them to
// sign in or sign up (with the invited email pre-filled) and back here to accept.
export default function AcceptInvitePage() {
  const { token = "" } = useParams();
  const invite = useCollaboratorInvite(token);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#fff4e2] to-cream-50">
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16 sm:px-6">
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 sm:p-8">
          {invite.isPending ? (
            <p className="py-10 text-center text-ink-muted" role="status">
              Loading…
            </p>
          ) : invite.error || !invite.data ? (
            <Message title="Invitation not found">
              {invite.error instanceof ApiRequestError && invite.error.status === 404
                ? "This link may be incomplete. Try opening it again from the email."
                : "Something went wrong loading this invitation. Please try again in a moment."}
            </Message>
          ) : (
            <Invite token={token} invite={invite.data} />
          )}
        </section>
      </main>
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <div className="mt-2 text-ink-soft">{children}</div>
    </div>
  );
}

function Invite({ token, invite }: { token: string; invite: CollaboratorInvitePreview }) {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const accept = useAcceptCollaboratorInvite(token);
  const what = invite.isTemplate ? "template" : "show";
  const here = `/collaborate/${token}`;
  const authQuery = `?redirect=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`;

  if (invite.status === "accepted") {
    return (
      <Message title="Invitation already accepted">
        <Link to="/dashboard/events" className="font-bold text-coral-ink hover:underline">
          Go to your dashboard
        </Link>
      </Message>
    );
  }
  if (invite.status !== "pending") {
    return (
      <Message title={invite.status === "expired" ? "This invitation has expired" : "This invitation was cancelled"}>
        Ask {invite.inviterName} to send you a new one.
      </Message>
    );
  }

  const signedInAs = session?.user.email;
  const matches = signedInAs?.toLowerCase() === invite.email;

  function onAccept() {
    accept.mutate(undefined, {
      onSuccess: (r) => navigate(r.isTemplate ? `/dashboard/templates/${r.eventId}` : `/dashboard/events/${r.eventId}`),
    });
  }

  return (
    <>
      <p className="text-sm font-bold tracking-wider text-coral-ink uppercase">You're invited</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{invite.eventName}</h1>
      <p className="mt-3 text-ink-soft">
        <strong className="text-ink">{invite.inviterName}</strong> invited you to help organize this {what} as{" "}
        {invite.role === "editor" ? "an editor" : "a viewer"}.{" "}
        {invite.role === "editor"
          ? "You'll be able to edit it and manage its vendor tables."
          : "You'll be able to see it and its vendor tables, but not change anything."}
      </p>

      <div className="mt-6">
        {sessionPending ? (
          <p className="text-ink-muted" role="status">
            Checking your sign-in…
          </p>
        ) : !session ? (
          <>
            <p className="text-sm text-ink-soft">
              Sign in or create an account with <strong className="text-ink">{invite.email}</strong> to accept.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Link
                to={`/login${authQuery}`}
                className="rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3 text-center font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5"
              >
                Log in to accept
              </Link>
              <Link
                to={`/signup${authQuery}`}
                className="rounded-full border-2 border-slate px-6 py-3 text-center font-bold text-slate transition hover:bg-slate hover:text-white"
              >
                Create an account
              </Link>
            </div>
          </>
        ) : matches ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={accept.isPending}
            className="w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-6 py-3.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 sm:w-auto"
          >
            {accept.isPending ? "Joining…" : `Accept and open the ${what}`}
          </button>
        ) : (
          <div className="rounded-2xl bg-peach px-5 py-4 text-sm text-coral-ink" role="alert">
            <p className="font-bold">
              This invitation is for {invite.email}, but you're signed in as {signedInAs}.
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-3 rounded-full bg-coral-ink px-4 py-2 font-bold text-white"
            >
              Sign out and switch account
            </button>
          </div>
        )}
        {accept.error && (
          <p className="mt-4 rounded-xl bg-peach px-4 py-3 text-sm font-semibold text-coral-ink" role="alert">
            {accept.error.message}
          </p>
        )}
      </div>
    </>
  );
}
