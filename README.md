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
pnpm dev          # web on http://localhost:5173, API on http://localhost:3001
```

The web dev server proxies `/api/*` to the API.

### Database

With no `DATABASE_URL` set, the API uses **PGlite**, an embedded Postgres stored in `apps/api/.data/`. You don't need to install a database.
To use a real Postgres server (Neon, Supabase, local), copy `apps/api/.env.example` to `apps/api/.env` and set `DATABASE_URL`.

Migrations run automatically when the API starts. After changing `apps/api/src/db/schema.ts`:

```bash
pnpm db:generate
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/organizers/signup` | Early-access organizer signup (validated with the shared Zod schema) |
