import { createMiddleware } from "hono/factory";
import type { ApiError } from "@flightplan/shared";
import { auth, type Session } from "./auth.js";

export type AuthEnv = { Variables: Session };

// Rejects requests without a valid session; otherwise exposes the organizer as c.var.user
export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json<ApiError>({ error: "Not signed in" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
