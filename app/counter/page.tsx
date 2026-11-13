import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import {
  getOrderItems,
  listOrders,
  orderStats,
  type OrderRow,
} from "@/lib/orders";
import { CHANNEL_LABELS } from "@/lib/pricing";
import { minutesSince } from "@/lib/time";
import { money } from "@/lib/money";
import { PortalNav } from "@/components/portal/PortalNav";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { ConfirmOrderButton } from "@/components/portal/ConfirmOrderButton";
import { ClaimLinkButton } from "@/components/portal/ClaimLinkButton";
import { OpsButton } from "@/components/portal/OpsButton";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

async function itemsFor(orderId: number) {
  return getOrderItems(await getDb(), orderId);
}

export default async function CounterPage() {
  const session = await requireRole(["admin", "manager", "counter"]);
  const db = await getDb();
  const [pending, kitchen, ready, stats, paidToday] = await Promise.all([
    listOrders(db, { status: ["pending_confirm"], limit: 20 }),
    listOrders(db, { status: ["confirmed", "preparing"], limit: 16 }),
    listOrders(db, { status: ["ready", "awaiting_collection"], limit: 16 }),
    orderStats(db),
    db.one<{ total: number }>(
      "SELECT COALESCE(SUM(total_cents), 0) AS total FROM orders WHERE payment_status = 'paid' AND created_at::date = CURRENT_DATE",
    ),
  ]);

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <AutoRefresh intervalMs={7000} />
      <main className="container portal-main">
        <div className="page-head">
          <div>
            <h1>Counter</h1>
            <p>
              Accept orders, take payment and route the ticket to the kitchen.
              Everything here updates live.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/kitchen" className="btn btn-outline btn-sm">
              Kitchen display <Icon name="arrow" size={14} />
            </Link>
            <Link href="/counter/customers" className="btn btn-ghost btn-sm">
              <Icon name="user" size={14} /> Customers
            </Link>
            <Link href="/delivery" className="btn btn-ghost btn-sm">
              Delivery desk
            </Link>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <span>Awaiting confirmation</span>
            <b
              style={{ color: stats.pending > 0 ? "var(--accent)" : undefined }}
            >
              {stats.pending}
            </b>
            <small>Accept to release to kitchen</small>
          </div>
          <div className="stat-card">
            <span>In the kitchen</span>
            <b>{stats.kitchen}</b>
            <small>Confirmed or cooking</small>
          </div>
          <div className="stat-card">
            <span>Ready / collection</span>
            <b>{ready.length}</b>
            <small>Hand to customer or courier</small>
          </div>
          <div className="stat-card">
            <span>Collected today</span>
            <b>{money(paidToday.total)}</b>
            <small>{stats.unpaid} unpaid tickets</small>
          </div>
        </div>

        <section style={{ marginBottom: 30 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: "1.25rem" }}>Awaiting confirmation</h2>
            <span className="tiny muted">{pending.length} ticket(s)</span>
          </div>

          {pending.length === 0 ? (
            <div className="card empty" style={{ padding: 30 }}>
              <div className="icon">
                <Icon name="check" size={24} />
              </div>
              <b>All caught up</b>
              <p className="small">
                New orders will appear here the moment they are placed.
              </p>
            </div>
          ) : (
            <div className="grid grid-2">
              {await Promise.all(
                pending.map(async (order: OrderRow) => {
                  const items = await itemsFor(order.id);
                  return (
                    <article
                      key={order.id}
                      data-order-id={order.id}
                      className="panel"
                      style={{
                        borderColor:
                          order.status === "pending_confirm"
                            ? "rgba(243,171,63,0.28)"
                            : undefined,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <b>{order.code}</b>
                            <span className="badge">
                              {CHANNEL_LABELS[order.channel]}
                            </span>
                            <StatusBadge
                              status={order.payment_status}
                              label={
                                order.payment_status === "paid"
                                  ? "Paid"
                                  : "Unpaid"
                              }
                            />
                          </div>
                          <div className="tiny muted" style={{ marginTop: 6 }}>
                            {order.customer_name}
                            {order.table_id ? ` · Table order` : ""} ·{" "}
                            {minutesSince(order.created_at)} min ago
                            {order.priority ? " · PRIORITY" : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="strong">
                            {money(order.total_cents)}
                          </div>
                          <div className="tiny muted">
                            {order.payment_method === "online"
                              ? "Online"
                              : "At counter"}
                          </div>
                        </div>
                      </div>

                      <div className="ticket-items" style={{ marginTop: 12 }}>
                        {items.map((item) => (
                          <div key={item.id} className="ticket-item">
                            <span className="qty">{item.qty}×</span>
                            <span className="nm">{item.name}</span>
                            <span className="sz">
                              {item.variant_label}
                              {item.spice_level
                                ? ` · ${item.spice_level.replace("_", " ")}`
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>

                      {order.notes ? (
                        <div
                          className="notice tiny"
                          style={{ marginBottom: 10 }}
                        >
                          {order.notes}
                        </div>
                      ) : null}

                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <ConfirmOrderButton
                          orderId={order.id}
                          code={order.code}
                        />
                        <ClaimLinkButton
                          orderId={order.id}
                          hasEmail={Boolean(order.email)}
                        />
                        {order.payment_status !== "paid" ? (
                          <>
                            <OpsButton
                              endpoint={`/api/ops/orders/${order.id}`}
                              payload={{ action: "paid", method: "cash" }}
                              className="btn btn-green btn-sm"
                            >
                              Mark cash paid
                            </OpsButton>
                            <OpsButton
                              endpoint={`/api/ops/orders/${order.id}`}
                              payload={{ action: "paid", method: "card" }}
                              className="btn btn-outline btn-sm"
                            >
                              Card paid
                            </OpsButton>
                          </>
                        ) : null}
                        <OpsButton
                          endpoint={`/api/ops/orders/${order.id}`}
                          payload={{
                            action: "cancel",
                            reason: "Cancelled at the counter",
                          }}
                          className="btn btn-ghost btn-sm"
                          confirmMessage={`Cancel ${order.code}?`}
                        >
                          Cancel
                        </OpsButton>
                      </div>
                    </article>
                  );
                }),
              )}
            </div>
          )}
        </section>

        <section style={{ marginBottom: 30 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: "1.25rem" }}>In the kitchen</h2>
            <span className="tiny muted">Live from the kitchen display</span>
          </div>
          {kitchen.length === 0 ? (
            <p className="small muted">Nothing cooking right now.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Channel</th>
                    <th>Items</th>
                    <th>Progress</th>
                    <th>Elapsed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {await Promise.all(
                    kitchen.map(async (order) => {
                      const items = await itemsFor(order.id);
                      const readyItems = items.filter(
                        (item) => item.prep_state === "ready",
                      ).length;
                      return (
                        <tr key={order.id}>
                          <td>
                            <b>{order.code}</b>
                            <div className="tiny muted">
                              {order.customer_name}
                            </div>
                          </td>
                          <td>
                            <span className="tag">
                              {CHANNEL_LABELS[order.channel]}
                            </span>
                            {order.priority ? (
                              <div
                                className="badge badge-amber"
                                style={{ marginTop: 4 }}
                              >
                                Priority
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {readyItems}/{items.length} ready
                          </td>
                          <td style={{ minWidth: 110 }}>
                            <div className="bar-mini">
                              <i style={{ width: `${order.progress}%` }} />
                            </div>
                            <div className="tiny muted">{order.progress}%</div>
                          </td>
                          <td>
                            {minutesSince(
                              order.kitchen_started_at ?? order.created_at,
                            )}{" "}
                            min
                          </td>
                          <td>
                            <OpsButton
                              endpoint={`/api/ops/orders/${order.id}`}
                              payload={{ action: "ready" }}
                              className="btn btn-outline btn-sm"
                            >
                              Bump ready
                            </OpsButton>
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: "1.25rem" }}>Ready &amp; collection</h2>
            <Link
              href="/delivery"
              className="tiny"
              style={{ color: "var(--accent)" }}
            >
              Delivery desk →
            </Link>
          </div>
          {ready.length === 0 ? (
            <p className="small muted">No packed orders waiting.</p>
          ) : (
            <div className="grid grid-2">
              {await Promise.all(
                ready.map(async (order) => {
                  const items = await itemsFor(order.id);
                  return (
                    <article key={order.id} className="panel">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <b>{order.code}</b>
                            <span className="badge">
                              {CHANNEL_LABELS[order.channel]}
                            </span>
                            <StatusBadge status={order.status} />
                          </div>
                          <div className="tiny muted" style={{ marginTop: 6 }}>
                            {order.customer_name} · {items.length} item(s) ·{" "}
                            {money(order.total_cents)} ·{" "}
                            {order.payment_status === "paid"
                              ? "paid"
                              : "PAYMENT DUE"}
                          </div>
                        </div>
                        <div>
                          {order.channel === "delivery" ? (
                            <Link
                              href="/delivery"
                              className="btn btn-outline btn-sm"
                            >
                              Courier desk
                            </Link>
                          ) : order.channel === "pickup" ? (
                            <OpsButton
                              endpoint={`/api/ops/orders/${order.id}`}
                              payload={{ action: "collected" }}
                              className="btn btn-green btn-sm"
                              successMessage="Collection confirmed"
                            >
                              Mark collected
                            </OpsButton>
                          ) : (
                            <OpsButton
                              endpoint={`/api/ops/orders/${order.id}`}
                              payload={{ action: "served" }}
                              className="btn btn-green btn-sm"
                              successMessage="Marked served"
                            >
                              Mark served
                            </OpsButton>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                }),
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
