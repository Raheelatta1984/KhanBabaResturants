import { NextResponse } from "next/server";
import { getDb, databaseConfigured, describeDatabaseTarget } from "@/lib/db";
import { mediaStorageSummary } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Deployment smoke test: confirms the Postgres connection, that the schema is
 * applied, and returns real row counts.
 *
 *   { ok, storage: "postgres", target, counts, media }
 */
export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        storage: "unconfigured",
        error:
          "DATABASE_URL is not set. Add your Neon connection string and redeploy.",
      },
      { status: 503 },
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
      target: describeDatabaseTarget(),
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
      server: version.version.split(",")[0],
    });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      {
        ok: false,
        storage: "postgres",
        target: describeDatabaseTarget(),
        error: error instanceof Error ? error.message : "Database unavailable",
      },
      { status: 500 },
    );
  }
}
