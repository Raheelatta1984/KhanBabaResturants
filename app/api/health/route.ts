import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isEphemeralStorage } from "@/lib/db/paths";

export const dynamic = "force-dynamic";

/** Deployment smoke test: confirms the database opened and seeded. */
export async function GET() {
  try {
    const db = getDb();
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

    return NextResponse.json({
      ok: true,
      storage: isEphemeralStorage() ? "ephemeral" : "persistent",
      counts: {
        menuItems: count("menu_items"),
        tables: count("dining_tables"),
        orders: count("orders"),
        materials: count("materials"),
      },
    });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Database unavailable" },
      { status: 500 },
    );
  }
}
