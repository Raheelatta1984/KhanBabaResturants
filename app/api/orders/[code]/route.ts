import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  fullOrderFromRow,
  publicOrderPayload,
  resolveOrderRef,
  syncDelivery,
} from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * Public order status used by the live tracking screen.
 *
 * `ref` is either the order code (`KB-…`) or the token from the shareable
 * tracking link, so the same poller serves `/order/<code>` and `/t/<token>`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const db = await getDb();
  const row = await resolveOrderRef(db, decodeURIComponent(code));
  if (!row)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const full = await fullOrderFromRow(db, row);
  if (
    full.order.channel === "delivery" &&
    full.order.status === "out_for_delivery"
  ) {
    await syncDelivery(db, full.order.id);
  }

  const payload = await publicOrderPayload(db, full.order.code);
  if (!payload)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json(payload);
}
