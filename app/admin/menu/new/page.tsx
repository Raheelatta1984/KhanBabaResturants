import { getDb } from "@/lib/db";
import { MenuEditor, type EditorItem } from "@/components/portal/MenuEditor";

export const dynamic = "force-dynamic";

export default async function NewDishPage() {
  const db = await getDb();
  const categories = await db.query<{ id: number; name: string }>(
    "SELECT id, name FROM categories WHERE active ORDER BY sort_order",
  );

  const initial: EditorItem = {
    name: "",
    slug: "",
    tagline: "",
    description: "",
    categoryId: categories[0]?.id ?? null,
    image: "",
    youtube: "",
    ingredients: "",
    allergens: "",
    spiceLevels: ["blend", "mild", "hot", "extra_hot"],
    prepMinutes: 15,
    isVeg: false,
    isAvailable: true,
    isFeatured: false,
    isNew: true,
    published: false,
    variants: [{ label: "500 ml", sizeMl: "500", price: "", isDefault: true }],
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New dish</h1>
          <p>
            Onboard a new item: photography, video, ingredients, allergens,
            sizes and spice options.
          </p>
        </div>
      </div>
      <MenuEditor categories={categories} initial={initial} />
    </>
  );
}
