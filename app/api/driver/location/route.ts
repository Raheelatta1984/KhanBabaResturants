import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  DriverError,
  getDriver,
  recordDriverPing,
  trackingSnapshot,
  verifyDriverToken,
} from "@/lib/drivers";

export const dynamic = "force-dynamic";

/**
 * GPS breadcrumbs from the driver's phone. The signed portal token is the only
 * credential: no password, no session cookie, and a token from one driver can
 * never post a location for another.
 */
export async function POST(request: Request) {
  let body: {
    token?: string;
    lat?: number;
    lng?: number;
    accuracyM?: number;
    heading?: number;
    speedKmh?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const identity = await verifyDriverToken(body.token ?? "");
  if (!identity)
    return NextResponse.json({ error: "Driver link expired" }, { status: 401 });
  const db = await getDb();
  const driver = await getDriver(db, identity.driverId);
  if (!driver || driver.status !== "approved")
    return NextResponse.json({ error: "Driver not active" }, { status: 403 });
  try {
    const result = await recordDriverPing(db, driver.id, {
      lat: Number(body.lat),
      lng: Number(body.lng),
      accuracyM: body.accuracyM,
      heading: body.heading,
      speedKmh: body.speedKmh,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof DriverError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Latest map snapshot for the driver's own active job (their portal polls it). */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const identity = await verifyDriverToken(token);
  if (!identity)
    return NextResponse.json({ error: "Driver link expired" }, { status: 401 });
  const db = await getDb();
  const order = await db.maybeOne<{
    id: number;
    code: string;
    address: string | null;
    suburb: string | null;
    postcode: string | null;
    delivery_lat: number | null;
    delivery_lng: number | null;
    dispatched_at: string | null;
    status: string;
  }>(
    `SELECT o.* FROM orders o JOIN delivery_jobs j ON j.order_id = o.id
      WHERE j.driver_id = $1 AND j.status IN ('requested','accepted','pickup','dropoff')
      ORDER BY j.id DESC LIMIT 1`,
    [identity.driverId],
  );
  if (!order) return NextResponse.json({ tracking: null });
  const tracking = await trackingSnapshot(db, {
    id: order.id,
    code: order.code,
    address: order.address,
    suburb: order.suburb,
    postcode: order.postcode,
    delivery_lat: order.delivery_lat,
    delivery_lng: order.delivery_lng,
    dispatched_at: order.dispatched_at,
    status: order.status,
  });
  return NextResponse.json({ tracking });
}
