import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  CustomerError,
  getCustomerById,
  getCustomerSession,
  publicCustomer,
  setCustomerPassword,
  updateCustomerProfile,
} from "@/lib/auth/customer";

export const dynamic = "force-dynamic";

/** POST /api/customer/profile — save the delivery details used to prefill checkout. */
export async function POST(request: Request) {
  const session = await getCustomerSession();
  if (!session)
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  let body: {
    name?: string;
    phone?: string;
    address?: string;
    suburb?: string;
    postcode?: string;
    marketingOptIn?: boolean;
    /** Only for a guest account: turns it into a real login. */
    newPassword?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  try {
    await updateCustomerProfile(db, session.id, body);
    if (body.newPassword) await setCustomerPassword(db, session.id, body.newPassword);
    const customer = await getCustomerById(db, session.id);
    return NextResponse.json({ ok: true, customer: customer ? publicCustomer(customer) : null });
  } catch (error) {
    if (error instanceof CustomerError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("profile update failed", error);
    return NextResponse.json(
      { error: "Could not save your details" },
      { status: 500 },
    );
  }
}
