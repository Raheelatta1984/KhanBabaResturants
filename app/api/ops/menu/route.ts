import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
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
const TOGGLE_FIELDS = new Set([
  "is_available",
  "is_featured",
  "is_new",
  "published",
]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(
  db: Db,
  base: string,
  ignoreId?: number,
): Promise<string> {
  let slug = base || "dish";
  let counter = 1;
  while (true) {
    const row = await db.maybeOne<{ id: number }>(
      "SELECT id FROM menu_items WHERE slug = $1",
      [slug],
    );
    if (!row || row.id === ignoreId) return slug;
    counter += 1;
    slug = `${base}-${counter}`;
  }
}

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();

  if (body.action === "toggle") {
    const id = Number(body.id);
    const field = body.field ?? "";
    if (!Number.isInteger(id) || !TOGGLE_FIELDS.has(field)) {
      return NextResponse.json({ error: "Invalid toggle" }, { status: 400 });
    }
    // `field` is checked against an allow-list above, so it cannot be injected.
    const current = await db.maybeOne<{ value: boolean }>(
      `SELECT ${field} AS value FROM menu_items WHERE id = $1`,
      [id],
    );
    if (!current)
      return NextResponse.json({ error: "Dish not found" }, { status: 404 });
    await db.query(
      `UPDATE menu_items SET ${field} = $1, updated_at = now() WHERE id = $2`,
      [!current.value, id],
    );
    return NextResponse.json({ ok: true, value: !current.value });
  }

  if (body.action === "delete") {
    const id = Number(body.id);
    if (!Number.isInteger(id))
      return NextResponse.json({ error: "Invalid dish" }, { status: 400 });
    await db.query("DELETE FROM menu_items WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  }

  // ---- save (create or update) ----
  const item = body.item ?? {};
  const name = (item.name ?? "").trim();
  if (name.length < 2)
    return NextResponse.json(
      { error: "Dish name is required" },
      { status: 400 },
    );

  const variants = (body.variants ?? []).filter(
    (variant) => (variant.priceCents ?? 0) >= 0 && variant.label?.trim(),
  );
  if (variants.length === 0)
    return NextResponse.json(
      { error: "Add at least one size / price" },
      { status: 400 },
    );
  if (variants.some((variant) => !(Number(variant.priceCents) > 0))) {
    return NextResponse.json(
      { error: "Each size needs a price above zero" },
      { status: 400 },
    );
  }

  const spiceLevels = SPICE_ORDER.filter((level) =>
    (item.spiceLevels ?? []).includes(level),
  ).join(",");
  const youtubeId = parseYouTubeId(item.youtube);
  const image = (item.image ?? "").trim() || "/images/biryani-chicken.jpg";
  const gallery = JSON.stringify(
    Array.isArray(item.gallery) ? item.gallery.filter(Boolean).slice(0, 8) : [],
  );

  const id = Number(body.id ?? 0);
  const baseSlug = slugify(item.slug || name);
  const slug = await uniqueSlug(db, baseSlug, id || undefined);

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
    Boolean(item.isVeg),
    item.isAvailable !== false,
    Boolean(item.isFeatured),
    Boolean(item.isNew),
    item.published !== false,
    Number(item.sortOrder ?? 100),
  ];

  try {
    const savedId = await db.transaction(async (tx) => {
      let itemId = id;
      if (itemId) {
        await tx.query(
          `UPDATE menu_items SET name=$1, slug=$2, tagline=$3, description=$4, category_id=$5, image=$6, gallery=$7,
             youtube_id=$8, ingredients=$9, allergens=$10, spice_levels=$11, prep_minutes=$12, is_veg=$13,
             is_available=$14, is_featured=$15, is_new=$16, published=$17, sort_order=$18, updated_at=now()
           WHERE id = $19`,
          [...payload, itemId],
        );
      } else {
        itemId = await tx.insert(
          `INSERT INTO menu_items (name, slug, tagline, description, category_id, image, gallery, youtube_id,
             ingredients, allergens, spice_levels, prep_minutes, is_veg, is_available, is_featured, is_new,
             published, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING id`,
          payload,
        );
      }

      const keptIds: number[] = [];
      for (const [index, variant] of variants.entries()) {
        const price = Math.round(Number(variant.priceCents));
        const isDefault = Boolean(variant.isDefault || index === 0);
        if (variant.id) {
          await tx.query(
            `UPDATE item_variants SET label=$1, size_ml=$2, price_cents=$3, is_default=$4, active=TRUE, sort_order=$5
             WHERE id=$6 AND item_id=$7`,
            [
              variant.label!.trim(),
              variant.sizeMl ?? null,
              price,
              isDefault,
              index,
              variant.id,
              itemId,
            ],
          );
          keptIds.push(variant.id);
        } else {
          const variantId = await tx.insert(
            `INSERT INTO item_variants (item_id, label, size_ml, price_cents, is_default, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [
              itemId,
              variant.label!.trim(),
              variant.sizeMl ?? null,
              price,
              isDefault,
              index,
            ],
          );
          keptIds.push(variantId);
        }
      }
      // Deactivate variants removed from the editor (history keeps name/price snapshots)
      await tx.query(
        "UPDATE item_variants SET active = FALSE WHERE item_id = $1 AND NOT (id = ANY($2::int[]))",
        [itemId, keptIds],
      );
      // ensure exactly one default
      if (!variants.some((variant) => variant.isDefault) && keptIds[0]) {
        await tx.query(
          "UPDATE item_variants SET is_default = FALSE WHERE item_id = $1",
          [itemId],
        );
        await tx.query(
          "UPDATE item_variants SET is_default = TRUE WHERE id = $1",
          [keptIds[0]],
        );
      }
      return itemId;
    });

    return NextResponse.json(
      { ok: true, id: savedId, slug },
      { status: id ? 200 : 201 },
    );
  } catch (error) {
    console.error("menu save failed", error);
    return NextResponse.json(
      { error: "Could not save this dish" },
      { status: 500 },
    );
  }
}
