import type { Metadata } from "next";
import Link from "next/link";
import { TrackLookup } from "@/components/TrackLookup";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track an order",
  description:
    "Enter your Khan Baba order code to see exactly where your food is — accepted, cooking, packed, on the way.",
};

export default function TrackPage() {
  return (
    <section className="section-tight" style={{ paddingTop: 44, paddingBottom: 64 }}>
      <div className="container">
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <span className="eyebrow">Where is my food?</span>
          <h1 style={{ fontSize: "clamp(1.9rem, 4.4vw, 2.9rem)", margin: "14px 0 10px" }}>
            Track your order.
          </h1>
          <p className="muted small" style={{ marginBottom: 22 }}>
            Enter the code from your receipt (it starts with <code>KB-</code>) or
            paste the tracking link you were sent. No login needed.
          </p>

          <div className="panel">
            <TrackLookup />
          </div>

          <div className="notice" style={{ marginTop: 18 }}>
            <Icon name="shield" size={15} />
            <span>
              Lost the code? Sign in with the email you ordered with —{" "}
              <Link href="/login?reason=signin" style={{ color: "var(--accent)" }}>
                every order is listed there
              </Link>
              .
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
