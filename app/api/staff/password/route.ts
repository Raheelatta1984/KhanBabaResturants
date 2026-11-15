import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { refreshStaffCookie } from "@/lib/auth/staff-cookie";
import { UserAdminError, changeOwnPassword } from "@/lib/auth/users";
import { withActionLog } from "@/lib/ops/actions";

export const dynamic = "force-dynamic";

/** POST /api/staff/password — any signed-in staff member changes their own password. */
async function post(request: Request) {
  const session = await getApiSession();
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const hash = await changeOwnPassword(
      await getDb(),
      session.id,
      String(body.currentPassword ?? ""),
      String(body.newPassword ?? ""),
    );
    const response = NextResponse.json({ ok: true });
    await refreshStaffCookie(response, session, hash);
    return response;
  } catch (error) {
    if (error instanceof UserAdminError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("password change failed", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}

/** Every call is written to the action log: who, what, the outcome, what to do next. */
export const POST = withActionLog("auth", post, { fallback: "change-password" });
