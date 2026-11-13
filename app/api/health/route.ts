import { NextResponse } from "next/server";
import {
  connectionStringIssue,
  databaseConfigured,
  databaseProjectRef,
  databaseUrl,
  describeDatabaseTarget,
  getDb,
  supabaseUrlProjectRef,
} from "@/lib/db";
import { isPgliteUrl, isSupabasePooler } from "@/lib/db/driver";
import { mediaStorageSummary } from "@/lib/media";

export const dynamic = "force-dynamic";

const SETUP_HINT =
  "Set DATABASE_URL to the Supabase pooler connection string " +
  "(postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres) " +
  "in Vercel → Settings → Environment Variables for Production and Preview, then redeploy.";

/**
 * Deployment smoke test: confirms the Postgres connection, that the schema is
 * applied, and returns real row counts.
 *
 *   { ok, storage: "postgres", target, counts, media }
 *
 * It also reports *why* it failed, because the page-level error boundary cannot:
 * a missing variable, a blank variable, a wrong password and a suspended project
 * all look like "database is not connected" from the browser.
 */
export async function GET() {
  if (!databaseConfigured()) {
    // Distinguish "nobody set it" from "Vercel has the variable with an empty
    // value" — the second is invisible in the dashboard and was the live bug.
    const blank = (process.env.DATABASE_URL ?? "") !== "";
    return NextResponse.json(
      {
        ok: false,
        storage: "unconfigured",
        reason: blank ? "blank-connection-string" : "missing-connection-string",
        error: blank
          ? "DATABASE_URL exists but is empty. Paste your Supabase pooler connection string as its value."
          : "DATABASE_URL is not set. Add your Supabase connection string and redeploy.",
        hint: SETUP_HINT,
      },
      { status: 503 },
    );
  }

  // Configured but unusable: report it before dialling, with the fix.
  const issue = connectionStringIssue();
  if (issue) {
    return NextResponse.json(
      {
        ok: false,
        storage: "postgres",
        provider: "supabase",
        target: describeDatabaseTarget(),
        reason: "invalid-connection-string",
        error: issue,
      },
      { status: 503 },
    );
  }

  const warnings: string[] = [];
  const dbRef = databaseProjectRef();
  const urlRef = supabaseUrlProjectRef();
  if (dbRef && urlRef && dbRef !== urlRef) {
    warnings.push(
      `DATABASE_URL points at Supabase project "${dbRef}" but SUPABASE_URL points at "${urlRef}". Photos and data would live in different projects.`,
    );
  }
  if (!isPgliteUrl(databaseUrl()) && !isSupabasePooler(databaseUrl())) {
    warnings.push(
      "DATABASE_URL is not a Supabase pooler host. The direct db.<ref>.supabase.co host is IPv6-only and usually unreachable from serverless functions.",
    );
  }

  try {
    const db = await getDb();
    const started = Date.now();
    const count = async (table: string) =>
      Number(
        (await db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)).c,
      );

    const [
      menuItems,
      tables,
      orders,
      materials,
      staff,
      batches,
      reviews,
      whatsNew,
    ] = await Promise.all([
      count("menu_items"),
      count("dining_tables"),
      count("orders"),
      count("materials"),
      count("staff"),
      count("production_batches"),
      count("reviews"),
      count("whats_new"),
    ]);
    const version = await db.one<{ version: string }>(
      "SELECT version() AS version",
    );

    return NextResponse.json({
      ok: true,
      storage: "postgres",
      provider: "supabase",
      target: describeDatabaseTarget(),
      projectRef: dbRef,
      latencyMs: Date.now() - started,
      counts: {
        menuItems,
        tables,
        orders,
        materials,
        staff,
        batches,
        reviews,
        whatsNew,
      },
      media: await mediaStorageSummary(),
      warnings,
      server: version.version.split(",")[0],
    });
  } catch (error) {
    console.error("health check failed", error);
    const message = error instanceof Error ? error.message : "Database unavailable";
    // Turn the two network-level failures into an instruction instead of a
    // stack-trace fragment: they mean the connection string is wrong, not that
    // the code is.
    const unreachable = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo|timeout/i.test(
      message,
    );
    const authFailed = /password authentication failed|SASL|no pg_hba|role .* does not exist/i.test(
      message,
    );
    const tlsFailed = /certificate|self.signed|SSL|TLS/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        storage: "postgres",
        provider: "supabase",
        target: describeDatabaseTarget(),
        projectRef: dbRef,
        reason: authFailed
          ? "authentication-failed"
          : tlsFailed
            ? "tls-verification-failed"
            : unreachable
              ? "unreachable"
              : "query-failed",
        error: message,
        hint: tlsFailed
          ? "TLS was rejected. Append ?sslmode=require to DATABASE_URL (the driver then uses Supabase's certificate without CA verification); set PGSSL_VERIFY=full only if your pooler hostname has a publicly trusted certificate."
          : authFailed
          ? "The password in DATABASE_URL is wrong (or was reset in Supabase → Project Settings → Database). Copy the pooler string again, URL-encoding any special characters in the password."
          : unreachable
            ? "The database host could not be reached. Check the project is not paused and that the pooler host in DATABASE_URL matches your project's region."
            : undefined,
        warnings,
      },
      { status: 500 },
    );
  }
}
