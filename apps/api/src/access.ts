import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canEditEvent, type ApiError, type EventRole } from "@flightplan/shared";
import { db, schema } from "./db/index.js";

// Who can do what with an event or template:
//   owner (events.organizer_id) — everything
//   editor (event_collaborators) — everything except deleting it and managing the team
//   viewer (event_collaborators) — read-only
// Routes load access once with eventAccess() and check the role, instead of filtering by owner.

const { eventCollaborators, events, user } = schema;

const idSchema = z.uuid();

export type Access = { eventId: string; ownerId: string; role: EventRole };

/** The signed-in organizer's access to an event, or null if they have none (or the id is invalid). */
export async function eventAccess(eventId: string, userId: string): Promise<Access | null> {
  if (!idSchema.safeParse(eventId).success) return null;
  const [row] = await db
    .select({ ownerId: events.organizerId, role: eventCollaborators.role })
    .from(events)
    .leftJoin(eventCollaborators, and(eq(eventCollaborators.eventId, events.id), eq(eventCollaborators.userId, userId)))
    .where(eq(events.id, eventId));
  if (!row) return null;
  if (row.ownerId === userId) return { eventId, ownerId: row.ownerId, role: "owner" };
  return row.role ? { eventId, ownerId: row.ownerId, role: row.role } : null;
}

/** Events shared with the user (not ones they own). */
export const sharedEventIds = (userId: string) =>
  db.select({ id: eventCollaborators.eventId }).from(eventCollaborators).where(eq(eventCollaborators.userId, userId));

/** WHERE clause for events the user owns or collaborates on. */
export const accessibleEvents = (userId: string): SQL =>
  or(eq(events.organizerId, userId), inArray(events.id, sharedEventIds(userId)))!;

/** WHERE clause for events the user owns or can edit. */
export const editableEvents = (userId: string): SQL =>
  or(
    eq(events.organizerId, userId),
    inArray(
      events.id,
      db
        .select({ id: eventCollaborators.eventId })
        .from(eventCollaborators)
        .where(and(eq(eventCollaborators.userId, userId), eq(eventCollaborators.role, "editor"))),
    ),
  )!;

/** Join condition for the user's own collaborator row on a query of `events`. */
export const collaboratorJoin = (userId: string) =>
  and(eq(eventCollaborators.eventId, events.id), eq(eventCollaborators.userId, userId));

/** Columns to select alongside a query of `events` joined with collaboratorJoin() and the owner (`user`). */
export const accessColumns = { ownerId: events.organizerId, ownerName: user.name, collaboratorRole: eventCollaborators.role };

export function roleOf(ownerId: string, collaboratorRole: EventRole | null, userId: string): EventRole {
  return ownerId === userId ? "owner" : (collaboratorRole ?? "viewer");
}

export const canEdit = (a: Access) => canEditEvent(a.role);

export const forbidden = (action: string) => ({ error: `You don't have permission to ${action}` }) satisfies ApiError;
