import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  COLLABORATOR_INVITE_DAYS,
  type CollaboratorRole,
  type EventRecord,
  type EventTeamResponse,
  type TeamMember,
} from "@flightplan/shared";
import CopyButton from "../../components/CopyButton";
import { EventTabs, isTemplate, SharedBadge } from "../../components/events";
import { ArrowLeftIcon } from "../../components/Icons";
import { useSession } from "../../lib/auth-client";
import {
  ApiRequestError,
  useEvent,
  useEventTeam,
  useInviteCollaborator,
  useRemoveCollaborator,
  useRevokeCollaboratorInvite,
  useSetCollaboratorRole,
} from "../../lib/api";

const roleLabels: Record<TeamMember["role"], string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

const roleHelp: Record<CollaboratorRole, string> = {
  editor: "Can edit details, publish, and manage tables and bookings. Can't delete it or manage the team.",
  viewer: "Can see everything, including tables and bookings, but can't change anything.",
};

/** Who's on an event or template's team: invite collaborators, change roles, remove people or leave. */
export default function TeamPage() {
  const { id } = useParams();
  const { data: event, isPending, error } = useEvent(id);
  const team = useEventTeam(event?.id);

  if (isPending) return <p className="text-ink-muted" role="status">Loading…</p>;
  if (error || !event) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-ink/5">
        <p className="text-lg font-extrabold">
          {error instanceof ApiRequestError && error.status === 404 ? "Not found" : "Couldn't load this"}
        </p>
        <Link to="/dashboard" className="mt-4 inline-block font-bold text-coral-ink hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const template = isTemplate(event);
  const isOwner = event.access.role === "owner";

  return (
    <>
      <Link
        to={template ? "/dashboard/templates" : "/dashboard/events"}
        className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeftIcon className="size-4" /> {template ? "All templates" : "All events"}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
        {template && <span className="rounded-full bg-peach px-3 py-1 text-sm font-bold text-coral-ink">Template</span>}
        <SharedBadge event={event} />
      </div>
      <EventTabs event={event} />

      {team.error ? (
        <p className="mt-6 rounded-2xl bg-peach px-5 py-4 font-semibold text-coral-ink" role="alert">
          Couldn't load the team: {team.error.message}
        </p>
      ) : team.isPending ? (
        <p className="mt-6 text-ink-muted" role="status">
          Loading team…
        </p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            <Members event={event} team={team.data} />
            {isOwner && team.data.invites.length > 0 && <PendingInvites event={event} team={team.data} />}
          </div>
          <aside className="space-y-6">
            {isOwner ? (
              <InviteCard event={event} />
            ) : (
              <p className="rounded-2xl bg-sky/15 px-4 py-3 text-sm font-semibold text-slate">
                Only {event.access.ownerName}, the owner, can invite people or change roles.
              </p>
            )}
            <Card title="Roles">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-bold">Owner</dt>
                  <dd className="text-ink-soft">Everything, including deleting it and managing the team.</dd>
                </div>
                {(["editor", "viewer"] as const).map((r) => (
                  <div key={r}>
                    <dt className="font-bold">{roleLabels[r]}</dt>
                    <dd className="text-ink-soft">{roleHelp[r]}</dd>
                  </div>
                ))}
              </dl>
              {template ? (
                <p className="mt-3 text-sm text-ink-soft">
                  Shows created from this template keep its team. Whoever creates the show owns it.
                </p>
              ) : (
                <p className="mt-3 text-sm text-ink-soft">Everyone on the team gets emails about new table requests and overdue payments.</p>
              )}
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-extrabold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Avatar({ member }: { member: TeamMember }) {
  return member.image ? (
    <img src={member.image} alt="" className="size-10 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
  ) : (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-coral to-gold font-extrabold text-white">
      {member.name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function Members({ event, team }: { event: EventRecord; team: EventTeamResponse }) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const setRole = useSetCollaboratorRole(event.id);
  const remove = useRemoveCollaborator(event.id);
  const [confirming, setConfirming] = useState<string | null>(null);
  const me = session?.user.id;
  const isOwner = team.myRole === "owner";
  const error = setRole.error ?? remove.error;

  function removeMember(userId: string) {
    remove.mutate(userId, {
      onSuccess: () => {
        setConfirming(null);
        // Leaving means losing access to this page
        if (userId === me) navigate(isTemplate(event) ? "/dashboard/templates" : "/dashboard/events");
      },
    });
  }

  return (
    <Card title={`Team (${team.members.length})`}>
      <ul className="divide-y divide-ink/5">
        {team.members.map((m) => {
          const isMe = m.userId === me;
          const canRemove = m.role !== "owner" && (isOwner || isMe);
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar member={m} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {m.name}
                  {isMe && <span className="font-semibold text-ink-muted"> (you)</span>}
                </p>
                <p className="truncate text-sm text-ink-soft">{m.email}</p>
              </div>
              {isOwner && m.role !== "owner" ? (
                <select
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  disabled={setRole.isPending}
                  onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as CollaboratorRole })}
                  className="rounded-full border-2 border-cream bg-white px-3 py-1.5 text-sm font-bold text-ink focus:border-coral focus:outline-none"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    m.role === "owner" ? "bg-peach text-coral-ink" : "bg-cream text-ink-soft"
                  }`}
                >
                  {roleLabels[m.role]}
                </span>
              )}
              {canRemove &&
                (confirming === m.userId ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => removeMember(m.userId)}
                      disabled={remove.isPending}
                      className="rounded-full bg-coral-ink px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {remove.isPending ? "…" : isMe ? "Leave" : "Remove"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-full px-2.5 py-1.5 text-sm font-bold text-ink-soft hover:bg-cream"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(m.userId)}
                    className="rounded-full px-3 py-1.5 text-sm font-bold text-coral-ink hover:bg-peach"
                  >
                    {isMe ? "Leave" : "Remove"}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {team.members.length === 1 && (
        <p className="mt-2 text-sm text-ink-soft">
          It's just you so far. Invite a co-organizer to share the work.
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-coral-ink" role="alert">
          {error.message}
        </p>
      )}
    </Card>
  );
}

function PendingInvites({ event, team }: { event: EventRecord; team: EventTeamResponse }) {
  const revoke = useRevokeCollaboratorInvite(event.id);
  return (
    <Card title="Pending invitations">
      <ul className="space-y-2">
        {team.invites.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-cream-50 px-4 py-3 text-sm ring-1 ring-ink/5">
            <span className="min-w-0 flex-1 truncate font-bold">{inv.email}</span>
            <span className="text-ink-soft">
              {roleLabels[inv.role]} · expires{" "}
              {new Date(inv.expiresAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
            </span>
            <button
              type="button"
              onClick={() => revoke.mutate(inv.id)}
              disabled={revoke.isPending}
              className="rounded-full px-2.5 py-1 text-xs font-bold text-coral-ink hover:bg-peach disabled:opacity-60"
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
      {revoke.error && (
        <p className="mt-2 text-sm font-semibold text-coral-ink" role="alert">
          {revoke.error.message}
        </p>
      )}
    </Card>
  );
}

function InviteCard({ event }: { event: EventRecord }) {
  const invite = useInviteCollaborator(event.id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollaboratorRole>("editor");
  const [sent, setSent] = useState<{ email: string; link: string } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSent(null);
    invite.mutate(
      { email, role },
      {
        onSuccess: (r) => {
          setSent({ email: r.invite.email, link: r.link });
          setEmail("");
        },
      },
    );
  }

  const fieldError =
    invite.error instanceof ApiRequestError ? invite.error.body.fieldErrors?.email?.[0] : undefined;

  return (
    <Card title="Invite a collaborator">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="invite-email" className="text-sm font-bold">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="co-organizer@example.com"
            aria-invalid={!!fieldError}
            className="mt-1 w-full rounded-xl border-2 border-cream bg-white px-3 py-2 text-ink placeholder:text-ink-muted/70 transition focus:border-coral focus:ring-4 focus:ring-coral/15 focus:outline-none"
          />
        </div>
        <fieldset>
          <legend className="text-sm font-bold">Role</legend>
          <div className="mt-1 space-y-2">
            {(["editor", "viewer"] as const).map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer gap-3 rounded-2xl px-3 py-2.5 ring-1 transition ${
                  role === r ? "bg-peach/40 ring-coral/40" : "bg-cream-50 ring-ink/5"
                }`}
              >
                <input
                  type="radio"
                  name="invite-role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="mt-1 accent-coral"
                />
                <span>
                  <span className="block text-sm font-bold">{roleLabels[r]}</span>
                  <span className="block text-xs text-ink-soft">{roleHelp[r]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={invite.isPending}
          className="w-full rounded-full bg-gradient-to-r from-coral to-coral-deep px-5 py-2.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(232,133,106,0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
        >
          {invite.isPending ? "Sending…" : "Send invitation"}
        </button>
        {invite.error && (
          <p className="text-sm font-semibold text-coral-ink" role="alert">
            {fieldError ?? invite.error.message}
          </p>
        )}
      </form>

      {sent && (
        <div className="mt-4 rounded-2xl bg-[#e8f8f5] px-4 py-3 text-sm text-[#2d7a6a]" role="status">
          <p className="font-bold">Invitation sent to {sent.email}</p>
          <p className="mt-1">
            It expires in {COLLABORATOR_INVITE_DAYS} days. You can also send them the link yourself. It only works for
            that email address.
          </p>
          <div className="mt-2">
            <CopyButton text={sent.link} />
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-muted">
        They'll sign in or create a Flightplan account with that email to accept.
      </p>
    </Card>
  );
}
