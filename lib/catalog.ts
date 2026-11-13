import { getDb, type Db } from "./db";
import type { CategoryView, ItemView, RatingView, ReviewView, VariantView } from "./types";

type MenuRow = {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  image: string | null;
  gallery: string | null;
  youtube_id: string | null;
  ingredients: string | null;
  allergens: string | null;
  spice_levels: string;
  prep_minutes: number;
  is_veg: number;
  is_featured: number;
  is_new: number;
  is_available: number;
  category_slug: string | null;
  category_name: string | null;
  rating_avg: number | null;
  rating_count: number;
};

function splitList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getCategories(db: Db = getDb()): CategoryView[] {
  return db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description,
        (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = c.id AND mi.published = 1 AND mi.is_available = 1) AS count
       FROM categories c WHERE c.active = 1 ORDER BY c.sort_order, c.id`,
    )
    .all() as CategoryView[];
}

export function getMenuItems(
  db: Db = getDb(),
  opts: { featured?: boolean; limit?: number } = {},
): ItemView[] {
  const clauses = ["mi.published = 1"];
  if (opts.featured) clauses.push("mi.is_featured = 1");
  const limit = opts.limit ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "";

  const rows = db
    .prepare(
      `SELECT mi.*, c.slug AS category_slug, c.name AS category_name,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.item_id = mi.id AND r.status = 'published') AS rating_avg,
        (SELECT COUNT(*) FROM reviews r WHERE r.item_id = mi.id AND r.status = 'published') AS rating_count
       FROM menu_items mi LEFT JOIN categories c ON c.id = mi.category_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY mi.sort_order, mi.id ${limit}`,
    )
    .all() as MenuRow[];

  if (rows.length === 0) return [];

  const variantStmt = db.prepare(
    "SELECT id, label, size_ml, price_cents, is_default FROM item_variants WHERE item_id = ? AND active = 1 ORDER BY sort_order, id",
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    categorySlug: row.category_slug ?? "menu",
    categoryName: row.category_name ?? "Menu",
    image: row.image ?? "/images/feast.jpg",
    gallery: splitList(row.gallery),
    youtubeId: row.youtube_id || null,
    ingredients: splitList(row.ingredients),
    allergens: splitList(row.allergens),
    spiceLevels: splitList(row.spice_levels),
    prepMinutes: row.prep_minutes,
    isVeg: Boolean(row.is_veg),
    isFeatured: Boolean(row.is_featured),
    isNew: Boolean(row.is_new),
    available: Boolean(row.is_available),
    variants: (variantStmt.all(row.id) as {
      id: number;
      label: string;
      size_ml: number | null;
      price_cents: number;
      is_default: number;
    }[]).map<VariantView>((variant) => ({
      id: variant.id,
      label: variant.label,
      sizeMl: variant.size_ml,
      priceCents: variant.price_cents,
      isDefault: Boolean(variant.is_default),
    })),
    rating: {
      avg: Number(row.rating_avg ?? 0),
      count: Number(row.rating_count ?? 0),
    } satisfies RatingView,
  }));
}

export function getMenuItem(slug: string, db: Db = getDb()): ItemView | null {
  const items = getMenuItems(db);
  return items.find((item) => item.slug === slug) ?? null;
}

export function getRelatedItems(item: ItemView, limit = 3, db: Db = getDb()): ItemView[] {
  const all = getMenuItems(db);
  const sameCategory = all.filter((candidate) => candidate.categorySlug === item.categorySlug && candidate.id !== item.id);
  const extras = all.filter((candidate) => candidate.categorySlug !== item.categorySlug && candidate.id !== item.id);
  return [...sameCategory, ...extras].slice(0, limit);
}

export function getItemReviews(itemId: number, limit = 12, db: Db = getDb()): ReviewView[] {
  const rows = db
    .prepare(
      "SELECT id, customer_name, rating, comment, created_at FROM reviews WHERE item_id = ? AND status = 'published' ORDER BY datetime(created_at) DESC LIMIT ?",
    )
    .all(itemId, limit) as {
    id: number;
    customer_name: string;
    rating: number;
    comment: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  }));
}

export function getRecentReviews(db: Db, limit = 6) {
  return db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.customer_name, r.created_at, mi.name AS item_name, mi.slug
       FROM reviews r JOIN menu_items mi ON mi.id = r.item_id
       WHERE r.status = 'published' AND r.comment IS NOT NULL
       ORDER BY r.rating DESC, datetime(r.created_at) DESC LIMIT ?`,
    )
    .all(limit) as {
    id: number;
    rating: number;
    comment: string | null;
    customer_name: string;
    created_at: string;
    item_name: string;
    slug: string;
  }[];
}

export function getFeaturedItems(db: Db = getDb(), limit = 4): ItemView[] {
  const featured = getMenuItems(db, { featured: true, limit });
  if (featured.length >= limit) return featured;
  const all = getMenuItems(db);
  const extras = all.filter((item) => !featured.some((f) => f.id === item.id));
  return [...featured, ...extras].slice(0, limit);
}

export function menuSummary(db: Db = getDb()) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS dishes,
        (SELECT ROUND(AVG(rating),1) FROM reviews WHERE status='published') AS rating,
        (SELECT COUNT(*) FROM reviews WHERE status='published') AS reviews
       FROM menu_items WHERE published = 1`,
    )
    .get() as { dishes: number; rating: number | null; reviews: number };
  return { dishes: row.dishes, rating: Number(row.rating ?? 4.9), reviews: row.reviews };
}
