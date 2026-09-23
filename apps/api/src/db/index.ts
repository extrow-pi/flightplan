import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

// With DATABASE_URL set, connect to a real Postgres server (Neon, Supabase, local install).
// Without it, fall back to PGlite: an embedded Postgres stored in apps/api/.data, so
// development needs no database install.
async function connect(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const db = drizzle(postgres(url), { schema });
    await migrate(db, { migrationsFolder });
    return db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = fileURLToPath(new URL("../../.data/pglite", import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder });
  console.log("Using embedded PGlite database (set DATABASE_URL to use Postgres)");
  return db;
}

export const db = await connect();
export { schema };
