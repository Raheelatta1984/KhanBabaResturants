import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { PortalNav } from "@/components/portal/PortalNav";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { StatusBadge } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type CustomerHit = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  guest: boolean;
  last_order_at: string | null;
  created_at: string;
  order_count: number;
  lifetime_cents: number;
  last_code: string | null;
  last_status: string | null;
};

/**
 * Counter-side customer lookup.
 *
 * The reason this exists: a customer rings and says "I ordered twenty minutes
 * ago" with no code. Searching their email or mobile has to find the order and
 * its live status in one screen, whether they ordered as a guest or signed in.
 */
export default async function CounterCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireRole(["admin", "manager", "counter"]);
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const db = await getDb();

  const like = `%${term.toLowerCase()}%`;
  const digits = `%${term.replace(/\D/g, "")}%`;

  let results: CustomerHit[] = [];
  if (term.length >= 2) {
    results = await db.query<CustomerHit>(
      `SELECT c.id, c.name, c.email, c.phone, c.guest, c.last_order_at, c.created_at,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_cents ELSE 0 END), 0) AS lifetime_cents,
              (SELECT code FROM orders WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_code,
              (SELECT status FROM orders WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_status
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id
       WHERE lower(c.email) LIKE $1 OR lower(c.name) LIKE $1
          OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE $2
       GROUP BY c.id
       ORDER BY c.last_order_at DESC NULLS LAST, c.id DESC
       LIMIT 25`,
      [like, digits],
    );
  }

  // Orders that have not been linked to an account yet, matched on what the
  // customer remembers: their email or the last digits of their mobile.
  const looseOrders =
    term.length >= 2
      ? await db.query<{
          id: number;
          code: string;
          customer_name: string;
          email: string | null;
          phone: string | null;
          channel: string;
          status: string;
          total_cents: number;
          created_at: string;
          tracking_token: string | null;
        }>(
          `SELECT id, code, customer_name, email, phone, channel, status, total_cents, created_at, tracking_token
           FROM orders
           WHERE customer_id IS NULL
             AND (lower(COALESCE(email, '')) LIKE $1 OR lower(customer_name) LIKE $1
                  OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE $2)
           ORDER BY created_at DESC LIMIT 15`,
          [like, digits],
        )
      : [];

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <main className="container portal-main">
        <div className="page-head">
          <div>
            <h1>Customers</h1>
            <p>
              Search by name, email or mobile. Guest orders show up too, so a
              phone call can be answered without an order code.
            </p>
          </div>
          <Link href="/counter" className="btn btn-ghost btn-sm">
            <Icon name="arrow" size={14} /> Back to counter
          </Link>
        </div>

        <form className="panel" method="get" style={{ marginBottom: 18 }}>
          <div className="form-row">
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <span className="label">Search customers</span>
              <input
                className="input"
                name="q"
                defaultValue={term}
                placeholder="Ayesha, 0412 345 678, ayesha@example.com"
                autoFocus
              />
            </div>
            <button className="btn btn-primary" type="submit">
              <Icon name="search" size={15} /> Search
            </button>
          </div>
        </form>

        {term.length >= 2 ? (
          <>
            <section className="panel">
              <div className="panel-head">
                <h3>Accounts</h3>
                <span className="tiny muted">{results.length} match(es)</span>
              </div>
              {results.length === 0 ? (
                <p className="small muted">
                  No account matches “{term}”. Check the guest orders below — they
                  may not have signed up.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Contact</th>
                        <th>Orders</th>
                        <th>Lifetime</th>
                        <th>Last order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <div className="strong small">{row.name}</div>
                            <div className="tiny muted">
                              {row.guest ? "Guest — no password" : "Account"}
                            </div>
                          </td>
                          <td className="tiny">
                            <div>{row.email}</div>
                            <div className="muted">{row.phone ?? "—"}</div>
                          </td>
                          <td className="mono small">{Number(row.order_count)}</td>
                          <td className="mono small">{money(Number(row.lifetime_cents))}</td>
                          <td className="tiny">
                            {row.last_code ? (
                              <>
                                <Link
                                  href={`/order/${row.last_code}`}
                                  style={{ color: "var(--accent)" }}
                                >
                                  {row.last_code}
                                </Link>
                                <div className="muted">
                                  {row.last_status?.replace(/_/g, " ")}
                                  {row.last_order_at
                                    ? ` · ${formatDateTime(row.last_order_at)}`
                                    : ""}
                                </div>
                              </>
                            ) : (
                              <span className="muted">No orders</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3>Guest orders not yet linked</h3>
                <span className="tiny muted">{looseOrders.length}</span>
              </div>
              {looseOrders.length === 0 ? (
                <p className="small muted">Nothing unlinked matches that search.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Name</th>
                        <th>Contact</th>
                        <th>Status</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {looseOrders.map((order) => (
                        <tr key={order.id}>
                          <td>
                            {order.tracking_token ? (
                              <Link
                                href={`/t/${order.tracking_token}`}
                                className="mono small"
                                style={{ color: "var(--accent)" }}
                              >
                                {order.code}
                              </Link>
                            ) : (
                              <span className="mono small">{order.code}</span>
                            )}
                          </td>
                          <td className="small">{order.customer_name}</td>
                          <td className="tiny muted">
                            {order.email ?? "—"}
                            {order.phone ? ` · ${order.phone}` : ""}
                          </td>
                          <td>
                            <StatusBadge status={order.status} />
                          </td>
                          <td className="mono small">{money(order.total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="notice">
            <Icon name="user" size={15} />
            <span>
              Type at least two characters. Tip: customers who ordered as a guest
              can turn their order into an account by using the claim link on
              their tracking page.
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
