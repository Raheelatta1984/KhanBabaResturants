import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { parseYouTubeId } from "@/lib/youtube";

export const dynamic = "force-dynamic";

type VariantInput = {
  id?: number;
  label?: string;
  sizeMl?: number | null;
  priceCents?: number;
  isDefault?: boolean;
};

type ItemInput = {
  name?: string;
  slug?: string;
  tagline?: string;
  description?: string;
  categoryId?: number | null;
  image?: string;
  gallery?: string[];
  youtube?: string;
  ingredients?: string;
  allergens?: string;
  spiceLevels?: string[];
  prepMinutes?: number;
  isVeg?: boolean;
  isAvailable?: boolean;
  isFeatured?: boolean;
  isNew?: boolean;
  published?: boolean;
  sortOrder?: number;
};

type Body = {
  action?: "save" | "toggle" | "delete";
  id?: number;
  item?: ItemInput;
  variants?: VariantInput[];
  field?: string;
};

const SPICE_ORDER = ["blend", "mild", "hot", "extra_hot"];
const TOGGLE_FIELDS = new Set(["is_available", "is_featured", "is_new", "published"]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function uniqueSlug(db: ReturnType<typeof getDb>, base: string, ignoreId?: number): string {
  let slug = base || "dish";
  let counter = 1;
  while (true) {
    const row = db.prepare("SELECT id FROM menu_items WHERE slug = ?").get(slug) as { id: number } | undefined;
    if (!row || row.id === ignoreId) return slug;
    counter += 1;
    slug = `${base}-${counter}`;
  }
}

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();

  if (body.action === "toggle") {
    const id = Number(body.id);
    const field = body.field ?? "";
    if (!Number.isInteger(id) || !TOGGLE_FIELDS.has(field)) {
      return NextResponse.json({ error: "Invalid toggle" }, { status: 400 });
    }
    const current = db.prepare(`SELECT ${field} AS value FROM menu_items WHERE id = ?`).get(id) as
      | { value: number }
      | undefined;
    if (!current) return NextResponse.json({ error: "Dish not found" }, { status: 404 });
    db.prepare(`UPDATE menu_items SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(
      current.value ? 0 : 1,
      id,
    );
    return NextResponse.json({ ok: true, value: current.value ? 0 : 1 });
  }

  if (body.action === "delete") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid dish" }, { status: 400 });
    db.prepare("DELETE FROM menu_items WHERE id = ?").run(id);
    return NextResponse.json({ ok: true });
  }

  // ---- save (create or update) ----
  const item = body.item ?? {};
  const name = (item.name ?? "").trim();
  if (name.length < 2) return NextResponse.json({ error: "Dish name is required" }, { status: 400 });

  const variants = (body.variants ?? []).filter((variant) => (variant.priceCents ?? 0) >= 0 && variant.label?.trim());
  if (variants.length === 0) return NextResponse.json({ error: "Add at least one size / price" }, { status: 400 });
  if (variants.some((variant) => !(Number(variant.priceCents) > 0))) {
    return NextResponse.json({ error: "Each size needs a price above zero" }, { status: 400 });
  }

  const spiceLevels = SPICE_ORDER.filter((level) => (item.spiceLevels ?? []).includes(level)).join(",");
  const youtubeId = parseYouTubeId(item.youtube);
  const image = (item.image ?? "").trim() || "/images/biryani-chicken.jpg";
  const gallery = JSON.stringify(Array.isArray(item.gallery) ? item.gallery.filter(Boolean).slice(0, 8) : []);

  const id = Number(body.id ?? 0);
  const baseSlug = slugify(item.slug || name);
  const slug = uniqueSlug(db, baseSlug, id || undefined);

  const payload = [
    name,
    slug,
    (item.tagline ?? "").trim() || null,
    (item.description ?? "").trim() || null,
    item.categoryId ?? null,
    image,
    gallery,
    youtubeId,
    (item.ingredients ?? "").trim(),
    (item.allergens ?? "").trim(),
    spiceLevels,
    Number(item.prepMinutes ?? 15),
    item.isVeg ? 1 : 0,
    item.isAvailable === false ? 0 : 1,
    item.isFeatured ? 1 : 0,
    item.isNew ? 1 : 0,
    item.published === false ? 0 : 1,
    Number(item.sortOrder ?? 100),
  ];

  try {
    const tx = db.transaction(() => {
      let itemId = id;
      if (itemId) {
        db.prepare(
          `UPDATE menu_items SET name=?, slug=?, tagline=?, description=?, category_id=?, image=?, gallery=?,
             youtube_id=?, ingredients=?, allergens=?, spice_levels=?, prep_minutes=?, is_veg=?, is_available=?,
             is_featured=?, is_new=?, published=?, sort_order=?, updated_at=datetime('now')
           WHERE id = ?`,
        ).run(...payload, itemId);
      } else {
        const info = db
          .prepare(
            `INSERT INTO menu_items (name, slug, tagline, description, category_id, image, gallery, youtube_id,
               ingredients, allergens, spice_levels, prep_minutes, is_veg, is_available, is_featured, is_new,
               published, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(...payload);
        itemId = Number(info.lastInsertRowid);
      }

      const keptIds: number[] = [];
      variants.forEach((variant, index) => {
        const price = Math.round(Number(variant.priceCents));
        const isDefault = variant.isDefault || index === 0 ? 1 : 0;
        if (variant.id) {
          db.prepare(
            "UPDATE item_variants SET label=?, size_ml=?, price_cents=?, is_default=?, active=1, sort_order=? WHERE id=? AND item_id=?",
          ).run(variant.label!.trim(), variant.sizeMl ?? null, price, isDefault, index, variant.id, itemId);
          keptIds.push(variant.id);
        } else {
          const info = db
            .prepare(
              "INSERT INTO item_variants (item_id, label, size_ml, price_cents, is_default, sort_order) VALUES (?,?,?,?,?,?)",
            )
            .run(itemId, variant.label!.trim(), variant.sizeMl ?? null, price, isDefault, index);
          keptIds.push(Number(info.lastInsertRowid));
        }
      });
      // Deactivate variants removed from the editor (history keeps name/price snapshots)
      const placeholders = keptIds.map(() => "?").join(",");
      db.prepare(`UPDATE item_variants SET active = 0 WHERE item_id = ? AND id NOT IN (${placeholders})`).run(
        itemId,
        ...keptIds,
      );
      // ensure exactly one default
      if (!variants.some((variant) => variant.isDefault) && keptIds[0]) {
        db.prepare("UPDATE item_variants SET is_default = 0 WHERE item_id = ?").run(itemId);
        db.prepare("UPDATE item_variants SET is_default = 1 WHERE id = ?").run(keptIds[0]);
      }
      return itemId;
    });

    const savedId = tx();
    return NextResponse.json({ ok: true, id: savedId, slug }, { status: id ? 200 : 201 });
  } catch (error) {
    console.error("menu save failed", error);
    return NextResponse.json({ error: "Could not save this dish" }, { status: 500 });
  }
}
