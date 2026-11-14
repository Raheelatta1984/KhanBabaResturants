import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { syncSquare } from "@/lib/integrations/square";

export const dynamic = "force-dynamic";

/**
 * Out-of-band Square POS synchronisation for a scheduler (e.g. Vercel Cron).
 *
 * This is intentionally a separate route: the main ordering flow never calls
 * Square. The bridge discovers completed orders from its own sync log, pushes
 * them, then imports POS payments. Set SQUARE_SYNC_SECRET (or CRON_SECRET) and
 * call `GET /api/ops/square/cron` with
 * `Authorization: Bearer <secret>`.
 */
export async function GET(request: Request) {
  const secret =
    process.env.SQUARE_SYNC_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret)
    return NextResponse.json(
      { error: "Set SQUARE_SYNC_SECRET to enable scheduled Square sync" },
      { status: 503 },
    );
  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  try {
    const db = await getDb();
    const result = await syncSquare(db, { limit: 50, sinceDays: 2 });
    return NextResponse.json({ ok: true, detached: true, ...result });
  } catch (error) {
    console.error("Scheduled Square sync failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Square sync failed" },
      { status: 500 },
    );
  }
}
