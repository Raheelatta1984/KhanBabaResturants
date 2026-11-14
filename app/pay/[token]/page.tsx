import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getOrderItems, type OrderRow } from "@/lib/orders";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { stripeConfigured, paypalConfigured } from "@/lib/payments";
import { PayNow } from "@/components/PayNow";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay for your order",
  robots: { index: false },
};

/**
 * The public page behind the WhatsApp payment link.
 *
 * It is deliberately quiet: the order, the total, the items, how to pay — and a
 * reminder that a guest at a table can simply settle at the counter instead.
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const order = await db.maybeOne<OrderRow>(
    "SELECT * FROM orders WHERE payment_link_token = $1",
    [token],
  );
  if (!order) notFound();

  const [items, settings, stripe, paypal] = await Promise.all([
    getOrderItems(db, order.id),
    getSettings(),
    stripeConfigured(),
    paypalConfigured(),
  ]);
  const sandbox = !(stripe || paypal);

  return (
    <section className="section-tight" style={{ paddingTop: 28 }}>
      <div className="container-narrow">
        <nav className="tiny muted" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Link href="/">Khan Baba</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Pay for your order</span>
        </nav>

        <div className="pay-shell">
          <div>
            <div className="page-head" style={{ marginBottom: 18 }}>
              <div>
                <h1 style={{ fontSize: "2.2rem" }}>Your bill</h1>
                <p>
                  {order.customer_name} · {order.code} · placed{" "}
                  {formatDateTime(order.created_at)}
                </p>
              </div>
              <span className="badge badge-green">
                <Icon name="shield" size={12} /> Secure link
              </span>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>What you ordered</h3>
                <span className="tiny muted">
                  {order.channel === "table"
                    ? "Table order"
                    : order.channel === "dine_in"
                      ? "Dine-in"
                      : order.channel === "pickup"
                        ? "Click & collect"
                        : "Delivery"}
                </span>
              </div>
              <div className="ticket-items">
                {items.map((item) => (
                  <div key={item.id} className="ticket-item">
                    <span className="qty">{item.qty}×</span>
                    <span className="nm">{item.name}</span>
                    <span className="sz">{item.variant_label}</span>
                    <span className="amt">{money(item.line_total_cents)}</span>
                  </div>
                ))}
              </div>
              <div className="totals" style={{ marginTop: 14 }}>
                <div>
                  <span>Subtotal</span>
                  <span>{money(order.subtotal_cents)}</span>
                </div>
                {order.surcharge_cents > 0 ? (
                  <div>
                    <span>Surcharge</span>
                    <span>{money(order.surcharge_cents)}</span>
                  </div>
                ) : null}
                {order.delivery_fee_cents > 0 ? (
                  <div>
                    <span>Delivery</span>
                    <span>{money(order.delivery_fee_cents)}</span>
                  </div>
                ) : null}
                {order.discount_cents > 0 ? (
                  <div>
                    <span>Discount</span>
                    <span>−{money(order.discount_cents)}</span>
                  </div>
                ) : null}
                <div className="total">
                  <span>Total</span>
                  <span>{money(order.total_cents)}</span>
                </div>
              </div>
              {order.parked ? (
                <div className="notice" style={{ marginTop: 14 }}>
                  Held at the counter until this bill is settled.
                </div>
              ) : null}
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h3>After you pay</h3>
              </div>
              <ol className="pay-steps">
                <li>The counter receives the payment confirmation instantly.</li>
                <li>The ticket is accepted and sent to the kitchen.</li>
                <li>You get an update on WhatsApp and can follow every step live.</li>
                <li>After the meal, a two-tap feedback link arrives — with the dish photos ready for your Google review.</li>
              </ol>
            </div>
          </div>

          <aside>
            {order.payment_status === "paid" ? (
              <div className="panel" style={{ padding: 26, textAlign: "center" }}>
                <div className="pay-tick" aria-hidden="true">✓</div>
                <h3 style={{ margin: "12px 0 6px" }}>Already paid</h3>
                <p className="small muted">
                  This bill cleared on {formatDateTime(order.paid_at)}. Nothing more to do.
                </p>
                <Link href={`/order/${order.code}`} className="btn btn-primary" style={{ marginTop: 16 }}>
                  Track my order
                </Link>
              </div>
            ) : order.channel === "table" || order.channel === "dine_in" ? (
              <div className="panel" style={{ padding: 26 }}>
                <span className="eyebrow">At the table</span>
                <h3 style={{ margin: "10px 0" }}>Settle at the counter</h3>
                <p className="small muted">
                  {settings.restaurant_name} takes dine-in payment at the counter after the meal — no
                  need to pay online while you are seated. Show this page or the order code{" "}
                  <b>{order.code}</b>.
                </p>
                <p className="tiny muted" style={{ marginTop: 12 }}>
                  The counter can also send this link if you would rather pay now.
                </p>
              </div>
            ) : (
              <PayNow
                token={token}
                code={order.code}
                totalLabel={money(order.total_cents)}
                sandbox={sandbox}
              />
            )}

            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h3 style={{ fontSize: "1rem" }}>Need a hand?</h3>
              </div>
              <p className="tiny muted">
                Call {settings.restaurant_phone} or reply on WhatsApp and the counter will sort it out.
              </p>
              <Link href={`/order/${order.code}`} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
                View live status <Icon name="arrow" size={13} />
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
