import type { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, type StaffSession } from "./core";
import { passwordFingerprint } from "./users";

/**
 * Re-issue the caller's staff cookie after their own password changed, so they
 * stay signed in on this device while every other session is signed out.
 */
export async function refreshStaffCookie(
  response: NextResponse,
  session: StaffSession,
  passwordHash: string,
): Promise<void> {
  const token = await createSessionToken({
    id: session.id,
    name: session.name,
    email: session.email,
    role: session.role,
    pv: passwordFingerprint(passwordHash),
  });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}
