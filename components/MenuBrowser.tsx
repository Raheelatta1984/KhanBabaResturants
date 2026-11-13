"use client";

import { useMemo, useState } from "react";
import type { CategoryView, ItemView } from "@/lib/types";
import { DishCard } from "./DishCard";
import { Icon } from "./Icon";

type SortKey = "recommended" | "price-asc" | "price-desc" | "rating";

function priceOf(item: ItemView) {
  return Math.min(...item.variants.map((variant) => variant.priceCents));
}

export function MenuBrowser({ categories, items }: { categories: CategoryView[]; items: ItemView[] }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [spicy, setSpicy] = useState(false);
  const [sort, setSort] = useState<SortKey>("recommended");

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const list = items.filter((item) => {
      if (category !== "all" && item.categorySlug !== category) return false;
      if (vegOnly && !item.isVeg) return false;
      if (spicy && item.spiceLevels.length === 0) return false;
      if (!search) return true;
      return (
        item.name.toLowerCase().includes(search) ||
        (item.description ?? "").toLowerCase().includes(search) ||
        item.ingredients.some((ingredient) => ingredient.toLowerCase().includes(search)) ||
        item.categoryName.toLowerCase().includes(search)
      );
    });

    return [...list].sort((a, b) => {
      if (sort === "price-asc") return priceOf(a) - priceOf(b);
      if (sort === "price-desc") return priceOf(b) - priceOf(a);
      if (sort === "rating") return b.rating.avg - a.rating.avg;
      return Number(b.isFeatured) - Number(a.isFeatured) || a.name.localeCompare(b.name);
    });
  }, [items, category, query, vegOnly, spicy, sort]);

  return (
    <>
      <div className="menu-toolbar">
        <div className="search-wrap">
          <span className="icon">
            <Icon name="search" size={17} />
          </span>
          <input
            className="input"
            placeholder="Search dishes, ingredients or categories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the menu"
          />
        </div>

        <div className="chips">
          <button type="button" className="chip" data-active={vegOnly ? "true" : "false"} onClick={() => setVegOnly((value) => !value)}>
            Vegetarian
          </button>
          <button type="button" className="chip" data-active={spicy ? "true" : "false"} onClick={() => setSpicy((value) => !value)}>
            Spice selectable
          </button>
          <select className="select" style={{ width: 170 }} value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort menu">
            <option value="recommended">Recommended</option>
            <option value="rating">Top rated</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </div>
      </div>

      <div className="chips" style={{ margin: "18px 0 8px" }}>
        <button type="button" className="chip" data-active={category === "all" ? "true" : "false"} onClick={() => setCategory("all")}>
          Everything ({items.length})
        </button>
        {categories.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            className="chip"
            data-active={category === entry.slug ? "true" : "false"}
            onClick={() => setCategory(entry.slug)}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 22px", gap: 12, flexWrap: "wrap" }}>
        <span className="menu-count">
          Showing {filtered.length} of {items.length} dishes
          {category !== "all" ? ` · ${categories.find((c) => c.slug === category)?.description ?? ""}` : ""}
        </span>
        <span className="menu-count">Prices include GST · size &amp; spice chosen on each dish</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="icon">🍽</div>
          <h3>Nothing matches that search</h3>
          <p className="small">Try “biryani”, “naan” or clear the filters.</p>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginTop: 16 }}
            onClick={() => {
              setQuery("");
              setCategory("all");
              setVegOnly(false);
              setSpicy(false);
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-3">
          {filtered.map((item) => (
            <DishCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
