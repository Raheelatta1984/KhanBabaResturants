import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { listOrders } from "@/lib/orders";
import { trackingSnapshot } from "@/lib/drivers";

export const dynamic = "force-dynamic";

/** Live positions for every delivery currently on the road (staff map). */
export async function GET() {
  const session = await getApiSession(["admin", "manager", "delivery"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const db = await getDb();
  const orders = await listOrders(db, {
    status: ["out_for_delivery"],
    channel: "delivery",
    limit: 40,
  });
  const positions = await Promise.all(
    orders.map(async (order) => ({
      code: order.code,
      customerName: order.customer_name,
      address: order.address,
      status: order.status,
      etaMinutes: null as number | null,
      tracking: await trackingSnapshot(db, {
        id: order.id,
        code: order.code,
        address: order.address,
        suburb: order.suburb,
        postcode: order.postcode,
        delivery_lat: order.delivery_lat,
        delivery_lng: order.delivery_lng,
        dispatched_at: order.dispatched_at,
        status: order.status,
      }),
    })),
  );
  for (const position of positions)
    position.etaMinutes = position.tracking.etaMinutes;
  return NextResponse.json({ positions, count: positions.length });
}
