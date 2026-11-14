import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPaypalWebhook } from "@/lib/payments";
import { markExternalPaymentPaid } from "@/lib/payments/external";

export const dynamic = "force-dynamic";

/**
 * PayPal `PAYMENT.CAPTURE.COMPLETED` / `CHECKOUT.ORDER.COMPLETED` webhook.
 * The redirect-based capture route is the primary path; this is the reliable
 * backup when a browser closes before returning to the site.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!(await verifyPaypalWebhook(request.headers, raw)))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: {
    event_type?: string;
    resource?: {
      id?: string;
      status?: string;
      custom_id?: string;
      invoice_id?: string;
      amount?: { value?: string };
      supplementary_data?: { related_ids?: { order_id?: string } };
    };
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const type = payload.event_type ?? "";
  if (!type.startsWith("PAYMENT.CAPTURE") && !type.startsWith("CHECKOUT.ORDER"))
    return NextResponse.json({ ok: true, ignored: type });

  const resource = payload.resource ?? {};
  const orderCode = resource.custom_id ?? resource.invoice_id ?? null;
  const db = await getDb();
  if (!orderCode) {
    // Try to find the order by the PayPal order id we stored on creation.
    const row = await db.maybeOne<{ code: string; total_cents: number }>(
      `SELECT o.code, o.total_cents FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE p.provider = 'paypal' AND p.intent_id = $1`,
      [resource.id ?? ""],
    );
    if (!row) return NextResponse.json({ ok: true, ignored: "unmatched" });
    await markExternalPaymentPaid(db, row.code, {
      provider: "paypal",
      intentId: String(resource.id ?? ""),
      amountCents: row.total_cents,
      method: "paypal",
      raw: resource,
    });
    return NextResponse.json({ ok: true });
  }
  await markExternalPaymentPaid(db, orderCode, {
    provider: "paypal",
    intentId: String(resource.id ?? ""),
    amountCents: Math.round(Number(resource.amount?.value ?? 0) * 100),
    method: "paypal",
    raw: resource,
  });
  return NextResponse.json({ ok: true });
}
