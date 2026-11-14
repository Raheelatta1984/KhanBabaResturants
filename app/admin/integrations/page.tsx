import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { squareStatus } from "@/lib/integrations/square";
import {
  configuredProviders,
  doordashConfigured,
  ownFleetConfigured,
  providerLabel,
  uberConfigured,
} from "@/lib/delivery";
import { stripeConfigured, paypalConfigured } from "@/lib/payments";
import { driverStats } from "@/lib/drivers";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { ActionForm } from "@/components/portal/ActionForm";
import { OpsButton } from "@/components/portal/OpsButton";
import { SettingsForm } from "@/components/portal/AdminForms";
import { AutoRefresh } from "@/components/portal/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const db = await getDb();
  const [
    settings,
    status,
    records,
    transactions,
    partners,
    uber,
    doordash,
    fleet,
    stripe,
    paypal,
    drivers,
  ] = await Promise.all([
    getSettings(),
    squareStatus(db),
    db.query<
      {
        id: number; direction: string; entity: string; entity_ref: string | null;
        external_id: string | null; status: string; message: string | null; created_at: string;
      }
    >("SELECT * FROM square_sync_records ORDER BY id DESC LIMIT 25"),
    db.query<
      {
        id: number; external_id: string; kind: string; source: string; order_code: string | null;
        amount_cents: number; currency: string; status: string | null; occurred_at: string | null;
      }
    >("SELECT * FROM square_transactions ORDER BY id DESC LIMIT 25"),
    configuredProviders(db),
    uberConfigured(db),
    doordashConfigured(db),
    ownFleetConfigured(db),
    stripeConfigured(),
    paypalConfigured(),
    driverStats(db),
  ]);

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p>
            Every external system sits behind its own module. The Square POS
            bridge is deliberately detached: it shares and synchronises data, but
            the ordering core never depends on it.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/admin/delivery" className="btn btn-outline btn-sm">
            Delivery &amp; payment settings
          </Link>
          <Link href="/admin/marketing" className="btn btn-outline btn-sm">
            Marketing &amp; social media
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Connected systems</h3>
          <span className="tiny muted">Settings are env-first, credentials never reach the browser</span>
        </div>
        <div className="grid grid-3">
          {[
            { label: "Uber Direct", ok: uber, detail: "Courier quotes & dispatch", live: "connected" },
            { label: "DoorDash Drive", ok: doordash, detail: "Second delivery partner", live: "connected" },
            { label: "Own driver fleet", ok: fleet, detail: `${drivers.approved} verified driver(s)`, live: "active" },
            { label: "Stripe (Visa, Mastercard, Amex, Afterpay)", ok: stripe, detail: "Hosted checkout", live: "connected" },
            { label: "PayPal", ok: paypal, detail: "Orders v2 + webhook", live: "connected" },
            { label: "Square POS", ok: status.configured, detail: status.mode, live: "connected" },
          ].map((entry) => (
            <div className="card" key={entry.label} style={{ padding: 14 }}>
              <div className="row">
                <b className="small">{entry.label}</b>
                <span className={`badge ${entry.ok ? "badge-green" : "badge-amber"}`}>
                  {entry.ok ? entry.live : "sandbox"}
                </span>
              </div>
              <p className="tiny muted" style={{ marginTop: 8 }}>{entry.detail}</p>
            </div>
          ))}
        </div>
        <div className="notice" style={{ marginTop: 14 }}>
          Courier quote strategy: <b>{settings.delivery_quote_strategy}</b> across{" "}
          {partners.length ? partners.map(providerLabel).join(", ") : "the sandbox courier"}.
          Webhooks: <code>/api/webhooks/uber</code>, <code>/api/webhooks/doordash</code>,{" "}
          <code>/api/webhooks/stripe</code>, <code>/api/webhooks/paypal</code>,{" "}
          <code>/api/webhooks/square</code>, <code>/api/webhooks/facebook</code>,{" "}
          <code>/api/webhooks/instagram</code>.
        </div>
      </section>

      <div className="grid grid-3" style={{ marginTop: 18 }}>
        <div className="stat-card"><span>Square mode</span><b style={{ fontSize: "1.2rem" }}>{status.mode}</b><small>{status.configured ? "API credentials present" : "Sandbox mirror"}</small></div>
        <div className="stat-card"><span>Synced records</span><b>{status.records}</b><small>{status.outbound} outbound pushes</small></div>
        <div className="stat-card"><span>POS transactions</span><b>{status.transactions}</b><small>{status.errors} sync error(s)</small></div>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Square POS bridge</h3>
          <span className="tiny muted">
            {status.last ? `Last activity ${formatDateTime(status.last.created_at)} · ${status.last.status}` : "No activity yet"}
          </span>
        </div>
        <p className="small muted" style={{ marginBottom: 14 }}>
          Push completed local orders, import Square payments, map menu variants
          to the Square catalogue and receive POS webhooks. All transfers land in
          <code> square_sync_records</code> and <code> square_transactions</code> —
          remove those two tables, the optional catalog variation ID and this
          module to detach completely.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <OpsButton endpoint="/api/ops/square" payload={{ action: "sync" }} successMessage="Sync complete" className="btn btn-primary btn-sm">
            Run full sync
          </OpsButton>
          <OpsButton endpoint="/api/ops/square" payload={{ action: "test" }} successMessage="Connection checked" className="btn btn-outline btn-sm">
            Test connection
          </OpsButton>
          <OpsButton endpoint="/api/ops/square" payload={{ action: "pull" }} successMessage="Payments imported" className="btn btn-outline btn-sm">
            Import POS payments
          </OpsButton>
        </div>
        <ActionForm
          endpoint="/api/ops/square"
          action="push_order"
          submitLabel="Push one order"
          compact
          fields={[{ name: "orderCode", label: "Order code", placeholder: "KB-DEMO06" }]}
        />
      </section>

      <div style={{ marginTop: 18 }}>
        <SettingsForm
          values={settings}
          groups={[
            {
              title: "Square POS connection",
              description:
                "Prefer SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID / SQUARE_ENVIRONMENT / SQUARE_WEBHOOK_SIGNATURE_KEY in production. Sandbox mirror mode needs no credentials.",
              fields: [
                { key: "square_enabled", label: "Enable the bridge", type: "toggle" },
                {
                  key: "square_environment", label: "Environment", type: "select",
                  options: [{ value: "sandbox", label: "Sandbox" }, { value: "production", label: "Production" }],
                },
                { key: "square_access_token", label: "Access token", type: "password" },
                { key: "square_location_id", label: "Location ID", type: "password" },
                { key: "square_webhook_signature_key", label: "Webhook signature key", type: "password" },
                { key: "square_sync_catalog", label: "Sync menu variants to Square Catalog", type: "toggle" },
              ],
            },
          ]}
        />
      </div>
    </>
  );
}
