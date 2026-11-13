import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCustomerSession, getCurrentCustomer, publicCustomer } from "@/lib/auth/customer";
import { listCustomerOrders } from "@/lib/orders";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { StatusBadge, EmptyState } from "@/components/ui";
import { AccountDetailsForm, SignOutButton } from "@/components/AccountPanels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My account",
  robots: { index: false },
};

const CHANNEL_LABEL: Record<string, string> = {
  delivery: "Delivery",
  pickup: "Click & collect",
  dine_in: "Dine in",
  table: "Table order",
};

const OPEN_STATUSES = [
  "pending_confirm",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "awaiting_collection",
];

export default async function AccountPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/login?next=/account&reason=signin");

  const db = await getDb();
  const customer = await getCurrentCustomer(db);
  if (!customer) redirect("/api/customer/logout");

  const orders = await listCustomerOrders(db, customer.id, 50);
  const active = orders.filter((entry) => OPEN_STATUSES.includes(entry.order.status));
  const past = orders.filter((entry) => !OPEN_STATUSES.includes(entry.order.status));
  const hasPassword = Boolean(customer.password_hash);

  const lifetimeCents = past
    .filter((entry) => entry.order.status !== "cancelled")
    .reduce((sum, entry) => sum + entry.order.total_cents, 0);

  return (
    <section className="section-tight" style={{ paddingTop: 34, paddingBottom: 64 }}>
      <div className="container">
        <div className="page-head" style={{ marginBottom: 22 }}>
          <div>
            <span className="eyebrow">My account</span>
            <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.7rem)", margin: "12px 0 6px" }}>
              Hello, {customer.name.split(" ")[0]}.
            </h1>
            <p className="small muted">
              {customer.email}
              {hasPassword ? "" : " · guest account — set a password to keep it"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/menu" className="btn btn-primary btn-sm">
              <Icon name="cart" size={14} /> Order again
            </Link>
            <SignOutButton />
          </div>
        </div>

        <div className="account-stats">
          <div className="stat-card">
            <span>Orders</span>
            <b>{orders.length}</b>
          </div>
          <div className="stat-card">
            <span>In progress</span>
            <b>{active.length}</b>
          </div>
          <div className="stat-card">
            <span>Lifetime</span>
            <b>{money(lifetimeCents)}</b>
          </div>
          <div className="stat-card">
            <span>Last order</span>
            <b style={{ fontSize: "1.05rem" }}>
              {customer.last_order_at ? formatDateTime(customer.last_order_at) : "—"}
            </b>
          </div>
        </div>

        {active.length > 0 ? (
          <div className="panel" style={{ marginTop: 8 }}>
            <div className="panel-head">
              <h3>
                <span className="step-number">1</span>Live now
              </h3>
              <span className="tiny muted">Updates every few seconds</span>
            </div>
            <div className="order-list">
              {active.map(({ order, items }) => (
                <Link
                  key={order.id}
                  href={order.tracking_token ? `/t/${order.tracking_token}` : `/order/${order.code}`}
                  className="order-card"
                >
                  <div className="order-card-main">
                    <div className="order-card-top">
                      <b className="mono">{order.code}</b>
                      <StatusBadge status={order.status} />
                      <span className="badge badge-amber">
                        {CHANNEL_LABEL[order.channel]}
                      </span>
                    </div>
                    <div className="small muted">
                      {items
                        .map((item) => `${item.qty}× ${item.name}`)
                        .join(" · ")}
                    </div>
                    <div className="order-progress">
                      <i style={{ width: `${Math.max(4, order.progress)}%` }} />
                    </div>
                  </div>
                  <div className="order-card-side">
                    <span className="mono">{money(order.total_cents)}</span>
                    <span className="tiny" style={{ color: "var(--accent)" }}>
                      Track <Icon name="arrow" size={12} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h3>
              <span className="step-number">2</span>Order history
            </h3>
            <span className="tiny muted">{past.length} completed</span>
          </div>
          {past.length === 0 ? (
            <EmptyState
              icon="bag"
              title="No orders yet"
              body="Your past orders will land here — and you can send any of them back to the cart in one tap."
              action={
                <Link href="/menu" className="btn btn-primary">
                  Browse the menu <Icon name="arrow" size={15} />
                </Link>
              }
            />
          ) : (
            <div className="order-list">
              {past.map(({ order, items }) => (
                <div key={order.id} className="order-card" style={{ cursor: "default" }}>
                  <div className="order-card-main">
                    <div className="order-card-top">
                      <b className="mono">{order.code}</b>
                      <StatusBadge status={order.status} />
                      <span className="badge">{CHANNEL_LABEL[order.channel]}</span>
                      <span className="tiny muted">
                        {formatDateTime(order.created_at)}
                      </span>
                    </div>
                    <div className="small muted">
                      {items
                        .map((item) => `${item.qty}× ${item.name}`)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="order-card-side">
                    <span className="mono">{money(order.total_cents)}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Link
                        href={order.tracking_token ? `/t/${order.tracking_token}` : `/order/${order.code}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Receipt
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="account-grid" style={{ marginTop: 18 }}>
          <div className="panel">
            <div className="panel-head">
              <h3>
                <span className="step-number">3</span>Details we remember
              </h3>
            </div>
            <AccountDetailsForm
              customer={publicCustomer(customer)}
              hasPassword={hasPassword}
            />
          </div>

          <div className="panel">
            <h3 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Ordering</h3>
            <div className="auth-points" style={{ marginTop: 0 }}>
              <div>
                <Icon name="table" size={16} />
                <div>
                  <b>At the table</b>
                  <span>
                    Scan the QR at your table — no app, no login needed.
                  </span>
                </div>
              </div>
              <div>
                <Icon name="bag" size={16} />
                <div>
                  <b>Counter</b>
                  <span>Walk-ins are welcome; the counter can place the order for you.</span>
                </div>
              </div>
              <div>
                <Icon name="bike" size={16} />
                <div>
                  <b>Delivery</b>
                  <span>Live courier quote at checkout, tracked to your door.</span>
                </div>
              </div>
            </div>
            <Link href="/whats-new" className="btn btn-outline btn-sm btn-block" style={{ marginTop: 16 }}>
              What&apos;s new at Khan Baba
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
