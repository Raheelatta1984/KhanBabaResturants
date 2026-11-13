import { NextResponse } from "next/server";
import { clearCustomerCookie } from "@/lib/auth/customer";

export const dynamic = "force-dynamic";

/** POST /api/customer/logout — clear the signed cookie. */
export async function POST() {
  await clearCustomerCookie();
  return NextResponse.json({ ok: true });
}
