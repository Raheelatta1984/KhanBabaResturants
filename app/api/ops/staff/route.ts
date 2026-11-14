import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { refreshStaffCookie } from "@/lib/auth/staff-cookie";
import {
  UserAdminError,
  createStaff,
  deleteStaff,
  goLive,
  resetStaffPassword,
  setStaffActive,
  updateStaff,
} from "@/lib/auth/users";

export const dynamic = "force-dynamic";

/**
 * POST /api/ops/staff — team administration for administrators and managers.
 * The permission rules live in lib/auth/users.ts.
 */
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
  const id = Number(body.id);

  try {
    switch (action) {
      case "create":
        await createStaff(db, session, body);
        return NextResponse.json({ ok: true }, { status: 201 });
      case "update":
        await updateStaff(db, session, id, body);
        return NextResponse.json({ ok: true });
      case "toggle": {
        const row = await db.maybeOne<{ active: boolean }>(
          "SELECT active FROM staff WHERE id = $1",
          [Number.isInteger(id) ? id : -1],
        );
        await setStaffActive(db, session, id, !(row?.active ?? false));
        return NextResponse.json({ ok: true });
      }
      case "password":
        await resetStaffPassword(db, session, id, String(body.password ?? ""));
        return NextResponse.json({ ok: true });
      case "delete":
        await deleteStaff(db, session, id);
        return NextResponse.json({ ok: true });
      case "go_live": {
        const result = await goLive(
          db,
          session,
          body.password ? String(body.password) : undefined,
        );
        const response = NextResponse.json({
          ok: true,
          disabledStaff: result.disabledStaff,
          removedCustomers: result.removedCustomers,
        });
        if (result.passwordHash)
          await refreshStaffCookie(response, session, result.passwordHash);
        return response;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof UserAdminError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("staff admin action failed", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
