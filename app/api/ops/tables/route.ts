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
  const action = String(body.action ?? "");

  if (action === "create") {
    const code = String(body.code ?? "")
      .trim()
      .toUpperCase();
    const name = String(body.name ?? "").trim();
    if (!/^[A-Z0-9-]{2,8}$/.test(code)) {
      return NextResponse.json(
        { error: "Table code must be 2–8 letters/numbers, e.g. T13" },
        { status: 400 },
      );
    }
    if (!name)
      return NextResponse.json(
        { error: "Give the table a name" },
        { status: 400 },
      );
    const exists = await db.maybeOne(
      "SELECT id FROM dining_tables WHERE code = $1",
      [code],
    );
    if (exists)
      return NextResponse.json(
        { error: "That table code already exists" },
        { status: 409 },
      );
    await db.query(
      "INSERT INTO dining_tables (code, name, zone, seats) VALUES ($1, $2, $3, $4)",
      [
        code,
        name,
        String(body.zone ?? "").trim() || null,
        Number(body.seats ?? 4),
      ],
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (action === "toggle") {
    const id = Number(body.id);
    const row = await db.maybeOne<{ active: boolean }>(
      "SELECT active FROM dining_tables WHERE id = $1",
      [id],
    );
    if (!row)
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    await db.query("UPDATE dining_tables SET active = $1 WHERE id = $2", [
      !row.active,
      id,
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    await db.query("DELETE FROM dining_tables WHERE id = $1", [
      Number(body.id),
    ]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
