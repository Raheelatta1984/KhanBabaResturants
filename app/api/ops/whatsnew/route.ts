import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"];

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
  const action = String(body.action ?? "create");

  if (action === "create") {
    const title = String(body.title ?? "").trim();
    const summary = String(body.summary ?? "").trim();
    const category = String(body.category ?? "feature");
    if (title.length < 3)
      return NextResponse.json(
        { error: "Give the update a title" },
        { status: 400 },
      );
    if (summary.length < 10)
      return NextResponse.json(
        { error: "Add a short summary customers will read" },
        { status: 400 },
      );
    if (!CATEGORIES.includes(category))
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    const id = await db.insert(
      `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        title,
        summary,
        String(body.body ?? "").trim() || null,
        category,
        String(body.version ?? "").trim() || null,
        body.prNumber ? Number(body.prNumber) : null,
        String(body.prUrl ?? "").trim() || null,
        Boolean(body.pinned),
      ],
    );
    return NextResponse.json({ ok: true, id }, { status: 201 });
  }

  if (action === "toggle-pin") {
    const id = Number(body.id);
    const row = await db.maybeOne<{ pinned: boolean }>(
      "SELECT pinned FROM whats_new WHERE id = $1",
      [id],
    );
    if (!row)
      return NextResponse.json({ error: "Update not found" }, { status: 404 });
    await db.query("UPDATE whats_new SET pinned = $1 WHERE id = $2", [
      !row.pinned,
      id,
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    await db.query("DELETE FROM whats_new WHERE id = $1", [Number(body.id)]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
