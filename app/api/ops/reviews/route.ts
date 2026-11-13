import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const id = Number(body.id);
  const action = String(body.action ?? "");
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "Invalid review" }, { status: 400 });

  if (action === "publish" || action === "hide") {
    await db.query("UPDATE reviews SET status = $1 WHERE id = $2", [
      action === "publish" ? "published" : "hidden",
      id,
    ]);
    return NextResponse.json({ ok: true });
  }
  if (action === "delete") {
    await db.query("DELETE FROM reviews WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
