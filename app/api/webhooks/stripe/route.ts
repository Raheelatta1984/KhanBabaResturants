import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { addEvent, getOrderByCode } from "@/lib/orders";
import { verifyStripeSignature } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Stripe Checkout completion webhook. */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret =
    process.env.STRIPE_WEBHOOK_SECRET ||
    (await getSetting("stripe_webhook_secret"));
  const signature = request.headers.get("stripe-signature");

  if (secret && !verifyStripeSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: {
    type?: string;
    data?: {
      object?: {
        client_reference_id?: string;
        id?: string;
        payment_status?: string;
        amount_total?: number;
      };
    };
  };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const session = event.data?.object;
  const code = session?.client_reference_id;
  if (!code)
    return NextResponse.json(
      { error: "Missing order reference" },
      { status: 400 },
    );

  const db = await getDb();
  const order = await getOrderByCode(db, code);
  if (!order) return NextResponse.json({ ok: true, ignored: "unknown order" });

  if (order.payment_status !== "paid") {
    await db.query(
      "UPDATE orders SET payment_status = 'paid', payment_ref = $1, updated_at = now() WHERE id = $2",
      [session?.id ?? "stripe", order.id],
    );
    await db.query(
      `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, raw, paid_at)
       VALUES ($1, 'stripe', $2, $3, 'paid', 'card', $4, now())`,
      [
        order.id,
        session?.id ?? "stripe",
        order.total_cents,
        JSON.stringify(session ?? {}),
      ],
    );
    await addEvent(
      db,
      order.id,
      "payment",
      "Payment received via Stripe",
      "stripe",
      8,
    );
  }

  return NextResponse.json({ ok: true });
}
