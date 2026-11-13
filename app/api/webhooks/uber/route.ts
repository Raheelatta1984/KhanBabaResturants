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
  const secret = process.env.UBER_WEBHOOK_SECRET || getSetting("uber_webhook_secret");

  if (secret) {
    const signature = request.headers.get("x-uber-signature") ?? request.headers.get("x-signature") ?? "";
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
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { delivery_id?: string; id?: string; status?: string; courier?: { name?: string; phone_number?: string } };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const deliveryId = payload.delivery_id ?? payload.id;
  const status = String(payload.status ?? "").toLowerCase();
  if (!deliveryId || !status) return NextResponse.json({ error: "Missing delivery id or status" }, { status: 400 });

  const db = getDb();
  const job = db
    .prepare("SELECT * FROM delivery_jobs WHERE provider_delivery_id = ? ORDER BY id DESC LIMIT 1")
    .get(deliveryId) as { id: number; order_id: number; status: string } | undefined;
  if (!job) return NextResponse.json({ ok: true, ignored: true });

  const mapped = MAP[status] ?? status;
  db.prepare(
    "UPDATE delivery_jobs SET status = ?, external_status = ?, courier_name = COALESCE(?, courier_name), courier_phone = COALESCE(?, courier_phone) WHERE id = ?",
  ).run(mapped, status, payload.courier?.name ?? null, payload.courier?.phone_number ?? null, job.id);

  const order = getOrderById(db, job.order_id);
  if (order) {
    if (mapped === "delivered") {
      db.prepare("UPDATE delivery_jobs SET completed_at = datetime('now') WHERE id = ?").run(job.id);
      if (order.status !== "completed") completeOrder(db, order.id, "uber-webhook", "Delivered — enjoy your meal");
    } else if (mapped === "pickup" && order.status === "out_for_delivery") {
      db.prepare("UPDATE orders SET progress = 95 WHERE id = ?").run(order.id);
    } else if (mapped === "cancelled" || mapped === "failed") {
      db.prepare("UPDATE orders SET status = 'ready', progress = 85, updated_at = datetime('now') WHERE id = ? AND status = 'out_for_delivery'").run(order.id);
    }
  }

  return NextResponse.json({ ok: true, status: mapped });
}
