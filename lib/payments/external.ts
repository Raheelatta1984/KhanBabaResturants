import type { Db } from "../db";
import { addEvent, getOrderByCode } from "../orders";

/**
 * Mark an order paid from an external hosted checkout (PayPal capture or a
 * webhook). Idempotent: a repeated notification never inserts a second payment
 * row. Kept out of `lib/payments.ts` so the payment gateway module stays free
 * of database/order dependencies.
 */
export async function markExternalPaymentPaid(
  db: Db,
  orderCode: string,
  input: {
    provider: "paypal" | "stripe" | "simulated";
    intentId: string;
    amountCents: number;
    method?: string;
    raw?: unknown;
  },
): Promise<{ ok: boolean; reason?: string }> {
  const order = await getOrderByCode(db, orderCode);
  if (!order) return { ok: false, reason: "unknown order" };
  const existing = await db.maybeOne<{ id: number }>(
    "SELECT id FROM payments WHERE provider = $1 AND intent_id = $2",
    [input.provider, input.intentId],
  );
  if (existing) return { ok: true, reason: "already recorded" };

  await db.query(
    `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, raw, paid_at)
     VALUES ($1,$2,$3,$4,'paid',$5,$6,now())`,
    [
      order.id,
      input.provider,
      input.intentId,
      input.amountCents || order.total_cents,
      input.method ?? input.provider,
      JSON.stringify(input.raw ?? {}),
    ],
  );
  if (order.payment_status !== "paid") {
    await db.query(
      "UPDATE orders SET payment_status = 'paid', payment_ref = $1, updated_at = now() WHERE id = $2",
      [input.intentId, order.id],
    );
    await addEvent(
      db,
      order.id,
      "payment",
      `Payment received via ${input.provider === "paypal" ? "PayPal" : "hosted checkout"} (${input.method ?? input.provider})`,
      input.provider,
      8,
    );
  }
  return { ok: true };
}
