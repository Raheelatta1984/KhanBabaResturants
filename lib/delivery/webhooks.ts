import type { Db } from "../db";
import {
  completeOrder,
  getOrderById,
  mapProviderStatus,
} from "../orders";

/**
 * Shared courier webhook handler for Uber Direct, DoorDash Drive and our own
 * fleet. Keeping one mapping here means a new partner only needs to translate
 * its payload into {deliveryId, status} — the order lifecycle, driver
 * commission settlement and ATO trip logging all fire from the same path.
 */
export async function applyCourierStatus(
  db: Db,
  input: {
    provider?: string;
    deliveryId: string;
    status: string;
    courierName?: string | null;
    courierPhone?: string | null;
    trackingUrl?: string | null;
    etaMinutes?: number | null;
    actor?: string;
  },
): Promise<{ found: boolean; mapped: string; orderId: number | null }> {
  const job = await db.maybeOne<{
    id: number;
    order_id: number;
    status: string;
  }>(
    `SELECT * FROM delivery_jobs WHERE provider_delivery_id = $1
      ${input.provider ? "AND provider = $2" : ""}
      ORDER BY id DESC LIMIT 1`,
    input.provider ? [input.deliveryId, input.provider] : [input.deliveryId],
  );
  if (!job)
    return { found: false, mapped: mapProviderStatus(input.status), orderId: null };

  const mapped = mapProviderStatus(input.status);
  await db.query(
    `UPDATE delivery_jobs SET status = $1, external_status = $2,
      courier_name = COALESCE($3, courier_name), courier_phone = COALESCE($4, courier_phone),
      tracking_url = COALESCE($5, tracking_url), eta_minutes = COALESCE($6, eta_minutes)
     WHERE id = $7`,
    [
      mapped,
      input.status,
      input.courierName ?? null,
      input.courierPhone ?? null,
      input.trackingUrl ?? null,
      input.etaMinutes ?? null,
      job.id,
    ],
  );

  const order = await getOrderById(db, job.order_id);
  if (order) {
    if (mapped === "delivered") {
      await db.query(
        "UPDATE delivery_jobs SET completed_at = now() WHERE id = $1",
        [job.id],
      );
      if (order.status !== "completed")
        await completeOrder(
          db,
          order.id,
          input.actor ?? "courier-webhook",
          "Delivered — enjoy your meal",
        );
    } else if (mapped === "pickup" && order.status === "out_for_delivery") {
      await db.query("UPDATE orders SET progress = 95 WHERE id = $1", [
        order.id,
      ]);
    } else if (
      (mapped === "cancelled" || mapped === "failed") &&
      order.status === "out_for_delivery"
    ) {
      await db.query(
        "UPDATE orders SET status = 'ready', progress = 85, updated_at = now() WHERE id = $1",
        [order.id],
      );
    }
  }
  return { found: true, mapped, orderId: job.order_id };
}
