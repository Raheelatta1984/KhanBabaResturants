"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/money";
import type { CategoryView, ItemView } from "@/lib/types";
import { useCart } from "./CartProvider";
import { Icon } from "./Icon";

type Pricing = {
  subtotalCents: number;
  surchargeCents: number;
  surchargeDetail?: string | null;
  totalCents: number;
  adjustments: { code: string; label: string; amountCents: number }[];
  context: { isWeekend: boolean; holidayName: string | null };
};

export function TableOrderClient({
  table,
  categories,
  items,
  paymentMode,
  payAtCounterEnabled,
  payAtCounterOnly = false,
}: {
  table: { code: string; name: string; zone: string | null; seats: number };
  categories: CategoryView[];
  items: ItemView[];
  paymentMode: "simulated" | "stripe";
  payAtCounterEnabled: boolean;
  /** House rule: a guest at the table settles at the counter after the meal. */
  payAtCounterOnly?: boolean;
}) {
  const router = useRouter();
  const { items: cart, add, setQty, remove, subtotalCents, clear, hydrated } = useCart();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [name, setName] = useState(`Table ${table.code.replace("T", "")}`);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"online" | "counter">(
    payAtCounterOnly ? "counter" : "online",
  );
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.categorySlug !== category) return false;
      if (!search) return true;
      return (
        item.name.toLowerCase().includes(search) ||
        (item.description ?? "").toLowerCase().includes(search) ||
        item.ingredients.some((ingredient) => ingredient.toLowerCase().includes(search))
      );
    });
  }, [items, category, query]);

  useEffect(() => {
    if (!hydrated || cart.length === 0) {
      setPricing(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "table",
            items: cart.map((item) => ({ variantId: item.variantId, qty: item.qty })),
          }),
        });
        const data = (await response.json()) as { pricing?: Pricing };
        if (alive && data.pricing) setPricing(data.pricing);
      } catch {
        /* keep subtotal fallback */
      }
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [cart, hydrated]);

  async function placeOrder() {
    setError("");
    if (cart.length === 0) return setError("Add something from the menu first.");
    if (name.trim().length < 2) return setError("Add a name for the order.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "table",
          tableCode: table.code,
          customerName: name,
          phone,
          notes,
          priority: false,
          paymentMethod,
          items: cart.map((item) => ({
            itemId: item.itemId,
            variantId: item.variantId,
            qty: item.qty,
            spiceLevel: item.spice,
            notes: item.notes,
          })),
        }),
      });
      const data = (await response.json()) as { error?: string; redirectTo?: string };
      if (!response.ok) throw new Error(data.error || "Could not place the order");
      clear();
      router.push(data.redirectTo ?? "/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  const total = pricing?.totalCents ?? subtotalCents;

  return (
    <>
      <div className="table-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="brand-mark" style={{ width: 44, height: 44 }}>
            {table.code}
          </span>
          <div>
            <div className="small strong">
              Ordering for {table.name} · {table.seats} seats
            </div>
            <div className="tiny muted">{table.zone ?? "Dining room"} · Khan Baba, Pitt Street</div>
          </div>
        </div>
        <div className="tiny muted" style={{ maxWidth: 380 }}>
          {payAtCounterOnly
            ? "Order now — the counter accepts it, the kitchen cooks it, and you settle at the counter after your meal. No need to pay at the table."
            : "Orders are confirmed by the counter, then cooked to order. You can pay now or settle at the counter."}
        </div>
      </div>

      <div className="table-layout">
        <div>
          <div className="menu-toolbar" style={{ position: "static", marginBottom: 16 }}>
            <div className="search-wrap">
              <span className="icon">
                <Icon name="search" size={17} />
              </span>
              <input className="input" placeholder="Search the menu…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <span className="menu-count">{filtered.length} dishes</span>
          </div>

          <div className="chips" style={{ marginBottom: 16 }}>
            <button type="button" className="chip" data-active={category === "all" ? "true" : "false"} onClick={() => setCategory("all")}>
              Everything
            </button>
            {categories.map((entry) => (
              <button key={entry.slug} type="button" className="chip" data-active={category === entry.slug ? "true" : "false"} onClick={() => setCategory(entry.slug)}>
                {entry.name}
              </button>
            ))}
          </div>

          <div className="table-menu">
            {filtered.map((item) => {
              const variant = item.variants.find((entry) => entry.isDefault) ?? item.variants[0];
              if (!variant) return null;
              return (
                <div key={item.id} className="table-dish">
                  <img src={item.image} alt={item.name} loading="lazy" />
                  <div>
                    <h4>{item.name}</h4>
                    <p>{item.tagline ?? item.description}</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                      <span className="small strong">{money(variant.priceCents)}</span>
                      {item.variants.length > 1 ? <span className="tiny muted">{item.variants.length} sizes</span> : null}
                      {item.spiceLevels.length > 0 ? <span className="tag">spice selectable</span> : null}
                      <Link href={`/menu/${item.slug}`} className="tiny" style={{ color: "var(--accent)" }}>
                        customise
                      </Link>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      add({
                        itemId: item.id,
                        variantId: variant.id,
                        slug: item.slug,
                        name: item.name,
                        image: item.image,
                        variantLabel: variant.label,
                        sizeMl: variant.sizeMl,
                        unitPriceCents: variant.priceCents,
                        spice: item.spiceLevels[0] ?? null,
                      })
                    }
                  >
                    <Icon name="plus" size={14} /> Add
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 ? <div className="empty">Nothing matches that search.</div> : null}
          </div>
        </div>

        <aside className="table-cart">
          <div className="panel">
            <div className="panel-head">
              <h3>Your table order</h3>
              <span className="badge badge-amber">{cart.reduce((sum, item) => sum + item.qty, 0)} items</span>
            </div>

            {cart.length === 0 ? (
              <p className="small muted">Tap “Add” on any dish to start. The kitchen gets your ticket once the counter confirms it.</p>
            ) : (
              <>
                <div className="cart-drawer">
                  {cart.map((item) => (
                    <div key={item.key} className="cart-line">
                      <img src={item.image} alt="" />
                      <div>
                        <div className="name">{item.name}</div>
                        <div className="opts">
                          {item.variantLabel}
                          {item.spice ? ` · ${item.spice.replace("_", " ")}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                          <div className="qty" style={{ height: 26 }}>
                            <button type="button" style={{ height: 26, width: 26 }} onClick={() => setQty(item.key, item.qty - 1)} aria-label="Decrease">
                              <Icon name="minus" size={11} />
                            </button>
                            <span style={{ minWidth: 20, fontSize: "0.78rem" }}>{item.qty}</span>
                            <button type="button" style={{ height: 26, width: 26 }} onClick={() => setQty(item.key, item.qty + 1)} aria-label="Increase">
                              <Icon name="plus" size={11} />
                            </button>
                          </div>
                          <button type="button" className="cart-remove" onClick={() => remove(item.key)}>
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="small mono">{money(item.unitPriceCents * item.qty)}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="summary-row">
                    <span>Subtotal</span>
                    <b>{money(subtotalCents)}</b>
                  </div>
                  {pricing?.adjustments.map((line) => (
                    <div className="summary-row" key={line.code}>
                      <span>{line.label}</span>
                      <b>{money(line.amountCents)}</b>
                    </div>
                  ))}
                  <div className="summary-total">
                    <span>Total</span>
                    <b>{money(total)}</b>
                  </div>
                </div>

                <div className="field" style={{ marginTop: 14 }}>
                  <span className="label">Name for the table</span>
                  <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <span className="label">Mobile (optional)</span>
                  <input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="For the counter to reach you" />
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <span className="label">Notes for the kitchen</span>
                  <textarea className="textarea" style={{ minHeight: 64 }} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Allergies, no onion…" maxLength={300} />
                </div>

                {payAtCounterOnly ? (
                  <div className="notice" style={{ marginTop: 14 }}>
                    <span>
                      <strong>Settle at the counter.</strong> Table orders are paid at the counter
                      after the meal — the counter parks the bill until it clears.
                    </span>
                  </div>
                ) : (
                  <div className="pay-tabs" style={{ marginTop: 14 }}>
                    <button type="button" className="pay-tab" data-active={paymentMethod === "online" ? "true" : "false"} onClick={() => setPaymentMethod("online")}>
                      <b>Pay now</b>
                      <span>{paymentMode === "stripe" ? "Secure card payment" : "Sandbox card"}</span>
                    </button>
                    <button
                      type="button"
                      className="pay-tab"
                      data-active={paymentMethod === "counter" ? "true" : "false"}
                      onClick={() => setPaymentMethod("counter")}
                      disabled={!payAtCounterEnabled}
                      style={!payAtCounterEnabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                    >
                      <b>Pay at counter</b>
                      <span>After your meal</span>
                    </button>
                  </div>
                )}

                {error ? (
                  <div className="notice notice-red" style={{ marginTop: 12 }}>
                    {error}
                  </div>
                ) : null}

                <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={placeOrder} disabled={submitting}>
                  {submitting ? "Sending to the counter…" : `Send order · ${money(total)}`}
                </button>
                <p className="tiny" style={{ color: "var(--muted-2)", marginTop: 8 }}>
                  You will get a live tracking page showing preparation progress for this table.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
