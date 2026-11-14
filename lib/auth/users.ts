/**
 * User administration: who may change which staff account, the rules that stop
 * an administrator locking the business out of its own console, and the
 * "go live" step that retires the demo credentials.
 *
 * Route handlers stay thin and call into here, so the same rules are exercised
 * by the PGlite test-suite without an HTTP server.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db/driver";
import type { Role, StaffSession } from "./core";
import { hashPassword, verifyPassword } from "./password";

export const STAFF_ROLES: Role[] = [
  "admin",
  "manager",
  "counter",
  "kitchen",
  "delivery",
];

/** The password every seeded demo account starts with (see lib/db/seed.ts). */
export const DEMO_PASSWORD = "KhanBaba2026!";
export const DEMO_CUSTOMER_EMAILS = ["ayesha@example.com", "daniel@example.com"];
/** Settings key: "1" while the sign-in page may advertise the demo logins. */
export const DEMO_LOGINS_SETTING = "demo_logins";

export class UserAdminError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type Actor = Pick<StaffSession, "id" | "role">;

type StaffRecord = {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  password_hash: string;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A short fingerprint of the stored password hash, carried in the session
 * cookie. When the password changes the fingerprint no longer matches and every
 * older session for that account stops working.
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export function validatePassword(password: string): void {
  if (password.length < 8)
    throw new UserAdminError("Password must be at least 8 characters");
  if (password.length > 200)
    throw new UserAdminError("Password is too long");
  if (password === DEMO_PASSWORD)
    throw new UserAdminError(
      "That is the published demo password. Choose a different one.",
    );
}

function validRole(role: string): Role {
  if (!STAFF_ROLES.includes(role as Role))
    throw new UserAdminError("Unknown role");
  return role as Role;
}

/** Managers run the team but cannot create, edit or become administrators. */
function assertCanManage(actor: Actor, targetRole: Role): void {
  if (actor.role === "admin") return;
  if (actor.role === "manager" && targetRole !== "admin") return;
  throw new UserAdminError(
    "Only an administrator can manage administrator accounts",
    403,
  );
}

async function getStaff(db: Db, id: number): Promise<StaffRecord> {
  const row = Number.isInteger(id)
    ? await db.maybeOne<StaffRecord>(
        "SELECT id, name, email, role, active, password_hash FROM staff WHERE id = $1",
        [id],
      )
    : null;
  if (!row) throw new UserAdminError("Staff member not found", 404);
  return row;
}

/** Refuse a change that would leave nobody able to open the admin console. */
async function assertAnotherActiveAdmin(db: Db, exceptId: number): Promise<void> {
  const row = await db.maybeOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM staff WHERE role = 'admin' AND active = TRUE AND id <> $1",
    [exceptId],
  );
  if (Number(row?.c ?? 0) === 0)
    throw new UserAdminError(
      "This is the only active administrator. Create or enable another administrator first.",
    );
}

/**
 * The account behind a session cookie, as it is right now. Returns null when
 * the account was deleted or disabled, or its password changed after the cookie
 * was issued. The role and name come from the database, so a role change takes
 * effect on the next request rather than when the cookie expires.
 */
export async function liveStaffSession(
  db: Db,
  session: StaffSession,
): Promise<StaffSession | null> {
  const row = await db.maybeOne<StaffRecord>(
    "SELECT id, name, email, role, active, password_hash FROM staff WHERE id = $1",
    [session.id],
  );
  if (!row || !row.active) return null;
  if (session.pv && session.pv !== passwordFingerprint(row.password_hash))
    return null;
  return { ...session, name: row.name, email: row.email, role: row.role };
}

export async function createStaff(
  db: Db,
  actor: Actor,
  input: { name?: unknown; email?: unknown; role?: unknown; password?: unknown },
): Promise<number> {
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const role = validRole(String(input.role ?? "counter"));
  const password = String(input.password ?? "");
  if (name.length < 2) throw new UserAdminError("Name is required");
  if (!EMAIL.test(email)) throw new UserAdminError("Enter a valid email");
  validatePassword(password);
  assertCanManage(actor, role);
  const exists = await db.maybeOne(
    "SELECT id FROM staff WHERE lower(email) = $1",
    [email],
  );
  if (exists)
    throw new UserAdminError("That email already has an account", 409);
  return db.insert(
    "INSERT INTO staff (name, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, email, role, hashPassword(password)],
  );
}

/** Change a team member's name, sign-in email or role. */
export async function updateStaff(
  db: Db,
  actor: Actor,
  id: number,
  input: { name?: unknown; email?: unknown; role?: unknown },
): Promise<void> {
  const target = await getStaff(db, id);
  assertCanManage(actor, target.role);
  const name = String(input.name ?? target.name).trim();
  const email = String(input.email ?? target.email).trim().toLowerCase();
  const role = validRole(String(input.role ?? target.role));
  if (name.length < 2) throw new UserAdminError("Name is required");
  if (!EMAIL.test(email)) throw new UserAdminError("Enter a valid email");
  if (role !== target.role) {
    if (id === actor.id)
      throw new UserAdminError("You cannot change your own role");
    assertCanManage(actor, role);
    if (target.role === "admin" && target.active)
      await assertAnotherActiveAdmin(db, id);
  }
  const clash = await db.maybeOne(
    "SELECT id FROM staff WHERE lower(email) = $1 AND id <> $2",
    [email, id],
  );
  if (clash)
    throw new UserAdminError("That email already has an account", 409);
  await db.query(
    "UPDATE staff SET name = $1, email = $2, role = $3 WHERE id = $4",
    [name, email, role, id],
  );
}

export async function setStaffActive(
  db: Db,
  actor: Actor,
  id: number,
  active: boolean,
): Promise<void> {
  const target = await getStaff(db, id);
  assertCanManage(actor, target.role);
  if (!active) {
    if (id === actor.id)
      throw new UserAdminError("You cannot disable your own account");
    if (target.role === "admin" && target.active)
      await assertAnotherActiveAdmin(db, id);
  }
  // Once the demo credentials are retired, an account still on the published
  // password must not come back to life without a new one.
  if (
    active &&
    !target.active &&
    !(await demoLoginsEnabled(db)) &&
    verifyPassword(DEMO_PASSWORD, target.password_hash)
  )
    throw new UserAdminError(
      "This account still has the demo password. Reset its password first, then enable it.",
    );
  await db.query("UPDATE staff SET active = $1 WHERE id = $2", [active, id]);
}

/** Set a new password for someone else. Their open sessions are signed out. */
export async function resetStaffPassword(
  db: Db,
  actor: Actor,
  id: number,
  password: string,
): Promise<void> {
  const target = await getStaff(db, id);
  assertCanManage(actor, target.role);
  validatePassword(password);
  await db.query("UPDATE staff SET password_hash = $1 WHERE id = $2", [
    hashPassword(password),
    id,
  ]);
}

export async function deleteStaff(
  db: Db,
  actor: Actor,
  id: number,
): Promise<void> {
  const target = await getStaff(db, id);
  assertCanManage(actor, target.role);
  if (id === actor.id)
    throw new UserAdminError("You cannot delete your own account");
  if (target.role === "admin" && target.active)
    await assertAnotherActiveAdmin(db, id);
  await db.query("DELETE FROM staff WHERE id = $1", [id]);
}

/**
 * Change your own password. Needs the current one, so a borrowed, unlocked
 * screen is not enough. Returns the new hash for re-issuing the session cookie.
 */
export async function changeOwnPassword(
  db: Db,
  id: number,
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const me = await getStaff(db, id);
  if (!verifyPassword(currentPassword, me.password_hash))
    throw new UserAdminError("Your current password is not correct", 403);
  validatePassword(newPassword);
  if (newPassword === currentPassword)
    throw new UserAdminError("Choose a password you are not already using");
  const hash = hashPassword(newPassword);
  await db.query("UPDATE staff SET password_hash = $1 WHERE id = $2", [hash, id]);
  return hash;
}

/* ------------------------------------------------------------------ customers */

async function getCustomer(db: Db, id: number) {
  const row = Number.isInteger(id)
    ? await db.maybeOne<{ id: number; email: string; active: boolean }>(
        "SELECT id, email, active FROM customers WHERE id = $1",
        [id],
      )
    : null;
  if (!row) throw new UserAdminError("Customer not found", 404);
  return row;
}

/** Give a customer a new password (also turns a guest row into a real login). */
export async function resetCustomerPassword(
  db: Db,
  id: number,
  password: string,
  actorName = "staff",
): Promise<void> {
  await getCustomer(db, id);
  validatePassword(password);
  await db.query(
    "UPDATE customers SET password_hash = $1, guest = FALSE, updated_at = now() WHERE id = $2",
    [hashPassword(password), id],
  );
  await db.query(
    "INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, 'password_reset', $2)",
    [id, `Password reset by ${actorName}`],
  );
}

export async function setCustomerActive(
  db: Db,
  id: number,
  active: boolean,
  actorName = "staff",
): Promise<void> {
  await getCustomer(db, id);
  await db.query(
    "UPDATE customers SET active = $1, updated_at = now() WHERE id = $2",
    [active, id],
  );
  await db.query(
    "INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, $2, $3)",
    [
      id,
      active ? "account_enabled" : "account_disabled",
      `${active ? "Enabled" : "Disabled"} by ${actorName}`,
    ],
  );
}

/* ------------------------------------------------------------ demo credentials */

/** Whether the sign-in page may still advertise the demo logins. */
export async function demoLoginsEnabled(db: Db): Promise<boolean> {
  const row = await db.maybeOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [DEMO_LOGINS_SETTING],
  );
  // Absent means "never switched off": the seed creates demo logins.
  return (row?.value ?? "1") === "1";
}

export type DemoStatus = {
  enabled: boolean;
  /** Staff accounts whose password is still the published demo password. */
  staffIds: number[];
  /** Demo customer accounts still present. */
  customers: number;
};

export async function demoStatus(db: Db): Promise<DemoStatus> {
  const staff = await db.query<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM staff",
  );
  const customers = await db.maybeOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM customers WHERE lower(email) = ANY($1::text[])",
    [DEMO_CUSTOMER_EMAILS],
  );
  return {
    enabled: await demoLoginsEnabled(db),
    staffIds: staff
      .filter((row) => verifyPassword(DEMO_PASSWORD, row.password_hash))
      .map((row) => row.id),
    customers: Number(customers?.c ?? 0),
  };
}

export type GoLiveResult = {
  disabledStaff: number;
  removedCustomers: number;
  /** Set when the caller's own password changed — re-issue their cookie. */
  passwordHash: string | null;
};

/**
 * Retire every demo credential in one step:
 *  - the administrator running it must stop using the demo password,
 *  - every other staff account still on the demo password is disabled (kept,
 *    so it can be given a real password and re-enabled),
 *  - the demo customer accounts are removed (their demo orders are kept),
 *  - the sign-in page stops listing demo logins.
 */
export async function goLive(
  db: Db,
  actor: Actor,
  newPassword?: string,
): Promise<GoLiveResult> {
  if (actor.role !== "admin")
    throw new UserAdminError("Only an administrator can do this", 403);
  const me = await getStaff(db, actor.id);
  const onDemo = verifyPassword(DEMO_PASSWORD, me.password_hash);
  if (onDemo && !newPassword)
    throw new UserAdminError(
      "You are signed in with the demo password. Enter a new password for your own account first.",
    );
  if (newPassword) validatePassword(newPassword);
  const myHash = newPassword ? hashPassword(newPassword) : null;

  const others = await db.query<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM staff WHERE id <> $1 AND active = TRUE",
    [actor.id],
  );
  const toDisable = others
    .filter((row) => verifyPassword(DEMO_PASSWORD, row.password_hash))
    .map((row) => row.id);

  return db.transaction(async (tx) => {
    if (myHash)
      await tx.query("UPDATE staff SET password_hash = $1 WHERE id = $2", [
        myHash,
        actor.id,
      ]);
    if (toDisable.length > 0)
      await tx.query(
        "UPDATE staff SET active = FALSE WHERE id = ANY($1::int[])",
        [toDisable],
      );
    await tx.query(
      `UPDATE orders SET customer_id = NULL WHERE customer_id IN
         (SELECT id FROM customers WHERE lower(email) = ANY($1::text[]))`,
      [DEMO_CUSTOMER_EMAILS],
    );
    const removed = await tx.query<{ id: number }>(
      "DELETE FROM customers WHERE lower(email) = ANY($1::text[]) RETURNING id",
      [DEMO_CUSTOMER_EMAILS],
    );
    await tx.query(
      "INSERT INTO settings (key, value) VALUES ($1, '0') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [DEMO_LOGINS_SETTING],
    );
    return {
      disabledStaff: toDisable.length,
      removedCustomers: removed.length,
      passwordHash: myHash,
    };
  });
}
