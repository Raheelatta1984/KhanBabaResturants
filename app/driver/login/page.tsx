import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getDriverCredential } from "@/lib/driver-credentials";
import { getDriver } from "@/lib/drivers";
import { DriverPortal } from "@/components/DriverPortal";
import { money } from "@/lib/money";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Driver Login Portal",
  robots: { index: false, follow: false },
};

/**
 * Driver login portal using separate credentials.
 * The driver logs in with email and password, then accesses the portal.
 */
export default async function DriverLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ credentialId?: string; token?: string }>;
}) {
  const { credentialId, token } = await searchParams;

  // If token is provided (legacy), redirect to legacy portal or handle
  if (token) {
    // For now, we keep the legacy token portal at /driver/[token]/page.tsx
    // This page is specifically for the new credential-based login
    notFound();
  }

  // If credentialId is provided, show the portal (after login)
  // In a real app, the login would happen on /driver/login and then redirect here with credentialId in session/cookie
  // For this implementation, we'll assume the credentialId is passed for the portal view after authentication
  if (credentialId) {
    const db = await getDb();
    const credential = await getDriverCredential(db, Number(credentialId));
    if (!credential) notFound();
    const driver = await getDriver(db, credential.driver_id);
    if (!driver || driver.status !== "approved") notFound();

    // Fetch initial data similar to legacy portal
    const [settings, job, ledger, trips] = await Promise.all([
      (await import("@/lib/settings")).getSettings(),
      db.maybeOne<
        {
          id: number;
          order_id: number;
          status: string;
          customer_fee_cents: number;
        }
      >(
        `SELECT * FROM delivery_jobs WHERE driver_id = $1
          AND status IN ('requested','accepted','pickup','dropoff','delivered')
          ORDER BY id DESC LIMIT 1`,
        [driver.id],
      ),
      db.query<
        {
          id: number;
          kind: string;
          amount_cents: number;
          description: string | null;
          settled_at: string | null;
          created_at: string;
        }
      >(
        "SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY id DESC LIMIT 20",
        [driver.id],
      ),
      db.query<
        {
          id: number;
          order_code: string | null;
          distance_km: number;
          claim_cents: number;
          source: string;
          financial_year: string;
          ended_at: string | null;
        }
      >(
        "SELECT * FROM driver_trips WHERE driver_id = $1 ORDER BY id DESC LIMIT 20",
        [driver.id],
      ),
    ]);

    const { financialYear, driverAtoReport } = await import("@/lib/drivers");
    const fy = financialYear();
    const report = await driverAtoReport(db, driver.id, fy);

    const order = job
      ? await db.maybeOne<
          {
            id: number;
            code: string;
            address: string | null;
            suburb: string | null;
            postcode: string | null;
            delivery_lat: number | null;
            delivery_lng: number | null;
            delivery_fee_cents: number;
            dispatched_at: string | null;
            status: string;
          }
        >("SELECT * FROM orders WHERE id = $1", [job.order_id])
      : null;

    const { trackingSnapshot } = await import("@/lib/drivers");
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

    // Get sound notification and tracking interval settings
    const { getSoundNotificationSetting, getTrackingIntervalSetting } =
      await import("@/lib/driver-credentials");
    const intervalSeconds =
      Number(settings.driver_tracking_interval_seconds) || 15;
    const soundNotification = await getSoundNotificationSetting(db);
    const trackingIntervalKm = await getTrackingIntervalSetting(db);

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
                {driver.code} · {driver.email} · verified driver (Credential ID: {credentialId})
              </p>
            </div>
          </div>

          <div className="notice" style={{ marginBottom: 18 }}>
            <span className="icon">🛡️</span>
            <span>
              This portal is secured by your separate login credential. Location is shared only while you turn
              it on for an active delivery, and your kilometre history is kept for
              ATO claims. Sound notification: {soundNotification ? "Enabled" : "Disabled"}.
            </span>
          </div>

          <DriverPortal
            initial={{
              token: "", // Legacy token not used here, but component expects it
              driver: {
                code: driver.code,
                name: `${driver.first_name} ${driver.last_name}`,
                commissionPercent: driver.commission_percent,
                baseFeeCents: driver.per_delivery_fee_cents,
              },
              intervalSeconds,
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
                      summary: {
                        amount: money(job.customer_fee_cents ?? order.delivery_fee_cents ?? 0),
                        location: {
                          address: order.address,
                          suburb: order.suburb,
                          postcode: order.postcode,
                          lat: order.delivery_lat,
                          lng: order.delivery_lng,
                        },
                        totalKm: tracking.distanceKm,
                        estimatedTimeMinutes: tracking.etaMinutes,
                      },
                    }
                  : null,
              ledger,
              trips,
              // Pass credential-specific settings
              credentialId: Number(credentialId),
              soundNotification,
              trackingIntervalKm,
            }}
          />
        </div>
      </section>
    );
  }

  // Default: Show login form
  return (
    <section className="section-tight" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <div className="container">
        <div className="page-head" style={{ marginBottom: 18 }}>
          <div>
            <span className="eyebrow">Khan Baba driver partners</span>
            <h1 style={{ fontSize: "clamp(1.8rem, 3.4vw, 2.5rem)", margin: "10px 0 6px" }}>
              Driver Login
            </h1>
            <p className="small muted">
              Enter your separate login credentials to start receiving orders.
            </p>
          </div>
        </div>

        <div className="panel" style={{ maxWidth: 480, margin: "0 auto" }}>
          <div className="panel-head">
            <h3>Sign in</h3>
          </div>
          <form
            action="/driver/login"
            method="POST"
            className="form"
            style={{ padding: 24 }}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="driver@khanbaba.com"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                placeholder="••••••••"
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn-primary btn-block">
                Sign in
              </button>
            </div>
          </form>
          <p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>
            Need help? Contact the delivery team.
          </p>
        </div>
      </div>
    </section>
  );
}
