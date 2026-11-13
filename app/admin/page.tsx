import Link from "next/link";
import { getDb } from "@/lib/db";
import { listOrders, orderStats } from "@/lib/orders";
import { cogsTotals, lowStockMaterials } from "@/lib/production";
import { getUpcomingHolidays } from "@/lib/pricing";
import { uberConfigured } from "@/lib/delivery";
import { stripeConfigured } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { formatDate, minutesSince } from "@/lib/time";
import { money } from "@/lib/money";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const db = getDb();
  const stats = orderStats(db);
  const cogs = cogsTotals(db, 1);
  const cogs7 = cogsTotals(db, 7);
  const settings = getSettings();
  const recent = listOrders(db, { limit: 8 });
  const lowStock = lowStockMaterials(db, 6);
  const holidays = getUpcomingHolidays(db, 3);

  const week = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) AS revenue
       FROM orders WHERE date(created_at) >= date('now', '-6 days')
       GROUP BY date(created_at) ORDER BY day`,
    )
    .all() as { day: string; orders: number; revenue: number }[];
  const maxRevenue = Math.max(1, ...week.map((row) => row.revenue));

  const topItems = db
    .prepare(
      `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total_cents) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status != 'cancelled' AND date(o.created_at) >= date('now', '-30 days')
       GROUP BY oi.name ORDER BY revenue DESC LIMIT 5`,
    )
    .all() as { name: string; qty: number; revenue: number }[];

  const deliveryMargin = db
    .prepare(
      `SELECT COALESCE(SUM(j.customer_fee_cents - j.cost_cents), 0) AS margin, COUNT(*) AS jobs
       FROM delivery_jobs j JOIN orders o ON o.id = j.order_id
       WHERE o.status = 'completed' AND date(o.completed_at) >= date('now', '-7 days')`,
    )
    .get() as { margin: number; jobs: number };

  const menuCount = db.prepare("SELECT COUNT(*) AS c FROM menu_items WHERE published = 1").get() as { c: number };
  const pendingReviews = db.prepare("SELECT COUNT(*) AS c FROM reviews WHERE status = 'pending'").get() as { c: number };

  return (
    <>
      <AutoRefresh intervalMs={15000} />
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Live trading snapshot for {settings.restaurant_name}.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/admin/menu/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} /> New dish
          </Link>
          <Link href="/admin/production" className="btn btn-outline btn-sm">
            Production
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span>Revenue today</span>
          <b>{money(stats.today.revenue)}</b>
          <small>{stats.today.orders} orders · avg {money(stats.today.avg_order)}</small>
        </div>
        <div className="stat-card">
          <span>Collected today</span>
          <b>{money(stats.today.collected)}</b>
          <small>{stats.unpaid} unpaid ticket(s)</small>
        </div>
        <div className="stat-card">
          <span>COGS today</span>
          <b>{money(cogs.cost_cents)}</b>
          <small>{cogs.batches} production run(s)</small>
        </div>
        <div className="stat-card">
          <span>Gross margin today</span>
          <b style={{ color: "var(--green)" }}>{money(Math.max(0, stats.today.revenue - cogs.cost_cents))}</b>
          <small>
            {stats.today.revenue > 0
              ? `${Math.round(((stats.today.revenue - cogs.cost_cents) / stats.today.revenue) * 100)}% of revenue`
              : "No sales yet"}
          </small>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Last 7 days</h3>
            <span className="tiny muted">{money(cogs7.cost_cents)} material cost</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150 }}>
            {week.length === 0 ? <p className="small muted">No orders yet.</p> : null}
            {week.map((row) => (
              <div key={row.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div
                  title={`${money(row.revenue)} · ${row.orders} orders`}
                  style={{
                    width: "100%",
                    height: Math.max(6, (row.revenue / maxRevenue) * 110),
                    borderRadius: "6px 6px 3px 3px",
                    background: "linear-gradient(180deg, var(--accent), rgba(224,83,47,0.5))",
                  }}
                />
                <span className="tiny" style={{ color: "var(--muted-2)" }}>
                  {new Date(row.day + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short" })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Alerts &amp; actions</h3>
            <Link href="/admin/production" className="tiny" style={{ color: "var(--accent)" }}>
              Production →
            </Link>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <Link href="/counter" className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small">Awaiting counter confirmation</span>
              <span className="badge badge-amber">{stats.pending}</span>
            </Link>
            <Link href="/kitchen" className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small">Tickets in the kitchen</span>
              <span className="badge badge-blue">{stats.kitchen}</span>
            </Link>
            <Link href="/delivery" className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small">Packed, awaiting courier</span>
              <span className="badge badge-amber">{stats.awaitingDispatch}</span>
            </Link>
            <Link href="/admin/reviews" className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small">Reviews to moderate</span>
              <span className="badge badge-blue">{pendingReviews.c}</span>
            </Link>
            <div className="card" style={{ padding: 12 }}>
              <div className="small" style={{ marginBottom: 6 }}>Integrations</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className={`badge ${uberConfigured() ? "badge-green" : "badge-amber"}`}>
                  {uberConfigured() ? "Uber Direct live" : "Courier sandbox"}
                </span>
                <span className={`badge ${stripeConfigured() ? "badge-green" : "badge-amber"}`}>
                  {stripeConfigured() ? "Stripe live" : "Stripe sandbox"}
                </span>
                <span className="badge">{menuCount.c} dishes live</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Recent orders</h3>
          <Link href="/admin/orders" className="tiny" style={{ color: "var(--accent)" }}>
            All orders →
          </Link>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Channel</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/order/${order.code}`} target="_blank" style={{ color: "var(--accent)" }}>
                      {order.code}
                    </Link>
                  </td>
                  <td>{order.channel.replace("_", " ")}</td>
                  <td>{order.customer_name}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>
                    <StatusBadge status={order.payment_status} />
                  </td>
                  <td>{money(order.total_cents)}</td>
                  <td className="tiny muted">{minutesSince(order.created_at)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-3" style={{ marginTop: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Top sellers (30d)</h3>
          </div>
          {topItems.length === 0 ? <p className="small muted">No sales yet.</p> : null}
          {topItems.map((item) => (
            <div key={item.name} className="summary-row">
              <span>{item.name}</span>
              <b>
                {item.qty}× · {money(item.revenue)}
              </b>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Low stock</h3>
            <Link href="/admin/production" className="tiny" style={{ color: "var(--accent)" }}>
              Materials →
            </Link>
          </div>
          {lowStock.length === 0 ? <p className="small muted">All materials above reorder level.</p> : null}
          {lowStock.map((material) => (
            <div key={material.id} className="summary-row">
              <span>{material.name}</span>
              <b style={{ color: "var(--red)" }}>
                {material.stock_qty} {material.unit}
              </b>
            </div>
          ))}
          <div className="summary-row" style={{ marginTop: 10 }}>
            <span>Delivery margin (7d)</span>
            <b style={{ color: "var(--green)" }}>{money(deliveryMargin.margin)}</b>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Calendar</h3>
            <Link href="/admin/pricing" className="tiny" style={{ color: "var(--accent)" }}>
              Pricing →
            </Link>
          </div>
          <div className="small" style={{ marginBottom: 8 }}>
            Weekend surcharge <b>{db.prepare("SELECT value FROM pricing_rules WHERE code='weekend_surcharge'").get() ? "5%" : "off"}</b>
          </div>
          {holidays.length === 0 ? <p className="small muted">No upcoming public holidays.</p> : null}
          {holidays.map((holiday) => (
            <div key={holiday.id} className="summary-row">
              <span>{holiday.name}</span>
              <b>{formatDate(holiday.date)}</b>
            </div>
          ))}
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Holiday dates override the weekend rate. Priority fees apply to delivery and pickup only.
          </p>
        </section>
      </div>
    </>
  );
}
