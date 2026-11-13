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

function secret(): string {
  return process.env.SESSION_SECRET || "khan-baba-dev-secret-change-me";
}

function toBase64Url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function createSessionToken(staff: {
  id: number;
  name: string;
  email: string;
  role: Role;
}): Promise<string> {
  const payload: StaffSession = {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmac(body));
  return `${body}.${signature}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<StaffSession | null> {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = toBase64Url(await hmac(body));
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as StaffSession;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
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
