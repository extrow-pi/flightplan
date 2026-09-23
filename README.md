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

### Vendor table booking

Each show has numbered tables (1…N, from **Vendor tables**) and an optional **floor map** image (PNG/JPEG/WebP, up to 10 MB), stored in `apps/api/.data/uploads/` or `UPLOADS_DIR`.

Settings (per event, and copied from templates):

- **Approve vendors first:** requests from links wait as *Needs approval*. Tables the organizer assigns skip approval.
- **Vendors pay within N days** (or no deadline): the clock starts at approval, or at booking if no approval is needed. Free tables are confirmed immediately.
- **Public booking link** `/book/:token`: anyone can request an open table while the event is published and the link is open.
- **Personal invites** `/invite/:token`: single-use links for specific vendors. They work while the public link is closed, and on drafts.
- **Payment instructions:** shown to vendors after they book. Payments happen outside the app; the organizer clicks **Mark paid**.
- **Max tables per vendor request** (default 4, up to 20): vendors can pick several tables at once.

**Multi-table requests:** a vendor's request is one booking per table, all sharing a `request_id`. The request is all-or-nothing: if any picked table is taken, nothing is booked and the vendor is told which tables to change. Approve, reject, mark paid and keep apply to the whole request, with one payment deadline. Release can free a single table or the whole request.

Booking statuses: `pending` → `awaiting_payment` → `paid`, or `rejected` / `released` / `cancelled`. A table can hold only one active booking at a time (enforced by a partial unique index).
When a payment deadline passes, the booking shows as **Payment overdue** in *Needs your attention* on the dashboard and on the event's **Tables & vendors** tab. From there the organizer can **Release table**, **Keep, +N days** or **Keep, no deadline**.

**Vendors don't have accounts.** Each organizer has a vendor list keyed by email, so a vendor who books several shows with the same email is one vendor with several bookings. Booking forms never overwrite a vendor's saved details; each booking keeps its own copy of what was submitted. The booking page remembers a vendor's details in their browser (localStorage) for next time.

### Vendor emails

Flightplan emails vendors and organizers as bookings change. Emails are queued in the `emails` table and sent by a background worker, with up to 5 retries. Every email also appears in the dashboard **Email log**.

| Email | To | When |
|---|---|---|
| Request received | Vendor | Booked from a link, approval needed |
| Tables held, please pay | Vendor | Approved, booked without approval, or assigned by the organizer |
| You're booked | Vendor | Marked paid, or a free table |
| Request not approved | Vendor | Rejected |
| Tables released | Vendor | One or more tables released |
| More time to pay | Vendor | Organizer keeps an overdue request |
| Payment reminder | Vendor | ~24h before the deadline (skipped if approved less than a day before it) |
| New request / new booking | Organizer | A vendor books from a link |
| Payment overdue | Organizer | Once, when a deadline passes |

Vendor emails set reply-to to the organizer, and they link to a private status page at `/booking/:requestId` showing the vendor's tables, status, deadline and payment instructions. Reminders and overdue notices are checked every 5 minutes.

**Turning on delivery:** without `RESEND_API_KEY`, emails are only recorded ("Not sent" in the Email log). To send them:

1. Create an account at [resend.com](https://resend.com) and an API key under **API Keys**.
2. Add it to `apps/api/.env` as `RESEND_API_KEY=re_...` and restart `pnpm dev`.
3. For testing, the default sender `onboarding@resend.dev` only delivers to your own Resend account's email. To email real vendors, verify your domain in Resend and set `EMAIL_FROM="Your Show <tables@yourdomain.com>"`.

`APP_TIMEZONE` (default `America/Vancouver`) sets the timezone for deadlines in emails, and `APP_URL` (default `BETTER_AUTH_URL`) sets the base for links.

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
| POST / DELETE | `/api/events/:id/floor-map` | Upload (multipart `file`) or remove the floor map |
| GET | `/api/events/:id/tables` | Tables with their active bookings, past bookings and invites |
| POST | `/api/events/:id/bookings` | Organizer assigns a table: `{ tableId, vendorId }` or `{ tableId, contact }`, optional `paid` |
| POST | `/api/events/:id/invites` | Create a personal invite link: `{ name?, email? }` |
| DELETE | `/api/invites/:id` | Cancel an unused invite |
| POST | `/api/bookings/:id/approve` · `reject` · `mark-paid` | Apply to the booking's whole request |
| POST | `/api/bookings/:id/release` | Free this table, or the whole request with `{ "wholeRequest": true }` |
| POST | `/api/bookings/:id/keep` | Keep an overdue request: `{ "extendDays": 7 }` or `{ "extendDays": null }` for no deadline |
| GET | `/api/alerts` | Overdue payments and requests awaiting approval |
| GET | `/api/vendors` | The organizer's vendor list |
| GET | `/api/emails` | The organizer's email log, and whether delivery is enabled |
| GET | `/api/emails/:id/html` | An email's HTML |
| POST | `/api/emails/:id/retry` | Retry a failed email |
| GET | `/api/public/request/:requestId` | A vendor's booking status page data (no sign-in) |
| GET / POST | `/api/public/book/:token` | Public booking page data / request tables: `{ tableIds: [...], name, email, … }` (no sign-in) |
| GET / POST | `/api/public/invite/:token` | Same, for a personal invite link |
| GET | `/api/uploads/:file` | Uploaded images (floor maps) |
| PATCH | `/api/events/:id/status` | Publish or unpublish a dated event: body `{ "status": "published" }` or `{ "status": "draft" }` |
| POST | `/api/organizers/signup` | Early-access organizer signup (validated with the shared Zod schema) |
