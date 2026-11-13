import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"];

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
  const action = String(body.action ?? "create");

  if (action === "create") {
    const title = String(body.title ?? "").trim();
    const summary = String(body.summary ?? "").trim();
    const category = String(body.category ?? "feature");
    if (title.length < 3) return NextResponse.json({ error: "Give the update a title" }, { status: 400 });
    if (summary.length < 10) return NextResponse.json({ error: "Add a short summary customers will read" }, { status: 400 });
    if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    const info = db
      .prepare(
        `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title,
        summary,
        String(body.body ?? "").trim() || null,
        category,
        String(body.version ?? "").trim() || null,
        body.prNumber ? Number(body.prNumber) : null,
        String(body.prUrl ?? "").trim() || null,
        body.pinned ? 1 : 0,
      );
    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) }, { status: 201 });
  }

  if (action === "toggle-pin") {
    const id = Number(body.id);
    const row = db.prepare("SELECT pinned FROM whats_new WHERE id = ?").get(id) as { pinned: number } | undefined;
    if (!row) return NextResponse.json({ error: "Update not found" }, { status: 404 });
    db.prepare("UPDATE whats_new SET pinned = ? WHERE id = ?").run(row.pinned ? 0 : 1, id);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    db.prepare("DELETE FROM whats_new WHERE id = ?").run(Number(body.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
