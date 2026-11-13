import { redirect } from "next/navigation";
import { getSession, canAccess, type Role, type StaffSession } from "./session";

export async function requireStaff(): Promise<StaffSession> {
  const session = await getSession();
  if (!session) redirect("/staff/login");
  return session;
}

export async function requireRole(roles: Role[]): Promise<StaffSession> {
  const session = await requireStaff();
  if (!roles.includes(session.role)) redirect("/staff/login?denied=1");
  return session;
}

export async function requirePageAccess(pathname: string): Promise<StaffSession> {
  const session = await requireStaff();
  if (!canAccess(session.role, pathname)) redirect("/staff/login?denied=1");
  return session;
}
