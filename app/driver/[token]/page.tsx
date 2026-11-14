import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  driverAtoReport,
  financialYear,
  getDriver,
  trackingSnapshot,
  verifyDriverToken,
} from "@/lib/drivers";
import { DriverPortal } from "@/components/DriverPortal";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Driver portal",
  robots: { index: false, follow: false },
};

/**
 * Capability-link driver portal. The signed token in the URL is the credential;
 * nobody can guess another driver's link, and it expires after 180 days.
 */
export default async function DriverPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const identity = await verifyDriverToken(token);
  if (!identity) notFound();
  const db = await getDb();
  const driver = await getDriver(db, identity.driverId);
  if (!driver || driver.status !== "approved") notFound();

  const [settings, job, ledger, trips] = await Promise.all([
    getSettings(),
    db.maybeOne<{
      id: number;
      order_id: number;
      status: string;
    }>(
      `SELECT * FROM delivery_jobs WHERE driver_id = $1
        AND status IN ('requested','accepted','pickup','dropoff','delivered')
        ORDER BY id DESC LIMIT 1`,
      [driver.id],
    ),
    db.query<{
      id: number;
      kind: string;
      amount_cents: number;
      description: string | null;
      settled_at: string | null;
      created_at: string;
    }>(
      "SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY id DESC LIMIT 20",
      [driver.id],
    ),
    db.query<{
      id: number;
      order_code: string | null;
      distance_km: number;
      claim_cents: number;
      source: string;
      financial_year: string;
      ended_at: string | null;
    }>(
      "SELECT * FROM driver_trips WHERE driver_id = $1 ORDER BY id DESC LIMIT 20",
      [driver.id],
    ),
  ]);

  const fy = financialYear();
  const report = await driverAtoReport(db, driver.id, fy);
  const order = job
    ? await db.maybeOne<{
        id: number;
        code: string;
        address: string | null;
        suburb: string | null;
        postcode: string | null;
        delivery_lat: number | null;
        delivery_lng: number | null;
        dispatched_at: string | null;
        status: string;
      }>("SELECT * FROM orders WHERE id = $1", [job.order_id])
    : null;
  const tracking = order
    ? await trackingSnapshot(db, {
        id: order.id,
        code: order.code,
        address: order.address,
        suburb: order.suburb,
        postcode: order.postcode,
        delivery_lat: order.delivery_lat,
        delivery_lng: order.delivery_lng,
        dispatched_at: order.dispatched_at,
        status: order.status,
      })
    : null;

  return (
    <section className="section-tight" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <div className="container">
        <div className="page-head" style={{ marginBottom: 18 }}>
          <div>
            <span className="eyebrow">Khan Baba driver partners</span>
            <h1 style={{ fontSize: "clamp(1.8rem, 3.4vw, 2.5rem)", margin: "10px 0 6px" }}>
              Welcome, {driver.first_name}.
            </h1>
            <p className="small muted">
              {driver.code} · {driver.email} · verified driver
            </p>
          </div>
          <Link href="/driver/apply" className="btn btn-ghost btn-sm">
            Partner terms
          </Link>
        </div>

        <div className="notice" style={{ marginBottom: 18 }}>
          <Icon name="shield" size={15} />
          <span>
            This link is private to you. Location is shared only while you turn
            it on for an active delivery, and your kilometre history is kept for
            ATO claims.
          </span>
        </div>

        <DriverPortal
          initial={{
            token,
            driver: {
              code: driver.code,
              name: `${driver.first_name} ${driver.last_name}`,
              commissionPercent: driver.commission_percent,
              baseFeeCents: driver.per_delivery_fee_cents,
            },
            intervalSeconds:
              Number(settings.driver_tracking_interval_seconds) || 15,
            fy,
            rate: report.rate,
            report: {
              totalKm: report.totalKm,
              claimableKm: report.claimableKm,
              claimCents: report.claimCents,
              capKm: report.capKm,
            },
            job:
              job && order && tracking
                ? {
                    id: job.id,
                    orderCode: order.code,
                    address: order.address,
                    suburb: order.suburb,
                    postcode: order.postcode,
                    status: job.status,
                    tracking,
                  }
                : null,
            ledger,
            trips,
          }}
        />
      </div>
    </section>
  );
}
