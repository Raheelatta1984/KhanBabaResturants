import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authorisedCron, pruneExpiredChats } from "@/lib/chat/retention";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!authorisedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Not authorised" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const removed = await pruneExpiredChats(await getDb());
    return NextResponse.json({ ok: true, removed }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Cleanup failed" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
