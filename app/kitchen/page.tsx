import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { getOrderItems, listOrders, type OrderRow } from "@/lib/orders";
import { CHANNEL_LABELS } from "@/lib/pricing";
import { cogsTotals, lowStockMaterials } from "@/lib/production";
import { minutesSince } from "@/lib/time";
import { money } from "@/lib/money";
import { PortalNav } from "@/components/portal/PortalNav";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { OpsButton } from "@/components/portal/OpsButton";
import { StartBatchForm } from "@/components/portal/StartBatchForm";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

function Ticket({ order, focus }: { order: OrderRow; focus: string }) {
  const db = getDb();
  const items = getOrderItems(db, order.id);
  const readyCount = items.filter((item) => item.prep_state === "ready").length;
  const elapsed = minutesSince(order.kitchen_started_at ?? order.confirmed_at ?? order.created_at);
  const isLate = elapsed > 25;
  const allReady = readyCount === items.length;

  return (
    <article
      className={`ticket ${order.channel}`}
      style={{
        borderColor: order.code === focus ? "rgba(243,171,63,0.65)" : undefined,
        boxShadow: order.code === focus ? "0 0 0 2px rgba(243,171,63,0.18)" : undefined,
      }}
    >
      <div className="ticket-head">
        <div>
          <div className="ticket-code">{order.code}</div>
          <div className="ticket-meta">
            <span>{CHANNEL_LABELS[order.channel]}</span>
            {order.table_id ? <span>Table</span> : null}
            <span style={{ color: isLate ? "var(--red)" : undefined }}>{elapsed} min</span>
            {order.priority ? <span className="badge badge-amber" style={{ padding: "1px 6px" }}>Priority</span> : null}
          </div>
        </div>
        <span className="badge badge-muted">{readyCount}/{items.length}</span>
      </div>

      <div className="ticket-items">
        {items.map((item) => (
          <div key={item.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
            <div className="ticket-item">
              <span className="qty">{item.qty}×</span>
              <span className="nm">{item.name}</span>
              <span className="sz">{item.variant_label}</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, paddingLeft: 26 }}>
              <span className="sz" style={{ minWidth: 64 }}>
                {item.spice_level ? item.spice_level.replace("_", " ") : "—"}
              </span>
              <div className="prep-toggle">
                <OpsButton
                  endpoint={`/api/ops/orders/${order.id}`}
                  payload={{ action: "item", itemId: item.id, state: "preparing" }}
                  className="btn btn-ghost"
                  title="Start this item"
                >
                  Start
                </OpsButton>
                <OpsButton
                  endpoint={`/api/ops/orders/${order.id}`}
                  payload={{ action: "item", itemId: item.id, state: "ready" }}
                  className="btn btn-ghost"
                  title="Mark this item ready"
                >
                  Done
                </OpsButton>
              </div>
              <span className={`badge ${item.prep_state === "ready" ? "badge-green" : item.prep_state === "preparing" ? "badge-amber" : "badge-muted"}`} style={{ marginLeft: "auto" }}>
                {item.prep_state}
              </span>
            </div>
            {item.notes ? <div className="tiny" style={{ color: "var(--accent)", paddingLeft: 26, marginTop: 3 }}>{item.notes}</div> : null}
          </div>
        ))}
      </div>

      {order.notes ? <div className="tiny muted" style={{ marginBottom: 8 }}>Note: {order.notes}</div> : null}

      <div className="ticket-actions">
        <OpsButton
          endpoint={`/api/ops/orders/${order.id}`}
          payload={{ action: "ready" }}
          className={`btn ${allReady ? "btn-primary" : "btn-outline"} btn-sm`}
          successMessage="Packed — sent to the next station"
        >
          <Icon name="check" size={13} /> Bump ticket
        </OpsButton>
        <Link href={`/order/${order.code}`} className="btn btn-ghost btn-sm" target="_blank">
          Customer view
        </Link>
      </div>
    </article>
  );
}

export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const session = await requireRole(["admin", "manager", "kitchen"]);
  const { focus } = await searchParams;
  const db = getDb();

  const queued = listOrders(db, { status: ["confirmed"], limit: 30 });
  const cooking = listOrders(db, { status: ["preparing"], limit: 30 });
  const packed = listOrders(db, { status: ["ready", "awaiting_collection"], limit: 20 });
  const recipes = db
    .prepare("SELECT id, name, output_unit, prep_minutes FROM recipes WHERE active = 1 ORDER BY name")
    .all() as { id: number; name: string; output_unit: string; prep_minutes: number }[];
  const batches = db
    .prepare(
      `SELECT b.id, b.ref, b.planned_qty, b.started_at, b.notes, r.name AS recipe_name, r.output_unit
       FROM production_batches b JOIN recipes r ON r.id = b.recipe_id
       WHERE b.status = 'in_progress' ORDER BY b.id DESC LIMIT 8`,
    )
    .all() as { id: number; ref: string; planned_qty: number; started_at: string; notes: string | null; recipe_name: string; output_unit: string }[];
  const cogs = cogsTotals(db, 1);
  const lowStock = lowStockMaterials(db, 4);

  const columns = [
    { key: "queued", title: "Queue", orders: queued, hint: "Accepted at counter" },
    { key: "cooking", title: "On the fire", orders: cooking, hint: "In preparation" },
    { key: "packed", title: "Packed / ready", orders: packed, hint: "Awaiting pickup or courier" },
  ];

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <AutoRefresh intervalMs={8000} />
      <main className="container portal-main">
        <div className="page-head">
          <div>
            <h1>Kitchen display</h1>
            <p>Orders auto-route here once the counter accepts. Tick items as they are prepared — customers see the same percentage.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge badge-amber">{queued.length + cooking.length} open tickets</span>
            <Link href="/counter" className="btn btn-ghost btn-sm">
              Counter
            </Link>
          </div>
        </div>

        <div className="queue-grid">
          {columns.map((column) => (
            <section key={column.key} className="queue-col">
              <header>
                <div>
                  <h3>{column.title}</h3>
                  <div className="tiny" style={{ color: "var(--muted-2)" }}>{column.hint}</div>
                </div>
                <span className="queue-count">{column.orders.length}</span>
              </header>
              {column.orders.length === 0 ? (
                <div className="tiny" style={{ color: "var(--muted-2)", padding: "20px 4px" }}>
                  Nothing here.
                </div>
              ) : (
                column.orders.map((order) => <Ticket key={order.id} order={order} focus={focus ?? ""} />)
              )}
            </section>
          ))}
        </div>

        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-head">
            <h3>
              <Icon name="box" size={16} /> Production — naan, roti &amp; prep
            </h3>
            <span className="tiny muted">Material costs are lodged as each batch is completed</span>
          </div>

          <StartBatchForm recipes={recipes} />

          <div style={{ marginTop: 18 }}>
            {batches.length === 0 ? (
              <p className="small muted">No open production runs.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Recipe</th>
                      <th>Qty</th>
                      <th>Started</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <b>{batch.ref}</b>
                        </td>
                        <td>{batch.recipe_name}</td>
                        <td>
                          {batch.planned_qty} {batch.output_unit}
                        </td>
                        <td>{minutesSince(batch.started_at)} min ago</td>
                        <td className="tiny muted">{batch.notes}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <OpsButton
                              endpoint="/api/ops/production"
                              payload={{ action: "complete", batchId: batch.id }}
                              className="btn btn-green btn-sm"
                              confirmMessage="Complete this batch and post material costs?"
                              successMessage="Batch completed — costs posted"
                            >
                              Complete
                            </OpsButton>
                            <OpsButton
                              endpoint="/api/ops/production"
                              payload={{ action: "cancel", batchId: batch.id }}
                              className="btn btn-ghost btn-sm"
                              confirmMessage="Cancel this batch?"
                            >
                              Cancel
                            </OpsButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-3" style={{ marginTop: 18, gap: 12 }}>
            <div className="stat-card">
              <span>COGS posted today</span>
              <b>{money(cogs.cost_cents)}</b>
              <small>{cogs.batches} batch(es)</small>
            </div>
            <div className="stat-card" style={{ gridColumn: "span 2" }}>
              <span>Low stock</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {lowStock.length === 0 ? <small>Everything above reorder level.</small> : null}
                {lowStock.map((material) => (
                  <span key={material.id} className="badge badge-red">
                    {material.name}: {material.stock_qty}
                    {material.unit}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="notice" style={{ marginTop: 18 }}>
          <Icon name="sparkle" size={15} />
          <span>
            Kitchen screen tip: mark individual items as you plate them. The customer progress bar moves from 20% to 78%
            as items are ticked, then hits 85% when the ticket is bumped.
          </span>
        </div>
      </main>
    </div>
  );
}
