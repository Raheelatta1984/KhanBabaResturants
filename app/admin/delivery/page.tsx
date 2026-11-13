import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { uberConfigured } from "@/lib/delivery";
import { stripeConfigured } from "@/lib/payments";
import { formatDateTime } from "@/lib/time";
import { money } from "@/lib/money";
import { SettingsForm } from "@/components/portal/AdminForms";
import { mediaConfig } from "@/lib/media";

export const dynamic = "force-dynamic";

export default async function DeliverySettingsPage() {
  const db = await getDb();
  const [settings, jobs, uberLive, stripeLive, media] = await Promise.all([
    getSettings(),
    db.query<{
      id: number;
      code: string;
      suburb: string | null;
      provider: string;
      status: string;
      cost_cents: number;
      customer_fee_cents: number;
      eta_minutes: number | null;
      created_at: string;
    }>(
      `SELECT j.*, o.code, o.suburb FROM delivery_jobs j JOIN orders o ON o.id = j.order_id
       ORDER BY j.id DESC LIMIT 12`,
    ),
    uberConfigured(db),
    stripeConfigured(),
    mediaConfig(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Delivery &amp; payments</h1>
          <p>
            Courier integration, the margin we apply to live quotes, and how
            customers pay.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className={`badge ${uberLive ? "badge-green" : "badge-amber"}`}>
            {uberLive ? "Uber Direct connected" : "Uber Direct not configured"}
          </span>
          <span
            className={`badge ${stripeLive ? "badge-green" : "badge-amber"}`}
          >
            {stripeLive ? "Stripe connected" : "Stripe not configured"}
          </span>
          <span
            className={`badge ${media.configured && media.driver !== "local" ? "badge-green" : "badge-amber"}`}
          >
            Photos:{" "}
            {media.driver === "blob"
              ? "Vercel Blob"
              : media.driver === "gdrive"
                ? "Google Drive"
                : "local disk"}
          </span>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <span>Markup on quotes</span>
          <b>{settings.delivery_markup_percent}%</b>
          <small>
            Minimum {money(Number(settings.delivery_markup_min_cents))}
          </small>
        </div>
        <div className="stat-card">
          <span>Fee cap</span>
          <b>{money(Number(settings.delivery_max_fee_cents))}</b>
          <small>
            Rounded to {money(Number(settings.delivery_rounding_cents))}
          </small>
        </div>
        <div className="stat-card">
          <span>Payment mode</span>
          <b style={{ fontSize: "1.2rem" }}>
            {stripeLive ? "Stripe live" : "Sandbox"}
          </b>
          <small>{settings.payment_provider}</small>
        </div>
      </div>

      <SettingsForm
        values={settings}
        groups={[
          {
            title: "Delivery pricing",
            description:
              "We quote the courier live, then charge the customer the courier fee plus this service margin. The margin is visible line-by-line at checkout when enabled.",
            fields: [
              {
                key: "delivery_provider",
                label: "Courier provider",
                type: "select",
                options: [
                  {
                    value: "auto",
                    label: "Auto (Uber Direct when configured)",
                  },
                  { value: "uber", label: "Force Uber Direct" },
                  { value: "simulated", label: "Sandbox courier" },
                ],
              },
              {
                key: "delivery_markup_percent",
                label: "Service margin",
                type: "number",
                suffix: "%",
              },
              {
                key: "delivery_markup_min_cents",
                label: "Minimum service fee",
                type: "number",
                suffix: "cents",
              },
              {
                key: "delivery_max_fee_cents",
                label: "Maximum delivery fee",
                type: "number",
                suffix: "cents",
              },
              {
                key: "delivery_rounding_cents",
                label: "Round fees up to",
                type: "number",
                suffix: "cents",
              },
              {
                key: "delivery_min_order_cents",
                label: "Delivery minimum order",
                type: "number",
                suffix: "cents",
              },
              {
                key: "delivery_prep_lead_minutes",
                label: "Kitchen lead time for quotes",
                type: "number",
                suffix: "minutes",
              },
              {
                key: "show_delivery_breakdown",
                label: "Show courier fee + service fee breakdown at checkout",
                type: "toggle",
              },
              {
                key: "uber_pickup_notes",
                label: "Pickup notes for the courier",
                type: "textarea",
              },
            ],
          },
          {
            title: "Uber Direct credentials",
            description:
              "Prefer environment variables in production (UBER_DIRECT_CLIENT_ID, UBER_DIRECT_CLIENT_SECRET, UBER_DIRECT_CUSTOMER_ID). Values here are stored in the local database and never sent to the browser.",
            fields: [
              { key: "uber_client_id", label: "Client ID", type: "password" },
              {
                key: "uber_client_secret",
                label: "Client secret",
                type: "password",
              },
              {
                key: "uber_customer_id",
                label: "Uber customer ID",
                type: "password",
              },
              {
                key: "uber_webhook_secret",
                label: "Webhook signing secret",
                type: "password",
              },
            ],
          },
          {
            title: "Payments",
            description:
              "Stripe uses a hosted Checkout Session, so card data never touches this application. Without a key the platform runs in sandbox mode.",
            fields: [
              {
                key: "payment_provider",
                label: "Payment provider",
                type: "select",
                options: [
                  { value: "simulated", label: "Sandbox (no live charges)" },
                  { value: "stripe", label: "Stripe Checkout" },
                ],
              },
              {
                key: "stripe_secret_key",
                label: "Stripe secret key",
                type: "password",
              },
              {
                key: "stripe_webhook_secret",
                label: "Stripe webhook secret",
                type: "password",
              },
              { key: "gst_percent", label: "GST", type: "number", suffix: "%" },
            ],
          },
        ]}
      />

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Recent courier quotes</h3>
          <span className="tiny muted">Customer charge vs courier cost</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Courier cost</th>
                <th>Charged</th>
                <th>Margin</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No delivery quotes yet.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <b>{job.code}</b>
                      <div className="tiny muted">{job.suburb ?? "—"}</div>
                    </td>
                    <td className="tiny">
                      {job.provider === "uber_direct"
                        ? "Uber Direct"
                        : "Sandbox"}
                    </td>
                    <td>
                      <span className="tag">{job.status}</span>
                    </td>
                    <td>{money(job.cost_cents)}</td>
                    <td>{money(job.customer_fee_cents)}</td>
                    <td
                      style={{
                        color:
                          job.customer_fee_cents - job.cost_cents >= 0
                            ? "var(--green)"
                            : "var(--red)",
                      }}
                    >
                      {money(job.customer_fee_cents - job.cost_cents)}
                    </td>
                    <td className="tiny">{formatDateTime(job.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="notice" style={{ marginTop: 18 }}>
        Webhook endpoints: <code>/api/webhooks/uber</code> for courier status
        and <code>/api/webhooks/stripe</code> for payment confirmation. Both
        accept unsigned requests only in sandbox mode.
      </div>
    </>
  );
}
