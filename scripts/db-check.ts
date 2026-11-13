/**
 * Diagnose the Supabase connection from wherever this is run.
 *
 *   npm run db:check                     # uses DATABASE_URL / .env.local
 *   DATABASE_URL=… npm run db:check
 *
 * Prints, in order: which variable supplied the string (never its value), the
 * host/database/pooler mode, then whether a real TCP connection through
 * node-postgres can run a query — the one thing /api/health cannot check when
 * the whole deployment is down. Exits non-zero on failure so it is useful in CI.
 */
import { createPostgresDb, isPgliteUrl } from "../lib/db/driver";
import {
  connectionStringIssue,
  databaseProjectRef,
  databaseUrl,
  describeDatabaseTarget,
  supabaseUrlProjectRef,
} from "../lib/db";

const URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

async function main() {
  const url = databaseUrl();
  const source = URL_KEYS.find((key) => (process.env[key] ?? "").trim());
  const blanks = URL_KEYS.filter(
    (key) => process.env[key] !== undefined && !(process.env[key] ?? "").trim(),
  );

  console.log("Connection source:", source ?? "none");
  if (blanks.length > 0)
    console.log("Present but empty:", blanks.join(", "), "(an empty value counts as missing)");

  if (!url) {
    console.error(
      "\nNo database configured. Set DATABASE_URL to the Supabase pooler string:\n" +
        "  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres",
    );
    process.exit(1);
  }

  const issue = connectionStringIssue();
  console.log("Target:", describeDatabaseTarget());
  if (issue) {
    console.error("\n" + issue);
    process.exit(1);
  }

  const dbRef = databaseProjectRef();
  const urlRef = supabaseUrlProjectRef();
  if (dbRef) console.log("Project ref:", dbRef);
  if (dbRef && urlRef && dbRef !== urlRef) {
    console.error(
      `\nSUPABASE_URL points at "${urlRef}" but DATABASE_URL at "${dbRef}". Photos and data would live in different projects.`,
    );
  }

  if (isPgliteUrl(url)) {
    console.log("\nPGlite (in-process) — no network connection to test. Skipping.");
    process.exit(0);
  }

  const db = createPostgresDb(url, { max: 1 });
  const started = Date.now();
  try {
    const row = await db.one<{ version: string; db: string }>(
      "SELECT version() AS version, current_database() AS db",
    );
    console.log(`\nConnected in ${Date.now() - started} ms to database "${row.db}".`);
    console.log(row.version.split(",")[0]);
    const counts = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    console.log(`Public tables: ${counts.length}`);
    if (counts.length === 0) {
      console.log(
        "No tables yet — the app creates them on its first request (or run `npm run seed`).",
      );
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nCould not connect: ${message}`);
    if (/password authentication failed|SASL|pg_hba/i.test(message)) {
      console.error(
        "The password is wrong. Re-copy the pooler string from Supabase → Connect, and URL-encode @ : / ? # if present.",
      );
    } else if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
      console.error(
        "The host could not be reached. Check the project is not paused and the pooler host/region matches the project.",
      );
    } else if (/self.signed|certificate/i.test(message)) {
      console.error("TLS problem. Append ?sslmode=require to the connection string.");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("db:check crashed:", error);
  process.exit(1);
});
