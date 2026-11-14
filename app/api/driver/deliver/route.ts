import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyDriverToken } from "@/lib/drivers";
import {
  completeOrder,
  getOrderById,
  getLatestJob,
  OrderError,
} from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Driver confirms a successful hand-over; commission is posted exactly once. */
export async function POST(request: Request) {
  let body: { token?: string; jobId?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const identity = await verifyDriverToken(body.token ?? "");
  if (!identity)
    return NextResponse.json({ error: "Driver link expired" }, { status: 401 });
  const db = await getDb();
  const job = await db.maybeOne<{
    id: number;
    order_id: number;
    driver_id: number | null;
    status: string;
  }>("SELECT * FROM delivery_jobs WHERE id = $1", [Number(body.jobId)]);
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.driver_id !== identity.driverId)
    return NextResponse.json({ error: "This job is not yours" }, { status: 403 });
  if (job.status === "delivered")
    return NextResponse.json({ ok: true, alreadyDelivered: true });

  await db.query(
    "UPDATE delivery_jobs SET status = 'delivered', completed_at = now() WHERE id = $1",
    [job.id],
  );
  const order = await getOrderById(db, job.order_id);
  if (order && order.status !== "completed") {
    try {
      await completeOrder(db, order.id, "driver-app", "Delivered — enjoy your meal");
    } catch (error) {
      if (!(error instanceof OrderError)) throw error;
    }
  }
  const refreshed = await getLatestJob(db, job.order_id);
  return NextResponse.json({
    ok: true,
    driverFeeCents: refreshed?.driver_fee_cents ?? 0,
    settled: Boolean(refreshed?.driver_settled_at),
  });
}
