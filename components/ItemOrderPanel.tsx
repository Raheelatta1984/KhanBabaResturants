"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/money";
import type { ItemView } from "@/lib/types";
import { useCart } from "./CartProvider";
import { Icon } from "./Icon";
import { SPICE_INFO } from "./ui";

export function ItemOrderPanel({ item }: { item: ItemView }) {
  const router = useRouter();
  const { add } = useCart();
  const defaultVariant = item.variants.find((variant) => variant.isDefault) ?? item.variants[0];
  const [variantId, setVariantId] = useState(defaultVariant?.id ?? 0);
  const [spice, setSpice] = useState(item.spiceLevels[0] ?? "");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [added, setAdded] = useState(false);

  const variant = item.variants.find((entry) => entry.id === variantId) ?? defaultVariant;
  const lineTotal = (variant?.priceCents ?? 0) * qty;

  if (!variant) {
    return <div className="notice notice-red">This dish is temporarily unavailable online. Please call the restaurant.</div>;
  }

  function addToCart(goToCheckout: boolean) {
    add(
      {
        itemId: item.id,
        variantId: variant.id,
        slug: item.slug,
        name: item.name,
        image: item.image,
        variantLabel: variant.label,
        sizeMl: variant.sizeMl,
        unitPriceCents: variant.priceCents,
        spice: item.spiceLevels.length > 0 ? spice || item.spiceLevels[0] : null,
        notes: notes.trim() || undefined,
      },
      qty,
    );
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
    if (goToCheckout) router.push("/checkout");
  }

  return (
    <div>
      {item.variants.length > 1 ? (
        <div className="option-block">
          <span className="label">Container size</span>
          <div className="option-grid">
            {item.variants.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="option"
                data-active={entry.id === variantId ? "true" : "false"}
                onClick={() => setVariantId(entry.id)}
              >
                <b>{entry.label}</b>
                <span>{entry.sizeMl ? `${entry.sizeMl >= 1000 ? "Sharing size · feeds 2–3" : "Individual portion"}` : "Single portion"}</span>
                <span className="amt">{money(entry.priceCents)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="option-block">
          <span className="label">Portion</span>
          <div className="option" data-active="true" style={{ cursor: "default" }}>
            <b>{variant.label}</b>
            <span className="amt">{money(variant.priceCents)}</span>
          </div>
        </div>
      )}

      {item.spiceLevels.length > 0 ? (
        <div className="option-block">
          <span className="label">Spice level</span>
          <div className="spice-grid">
            {item.spiceLevels.map((level) => {
              const info = SPICE_INFO[level] ?? { label: level, chillies: "•", description: "" };
              return (
                <button key={level} type="button" className="spice" data-active={spice === level ? "true" : "false"} onClick={() => setSpice(level)} title={info.description}>
                  <span className="chilli" aria-hidden="true">
                    {info.chillies}
                  </span>
                  {info.label}
                  <small>{level === "blend" ? "house blend" : level === "extra_hot" ? "brave" : level}</small>
                </button>
              );
            })}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {(SPICE_INFO[spice] ?? { description: "" }).description} — our kitchen seasons to order, so heat is adjusted, never added as an afterthought.
          </p>
        </div>
      ) : null}

      <div className="option-block">
        <span className="label">Kitchen notes (optional)</span>
        <textarea
          className="textarea"
          placeholder="Allergies, no onion, extra raita…"
          value={notes}
          maxLength={200}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
        <div className="qty">
          <button type="button" onClick={() => setQty((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">
            <Icon name="minus" size={15} />
          </button>
          <span>{qty}</span>
          <button type="button" onClick={() => setQty((value) => Math.min(30, value + 1))} aria-label="Increase quantity">
            <Icon name="plus" size={15} />
          </button>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => addToCart(true)} disabled={!item.available}>
          Add · {money(lineTotal)}
        </button>
        <button type="button" className={`btn btn-outline ${added ? "btn-green" : ""}`} onClick={() => addToCart(false)} disabled={!item.available}>
          <Icon name={added ? "check" : "cart"} size={16} />
          {added ? "Added" : "Add to order"}
        </button>
      </div>

      {!item.available ? (
        <p className="notice notice-red" style={{ marginTop: 16 }}>
          This dish is off the menu right now. Browse the rest of the menu — the kitchen updates availability in real time.
        </p>
      ) : (
        <p className="tiny muted" style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="clock" size={12} /> Prepared fresh in about {item.prepMinutes} minutes · 100% halal kitchen
        </p>
      )}
    </div>
  );
}
