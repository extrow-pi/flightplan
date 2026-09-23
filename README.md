# Flightplan

Event tools for trading card & collectibles show organizers, by [Jetlagged Cards](https://jetlaggedcards.ca).

## Stack

| Part | Tech |
|---|---|
| `apps/web` | React + Vite + Tailwind CSS v4 + TanStack Query |
| `apps/api` | Hono on Node, Drizzle ORM, PostgreSQL (or embedded PGlite for local dev) |
| `packages/shared` | Zod schemas & types shared by web and API |

## Getting started

Requires Node 20+ and pnpm 10 (`npm install -g pnpm@10`, or prefix commands with `corepack`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # then set BETTER_AUTH_SECRET
pnpm dev          # web on http://localhost:5173, API on http://localhost:3001
```

The web dev server proxies `/api/*` to the API.

### Test organizer account

With `pnpm dev` running, create a test organizer with sample events:

```bash
pnpm seed
```

Then log in at http://localhost:5173/login with **organizer@flightplan.test** / **flightplan-test-2026**.
The script is safe to re-run: it only adds sample events and templates (matched by name) that the account doesn't have yet. It goes through the API, so it works with PGlite or Postgres.

### Database

With no `DATABASE_URL` set, the API uses **PGlite**, an embedded Postgres stored in `apps/api/.data/`. You don't need to install a database.
Only one process can open PGlite at a time. Don't run a second API instance or other scripts against `apps/api/.data` while `pnpm dev` is running, because that can damage the database. To start fresh, stop the dev server and delete `apps/api/.data/`.
**Stop the dev server before generating or editing migrations.** The API re-runs migrations every time it restarts, and it restarts whenever `schema.ts` changes, so it can apply a migration you haven't finished writing.
To use a real Postgres server (Neon, Supabase, local), copy `apps/api/.env.example` to `apps/api/.env` and set `DATABASE_URL`.

Migrations run automatically when the API starts. After changing `apps/api/src/db/schema.ts`:

```bash
pnpm db:generate
```

## Organizer login

Built on [Better Auth](https://better-auth.com). Organizers can sign up or log in with email and password, or with Google.
Pages: `/signup` and `/login`. Signed-in organizers use the dashboard at `/dashboard`:

- **Overview:** upcoming-show stats, a countdown to the next show, later shows and a getting-started checklist
- **Events:** list with Upcoming / Drafts / Past / All filters, plus create, edit, publish/unpublish and delete
- **Templates:** reusable show setups with no dates

### Shows, days and templates

- A show has **one or more days**, each with its own hours (e.g. Fri 2pm–8pm, Sat 10am–6pm, Sun 10am–5pm).
  They're stored as `events.start_date` plus `event_days` rows (`day_offset` 0 = first day, start/end time).
- Every show is a **template**, a **draft** or **published**:
  - **Template:** no dates, just Day 1, Day 2… and their hours. Create one from scratch, or use **Save as template** on any show (this copies it, including unsaved edits).
  - **Use template:** pick the first day's date to create a **draft**. Day N lands N−1 days after the first day, and the template itself doesn't change.
  - **Draft:** customize anything, then **Publish**.

### Enabling Google sign-in

Until Google credentials are set, the "Continue with Google" button is disabled and email/password login still works.
This takes about 5 minutes and needs a Google account.

**1. Create a Google Cloud project**

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and sign in.
2. Open the project picker at the top of the page and choose **New project**. Name it `Flightplan` and click **Create**.
3. Make sure the new project is selected in the project picker.

**2. Set up the OAuth consent screen**

This is what people see when Google asks "Sign in to Flightplan?".

1. Go to **APIs & Services → OAuth consent screen**. In newer consoles this is **Google Auth Platform**, split into **Branding** and **Audience**.
2. Click **Get started**, or **Configure consent screen** if that's what you see.
3. Fill in:
   - **App name:** `Flightplan`
   - **User support email:** your email
   - **Audience / User type:** **External**
   - **Developer contact email:** your email
4. Save. The only scopes needed are the defaults: `openid`, `email` and `profile`. Nothing sensitive is requested.
5. **Add test users.** While the app is in *Testing* mode, **only listed test users can sign in with Google**. Under **Audience** (or **Test users**), add the Google accounts you'll test with, including your own.

**3. Create the OAuth client**

1. Go to **APIs & Services → Credentials**, or **Google Auth Platform → Clients**.
2. Click **Create credentials → OAuth client ID**, or **Create client**.
3. **Application type:** **Web application**. **Name:** `Flightplan (local dev)`.
4. Under **Authorized JavaScript origins**, add:
   ```
   http://localhost:5173
   ```
5. Under **Authorized redirect URIs**, add exactly:
   ```
   http://localhost:5173/api/auth/callback/google
   ```
6. Click **Create**, then copy the **Client ID** and **Client secret**.

**4. Add the credentials to the API**

In `apps/api/.env` (copy it from `apps/api/.env.example` if it doesn't exist):

```bash
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
```

`.env` is ignored by git. Never commit these values.

**5. Restart and test**

1. Stop `pnpm dev` and start it again. The API log should say `Google sign-in enabled`.
2. Open http://localhost:5173/login and click **Continue with Google**.
3. Pick a test user account. You should end up on `/dashboard` with your Google name and photo.

**Troubleshooting**

| Problem | Fix |
|---|---|
| Google shows `Error 400: redirect_uri_mismatch` | The redirect URI in Google must match `http://localhost:5173/api/auth/callback/google` exactly: `http`, not `https`, port `5173`, and no trailing slash. Changes can take a few minutes to apply. |
| `Access blocked: … has not completed the Google verification process` | The account you picked isn't a test user. Add it under **Audience → Test users**. |
| The button is still disabled | The API didn't pick up the credentials. Check the variable names in `apps/api/.env` and restart `pnpm dev`. |
| You're sent back to `/login` with an error | Check the API logs in the `pnpm dev` output for details. |

**Going to production**

1. In the OAuth client, add your production origin, e.g. `https://flightplan.example.com`, and the redirect URI `https://flightplan.example.com/api/auth/callback/google`. Consider a separate OAuth client for production.
2. On the production server, set `BETTER_AUTH_URL=https://flightplan.example.com`, a new `BETTER_AUTH_SECRET`, and the Google client ID and secret.
3. On the consent screen, add your app's homepage, privacy policy and terms links, then click **Publish app** so any Google user can sign in, not just test users.

If someone signs in with Google using the same email as an existing email/password account, the two are linked into one account.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| * | `/api/auth/*` | Better Auth: sign up/in/out, Google OAuth, session |
| GET | `/api/auth-config` | Which sign-in methods are configured |
| GET | `/api/me` | The signed-in organizer (401 if signed out) |
| GET / POST | `/api/events` | List / create the organizer's events |
| GET / PUT / DELETE | `/api/events/:id` | Read / update (including the day schedule) / delete one of the organizer's events or templates |
| POST | `/api/events/:id/spawn` | Create a draft from a template: body `{ "startDate": "2026-11-13" }` |
| PATCH | `/api/events/:id/status` | Publish or unpublish a dated event: body `{ "status": "published" }` or `{ "status": "draft" }` |
| POST | `/api/organizers/signup` | Early-access organizer signup (validated with the shared Zod schema) |
