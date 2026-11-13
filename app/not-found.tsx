import Link from "next/link";

export default function NotFound() {
  return (
    <section className="section" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <div className="container-narrow center">
        <span className="eyebrow">404</span>
        <h1 style={{ margin: "16px 0 12px" }}>That dish has left the pass.</h1>
        <p className="muted">The page you were looking for is not on the menu. Try the full menu or track an order.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 26 }}>
          <Link href="/menu" className="btn btn-primary">
            Browse the menu
          </Link>
          <Link href="/" className="btn btn-outline">
            Back home
          </Link>
        </div>
      </div>
    </section>
  );
}
