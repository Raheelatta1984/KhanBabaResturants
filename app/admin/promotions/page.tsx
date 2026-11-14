import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { listPromotions } from "@/lib/promotions";
import { listDrivers } from "@/lib/drivers";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { ActionForm } from "@/components/portal/ActionForm";
import { OpsButton } from "@/components/portal/OpsButton";
import { AutoRefresh } from "@/components/portal/AutoRefresh";

export const dynamic = "force-dynamic";

const AUDIENCE: Record<string, string> = {
  customer: "Customers",
  driver: "Driver partners",
  both: "Everyone",
};

const KIND: Record<string, string> = {
  percent: "% off subtotal",
  flat: "Flat discount",
  free_delivery: "Free delivery",
  driver_bonus: "Driver bonus (flat)",
  driver_commission: "Driver commission uplift (%)",
};

export default async function PromotionsPage() {
  const db = await getDb();
  const [promotions, drivers, settings, totals] = await Promise.all([
    listPromotions(db),
    listDrivers(db),
    getSettings(),
    db.one<{ redemptions: number; saved: number; rewards: number }>(
      `SELECT COUNT(*) AS redemptions,
        COALESCE(SUM(discount_cents),0) AS saved,
        COALESCE(SUM(reward_cents),0) AS rewards
       FROM promotion_redemptions`,
    ),
  ]);

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <div className="page-head">
        <div>
          <h1>Promotions</h1>
          <p>
            Customer offers and driver-partner rewards in one module. Codes are
            re-validated on the server at checkout; driver bonuses post to the
            ledger only on a successful delivery.
          </p>
        </div>
        <span className={`badge ${settings.promotions_enabled === "1" ? "badge-green" : "badge-amber"}`}>
          {settings.promotions_enabled === "1" ? "Promotions live" : "Promotions paused"}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span>Active campaigns</span><b>{promotions.filter((p) => p.active).length}</b><small>{promotions.length} total</small></div>
        <div className="stat-card"><span>Redemptions</span><b>{Number(totals.redemptions)}</b><small>across customers and drivers</small></div>
        <div className="stat-card"><span>Customer savings</span><b>{money(Number(totals.saved))}</b><small>discounts applied</small></div>
        <div className="stat-card"><span>Driver rewards</span><b style={{ color: "var(--green)" }}>{money(Number(totals.rewards))}</b><small>bonuses earned</small></div>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>New promotion</h3></div>
        <ActionForm
          endpoint="/api/ops/promotions"
          action="create"
          submitLabel="Create promotion"
          fields={[
            { name: "code", label: "Code", placeholder: "WELCOME10", defaultValue: "" },
            { name: "name", label: "Name", placeholder: "Welcome offer" },
            {
              name: "audience", label: "Audience", type: "select", defaultValue: "customer",
              options: [
                { value: "customer", label: "Customers" },
                { value: "driver", label: "Driver partners" },
                { value: "both", label: "Everyone" },
              ],
            },
            {
              name: "kind", label: "Reward type", type: "select", defaultValue: "percent",
              options: [
                { value: "percent", label: "% off subtotal" },
                { value: "flat", label: "Flat discount (cents)" },
                { value: "free_delivery", label: "Free delivery" },
                { value: "driver_bonus", label: "Driver bonus (cents)" },
                { value: "driver_commission", label: "Driver commission uplift (%)" },
              ],
            },
            { name: "value", label: "Value", type: "number", defaultValue: 10, help: "% or cents, depending on the reward type" },
            { name: "maxDiscountCents", label: "Cap", type: "number", suffix: "cents", defaultValue: 0 },
            { name: "minSubtotalCents", label: "Minimum spend", type: "number", suffix: "cents", defaultValue: 0 },
            { name: "channels", label: "Channels", placeholder: "delivery,pickup (blank = all)" },
            {
              name: "driverId", label: "Limit to driver", type: "select", defaultValue: "",
              options: [
                { value: "", label: "All drivers" },
                ...drivers.map((driver) => ({ value: String(driver.id), label: `${driver.code} · ${driver.first_name} ${driver.last_name}` })),
              ],
            },
            { name: "usageLimit", label: "Total uses", type: "number", defaultValue: 0, help: "0 = unlimited" },
            { name: "perCustomerLimit", label: "Uses per customer", type: "number", defaultValue: 0 },
            { name: "startsAt", label: "Starts", type: "datetime-local" },
            { name: "endsAt", label: "Ends", type: "datetime-local" },
            { name: "description", label: "Internal note", type: "textarea", full: true },
          ]}
        />
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Campaigns</h3>
          <span className="tiny muted">Toggle to pause a campaign instantly</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Audience</th><th>Reward</th>
                <th>Window</th><th>Uses</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {promotions.length === 0 ? (
                <tr><td colSpan={8} className="muted">No campaigns yet — create the first one above.</td></tr>
              ) : null}
              {promotions.map((promotion) => (
                <tr key={promotion.id}>
                  <td><b className="mono">{promotion.code}</b></td>
                  <td>
                    {promotion.name}
                    {promotion.description ? <div className="tiny muted">{promotion.description}</div> : null}
                  </td>
                  <td className="tiny">{AUDIENCE[promotion.audience]}</td>
                  <td className="tiny">
                    {KIND[promotion.kind]} · {promotion.value}
                    {promotion.min_subtotal_cents > 0
                      ? <div className="muted">min {money(promotion.min_subtotal_cents)}</div>
                      : null}
                  </td>
                  <td className="tiny muted">
                    {promotion.starts_at ? formatDate(promotion.starts_at) : "now"} →{" "}
                    {promotion.ends_at ? formatDate(promotion.ends_at) : "open"}
                  </td>
                  <td>
                    {promotion.usage_count}
                    {promotion.usage_limit > 0 ? ` / ${promotion.usage_limit}` : ""}
                  </td>
                  <td><span className={`badge ${promotion.active ? "badge-green" : "badge-muted"}`}>{promotion.active ? "Active" : "Paused"}</span></td>
                  <td>
                    <OpsButton
                      endpoint="/api/ops/promotions"
                      payload={{ action: "toggle", id: promotion.id, active: !promotion.active }}
                      className="btn btn-ghost btn-sm"
                    >
                      {promotion.active ? "Pause" : "Activate"}
                    </OpsButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="notice" style={{ marginTop: 18 }}>
        Checkout accepts one customer code per order. Driver promotions are
        evaluated when a delivery completes and appear in the driver&apos;s
        commission ledger and payout.
      </div>
    </>
  );
}
