import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { getLatestJob, getOrderItems, listOrders } from "@/lib/orders";
import { configuredProviders, providerLabel, uberConfigured } from "@/lib/delivery";
import { trackingSnapshot } from "@/lib/drivers";
import { DeliveryMap } from "@/components/DeliveryMap";
import { minutesSince } from "@/lib/time";
import { money } from "@/lib/money";
import { PortalNav } from "@/components/portal/PortalNav";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { OpsButton } from "@/components/portal/OpsButton";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const PROVIDER_LABEL: Record<string, string> = {
  uber_direct: "Uber Direct",
  doordash_drive: "DoorDash Drive",
  own_fleet: "Khan Baba drivers",
  simulated: "Local courier (sandbox)",
};

export default async function DeliveryPage() {
  const session = await requireRole(["admin", "manager", "delivery"]);
  const db = await getDb();

  const [awaitingDispatch, inTransit, pickups, completedToday, uberLive, partners] =
    await Promise.all([
      listOrders(db, { status: ["ready"], channel: "delivery", limit: 30 }),
      listOrders(db, { status: ["out_for_delivery"], limit: 30 }),
      listOrders(db, {
        status: ["awaiting_collection"],
        channel: "pickup",
        limit: 20,
      }),
      db.query<{
        code: string;
        customer_name: string;
        total_cents: number;
        delivery_fee_cents: number;
        completed_at: string;
        cost_cents: number | null;
        courier_name: string | null;
        provider: string | null;
      }>(
        `SELECT o.code, o.customer_name, o.total_cents, o.delivery_fee_cents, o.completed_at,
              j.cost_cents, j.courier_name, j.provider
       FROM orders o LEFT JOIN delivery_jobs j ON j.id = (SELECT MAX(id) FROM delivery_jobs WHERE order_id = o.id)
       WHERE o.channel = 'delivery' AND o.status = 'completed' AND o.completed_at::date = CURRENT_DATE
       ORDER BY o.completed_at DESC LIMIT 12`,
      ),
      uberConfigured(db),
      configuredProviders(db),
    ]);
  const mapOrder = inTransit[0];
  const mapData = mapOrder
    ? await trackingSnapshot(db, {
        id: mapOrder.id,
        code: mapOrder.code,
        address: mapOrder.address,
        suburb: mapOrder.suburb,
        postcode: mapOrder.postcode,
        delivery_lat: mapOrder.delivery_lat,
        delivery_lng: mapOrder.delivery_lng,
        dispatched_at: mapOrder.dispatched_at,
        status: mapOrder.status,
      })
    : null;

  const marginToday = completedToday.reduce(
    (sum, row) => sum + (row.delivery_fee_cents - (row.cost_cents ?? 0)),
    0,
  );

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <AutoRefresh intervalMs={9000} />
      <main className="container portal-main">
        <div className="page-head">
          <div>
            <h1>Delivery desk</h1>
            <p>
              Confirm the live courier quote, trigger the delivery request and
              track it through to the door.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span
              className={`badge ${uberLive ? "badge-green" : "badge-amber"}`}
            >
              {uberLive ? "Uber Direct connected" : "Uber Direct sandbox"}
            </span>
            <Link href="/admin/delivery" className="btn btn-ghost btn-sm">
              Settings
            </Link>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <span>Awaiting dispatch</span>
            <b
              style={{
                color:
                  awaitingDispatch.length > 0 ? "var(--accent)" : undefined,
              }}
            >
              {awaitingDispatch.length}
            </b>
            <small>Packed, ready for a courier</small>
          </div>
          <div className="stat-card">
            <span>On the road</span>
            <b>{inTransit.length}</b>
            <small>Courier assigned</small>
          </div>
          <div className="stat-card">
            <span>Pickups waiting</span>
            <b>{pickups.length}</b>
            <small>Click &amp; collect counter</small>
          </div>
          <div className="stat-card">
            <span>Delivery margin today</span>
            <b>{money(marginToday)}</b>
            <small>{completedToday.length} delivered</small>
          </div>
        </div>

        {mapData && mapOrder ? (
          <section className="panel" style={{ marginBottom: 24 }}>
            <div className="panel-head">
              <h3 style={{ fontSize: "1.05rem" }}>Live map · {mapOrder.code}</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge badge-blue">
                  {partners.length ? partners.map(providerLabel).join(" · ") : "sandbox courier"}
                </span>
                <Link href="/admin/drivers" className="btn btn-ghost btn-sm">
                  Driver management
                </Link>
              </div>
            </div>
            <DeliveryMap
              data={mapData}
              title={`Tracking ${mapOrder.customer_name} · ${mapOrder.address ?? ""}`}
              refreshUrl="/api/ops/tracking"
            />
            {inTransit.length > 1 ? (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Showing the newest of {inTransit.length} deliveries on the road.
                Customers see the same live map on their tracking page.
              </p>
            ) : null}
          </section>
        ) : null}

        <section style={{ marginBottom: 30 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: "1.25rem" }}>Ready to dispatch</h2>
            <span className="tiny muted">
              Quote is re-checked at dispatch — you approve the final cost
            </span>
          </div>

          {awaitingDispatch.length === 0 ? (
            <div className="card empty" style={{ padding: 30 }}>
              <div className="icon">
                <Icon name="bike" size={26} />
              </div>
              <b>No deliveries waiting</b>
              <p className="small">
                Packed delivery orders land here automatically from the kitchen.
              </p>
            </div>
          ) : (
            <div className="grid grid-2">
              {await Promise.all(
                awaitingDispatch.map(async (order) => {
                  const job = await getLatestJob(db, order.id);
                  const itemCount = (await getOrderItems(db, order.id)).reduce(
                    (sum, item) => sum + item.qty,
                    0,
                  );
                  const charged =
                    job?.customer_fee_cents ?? order.delivery_fee_cents;
                  const cost = job?.cost_cents ?? order.delivery_cost_cents;
                  const margin = charged - cost;
                  const unpaid = order.payment_status !== "paid";
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
                            <StatusBadge status={order.status} />
                            {order.priority ? (
                              <span className="badge badge-amber">
                                Priority
                              </span>
                            ) : null}
                            {unpaid ? (
                              <span className="badge badge-red">Unpaid</span>
                            ) : null}
                          </div>
                          <div className="tiny muted" style={{ marginTop: 6 }}>
                            {order.customer_name} · {itemCount} item(s) · packed{" "}
                            {minutesSince(order.ready_at)} min ago
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="strong">
                            {money(order.total_cents)}
                          </div>
                          <div className="tiny muted">customer total</div>
                        </div>
                      </div>

                      <div className="quote-box" style={{ marginTop: 12 }}>
                        <div className="row">
                          <span className="muted">Drop-off</span>
                          <span style={{ textAlign: "right", maxWidth: 220 }}>
                            {order.address}
                            {order.suburb ? `, ${order.suburb}` : ""}{" "}
                            {order.postcode ?? ""}
                          </span>
                        </div>
                        <div className="row" style={{ marginTop: 6 }}>
                          <span className="muted">Courier provider</span>
                          <span>
                            {PROVIDER_LABEL[job?.provider ?? "simulated"] ??
                              job?.provider}
                          </span>
                        </div>
                        <div className="row" style={{ marginTop: 6 }}>
                          <span className="muted">
                            Courier cost (live quote)
                          </span>
                          <span>{money(cost)}</span>
                        </div>
                        <div className="row" style={{ marginTop: 6 }}>
                          <span className="muted">Customer was charged</span>
                          <span>{money(charged)}</span>
                        </div>
                        <div
                          className="row"
                          style={{
                            marginTop: 6,
                            borderTop: "1px solid var(--line)",
                            paddingTop: 8,
                          }}
                        >
                          <span className="strong">Delivery margin</span>
                          <span
                            className="strong"
                            style={{
                              color:
                                margin >= 0 ? "var(--green)" : "var(--red)",
                            }}
                          >
                            {money(margin)}
                          </span>
                        </div>
                      </div>

                      <div className="ticket-actions" style={{ marginTop: 12 }}>
                        <OpsButton
                          endpoint={`/api/ops/orders/${order.id}`}
                          payload={{ action: "quote" }}
                          className="btn btn-outline btn-sm"
                          successMessage="Quote refreshed"
                        >
                          Refresh quote
                        </OpsButton>
                        <OpsButton
                          endpoint={`/api/ops/orders/${order.id}`}
                          payload={{ action: "dispatch" }}
                          className="btn btn-primary btn-sm"
                          confirmMessage={`Request a courier for ${order.code} at ${money(cost)}?`}
                          successMessage="Courier requested"
                          disabled={unpaid}
                          title={
                            unpaid
                              ? "Payment must be captured first"
                              : undefined
                          }
                        >
                          <Icon name="truck" size={14} /> Request courier
                        </OpsButton>
                        <Link
                          href={`/order/${order.code}`}
                          className="btn btn-ghost btn-sm"
                          target="_blank"
                        >
                          Customer tracking
                        </Link>
                      </div>
                    </article>
                  );
                }),
              )}
            </div>
          )}
        </section>

        {inTransit.length > 0 ? (
          <section style={{ marginBottom: 30 }}>
            <h2 style={{ fontSize: "1.25rem", marginBottom: 12 }}>
              On the road
            </h2>
            <div className="grid grid-2">
              {await Promise.all(
                inTransit.map(async (order) => {
                  const job = await getLatestJob(db, order.id);
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
                            <StatusBadge status={order.status} />
                          </div>
                          <div className="tiny muted" style={{ marginTop: 6 }}>
                            {order.customer_name} · {order.address}
                            {order.suburb ? `, ${order.suburb}` : ""}
                          </div>
                          <div className="tiny muted" style={{ marginTop: 4 }}>
                            {job?.courier_name
                              ? `Courier ${job.courier_name}`
                              : "Courier assigned"}{" "}
                            · dispatched {minutesSince(order.dispatched_at)} min
                            ago
                            {job?.eta_minutes
                              ? ` · ETA ${job.eta_minutes} min`
                              : ""}
                          </div>
                        </div>
                        <div className="eta-pill">
                          <Icon name="bike" size={12} />{" "}
                          {job?.status ?? "en route"}
                        </div>
                      </div>
                      <div className="ticket-actions" style={{ marginTop: 12 }}>
                        <OpsButton
                          endpoint={`/api/ops/orders/${order.id}`}
                          payload={{ action: "sync" }}
                          className="btn btn-outline btn-sm"
                          successMessage="Status synced"
                        >
                          Sync courier status
                        </OpsButton>
                        <OpsButton
                          endpoint={`/api/ops/orders/${order.id}`}
                          payload={{ action: "delivered" }}
                          className="btn btn-green btn-sm"
                          confirmMessage="Mark this delivery complete?"
                          successMessage="Delivery completed"
                        >
                          Mark delivered
                        </OpsButton>
                        {job?.tracking_url ? (
                          <a
                            href={job.tracking_url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-ghost btn-sm"
                          >
                            Tracking link
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                }),
              )}
            </div>
          </section>
        ) : null}

        <div className="grid grid-2">
          <section>
            <h2 style={{ fontSize: "1.25rem", marginBottom: 12 }}>
              Click &amp; collect
            </h2>
            {pickups.length === 0 ? (
              <p className="small muted">No pickups waiting.</p>
            ) : (
              pickups.map((order) => (
                <article
                  key={order.id}
                  className="panel"
                  style={{ marginBottom: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <b>{order.code}</b>
                      <div className="tiny muted">
                        {order.customer_name} · {order.phone ?? "no phone"} ·{" "}
                        {money(order.total_cents)}
                      </div>
                    </div>
                    <OpsButton
                      endpoint={`/api/ops/orders/${order.id}`}
                      payload={{ action: "collected" }}
                      className="btn btn-green btn-sm"
                      successMessage="Handed over"
                    >
                      Mark collected
                    </OpsButton>
                  </div>
                </article>
              ))
            )}
          </section>

          <section>
            <h2 style={{ fontSize: "1.25rem", marginBottom: 12 }}>
              Delivered today
            </h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Courier</th>
                    <th>Charged</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {completedToday.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Nothing delivered yet today.
                      </td>
                    </tr>
                  ) : (
                    completedToday.map((row) => (
                      <tr key={row.code}>
                        <td>
                          <b>{row.code}</b>
                          <div className="tiny muted">{row.customer_name}</div>
                        </td>
                        <td className="tiny">{row.courier_name ?? "—"}</td>
                        <td>{money(row.delivery_fee_cents)}</td>
                        <td>{money(row.cost_cents ?? 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="notice" style={{ marginTop: 22 }}>
          <Icon name="shield" size={15} />
          <span>
            The customer is charged the courier quote plus the restaurant&apos;s
            service margin at checkout. Any difference between that quote and
            the final courier invoice is shown above as delivery margin or
            variance.
          </span>
        </div>
      </main>
    </div>
  );
}
