import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import {
  UserAdminError,
  resetCustomerPassword,
  setCustomerActive,
} from "@/lib/auth/users";

export const dynamic = "force-dynamic";

/** POST /api/ops/customers — reset a customer's password or disable the login. */
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
  try {
    if (body.action === "password") {
      await resetCustomerPassword(
        db,
        id,
        String(body.password ?? ""),
        session.name,
      );
      return NextResponse.json({ ok: true });
    }
    if (body.action === "toggle") {
      const row = await db.maybeOne<{ active: boolean }>(
        "SELECT active FROM customers WHERE id = $1",
        [Number.isInteger(id) ? id : -1],
      );
      await setCustomerActive(db, id, !(row?.active ?? false), session.name);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof UserAdminError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("customer admin action failed", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
