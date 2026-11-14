import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  configuredProviders,
  doordashConfigured,
  providerLabel,
  uberConfigured,
} from "@/lib/delivery";
import { stripeConfigured, paypalConfigured, PAYMENT_OPTIONS } from "@/lib/payments";
import { formatDateTime } from "@/lib/time";
import { money } from "@/lib/money";
import { SettingsForm } from "@/components/portal/AdminForms";
import { mediaConfig } from "@/lib/media";

export const dynamic = "force-dynamic";

export default async function DeliverySettingsPage() {
  const db = await getDb();
  const [settings, jobs, uberLive, stripeLive, media, doordashLive, paypalLive, partners] = await Promise.all([
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
    doordashConfigured(db),
    paypalConfigured(),
    configuredProviders(db),
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
          <span className={`badge ${doordashLive ? "badge-green" : "badge-amber"}`}>
            {doordashLive ? "DoorDash Drive connected" : "DoorDash not configured"}
          </span>
          <span className={`badge ${paypalLive ? "badge-green" : "badge-amber"}`}>
            {paypalLive ? "PayPal connected" : "PayPal sandbox"}
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
            {media.driver === "supabase"
              ? "Supabase Storage"
              : media.driver === "blob"
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

      <div className="notice" style={{ marginBottom: 18 }}>
        Quoting from{" "}
        <b>{partners.length ? partners.map(providerLabel).join(" · ") : "the sandbox courier"}</b>{" "}
        using the <b>{settings.delivery_quote_strategy}</b> strategy. The Square
        POS bridge, driver network and community settings live under{" "}
        <a href="/admin/integrations" style={{ color: "var(--accent)" }}>Integrations</a>,{" "}
        <a href="/admin/drivers" style={{ color: "var(--accent)" }}>Driver management</a> and{" "}
        <a href="/admin/community" style={{ color: "var(--accent)" }}>Returns &amp; community</a>.
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
                    label: "Auto — compare every configured partner",
                  },
                  { value: "uber", label: "Force Uber Direct" },
                  { value: "doordash", label: "Force DoorDash Drive" },
                  { value: "own_fleet", label: "Force our own verified drivers" },
                  { value: "simulated", label: "Sandbox courier" },
                ],
              },
              {
                key: "delivery_quote_strategy",
                label: "How auto chooses a partner",
                type: "select",
                options: [
                  { value: "cheapest", label: "Cheapest live quote" },
                  { value: "fastest", label: "Fastest ETA" },
                ],
              },
              {
                key: "own_fleet_enabled",
                label: "Offer our own driver fleet for quotes",
                type: "toggle",
              },
              {
                key: "delivery_radius_km",
                label: "Own-fleet delivery radius",
                type: "number",
                suffix: "km",
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
            title: "DoorDash Drive credentials",
            description:
              "Create a Drive developer app and copy the developer ID, key ID and signing secret. Env vars (DOORDASH_DEVELOPER_ID, DOORDASH_KEY_ID, DOORDASH_SIGNING_SECRET) take precedence. The quote/dispatch API is idempotent on our order-scoped external_delivery_id.",
            fields: [
              { key: "doordash_developer_id", label: "Developer ID", type: "password" },
              { key: "doordash_key_id", label: "Key ID (JWT kid)", type: "password" },
              { key: "doordash_signing_secret", label: "Signing secret", type: "password" },
              { key: "doordash_store_id", label: "External store ID", type: "text" },
              { key: "doordash_webhook_secret", label: "Webhook signing secret", type: "password" },
            ],
          },
          {
            title: "Payments",
            description: `Stripe hosts card and Afterpay checkout, so card data never touches this application. PayPal uses its own Orders v2 approval flow. Enabled options: ${PAYMENT_OPTIONS.map((option) => option.id).join(", ")} — enter them as a comma-separated list. Without credentials every option is clearly labelled sandbox at checkout.`,
            fields: [
              {
                key: "payment_provider",
                label: "Card / Afterpay provider",
                type: "select",
                options: [
                  { value: "simulated", label: "Sandbox (no live charges)" },
                  { value: "stripe", label: "Stripe Checkout" },
                  { value: "auto", label: "Auto — Stripe when configured" },
                ],
              },
              { key: "payment_methods", label: "Enabled payment options (CSV)", type: "textarea" },
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
              {
                key: "paypal_client_id",
                label: "PayPal client ID",
                type: "password",
              },
              {
                key: "paypal_client_secret",
                label: "PayPal client secret",
                type: "password",
              },
              {
                key: "paypal_mode",
                label: "PayPal environment",
                type: "select",
                options: [
                  { value: "sandbox", label: "Sandbox" },
                  { value: "live", label: "Live" },
                ],
              },
              {
                key: "paypal_webhook_id",
                label: "PayPal webhook ID",
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
                    <td className="tiny">{providerLabel(job.provider)}</td>
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
        Webhooks: <code>/api/webhooks/uber</code>,{" "}
        <code>/api/webhooks/doordash</code> (courier status),{" "}
        <code>/api/webhooks/stripe</code>,{" "}
        <code>/api/webhooks/paypal</code> (payment confirmation),{" "}
        <code>/api/webhooks/square</code> (POS) and{" "}
        <code>/api/webhooks/facebook</code> (community comments). Signed
        requests are required whenever a secret is configured.
      </div>
    </>
  );
}
