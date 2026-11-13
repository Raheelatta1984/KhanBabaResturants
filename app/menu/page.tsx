import type { Metadata } from "next";
import Link from "next/link";
import { getCategories, getMenuItems } from "@/lib/catalog";
import { MenuBrowser } from "@/components/MenuBrowser";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Menu",
  description:
    "Browse the full Khan Baba menu — biryani, karahi, tandoor BBQ, naan, burgers and desserts. Order for delivery, pick-up or dine-in.",
};

export default async function MenuPage() {
  const [categories, items] = await Promise.all([
    getCategories(),
    getMenuItems(),
  ]);

  return (
    <>
      <section className="section-tight" style={{ paddingTop: 40 }}>
        <div className="container">
          <nav
            className="tiny muted"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 18,
            }}
          >
            <Link href="/">Home</Link> <span>/</span>{" "}
            <span style={{ color: "var(--text)" }}>Menu</span>
          </nav>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 24,
              flexWrap: "wrap",
              marginBottom: 28,
            }}
          >
            <div>
              <span className="eyebrow">Cooked to order</span>
              <h1
                style={{
                  fontSize: "clamp(2.2rem, 5vw, 3.4rem)",
                  margin: "14px 0 10px",
                }}
              >
                The full menu.
              </h1>
              <p className="muted" style={{ maxWidth: "58ch" }}>
                Choose a container size, pick your heat and see every ingredient
                before you order. Delivery quotes are live from Uber Direct;
                click &amp; collect is usually ready in 20 minutes.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="badge badge-green">100% halal</span>
              <span className="badge badge-amber">500 ml / 1 L</span>
              <span className="badge">
                <Icon name="clock" size={11} /> 20 min pick-up
              </span>
            </div>
          </div>

          <MenuBrowser categories={categories} items={items} />
        </div>
      </section>
    </>
  );
}
