import { getDb, type Db } from "./db";
import type {
  CategoryView,
  ItemView,
  RatingView,
  ReviewView,
  VariantView,
} from "./types";

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
  is_veg: boolean;
  is_featured: boolean;
  is_new: boolean;
  is_available: boolean;
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

export async function getCategories(db?: Db): Promise<CategoryView[]> {
  const handle = db ?? (await getDb());
  return handle.query<CategoryView>(
    `SELECT c.id, c.slug, c.name, c.description,
      (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = c.id AND mi.published AND mi.is_available) AS count
     FROM categories c WHERE c.active ORDER BY c.sort_order, c.id`,
  );
}

export async function getMenuItems(
  db?: Db,
  opts: { featured?: boolean; limit?: number } = {},
): Promise<ItemView[]> {
  const handle = db ?? (await getDb());
  const clauses = ["mi.published"];
  const params: unknown[] = [];
  if (opts.featured) clauses.push("mi.is_featured");
  if (opts.limit) params.push(Math.max(1, Math.floor(opts.limit)));

  const rows = await handle.query<MenuRow>(
    `SELECT mi.*, c.slug AS category_slug, c.name AS category_name,
      (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.item_id = mi.id AND r.status = 'published') AS rating_avg,
      (SELECT COUNT(*) FROM reviews r WHERE r.item_id = mi.id AND r.status = 'published') AS rating_count
     FROM menu_items mi LEFT JOIN categories c ON c.id = mi.category_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY mi.sort_order, mi.id ${opts.limit ? "LIMIT $1" : ""}`,
    params,
  );

  if (rows.length === 0) return [];

  // One query for every variant instead of one per dish (N+1 on a remote DB).
  const variantRows = await handle.query<{
    id: number;
    item_id: number;
    label: string;
    size_ml: number | null;
    price_cents: number;
    is_default: boolean;
    sort_order: number;
  }>(
    `SELECT id, item_id, label, size_ml, price_cents, is_default, sort_order
     FROM item_variants WHERE active ORDER BY item_id, sort_order, id`,
  );
  const variantsByItem = new Map<number, VariantView[]>();
  for (const variant of variantRows) {
    const list = variantsByItem.get(variant.item_id) ?? [];
    list.push({
      id: variant.id,
      label: variant.label,
      sizeMl: variant.size_ml,
      priceCents: variant.price_cents,
      isDefault: Boolean(variant.is_default),
    });
    variantsByItem.set(variant.item_id, list);
  }

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
    variants: variantsByItem.get(row.id) ?? [],
    rating: {
      avg: Number(row.rating_avg ?? 0),
      count: Number(row.rating_count ?? 0),
    } satisfies RatingView,
  }));
}

export async function getMenuItem(
  slug: string,
  db?: Db,
): Promise<ItemView | null> {
  const handle = db ?? (await getDb());
  const items = await getMenuItems(handle);
  return items.find((item) => item.slug === slug) ?? null;
}

export async function getRelatedItems(
  item: ItemView,
  limit = 3,
  db?: Db,
): Promise<ItemView[]> {
  const handle = db ?? (await getDb());
  const all = await getMenuItems(handle);
  const sameCategory = all.filter(
    (candidate) =>
      candidate.categorySlug === item.categorySlug && candidate.id !== item.id,
  );
  const extras = all.filter(
    (candidate) =>
      candidate.categorySlug !== item.categorySlug && candidate.id !== item.id,
  );
  return [...sameCategory, ...extras].slice(0, limit);
}

export async function getItemReviews(
  itemId: number,
  limit = 12,
  db?: Db,
): Promise<ReviewView[]> {
  const handle = db ?? (await getDb());
  const rows = await handle.query<{
    id: number;
    customer_name: string;
    rating: number;
    comment: string | null;
    created_at: string;
  }>(
    `SELECT id, customer_name, rating, comment, created_at FROM reviews
     WHERE item_id = $1 AND status = 'published' ORDER BY created_at DESC LIMIT $2`,
    [itemId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  }));
}

export async function getRecentReviews(db: Db, limit = 6) {
  const handle = db ?? (await getDb());
  return handle.query<{
    id: number;
    rating: number;
    comment: string | null;
    customer_name: string;
    created_at: string;
    item_name: string;
    slug: string;
  }>(
    `SELECT r.id, r.rating, r.comment, r.customer_name, r.created_at, mi.name AS item_name, mi.slug
     FROM reviews r JOIN menu_items mi ON mi.id = r.item_id
     WHERE r.status = 'published' AND r.comment IS NOT NULL
     ORDER BY r.rating DESC, r.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function getFeaturedItems(
  db?: Db,
  limit = 4,
): Promise<ItemView[]> {
  const handle = db ?? (await getDb());
  const featured = await getMenuItems(handle, { featured: true, limit });
  if (featured.length >= limit) return featured;
  const all = await getMenuItems(handle);
  const extras = all.filter((item) => !featured.some((f) => f.id === item.id));
  return [...featured, ...extras].slice(0, limit);
}

export async function menuSummary(db?: Db) {
  const handle = db ?? (await getDb());
  const row = await handle.one<{
    dishes: number;
    rating: number | null;
    reviews: number;
  }>(
    `SELECT COUNT(*) AS dishes,
      (SELECT ROUND(AVG(rating),1) FROM reviews WHERE status = 'published') AS rating,
      (SELECT COUNT(*) FROM reviews WHERE status = 'published') AS reviews
     FROM menu_items WHERE published`,
  );
  return {
    dishes: Number(row.dishes),
    rating: Number(row.rating ?? 4.9),
    reviews: Number(row.reviews),
  };
}
