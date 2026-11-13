import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCategories, getMenuItems } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { stripeConfigured } from "@/lib/payments";
import { TableOrderClient } from "@/components/TableOrderClient";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type TableRow = {
  id: number;
  code: string;
  name: string;
  zone: string | null;
  seats: number;
  active: boolean;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Table ${code.replace("T", "")} ordering`,
    description: "Order from your table at Khan Baba Restaurant.",
    robots: { index: false },
  };
}

export default async function TableOrderPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = await getDb();
  const table = await db.maybeOne<TableRow>(
    "SELECT * FROM dining_tables WHERE code = $1 AND active",
    [code.toUpperCase()],
  );
  if (!table) notFound();

  const [settings, categories, items] = await Promise.all([
    getSettings(),
    getCategories(db),
    getMenuItems(db),
  ]);
  const paymentMode: "simulated" | "stripe" =
    (settings.payment_provider === "stripe" ||
      settings.payment_provider === "auto") &&
    (await stripeConfigured())
      ? "stripe"
      : "simulated";

  return (
    <section className="section-tight" style={{ paddingTop: 26 }}>
      <div className="container">
        <nav
          className="tiny muted"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <Link href="/">Khan Baba</Link> <span>/</span>{" "}
          <span style={{ color: "var(--text)" }}>Table ordering</span>
        </nav>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div>
            <span className="eyebrow">Scan · order · track</span>
            <h1
              style={{
                fontSize: "clamp(1.9rem, 4vw, 2.8rem)",
                margin: "10px 0 6px",
              }}
            >
              {table.name}
            </h1>
            <p className="muted small">
              Order straight to the kitchen from your phone. No app, no waiting
              for a menu.
            </p>
          </div>
          <div className="chips">
            <span className="badge badge-green">
              <Icon name="shield" size={11} /> Halal kitchen
            </span>
            <span className="badge">
              <Icon name="table" size={11} /> {table.seats} seats
            </span>
            <span className="badge badge-amber">Live prep tracking</span>
          </div>
        </div>

        {settings.table_ordering_enabled !== "1" ? (
          <div className="notice notice-red" style={{ marginBottom: 18 }}>
            Table ordering is paused right now. Please order with our team at
            the counter.
          </div>
        ) : (
          <TableOrderClient
            table={{
              code: table.code,
              name: table.name,
              zone: table.zone,
              seats: table.seats,
            }}
            categories={categories}
            items={items}
            paymentMode={paymentMode}
            payAtCounterEnabled={settings.pay_at_counter_enabled === "1"}
          />
        )}
      </div>
    </section>
  );
}
