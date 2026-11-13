import Link from "next/link";
import { Icon } from "./Icon";

export function SiteFooter({
  restaurant,
}: {
  restaurant: { name: string; address: string; phone: string; email: string; hours: string };
}) {
  return (
    <footer className="site-footer" id="visit">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link href="/" className="brand" style={{ marginBottom: 16 }}>
              <span className="brand-mark">KB</span>
              <span className="brand-text">
                <b>Khan Baba</b>
                <span>Pakistani kitchen · Sydney</span>
              </span>
            </Link>
            <p className="small muted" style={{ maxWidth: 300 }}>
              Family-owned Pakistani kitchen serving Sydney since 2015. 100% halal, cooked to order, delivered direct.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              <span className="badge badge-green">100% Halal</span>
              <span className="badge badge-amber">Uber Direct</span>
              <span className="badge">Secure payments</span>
            </div>
          </div>

          <div>
            <h4>Order</h4>
            <div className="footer-links">
              <Link href="/menu">Full menu</Link>
              <Link href="/checkout">Delivery</Link>
              <Link href="/menu?mode=pickup">Click &amp; collect</Link>
              <Link href="/table/T04">Order from your table</Link>
              <Link href="/whats-new">What&apos;s new</Link>
            </div>
          </div>

          <div>
            <h4>Team portals</h4>
            <div className="footer-links">
              <Link href="/counter">Counter</Link>
              <Link href="/kitchen">Kitchen</Link>
              <Link href="/delivery">Delivery</Link>
              <Link href="/admin">Admin</Link>
              <Link href="/staff/login">Staff sign in</Link>
            </div>
          </div>

          <div>
            <h4>Visit us</h4>
            <div className="footer-links">
              <span style={{ display: "flex", gap: 8 }}>
                <Icon name="pin" size={15} />
                {restaurant.address}
              </span>
              <a href={`tel:${restaurant.phone.replace(/\s/g, "")}`} style={{ display: "flex", gap: 8 }}>
                <Icon name="phone" size={15} />
                {restaurant.phone}
              </a>
              <span style={{ display: "flex", gap: 8 }}>
                <Icon name="clock" size={15} />
                {restaurant.hours}
              </span>
              <a href={`mailto:${restaurant.email}`}>{restaurant.email}</a>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {restaurant.name}. All prices in AUD and include GST. Public holiday and
            weekend surcharges apply as displayed at checkout.
          </span>
          <span>Built for direct ordering · no aggregator commission</span>
        </div>
      </div>
    </footer>
  );
}
