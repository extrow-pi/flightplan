import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  COLLABORATOR_INVITE_DAYS,
  inviteCollaboratorSchema,
  MAX_COLLABORATORS,
  updateCollaboratorSchema,
  type ApiError,
  type CollaboratorInvite,
  type CollaboratorInvitePreview,
  type EventTeamResponse,
  type TeamMember,
} from "@flightplan/shared";
import { eventAccess, forbidden } from "../access.js";
import { db, schema } from "../db/index.js";
import { sendCollaboratorInvite } from "../email/notifications.js";
import { requireUser, type AuthEnv } from "../middleware.js";

const { collaboratorInvites, eventCollaborators, events, user } = schema;

const idSchema = z.uuid();
const notFound = (what = "Event") => ({ error: `${what} not found` }) satisfies ApiError;

function invalid(error: z.ZodError) {
  return { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(error).fieldErrors } satisfies ApiError;
}

// Invite links carry a random token; only its hash is stored, so a database leak can't be used to join
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

const APP_URL = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:5173").replace(/\/$/, "");

const pendingInvite = () =>
  and(isNull(collaboratorInvites.acceptedAt), isNull(collaboratorInvites.revokedAt), gt(collaboratorInvites.expiresAt, new Date()));

function toInvite(i: typeof collaboratorInvites.$inferSelect): CollaboratorInvite {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
  };
}

// ── Per-event team: /api/events/:id/team ─────────────────────────────────
// Anyone on the event can see the team. Only the owner invites, changes roles and removes people;
// collaborators can remove themselves (leave).

export const teamRoutes = new Hono<AuthEnv>()
  .use(requireUser)

  .get("/:id/team", async (c) => {
    const access = await eventAccess(c.req.param("id"), c.var.user.id);
    if (!access) return c.json(notFound(), 404);

    const [[owner], collaborators, invites] = await Promise.all([
      db
        .select({ userId: user.id, name: user.name, email: user.email, image: user.image, addedAt: events.createdAt })
        .from(events)
        .innerJoin(user, eq(user.id, events.organizerId))
        .where(eq(events.id, access.eventId)),
      db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: eventCollaborators.role,
          addedAt: eventCollaborators.createdAt,
        })
        .from(eventCollaborators)
        .innerJoin(user, eq(user.id, eventCollaborators.userId))
        .where(eq(eventCollaborators.eventId, access.eventId))
        .orderBy(asc(eventCollaborators.createdAt)),
      access.role === "owner"
        ? db
            .select()
            .from(collaboratorInvites)
            .where(and(eq(collaboratorInvites.eventId, access.eventId), pendingInvite()))
            .orderBy(asc(collaboratorInvites.createdAt))
        : Promise.resolve([]),
    ]);

    const member = (m: Omit<TeamMember, "addedAt"> & { addedAt: Date }): TeamMember => ({ ...m, addedAt: m.addedAt.toISOString() });
    const body: EventTeamResponse = {
      members: [member({ ...owner, role: "owner" }), ...collaborators.map(member)],
      invites: invites.map(toInvite),
      myRole: access.role,
    };
    return c.json(body);
  })

  // Invite someone by email. Replaces any pending invite for the same address.
  .post("/:id/team/invites", async (c) => {
    const access = await eventAccess(c.req.param("id"), c.var.user.id);
    if (!access) return c.json(notFound(), 404);
    if (access.role !== "owner") return c.json(forbidden("invite people. Only the owner can"), 403);
    const parsed = inviteCollaboratorSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { email, role } = parsed.data;

    if (email === c.var.user.email.toLowerCase()) {
      return c.json<ApiError>({ error: "You're already the owner of this event", fieldErrors: { email: ["That's your own email"] } }, 400);
    }
    const [existing] = await db
      .select({ id: eventCollaborators.id })
      .from(eventCollaborators)
      .innerJoin(user, eq(user.id, eventCollaborators.userId))
      .where(and(eq(eventCollaborators.eventId, access.eventId), sql`lower(${user.email}) = ${email}`));
    if (existing) {
      return c.json<ApiError>({ error: "They're already on the team", fieldErrors: { email: ["Already on the team"] } }, 409);
    }

    const [[{ members }], [{ pending }]] = await Promise.all([
      db.select({ members: count() }).from(eventCollaborators).where(eq(eventCollaborators.eventId, access.eventId)),
      db
        .select({ pending: count() })
        .from(collaboratorInvites)
        .where(and(eq(collaboratorInvites.eventId, access.eventId), pendingInvite(), sql`${collaboratorInvites.email} <> ${email}`)),
    ]);
    if (members + pending >= MAX_COLLABORATORS) {
      return c.json<ApiError>({ error: `An event can have up to ${MAX_COLLABORATORS} collaborators and pending invites` }, 400);
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + COLLABORATOR_INVITE_DAYS * 86_400_000);
    const invite = await db.transaction(async (tx) => {
      await tx
        .update(collaboratorInvites)
        .set({ revokedAt: new Date() })
        .where(and(eq(collaboratorInvites.eventId, access.eventId), eq(collaboratorInvites.email, email), pendingInvite()));
      const [row] = await tx
        .insert(collaboratorInvites)
        .values({ eventId: access.eventId, email, role, tokenHash: hashToken(token), invitedBy: c.var.user.id, expiresAt })
        .returning();
      return row;
    });

    const [event] = await db
      .select({ id: events.id, name: events.name, status: events.status, organizerId: events.organizerId })
      .from(events)
      .where(eq(events.id, access.eventId));
    await sendCollaboratorInvite({
      to: email,
      token,
      role,
      expiresAt,
      event,
      inviter: { name: c.var.user.name, email: c.var.user.email },
    });

    // The link is returned once so the owner can also share it directly (it only works for this email)
    return c.json({ invite: toInvite(invite), link: `${APP_URL}/collaborate/${token}` }, 201);
  })

  .patch("/:id/team/:userId", async (c) => {
    const access = await eventAccess(c.req.param("id"), c.var.user.id);
    if (!access) return c.json(notFound(), 404);
    if (access.role !== "owner") return c.json(forbidden("change roles. Only the owner can"), 403);
    const parsed = updateCollaboratorSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);

    const [row] = await db
      .update(eventCollaborators)
      .set({ role: parsed.data.role })
      .where(and(eq(eventCollaborators.eventId, access.eventId), eq(eventCollaborators.userId, c.req.param("userId"))))
      .returning({ id: eventCollaborators.id });
    return row ? c.json({ ok: true }) : c.json(notFound("Collaborator"), 404);
  })

  // The owner removes a collaborator, or a collaborator leaves
  .delete("/:id/team/:userId", async (c) => {
    const access = await eventAccess(c.req.param("id"), c.var.user.id);
    if (!access) return c.json(notFound(), 404);
    const target = c.req.param("userId");
    if (access.role !== "owner" && target !== c.var.user.id) {
      return c.json(forbidden("remove people. Only the owner can"), 403);
    }
    const [row] = await db
      .delete(eventCollaborators)
      .where(and(eq(eventCollaborators.eventId, access.eventId), eq(eventCollaborators.userId, target)))
      .returning({ id: eventCollaborators.id });
    return row ? c.body(null, 204) : c.json(notFound("Collaborator"), 404);
  });

// ── Invites: /api/collaborator-invites/… ─────────────────────────────────

async function findByToken(token: string) {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({
      invite: collaboratorInvites,
      event: { id: events.id, name: events.name, status: events.status, organizerId: events.organizerId },
      inviterName: user.name,
    })
    .from(collaboratorInvites)
    .innerJoin(events, eq(events.id, collaboratorInvites.eventId))
    .innerJoin(user, eq(user.id, collaboratorInvites.invitedBy))
    .where(eq(collaboratorInvites.tokenHash, hashToken(token)));
  return row ?? null;
}

function statusOf(i: typeof collaboratorInvites.$inferSelect): CollaboratorInvitePreview["status"] {
  if (i.acceptedAt) return "accepted";
  if (i.revokedAt) return "revoked";
  if (i.expiresAt <= new Date()) return "expired";
  return "pending";
}

export const collaboratorInviteRoutes = new Hono<AuthEnv>()
  // What the invite page shows before accepting. No sign-in needed: the token is the secret.
  .get("/by-token/:token", async (c) => {
    const found = await findByToken(c.req.param("token"));
    if (!found) return c.json(notFound("Invitation"), 404);
    const body: CollaboratorInvitePreview = {
      eventName: found.event.name,
      isTemplate: found.event.status === "template",
      inviterName: found.inviterName,
      role: found.invite.role,
      email: found.invite.email,
      status: statusOf(found.invite),
    };
    return c.json(body);
  })

  // Accept: the signed-in organizer's email must match the invited address
  .post("/by-token/:token/accept", requireUser, async (c) => {
    const found = await findByToken(c.req.param("token"));
    if (!found) return c.json(notFound("Invitation"), 404);
    const { invite, event } = found;
    const me = c.var.user;
    const result = { eventId: event.id, isTemplate: event.status === "template" };

    const status = statusOf(invite);
    if (status === "accepted") {
      return invite.acceptedBy === me.id
        ? c.json(result)
        : c.json<ApiError>({ error: "This invitation has already been used" }, 410);
    }
    if (status === "revoked") return c.json<ApiError>({ error: "This invitation was cancelled" }, 410);
    if (status === "expired") return c.json<ApiError>({ error: "This invitation has expired. Ask for a new one." }, 410);

    if (me.email.toLowerCase() !== invite.email) {
      return c.json<ApiError>(
        { error: `This invitation is for ${invite.email}. You're signed in as ${me.email}.` },
        403,
      );
    }
    if (event.organizerId === me.id) return c.json<ApiError>({ error: "You already own this event" }, 400);

    await db.transaction(async (tx) => {
      await tx
        .insert(eventCollaborators)
        .values({ eventId: event.id, userId: me.id, role: invite.role, invitedBy: invite.invitedBy })
        .onConflictDoUpdate({
          target: [eventCollaborators.eventId, eventCollaborators.userId],
          set: { role: invite.role },
        });
      await tx
        .update(collaboratorInvites)
        .set({ acceptedAt: new Date(), acceptedBy: me.id })
        .where(eq(collaboratorInvites.id, invite.id));
    });
    return c.json(result);
  })

  // The owner cancels a pending invite
  .delete("/:id", requireUser, async (c) => {
    const id = c.req.param("id");
    if (!idSchema.safeParse(id).success) return c.json(notFound("Invitation"), 404);
    const [invite] = await db.select().from(collaboratorInvites).where(eq(collaboratorInvites.id, id));
    if (!invite) return c.json(notFound("Invitation"), 404);
    const access = await eventAccess(invite.eventId, c.var.user.id);
    if (!access) return c.json(notFound("Invitation"), 404);
    if (access.role !== "owner") return c.json(forbidden("cancel invitations. Only the owner can"), 403);

    await db
      .update(collaboratorInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(collaboratorInvites.id, id), pendingInvite()));
    return c.body(null, 204);
  });
