import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "manager", "counter", "kitchen", "delivery"];

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
  const action = String(body.action ?? "");

  if (action === "create") {
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "counter");
    const password = String(body.password ?? "");
    if (name.length < 2) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    if (!ROLES.includes(role)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    if (session.role === "manager" && role === "admin") {
      return NextResponse.json({ error: "Only an administrator can create another administrator" }, { status: 403 });
    }
    const exists = db.prepare("SELECT id FROM staff WHERE lower(email) = ?").get(email);
    if (exists) return NextResponse.json({ error: "That email already has an account" }, { status: 409 });
    db.prepare("INSERT INTO staff (name, email, role, password_hash) VALUES (?, ?, ?, ?)").run(
      name,
      email,
      role,
      hashPassword(password),
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (action === "toggle") {
    const id = Number(body.id);
    if (id === session.id) return NextResponse.json({ error: "You cannot deactivate your own account" }, { status: 400 });
    const row = db.prepare("SELECT active FROM staff WHERE id = ?").get(id) as { active: number } | undefined;
    if (!row) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    db.prepare("UPDATE staff SET active = ? WHERE id = ?").run(row.active ? 0 : 1, id);
    return NextResponse.json({ ok: true });
  }

  if (action === "password") {
    const id = Number(body.id);
    const password = String(body.password ?? "");
    if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    db.prepare("UPDATE staff SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
