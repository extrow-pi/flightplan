import "./env.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { organizerSignupSchema, type ApiError } from "@flightplan/shared";
import { db, schema } from "./db/index.js";
import { auth, googleEnabled } from "./auth.js";
import { requireUser } from "./middleware.js";
import { eventRoutes } from "./routes/events.js";
import { alertRoutes, bookingRoutes, eventBookingRoutes, inviteRoutes } from "./routes/bookings.js";
import { vendorGroupRoutes, vendorRoutes } from "./routes/vendors.js";
import { publicRoutes } from "./routes/public.js";
import { emailRoutes } from "./routes/emails.js";
import { collaboratorInviteRoutes, teamRoutes } from "./routes/collaborators.js";
import { emailDeliveryEnabled, startEmailWorker } from "./email/outbox.js";
import { startNotificationScheduler } from "./email/notifications.js";
import { uploadRoutes } from "./uploads.js";

const app = new Hono().basePath("/api");

app.use(logger());

// Better Auth: sign up, sign in, sign out, Google OAuth, sessions
app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

app.get("/health", (c) => c.json({ ok: true }));

// Tells the web app which sign-in methods are configured
app.get("/auth-config", (c) => c.json({ google: googleEnabled }));

app.get("/me", requireUser, (c) => c.json({ user: c.var.user }));

app.route("/events", eventRoutes);
app.route("/events", eventBookingRoutes);
app.route("/events", teamRoutes);
app.route("/collaborator-invites", collaboratorInviteRoutes);
app.route("/bookings", bookingRoutes);
app.route("/invites", inviteRoutes);
app.route("/alerts", alertRoutes);
app.route("/vendors", vendorRoutes);
app.route("/vendor-groups", vendorGroupRoutes);
app.route("/emails", emailRoutes);

// No sign-in needed: vendor booking pages and floor map images
app.route("/public", publicRoutes);
app.route("/uploads", uploadRoutes);

app.post("/organizers/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = organizerSignupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json<ApiError>(
      { error: "Please fix the highlighted fields", fieldErrors: z.flattenError(parsed.error).fieldErrors },
      400,
    );
  }

  const inserted = await db
    .insert(schema.organizerSignups)
    .values(parsed.data)
    .onConflictDoNothing() // email is unique: a repeat signup is a no-op
    .returning({ id: schema.organizerSignups.id });

  return c.json({ ok: true, alreadyRegistered: inserted.length === 0 }, inserted.length ? 201 : 200);
});

// Unknown /api paths stay 404s instead of falling through to the web app
app.all("*", (c) => c.json<ApiError>({ error: "Not found" }, 404));

// In production the API also serves the built web app (apps/web/dist, or WEB_DIST), so the
// site and API share one origin. In development Vite serves the web app and proxies /api here.
const server = new Hono();
server.route("/", app);

const webDist = process.env.WEB_DIST ?? fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(join(webDist, "index.html"))) {
  const indexHtml = readFileSync(join(webDist, "index.html"), "utf8");
  // Revalidated on every visit so a deploy's new asset names are picked up right away
  const sendIndex = (c: Context) => {
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  };
  // Vite puts content-hashed files in /assets, so they never change. A missing asset is a 404,
  // not the app's HTML, so a stale page can't cache HTML under a script's URL.
  server.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  server.use("/assets/*", serveStatic({ root: webDist }));
  server.get("/assets/*", (c) => c.notFound());
  server.get("/", sendIndex);
  server.use("*", serveStatic({ root: webDist }));
  // Client-side routes (/dashboard, /book/:token…) all load the single-page app
  server.get("*", sendIndex);
  console.log(`Serving web app from ${webDist}`);
}

// API_PORT wins so tools that set PORT for the web dev server (e.g. to 5173) can't move the API.
// Hosts that only set PORT (Railway, Render…) still work, and the Dockerfile sets PORT=3001.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
serve({ fetch: server.fetch, port }, () => {
  console.log(`API listening on http://localhost:${port} (Google sign-in ${googleEnabled ? "enabled" : "not configured"})`);
  console.log(
    emailDeliveryEnabled
      ? "Emails: sending with Resend"
      : "Emails: not sending (no RESEND_API_KEY); they appear in the dashboard Email log instead",
  );
});

// Background jobs: send queued emails; payment reminders and overdue notices
startEmailWorker();
startNotificationScheduler();
