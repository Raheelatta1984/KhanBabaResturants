/**
 * Driver Order Acceptance & Live Tracking API
 *
 * - Accept order with sound notification and summary info
 * - Live tracking updates (.05 km configurable interval)
 * - Unsuccessful delivery tracking back to restaurant
 * - Customer-facing live tracking pin-point updates (lat/lng)
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getDriverCredential,
  getTrackingIntervalSetting,
} from "@/lib/driver-credentials";
import {
  recordDriverPing,
  settleDriverJob,
  trackingSnapshot,
  DriverError,
} from "@/lib/drivers";
import { money } from "@/lib/money";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    const body = await request.json();

    // /api/driver/order/accept
    if (path === "/api/driver/order/accept") {
      const { credentialId, jobId } = body;
      const db = await getDb();
      const credential = await getDriverCredential(db, credentialId);
      if (!credential) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 }
        );
      }

      // Update job status to accepted
      await db.query(
        `UPDATE delivery_jobs SET status = 'accepted', accepted_at = now() WHERE id = $1 AND status = 'requested'`,
        [jobId],
      );

      // Get order summary info
      const orderRow = await db.maybeOne<
        {
          id: number;
          code: string;
          address: string | null;
          suburb: string | null;
          postcode: string | null;
          delivery_lat: number | null;
          delivery_lng: number | null;
          customer_fee_cents: number;
        }
      >(
        `SELECT o.* FROM orders o JOIN delivery_jobs j ON o.id = j.order_id WHERE j.id = $1`,
        [jobId],
      );

      if (!orderRow) {
        return NextResponse.json(
          { error: "Order not found" },
          { status: 404 }
        );
      }

      const tracking = await trackingSnapshot(db, {
        id: orderRow.id,
        code: orderRow.code,
        address: orderRow.address,
        suburb: orderRow.suburb,
        postcode: orderRow.postcode,
        delivery_lat: orderRow.delivery_lat,
        delivery_lng: orderRow.delivery_lng,
        dispatched_at: new Date().toISOString(),
        status: "accepted",
      });

      // Sound notification is handled on the client side based on setting
      const soundEnabled = await (
        await import("@/lib/driver-credentials")
      ).getSoundNotificationSetting(db);

      return NextResponse.json({
        success: true,
        summary: {
          orderCode: orderRow.code,
          amount: money(orderRow.customer_fee_cents),
          location: {
            address: orderRow.address,
            suburb: orderRow.suburb,
            postcode: orderRow.postcode,
            lat: orderRow.delivery_lat,
            lng: orderRow.delivery_lng,
          },
          totalKm: tracking.distanceKm,
          estimatedTimeMinutes: tracking.etaMinutes,
        },
        soundNotification: soundEnabled,
        trackingIntervalKm: await (
          await import("@/lib/driver-credentials")
        ).getTrackingIntervalSetting(db),
        tracking,
      });
    }

    // /api/driver/order/track
    if (path === "/api/driver/order/track") {
      const { credentialId, jobId, lat, lng, accuracyM, heading, speedKmh } =
        body;
      const db = await getDb();
      const credential = await getDriverCredential(db, credentialId);
      if (!credential) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 }
        );
      }

      const result = await recordDriverPing(db, credential.driver_id, {
        lat,
        lng,
        accuracyM,
        heading,
        speedKmh,
      });

      // Get updated tracking snapshot for customer live tracking
      const job = await db.maybeOne<
        {
          id: number;
          order_id: number;
          status: string;
        }
      >(`SELECT * FROM delivery_jobs WHERE id = $1`, [jobId]);

      if (job && job.order_id) {
        const order = await db.maybeOne<
          {
            id: number;
            code: string;
            address: string | null;
            suburb: string | null;
            postcode: string | null;
            delivery_lat: number | null;
            delivery_lng: number | null;
            dispatched_at: string | null;
            status: string;
          }
        >(`SELECT * FROM orders WHERE id = $1`, [job.order_id]);

        if (order) {
          const tracking = await trackingSnapshot(db, order);
          return NextResponse.json({
            success: true,
            tracking,
            jobId: result.jobId,
            orderId: result.orderId,
          });
        }
      }

      return NextResponse.json({ success: true, jobId: result.jobId, orderId: result.orderId });
    }

    // /api/driver/order/deliver (success)
    if (path === "/api/driver/order/deliver") {
      const { credentialId, jobId } = body;
      const db = await getDb();
      const credential = await getDriverCredential(db, credentialId);
      if (!credential) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 }
        );
      }

      // Mark job as delivered
      await db.query(
        `UPDATE delivery_jobs SET status = 'delivered', completed_at = now() WHERE id = $1 AND status IN ('accepted','pickup','dropoff')`,
        [jobId],
      );

      const settlement = await settleDriverJob(db, jobId, `driver_${credentialId}`);

      return NextResponse.json({
        success: true,
        settlement,
      });
    }

    // /api/driver/order/unsuccessful (return to restaurant)
    if (path === "/api/driver/order/unsuccessful") {
      const { credentialId, jobId, reason } = body;
      const db = await getDb();
      const credential = await getDriverCredential(db, credentialId);
      if (!credential) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 }
        );
      }

      // Mark job as unsuccessful / return to restaurant
      await db.query(
        `UPDATE delivery_jobs SET status = 'returning', reason = $1, updated_at = now() WHERE id = $2 AND status IN ('accepted','pickup','dropoff')`,
        [reason || "Unsuccessful delivery", jobId],
      );

      // Continue tracking until delivered back to restaurant (status will be updated via track endpoint)
      return NextResponse.json({ success: true, message: "Tracking continued until return to restaurant" });
    }

    return NextResponse.json(
      { error: "Unknown endpoint" },
      { status: 404 }
    );
  } catch (error: any) {
    const status = error instanceof DriverError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status }
    );
  }
}
