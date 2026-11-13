import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  CustomerError,
  signinCustomer,
  signupCustomer,
} from "@/lib/auth/customer";
import { setCustomerCookie } from "@/lib/auth/customer";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 8;
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

type Body = {
  mode?: "signin" | "signup";
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  marketingOptIn?: boolean;
};

/** POST /api/customer/auth — one endpoint for sign in and sign up. */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const mode = body.mode === "signin" ? "signin" : "signup";
  const email = (body.email ?? "").trim().toLowerCase();
  const key = `customer:${email || "unknown"}`;

  if (mode === "signin" && throttled(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const db = await getDb();
  try {
    const result =
      mode === "signin"
        ? await signinCustomer(db, { email: body.email, password: body.password })
        : await signupCustomer(db, {
            name: body.name,
            email: body.email,
            password: body.password,
            phone: body.phone,
            marketingOptIn: body.marketingOptIn,
          });

    await setCustomerCookie(result.token);
    await db.query(
      "INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, $2, $3)",
      [
        result.customer.id,
        mode,
        mode === "signin" ? "Signed in" : "Account created",
      ],
    );
    attempts.delete(key);

    return NextResponse.json({
      ok: true,
      customer: {
        name: result.customer.name,
        email: result.customer.email,
        guest: !result.customer.password_hash,
      },
      redirectTo: "/account",
    });
  } catch (error) {
    if (error instanceof CustomerError) {
      if (mode === "signin") recordFailure(key);
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("customer auth failed", error);
    return NextResponse.json(
      { error: "Something went wrong — please try again." },
      { status: 500 },
    );
  }
}
