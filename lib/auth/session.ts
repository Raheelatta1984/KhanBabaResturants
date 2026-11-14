import { cookies } from "next/headers";
import { getDb } from "../db";
import { SESSION_COOKIE, verifySessionToken, type StaffSession } from "./core";
import { liveStaffSession } from "./users";

export * from "./core";

/**
 * Check a verified cookie against the staff table, so a disabled or deleted
 * account, a changed password or a changed role applies on the very next
 * request instead of when the 12-hour cookie runs out.
 *
 * If the database cannot be reached the signed cookie is trusted as before:
 * the page behind it needs the database too and will report the outage itself.
 */
export async function resolveStaffSession(
  session: StaffSession | null,
): Promise<StaffSession | null> {
  if (!session) return null;
  let db;
  try {
    db = await getDb();
  } catch {
    return session;
  }
  return liveStaffSession(db, session);
}

export async function getSession(): Promise<StaffSession | null> {
  const jar = await cookies();
  return resolveStaffSession(
    await verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  );
}
