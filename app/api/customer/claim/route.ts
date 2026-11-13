import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  CustomerError,
  redeemClaimToken,
  setCustomerCookie,
} from "@/lib/auth/customer";

export const dynamic = "force-dynamic";

/**
 * POST /api/customer/claim  { token }
 *
 * Redeems the one-time link a guest was given for their order: it signs them in
 * as the guest customer for that email (no password needed — possession of the
 * link is the proof) and attaches the order to the account.
 */
export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.token)
    return NextResponse.json({ error: "A claim token is required" }, { status: 400 });

  const db = await getDb();
  try {
    const result = await redeemClaimToken(db, body.token);
    await setCustomerCookie(result.token);
    return NextResponse.json({
      ok: true,
      orderCode: result.orderCode,
      customer: {
        name: result.customer.name,
        email: result.customer.email,
        guest: !result.customer.password_hash,
      },
      redirectTo: "/account",
    });
  } catch (error) {
    if (error instanceof CustomerError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("claim failed", error);
    return NextResponse.json(
      { error: "Could not use that link" },
      { status: 500 },
    );
  }
}
