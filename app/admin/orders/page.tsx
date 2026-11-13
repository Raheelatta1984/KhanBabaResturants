import Link from "next/link";
import { getDb } from "@/lib/db";
import { listOrders } from "@/lib/orders";
import { formatDateTime } from "@/lib/time";
import { money } from "@/lib/money";
import { StatusBadge } from "@/components/ui";
import { AutoRefresh } from "@/components/portal/AutoRefresh";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All", statuses: undefined },
  { key: "pending", label: "Awaiting confirmation", statuses: ["pending_confirm"] },
  { key: "kitchen", label: "In the kitchen", statuses: ["confirmed", "preparing"] },
  { key: "ready", label: "Ready", statuses: ["ready", "awaiting_collection"] },
  { key: "transit", label: "Out for delivery", statuses: ["out_for_delivery"] },
  { key: "done", label: "Completed", statuses: ["completed"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = FILTERS.find((entry) => entry.key === status) ?? FILTERS[0];
  const db = getDb();
  const orders = listOrders(db, { status: filter.statuses, limit: 100 });

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents),0) AS revenue FROM orders WHERE date(created_at) = date('now')`,
    )
    .get() as { count: number; revenue: number };

  return (
    <>
      <AutoRefresh intervalMs={12000} />
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>
            {totals.count} order(s) today · {money(totals.revenue)} taken. Every order keeps its full audit trail.
          </p>
        </div>
        <div className="chips">
          {FILTERS.map((entry) => (
            <Link key={entry.key} href={`/admin/orders?status=${entry.key}`} className="chip" data-active={filter.key === entry.key ? "true" : "false"}>
              {entry.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Channel</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Progress</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="muted">
                  No orders in this view.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <b>{order.code}</b>
                    {order.priority ? <div className="badge badge-amber" style={{ marginTop: 4 }}>Priority</div> : null}
                  </td>
                  <td className="tiny">{formatDateTime(order.created_at)}</td>
                  <td>
                    <span className="tag">{order.channel.replace("_", " ")}</span>
                  </td>
                  <td>
                    {order.customer_name}
                    {order.phone ? <div className="tiny muted">{order.phone}</div> : null}
                  </td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>
                    <StatusBadge status={order.payment_status} />
                    <div className="tiny muted">{order.payment_method === "online" ? "online" : "counter"}</div>
                  </td>
                  <td>
                    <b>{money(order.total_cents)}</b>
                    {order.delivery_fee_cents > 0 ? <div className="tiny muted">incl. {money(order.delivery_fee_cents)} delivery</div> : null}
                  </td>
                  <td style={{ minWidth: 90 }}>
                    <div className="bar-mini">
                      <i style={{ width: `${order.progress}%` }} />
                    </div>
                    <div className="tiny muted">{order.progress}%</div>
                  </td>
                  <td>
                    <Link href={`/order/${order.code}`} target="_blank" className="btn btn-ghost btn-sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="notice" style={{ marginTop: 18 }}>
        Need to change a live order? Use the Counter portal to accept, mark paid or cancel — each action is written to the
        order&apos;s event log and visible to the customer instantly.
      </div>
    </>
  );
}
