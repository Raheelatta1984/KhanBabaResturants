import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getFullOrder, publicOrderPayload, syncDelivery } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Public order status used by the live tracking screen. */
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const db = getDb();
  let payload = publicOrderPayload(db, code);
  if (!payload) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const full = getFullOrder(db, code);
  if (full && full.order.channel === "delivery" && full.order.status === "out_for_delivery") {
    await syncDelivery(db, full.order.id);
    payload = publicOrderPayload(db, code) ?? payload;
  }

  return NextResponse.json(payload);
}
