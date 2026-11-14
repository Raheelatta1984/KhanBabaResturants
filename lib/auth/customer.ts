import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import { hashPassword, verifyPassword } from "./password";
import { signToken, verifyToken } from "./token";

/**
 * Customer accounts.
 *
 * The portal is deliberately *soft* login: browsing, table ordering and the
 * tracking link all work without an account. An account is what turns the
 * anonymous order flow into "my orders, my usual, one tap to track", and it is
 * what the counter can look up when someone rings about an order.
 *
 * Passwords reuse the staff scrypt hasher, sessions reuse the same signed-cookie
 * primitive with a different `aud` claim, and every query here is scoped by
 * customer id — never by anything the browser sends.
 */

export const CUSTOMER_COOKIE = "kb_customer";
const AUDIENCE = "customer";
/** Long-lived on purpose: this is a food-ordering site, not a bank. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Links emailed/texted to a guest so they can claim the order later. */
export const CLAIM_TTL_SECONDS = 60 * 60 * 24 * 14;

export type CustomerRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string | null;
  address: string | null;
  suburb: string | null;
  postcode: string | null;
  marketing_opt_in: boolean;
  guest: boolean;
  active: boolean;
  last_order_at: string | null;
  created_at: string;
};

export type CustomerSession = {
  id: number;
  name: string;
  email: string;
  guest: boolean;
  exp: number;
};

export class CustomerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function normaliseEmail(email: string | undefined | null): string {
  return (email ?? "").trim().toLowerCase();
}

export async function getCustomerByEmail(
  db: Db,
  email: string,
): Promise<CustomerRow | null> {
  return db.maybeOne<CustomerRow>(
    "SELECT * FROM customers WHERE lower(email) = $1",
    [normaliseEmail(email)],
  );
}

export async function getCustomerById(
  db: Db,
  id: number,
): Promise<CustomerRow | null> {
  return db.maybeOne<CustomerRow>("SELECT * FROM customers WHERE id = $1", [id]);
}

/** The public shape — never includes the password hash. */
export function publicCustomer(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    suburb: row.suburb,
    postcode: row.postcode,
    marketingOptIn: Boolean(row.marketing_opt_in),
    guest: Boolean(row.guest),
    lastOrderAt: row.last_order_at,
    createdAt: row.created_at,
  };
}

export type PublicCustomer = ReturnType<typeof publicCustomer>;

export async function createCustomerSessionToken(
  customer: Pick<CustomerRow, "id" | "name" | "email" | "guest" | "password_hash">,
): Promise<string> {
  return signToken(
    {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      guest: !customer.password_hash,
      aud: AUDIENCE,
    },
    SESSION_TTL_SECONDS,
  );
}

export async function verifyCustomerToken(
  token: string | undefined | null,
): Promise<CustomerSession | null> {
  const payload = await verifyToken<CustomerSession & { aud?: string }>(token);
  if (!payload || payload.aud !== AUDIENCE) return null;
  return payload;
}

export async function setCustomerCookie(token: string) {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.set({
    name: CUSTOMER_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearCustomerCookie() {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.set({ name: CUSTOMER_COOKIE, value: "", path: "/", maxAge: 0 });
}

/**
 * Who is signed in, if anyone. Reads the signed cookie only — no query — so the
 * public layout can render the header without waking the database.
 */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return verifyCustomerToken(jar.get(CUSTOMER_COOKIE)?.value);
}

/** The signed-in customer's full row (for the account page and checkout prefill). */
export async function getCurrentCustomer(db: Db): Promise<CustomerRow | null> {
  const session = await getCustomerSession();
  if (!session) return null;
  const customer = await getCustomerById(db, session.id);
  // A login the restaurant has disabled is treated as signed out.
  return customer && customer.active ? customer : null;
}

/* ------------------------------------------------------------------ sign up */

export type SignupInput = {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  marketingOptIn?: boolean;
};

export async function signupCustomer(
  db: Db,
  input: SignupInput,
): Promise<{ customer: CustomerRow; token: string }> {
  const name = (input.name ?? "").trim().slice(0, 80);
  const email = normaliseEmail(input.email);
  const password = input.password ?? "";

  if (name.length < 2) throw new CustomerError("Tell us your name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new CustomerError("That email address does not look right");
  if (password.length < 8)
    throw new CustomerError("Use at least 8 characters for your password");

  const existing = await getCustomerByEmail(db, email);
  if (existing?.password_hash)
    throw new CustomerError(
      "That email already has an account — sign in instead",
      409,
    );

  // Someone who ordered as a guest is upgraded in place, keeping their history.
  if (existing) {
    await db.query(
      `UPDATE customers SET name = $1, password_hash = $2, phone = COALESCE($3, phone),
        marketing_opt_in = $4, guest = FALSE, active = TRUE, updated_at = now() WHERE id = $5`,
      [
        name,
        hashPassword(password),
        input.phone?.trim().slice(0, 30) || null,
        Boolean(input.marketingOptIn),
        existing.id,
      ],
    );
    const customer = (await getCustomerById(db, existing.id))!;
    await claimOrdersForEmail(db, customer);
    return { customer, token: await createCustomerSessionToken(customer) };
  }

  const id = await db.insert(
    `INSERT INTO customers (name, email, phone, password_hash, marketing_opt_in, guest)
     VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
    [
      name,
      email,
      input.phone?.trim().slice(0, 30) || null,
      hashPassword(password),
      Boolean(input.marketingOptIn),
    ],
  );
  const customer = (await getCustomerById(db, id))!;
  await claimOrdersForEmail(db, customer);
  return { customer, token: await createCustomerSessionToken(customer) };
}

export async function signinCustomer(
  db: Db,
  input: { email?: string; password?: string },
): Promise<{ customer: CustomerRow; token: string }> {
  const email = normaliseEmail(input.email);
  const password = input.password ?? "";
  if (!email || !password)
    throw new CustomerError("Enter your email and password", 400);

  const customer = await getCustomerByEmail(db, email);
  if (
    !customer ||
    !customer.active ||
    !customer.password_hash ||
    !verifyPassword(password, customer.password_hash)
  ) {
    throw new CustomerError("Those details do not match an account", 401);
  }
  return { customer, token: await createCustomerSessionToken(customer) };
}

/**
 * Turn a guest account (created by a claim link or a guest checkout) into a real
 * login by setting a password. The email is the identity, so no extra proof is
 * needed beyond being signed in as that account.
 */
export async function setCustomerPassword(
  db: Db,
  customerId: number,
  password: string,
): Promise<CustomerRow> {
  if (password.length < 8)
    throw new CustomerError("Use at least 8 characters for your password");
  await db.query(
    "UPDATE customers SET password_hash = $1, guest = FALSE, updated_at = now() WHERE id = $2",
    [hashPassword(password), customerId],
  );
  await db.query(
    "INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, 'password_set', 'Password set')",
    [customerId],
  );
  return (await getCustomerById(db, customerId))!;
}

/* ------------------------------------------------------- guest + claiming */

/**
 * A guest row keyed by email, created or reused at checkout so a first-time
 * order still has somewhere to attach history and an address book.
 * Email is optional at the counter, so guests without one are not stored.
 */
export async function upsertGuestCustomer(
  db: Db,
  input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    suburb?: string | null;
    postcode?: string | null;
  },
): Promise<CustomerRow | null> {
  const email = normaliseEmail(input.email);
  if (!email) return null;

  const existing = await getCustomerByEmail(db, email);
  if (existing) {
    await db.query(
      `UPDATE customers SET
        phone = COALESCE(NULLIF(phone, ''), $2),
        address = COALESCE(NULLIF(address, ''), $3),
        suburb = COALESCE(NULLIF(suburb, ''), $4),
        postcode = COALESCE(NULLIF(postcode, ''), $5),
        last_order_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        existing.id,
        input.phone?.trim().slice(0, 30) || null,
        input.address?.trim().slice(0, 250) || null,
        input.suburb?.trim().slice(0, 80) || null,
        input.postcode?.trim().slice(0, 12) || null,
      ],
    );
    return getCustomerById(db, existing.id);
  }

  const id = await db.insert(
    `INSERT INTO customers (name, email, phone, address, suburb, postcode, guest, last_order_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, now()) RETURNING id`,
    [
      input.name.trim().slice(0, 80),
      email,
      input.phone?.trim().slice(0, 30) || null,
      input.address?.trim().slice(0, 250) || null,
      input.suburb?.trim().slice(0, 80) || null,
      input.postcode?.trim().slice(0, 12) || null,
    ],
  );
  return getCustomerById(db, id);
}

/**
 * Attach every order placed with this email to the account that just verified
 * the address — either by signing up or by proving ownership with a claim link.
 * This is why a guest order does not disappear when the customer registers.
 */
export async function claimOrdersForEmail(
  db: Db,
  customer: CustomerRow,
): Promise<number> {
  // Count first: some Postgres drivers neither report nor count an UPDATE's
  // affected rows, and the number is user-facing ("3 earlier orders added").
  const pending = await db.one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM orders
     WHERE customer_id IS NULL AND lower(email) = $1`,
    [normaliseEmail(customer.email)],
  );
  const claimed = Number(pending.c);
  if (claimed === 0) return 0;

  await db.query(
    `UPDATE orders SET customer_id = $1, updated_at = now()
     WHERE customer_id IS NULL AND lower(email) = $2`,
    [customer.id, normaliseEmail(customer.email)],
  );
  if (claimed > 0) {
    await db.query(
      `INSERT INTO customer_activity (customer_id, kind, detail)
       VALUES ($1, 'orders_claimed', $2)`,
      [customer.id, `${claimed} earlier order(s) added to this account`],
    );
  }
  return claimed;
}

/* ------------------------------------------------------------ claim links */

/** A one-time link that lets a guest prove they own an order (texted/emailed). */
export async function createClaimToken(
  db: Db,
  order: { id: number; code: string; email: string | null },
): Promise<string | null> {
  if (!order.email) return null;
  const raw = randomBytes(24).toString("base64url");
  await db.query(
    `INSERT INTO order_claims (order_id, token_hash, email) VALUES ($1, $2, $3)`,
    [order.id, await hashClaimToken(raw), normaliseEmail(order.email)],
  );
  return raw;
}

async function hashClaimToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Redeem a claim link: mark it used, sign the visitor in as the order's guest
 * customer and attach the order. The token is single-use, so a forwarded link
 * cannot be replayed.
 */
export async function redeemClaimToken(
  db: Db,
  raw: string,
): Promise<{ customer: CustomerRow; token: string; orderCode: string }> {
  const hash = await hashClaimToken((raw ?? "").trim());
  const claim = await db.maybeOne<{
    id: number;
    order_id: number;
    email: string;
    used_at: string | null;
    created_at: string;
  }>("SELECT * FROM order_claims WHERE token_hash = $1", [hash]);

  if (!claim) throw new CustomerError("That link is not valid", 404);
  if (claim.used_at)
    throw new CustomerError("That link has already been used — sign in instead", 410);
  const created = new Date(claim.created_at).getTime();
  if (Number.isFinite(created) && Date.now() - created > CLAIM_TTL_SECONDS * 1000)
    throw new CustomerError("That link has expired — sign in to see your orders", 410);

  const order = await db.maybeOne<{ code: string; customer_name: string; phone: string | null }>(
    "SELECT code, customer_name, phone FROM orders WHERE id = $1",
    [claim.order_id],
  );

  let customer = await getCustomerByEmail(db, claim.email);
  if (!customer) {
    const id = await db.insert(
      `INSERT INTO customers (name, email, phone, guest, last_order_at)
       VALUES ($1, $2, $3, TRUE, now()) RETURNING id`,
      [order?.customer_name ?? "Guest", normaliseEmail(claim.email), order?.phone ?? null],
    );
    customer = (await getCustomerById(db, id))!;
  }

  await db.query("UPDATE order_claims SET used_at = now() WHERE id = $1", [claim.id]);
  await db.query(
    "UPDATE orders SET customer_id = $1, updated_at = now() WHERE id = $2",
    [customer.id, claim.order_id],
  );

  return {
    customer,
    token: await createCustomerSessionToken(customer),
    orderCode: order?.code ?? "",
  };
}

/* --------------------------------------------------------- saved details */

export async function updateCustomerProfile(
  db: Db,
  customerId: number,
  input: {
    name?: string;
    phone?: string;
    address?: string;
    suburb?: string;
    postcode?: string;
    marketingOptIn?: boolean;
  },
) {
  const name = (input.name ?? "").trim();
  if (name.length < 2) throw new CustomerError("Tell us your name");
  await db.query(
    `UPDATE customers SET name = $1, phone = $2, address = $3, suburb = $4, postcode = $5,
      marketing_opt_in = $6, updated_at = now() WHERE id = $7`,
    [
      name.slice(0, 80),
      input.phone?.trim().slice(0, 30) || null,
      input.address?.trim().slice(0, 250) || null,
      input.suburb?.trim().slice(0, 80) || null,
      input.postcode?.trim().slice(0, 12) || null,
      Boolean(input.marketingOptIn),
      customerId,
    ],
  );
  await db.query(
    `INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, 'profile_updated', 'Saved delivery details')`,
    [customerId],
  );
  return (await getCustomerById(db, customerId))!;
}
