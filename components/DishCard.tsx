"use client";

import Link from "next/link";
import { useState } from "react";
import { money } from "@/lib/money";
import type { ItemView } from "@/lib/types";
import { useCart } from "./CartProvider";
import { Icon } from "./Icon";
import { Stars } from "./ui";

export function DishCard({ item }: { item: ItemView }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const defaultVariant = item.variants.find((variant) => variant.isDefault) ?? item.variants[0];
  const cheapest = item.variants.reduce(
    (min, variant) => (variant.priceCents < min ? variant.priceCents : min),
    item.variants[0]?.priceCents ?? 0,
  );

  if (!defaultVariant) return null;

  function quickAdd() {
    add({
      itemId: item.id,
      variantId: defaultVariant.id,
      slug: item.slug,
      name: item.name,
      image: item.image,
      variantLabel: defaultVariant.label,
      sizeMl: defaultVariant.sizeMl,
      unitPriceCents: defaultVariant.priceCents,
      spice: item.spiceLevels.length > 0 ? item.spiceLevels[0] : null,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <article className="dish-card">
      <Link href={`/menu/${item.slug}`} className="dish-media" aria-label={`View ${item.name}`}>
        <img src={item.image} alt={item.name} loading="lazy" />
        <div className="badges">
          {item.isNew ? <span className="badge badge-amber">New</span> : null}
          {item.isVeg ? <span className="badge badge-green">Veg</span> : null}
          {item.spiceLevels.length > 0 ? <span className="badge">Spice selectable</span> : null}
        </div>
      </Link>
      <div className="dish-body">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <h3>
            <Link href={`/menu/${item.slug}`}>{item.name}</Link>
          </h3>
          {item.rating.count > 0 ? <Stars rating={item.rating.avg} /> : null}
        </div>
        <span className="tagline">{item.tagline ?? item.categoryName}</span>
        <p className="dish-desc">{item.description}</p>
        <div className="dish-meta">
          <span className="dish-price">
            {money(cheapest)}
            {item.variants.length > 1 ? <small> onwards</small> : null}
          </span>
          <div className="dish-actions">
            <Link href={`/menu/${item.slug}`} className="btn btn-ghost btn-sm" aria-label={`Customise ${item.name}`}>
              <Icon name="eye" size={14} />
            </Link>
            <button
              type="button"
              className={`add-btn ${added ? "added" : ""}`}
              onClick={quickAdd}
              aria-label={`Add ${item.name} to cart`}
              title="Quick add — choose size and spice on the dish page"
            >
              <Icon name={added ? "check" : "plus"} size={18} />
            </button>
          </div>
        </div>
        <span className="tiny" style={{ color: "var(--muted-2)" }}>
          <Icon name="clock" size={11} /> {item.prepMinutes} min prep · {item.available ? "available now" : "unavailable"}
        </span>
      </div>
    </article>
  );
}
