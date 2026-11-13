import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { publicOrderPayload } from "@/lib/orders";
import { TrackingView } from "@/components/TrackingView";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track your order",
  description: "Follow your Khan Baba order from the counter to the kitchen to your door.",
  robots: { index: false },
};

export default async function OrderTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ new?: string; paid?: string }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const db = getDb();
  const payload = publicOrderPayload(db, code);
  if (!payload) notFound();

  const justPlaced = query.new === "1" || query.paid === "1";

  return (
    <section className="section-tight" style={{ paddingTop: 32 }}>
      <div className="container">
        <nav className="tiny muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
          <Link href="/">Home</Link> <span>/</span>
          <Link href="/menu">Menu</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Order {payload.order.code}</span>
        </nav>

        <TrackingView initial={payload} justPlaced={justPlaced} />

        <div className="notice" style={{ marginTop: 24 }}>
          <Icon name="shield" size={15} />
          <span>
            This tracking link is unique to your order — save it or keep the tab open. Our team sees exactly the same
            status in the kitchen and delivery portals.
          </span>
        </div>
      </div>
    </section>
  );
}
