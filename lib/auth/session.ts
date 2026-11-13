import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type StaffSession } from "./core";

export * from "./core";

export async function getSession(): Promise<StaffSession | null> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}
