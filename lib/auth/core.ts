import { signToken, verifyToken } from "./token";

export type Role = "admin" | "manager" | "counter" | "kitchen" | "delivery";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  counter: "Counter / Front of house",
  kitchen: "Kitchen",
  delivery: "Delivery coordinator",
};

export type StaffSession = {
  id: number;
  name: string;
  email: string;
  role: Role;
  exp: number;
};

export const SESSION_COOKIE = "kb_staff";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
/** Audience claim — a customer cookie is signed with the same secret but a different aud. */
const AUDIENCE = "staff";

export async function createSessionToken(staff: {
  id: number;
  name: string;
  email: string;
  role: Role;
}): Promise<string> {
  return signToken({ ...staff, aud: AUDIENCE }, SESSION_TTL_SECONDS);
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<StaffSession | null> {
  const payload = await verifyToken<StaffSession & { aud?: string }>(token);
  if (!payload || payload.aud !== AUDIENCE) return null;
  return payload;
}

const ACCESS: Record<string, Role[]> = {
  "/admin": ["admin", "manager"],
  "/counter": ["admin", "manager", "counter"],
  "/kitchen": ["admin", "manager", "kitchen"],
  "/delivery": ["admin", "manager", "delivery"],
};

export function rolesForPath(pathname: string): Role[] | null {
  for (const [prefix, roles] of Object.entries(ACCESS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return roles;
  }
  return null;
}

export function homeForRole(role: Role): string {
  switch (role) {
    case "kitchen":
      return "/kitchen";
    case "delivery":
      return "/delivery";
    case "counter":
      return "/counter";
    default:
      return "/admin";
  }
}

export function canAccess(role: Role, pathname: string): boolean {
  const roles = rolesForPath(pathname);
  if (!roles) return true;
  return roles.includes(role);
}

export const PORTAL_LINKS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/counter", label: "Counter", roles: ["admin", "manager", "counter"] },
  { href: "/kitchen", label: "Kitchen", roles: ["admin", "manager", "kitchen"] },
  { href: "/delivery", label: "Delivery", roles: ["admin", "manager", "delivery"] },
  { href: "/admin", label: "Admin", roles: ["admin", "manager"] },
];
