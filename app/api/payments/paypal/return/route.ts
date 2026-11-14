import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { capturePaypalOrder } from "@/lib/payments";
import { markExternalPaymentPaid } from "@/lib/payments/external";

export const dynamic = "force-dynamic";

/** PayPal redirects here with `?token=<order id>` after the buyer approves. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const orderCode = url.searchParams.get("order");
  if (!token || !orderCode)
    return NextResponse.json({ error: "Missing PayPal token" }, { status: 400 });

  try {
    const capture = await capturePaypalOrder(token);
    const db = await getDb();
    await markExternalPaymentPaid(db, orderCode, {
      provider: "paypal",
      intentId: capture.captureId,
      amountCents: capture.amountCents,
      method: "paypal",
      raw: capture.raw,
    });
    return NextResponse.redirect(
      new URL(`/order/${encodeURIComponent(orderCode)}?paid=1`, url.origin),
      303,
    );
  } catch (error) {
    console.error("PayPal capture failed", error);
    return NextResponse.redirect(
      new URL(
        `/order/${encodeURIComponent(orderCode)}?cancelled=1`,
        url.origin,
      ),
      303,
    );
  }
}
