import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { completeOrder, getOrderById } from "@/lib/orders";

export const dynamic = "force-dynamic";

const MAP: Record<string, string> = {
  accepted: "accepted",
  pickup: "pickup",
  pickup_complete: "pickup",
  dropoff: "dropoff",
  dropoff_complete: "dropoff",
  delivered: "delivered",
  canceled: "cancelled",
  cancelled: "cancelled",
  returned: "failed",
};

/** Uber Direct delivery status webhook. */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret =
    process.env.UBER_WEBHOOK_SECRET ||
    (await getSetting("uber_webhook_secret"));

  if (secret) {
    const signature =
      request.headers.get("x-uber-signature") ??
      request.headers.get("x-signature") ??
      "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const provided = signature.replace(/^sha256=/, "");
    const valid =
      provided.length === expected.length &&
      (() => {
        try {
          return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
        } catch {
          return false;
        }
      })();
    if (!valid)
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    delivery_id?: string;
    id?: string;
    status?: string;
    courier?: { name?: string; phone_number?: string };
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const deliveryId = payload.delivery_id ?? payload.id;
  const status = String(payload.status ?? "").toLowerCase();
  if (!deliveryId || !status)
    return NextResponse.json(
      { error: "Missing delivery id or status" },
      { status: 400 },
    );

  const db = await getDb();
  const job = await db.maybeOne<{
    id: number;
    order_id: number;
    status: string;
  }>(
    "SELECT * FROM delivery_jobs WHERE provider_delivery_id = $1 ORDER BY id DESC LIMIT 1",
    [deliveryId],
  );
  if (!job) return NextResponse.json({ ok: true, ignored: true });

  const mapped = MAP[status] ?? status;
  await db.query(
    `UPDATE delivery_jobs SET status = $1, external_status = $2, courier_name = COALESCE($3, courier_name),
      courier_phone = COALESCE($4, courier_phone) WHERE id = $5`,
    [
      mapped,
      status,
      payload.courier?.name ?? null,
      payload.courier?.phone_number ?? null,
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
          "uber-webhook",
          "Delivered — enjoy your meal",
        );
    } else if (mapped === "pickup" && order.status === "out_for_delivery") {
      await db.query("UPDATE orders SET progress = 95 WHERE id = $1", [
        order.id,
      ]);
    } else if (mapped === "cancelled" || mapped === "failed") {
      await db.query(
        "UPDATE orders SET status = 'ready', progress = 85, updated_at = now() WHERE id = $1 AND status = 'out_for_delivery'",
        [order.id],
      );
    }
  }

  return NextResponse.json({ ok: true, status: mapped });
}
