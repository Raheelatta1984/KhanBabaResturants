import { unstable_noStore } from "next/cache";
import fs from "node:fs";
import path from "node:path";
import {
  createPgliteDb,
  createPostgresDb,
  isPgliteUrl,
  isSupabasePooler,
  type Db,
} from "./driver";
import { SCHEMA_SQL } from "./schema";
import { seedDatabase } from "./seed";

export type { Db, Row, Sql } from "./driver";

/**
 * Postgres (Supabase) data layer.
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

/** Every variable a connection string can arrive in, in priority order. */
const URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

/**
 * The configured connection string, or "" when there is none.
 *
 * A blank-but-present variable is the failure that started this: Vercel keeps an
 * env var with an empty value, `process.env.DATABASE_URL` is `""` (falsy but
 * defined), and every `if (!process.env.DATABASE_URL)` check says "configured"
 * while the driver has nothing to connect with. Trim and skip blanks instead.
 */
export function databaseUrl(): string {
  for (const key of URL_KEYS) {
    const value = (process.env[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** True when a database connection string is configured. */
export function databaseConfigured(): boolean {
  return databaseUrl() !== "";
}

/**
 * Reasons a configured string still cannot be dialled, in the words someone can
 * act on. The REST URL pasted into DATABASE_URL and the IPv6-only direct host
 * are the two ways this goes wrong in practice; both used to surface as an
 * opaque 500.
 */
export function connectionStringIssue(): string | null {
  const url = databaseUrl();
  if (!url) return null;
  if (isPgliteUrl(url)) return null;
  if (/^https?:\/\//i.test(url)) {
    return (
      "DATABASE_URL holds an https:// URL. That is the Supabase REST endpoint, not the database. " +
      "Use the connection string from Connect → Connection pooling (it starts with postgresql://)."
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return "DATABASE_URL must start with postgresql:// (or postgres://).";
  }
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!host)
    return "DATABASE_URL is not a valid URL. Copy the connection string again — special characters in the password must be URL-encoded.";
  if (/^db\.[a-z0-9]+\.supabase\.(co|net)$/i.test(host)) {
    return (
      "DATABASE_URL uses the direct Supabase host, which is IPv6-only and unreachable from Vercel. " +
      "Use the pooler host instead (Connect → Connection pooling → Transaction, port 6543)."
    );
  }
  return null;
}

/**
 * Where we are connected to, safe to show in the UI and /api/health: host,
 * database name and pooler mode. Never the user or the password.
 */
export function describeDatabaseTarget(): string {
  const url = databaseUrl();
  if (!url) return "not configured";
  if (isPgliteUrl(url)) return "pglite (in-process)";
  try {
    const parsed = new URL(url);
    const mode = isSupabasePooler(url)
      ? parsed.port === "6543"
        ? " · pooler/transaction"
        : " · pooler/session"
      : "";
    return `${parsed.hostname}${parsed.pathname}${mode}`;
  } catch {
    return "configured";
  }
}

/**
 * Which Supabase project the connection string points at, derived from the
 * pooler username (`postgres.<project-ref>`) or the direct host. Used only to
 * warn when SUPABASE_URL and DATABASE_URL disagree, which is a confusing
 * misconfiguration to debug from a 500 page.
 */
export function databaseProjectRef(): string | null {
  const url = databaseUrl();
  if (!url || isPgliteUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const fromUser = /^postgres\.([a-z0-9]+)$/i.exec(
      decodeURIComponent(parsed.username),
    );
    if (fromUser) return fromUser[1];
    const fromHost = /^db\.([a-z0-9]+)\.supabase\.(co|net)$/i.exec(
      parsed.hostname,
    );
    return fromHost ? fromHost[1] : null;
  } catch {
    return null;
  }
}

/** The Supabase project named by SUPABASE_URL, when that variable is set. */
export function supabaseUrlProjectRef(): string | null {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  if (!url) return null;
  try {
    const match = /^([a-z0-9]+)\.supabase\.(co|net)$/i.exec(
      new URL(url).hostname,
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function initialise(): Promise<Db> {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Supabase connection string to your environment " +
        "(.env.local locally, Vercel → Project → Settings → Environment Variables in production).",
    );
  }

  const issue = connectionStringIssue();
  if (issue) throw new Error(issue);

  const db = globalForDb.__kbDbFactory
    ? globalForDb.__kbDbFactory()
    : isPgliteUrl(url)
      ? await createPgliteDb(url)
      : createPostgresDb(url);

  // Retry transient failures (a paused Supabase project waking up, a network
  // blip) before giving up — the app must recover without a redeploy.
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

/** Local development uploads (only used when no cloud media driver is configured). */
export function localUploadsDir(): string {
  const dir = path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
