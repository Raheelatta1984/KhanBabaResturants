import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrderItems, type OrderRow } from "@/lib/orders";
import { isPaymentOption, startPayment } from "@/lib/payments";
import { publicBaseUrl } from "@/lib/url";
import { afterPaymentCleared, markOrderPaidViaLink } from "@/lib/dine-in";

export const dynamic = "force-dynamic";

/**
 * The secure payment link the counter sends over WhatsApp.
 *
 * The token is 24 random bytes; knowing it is the only way to reach the order,
 * so the URL can be texted or reopened later without exposing the customer's
 * history. Card data never reaches this route — Stripe (or PayPal) hosts the
 * payment. With no provider credentials the sandbox gateway is used and clearly
 * labelled on the page, exactly like checkout.
 */
async function orderForToken(token: string): Promise<OrderRow | null> {
  const db = await getDb();
  return db.maybeOne<OrderRow>("SELECT * FROM orders WHERE payment_link_token = $1", [token]);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const order = await orderForToken(token);
  if (!order) return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  const db = await getDb();
  return NextResponse.json({
    order: {
      code: order.code,
      customerName: order.customer_name,
      totalCents: order.total_cents,
      paymentStatus: order.payment_status,
      channel: order.channel,
      parked: order.parked,
      createdAt: order.created_at,
    },
    items: await getOrderItems(db, order.id),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const db = await getDb();
  const order = await orderForToken(token);
  if (!order) return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  if (order.payment_status === "paid") {
    return NextResponse.json({ ok: true, alreadyPaid: true, code: order.code });
  }
  if (order.status === "cancelled") {
    return NextResponse.json({ error: "This order was cancelled" }, { status: 400 });
  }

  let body: { option?: string } = {};
  try {
    body = (await request.json()) as { option?: string };
  } catch {
    body = {};
  }
  const option = body.option && isPaymentOption(body.option) ? body.option : "card_visa";
  const baseUrl = publicBaseUrl(request);

  const payment = await startPayment({
    orderCode: order.code,
    amountCents: order.total_cents,
    description: `Khan Baba order ${order.code}`,
    customerEmail: order.email ?? undefined,
    option,
  });

  if (payment.status === "paid") {
    await markOrderPaidViaLink(db, order.id, {
      provider: payment.provider,
      intentId: payment.intentId,
      option,
      sandbox: payment.provider === "simulated",
    });
    await afterPaymentCleared(db, order.id, baseUrl);
    return NextResponse.json({
      ok: true,
      paid: true,
      sandbox: payment.provider === "simulated",
      code: order.code,
      redirectTo: `/order/${order.code}?paid=1`,
    });
  }

  if (payment.status === "redirect" && payment.redirectUrl) {
    await db.query(
      `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, raw)
       VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
      [
        order.id,
        payment.provider,
        payment.intentId,
        order.total_cents,
        option,
        JSON.stringify(payment.raw ?? {}),
      ],
    );
    return NextResponse.json({ ok: true, redirectUrl: payment.redirectUrl });
  }

  return NextResponse.json(
    { error: "The payment could not be started. Please pay at the counter." },
    { status: 400 },
  );
}
