import { unstable_noStore } from "next/cache";
import fs from "node:fs";
import path from "node:path";
import { createNeonDb, createPgliteDb, isPgliteUrl, type Db } from "./driver";
import { SCHEMA_SQL } from "./schema";
import { seedDatabase } from "./seed";

export type { Db, Row, Sql } from "./driver";

/**
 * Postgres (Neon) data layer.
 *
 * `getDb()` is async and idempotent: the first call in a process applies the
 * schema (every statement is `CREATE … IF NOT EXISTS`, so this file doubles as
 * the migration) and seeds a brand-new database. Vercel starts a fresh instance
 * per cold start, so this runs once per instance and every later call reuses
 * the resolved promise. Concurrent instance startups are safe: the schema is
 * idempotent and the seed holds a Postgres advisory lock.
 *
 * Set DATABASE_URL to `postgres://pglite/khanbaba` to run the exact same code
 * against PGlite (Postgres in WASM) — that is how CI tests without a server.
 */
const globalForDb = globalThis as unknown as {
  __kbDb?: Promise<Db>;
  __kbDbFactory?: () => Db;
};

/**
 * Replace how the handle is created. The PGlite test harness uses this so the
 * app boots against an in-process Postgres; production never calls it.
 */
export function setDbFactory(factory: () => Db): void {
  globalForDb.__kbDbFactory = factory;
  globalForDb.__kbDb = undefined;
}

/**
 * Resolved handle to the database. Await it: `const db = await getDb()`.
 *
 * Every read goes through here, so this is also where we opt out of Next's
 * static rendering and data cache — a menu price or a ticket status must never
 * come from a build-time snapshot. (`export const dynamic` would be nicer, but
 * two public pages missed it; marking the data access is impossible to forget.)
 */
export function getDb(): Promise<Db> {
  unstable_noStore();
  if (!globalForDb.__kbDb) globalForDb.__kbDb = initialise();
  return globalForDb.__kbDb;
}

/** Drop the cached connection (used by the test harness between databases). */
export function resetDbForTests(): void {
  globalForDb.__kbDb = undefined;
}

/** True when a database connection string is configured. */
export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

export function describeDatabaseTarget(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) return "not configured";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "configured";
  }
}

async function initialise(): Promise<Db> {
  const url = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ""
  ).trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Create a Neon Postgres project and add DATABASE_URL to your environment " +
        "(.env.local locally, Vercel → Project → Settings → Environment Variables in production).",
    );
  }

  const db = globalForDb.__kbDbFactory
    ? globalForDb.__kbDbFactory()
    : isPgliteUrl(url)
      ? await createPgliteDb(url)
      : createNeonDb(url);

  // Retry transient failures (a paused Neon branch waking up, a network blip)
  // before giving up — the app must recover without a redeploy.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await db.exec(SCHEMA_SQL);
      const { seeded } = await seedDatabase(db);
      if (seeded)
        console.log("[khanbaba] Postgres schema created and demo data seeded");
      return db;
    } catch (error) {
      lastError = error;
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  throw lastError;
}

/** Local development uploads (only used when no blob driver is configured). */
export function localUploadsDir(): string {
  const dir = path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
