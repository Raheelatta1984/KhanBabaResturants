import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type Role, type StaffSession } from "./core";

/** Session check for route handlers. Returns null when unauthenticated. */
export async function getApiSession(roles?: Role[]): Promise<StaffSession | null> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  if (roles && !roles.includes(session.role)) return null;
  return session;
}
