import type { Role, StaffSession } from "./core";
import { getSession } from "./session";

/** Session check for route handlers. Returns null when unauthenticated. */
export async function getApiSession(roles?: Role[]): Promise<StaffSession | null> {
  const session = await getSession();
  if (!session) return null;
  if (roles && !roles.includes(session.role)) return null;
  return session;
}
