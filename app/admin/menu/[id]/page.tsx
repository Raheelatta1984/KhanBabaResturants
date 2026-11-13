import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { MenuEditor, type EditorItem } from "@/components/portal/MenuEditor";

export const dynamic = "force-dynamic";

export default async function EditDishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();
  const item = await db.maybeOne<{
    id: number;
    name: string;
    slug: string;
    tagline: string | null;
    description: string | null;
    category_id: number | null;
    image: string | null;
    youtube_id: string | null;
    ingredients: string | null;
    allergens: string | null;
    spice_levels: string;
    prep_minutes: number;
    is_veg: number;
    is_available: number;
    is_featured: number;
    is_new: number;
    published: boolean;
  }>("SELECT * FROM menu_items WHERE id = $1", [Number(id)]);
  if (!item) notFound();

  const [variants, categories] = await Promise.all([
    db.query<{
      id: number;
      label: string;
      size_ml: number | null;
      price_cents: number;
      is_default: boolean;
    }>(
      "SELECT * FROM item_variants WHERE item_id = $1 AND active ORDER BY sort_order, id",
      [item.id],
    ),
    db.query<{ id: number; name: string }>(
      "SELECT id, name FROM categories WHERE active ORDER BY sort_order",
    ),
  ]);

  const initial: EditorItem = {
    id: item.id,
    name: item.name,
    slug: item.slug,
    tagline: item.tagline ?? "",
    description: item.description ?? "",
    categoryId: item.category_id,
    image: item.image ?? "",
    youtube: item.youtube_id ?? "",
    ingredients: item.ingredients ?? "",
    allergens: item.allergens ?? "",
    spiceLevels: item.spice_levels
      ? item.spice_levels.split(",").filter(Boolean)
      : [],
    prepMinutes: item.prep_minutes,
    isVeg: Boolean(item.is_veg),
    isAvailable: Boolean(item.is_available),
    isFeatured: Boolean(item.is_featured),
    isNew: Boolean(item.is_new),
    published: Boolean(item.published),
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      sizeMl: variant.size_ml ? String(variant.size_ml) : "",
      price: (variant.price_cents / 100).toFixed(2),
      isDefault: Boolean(variant.is_default),
    })),
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{item.name}</h1>
          <p>
            Editing a live dish — changes appear on the website immediately.
          </p>
        </div>
        <a
          href={`/menu/${item.slug}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline btn-sm"
        >
          Preview on site
        </a>
      </div>
      <MenuEditor categories={categories} initial={initial} />
    </>
  );
}
