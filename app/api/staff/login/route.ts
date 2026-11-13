import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, homeForRole, type Role } from "@/lib/auth/core";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 8;
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const key = email || "unknown";

  if (throttled(key)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  }

  const db = getDb();
  const staff = db
    .prepare("SELECT id, name, email, role, password_hash, active FROM staff WHERE lower(email) = ?")
    .get(email) as
    | { id: number; name: string; email: string; role: Role; password_hash: string; active: number }
    | undefined;

  if (!staff || !staff.active || !verifyPassword(password, staff.password_hash)) {
    recordFailure(key);
    return NextResponse.json({ error: "Those details do not match an active staff account" }, { status: 401 });
  }

  const token = await createSessionToken({
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role,
  });

  const response = NextResponse.json({ ok: true, role: staff.role, redirectTo: homeForRole(staff.role) });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  attempts.delete(key);
  return response;
}
