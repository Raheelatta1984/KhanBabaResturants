import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();
  const id = Number(body.id);
  const action = String(body.action ?? "");
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid review" }, { status: 400 });

  if (action === "publish" || action === "hide") {
    db.prepare("UPDATE reviews SET status = ? WHERE id = ?").run(action === "publish" ? "published" : "hidden", id);
    return NextResponse.json({ ok: true });
  }
  if (action === "delete") {
    db.prepare("DELETE FROM reviews WHERE id = ?").run(id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
