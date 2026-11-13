import Link from "next/link";
import { getDb } from "@/lib/db";
import { getRecipeCost } from "@/lib/production";
import { money } from "@/lib/money";
import { OpsButton } from "@/components/portal/OpsButton";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  slug: string;
  name: string;
  image: string | null;
  category: string | null;
  is_available: number;
  is_featured: number;
  is_new: number;
  published: number;
  min_price: number | null;
  max_price: number | null;
  review_count: number;
  recipe_id: number | null;
};

export default async function AdminMenuPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT mi.id, mi.slug, mi.name, mi.image, c.name AS category, mi.is_available, mi.is_featured, mi.is_new, mi.published,
        (SELECT MIN(price_cents) FROM item_variants WHERE item_id = mi.id AND active = 1) AS min_price,
        (SELECT MAX(price_cents) FROM item_variants WHERE item_id = mi.id AND active = 1) AS max_price,
        (SELECT COUNT(*) FROM reviews WHERE item_id = mi.id AND status = 'published') AS review_count,
        (SELECT id FROM recipes WHERE menu_item_id = mi.id ORDER BY id LIMIT 1) AS recipe_id
       FROM menu_items mi LEFT JOIN categories c ON c.id = mi.category_id
       ORDER BY c.sort_order, mi.sort_order, mi.id`,
    )
    .all() as Row[];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Menu &amp; dishes</h1>
          <p>{rows.length} dishes. Cost of goods comes from the production recipes, so margins update as material prices move.</p>
        </div>
        <Link href="/admin/menu/new" className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} /> Add a dish
        </Link>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Dish</th>
              <th>Category</th>
              <th>Price</th>
              <th>Portion cost</th>
              <th>GP</th>
              <th>Reviews</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              let cost: number | null = null;
              if (row.recipe_id) {
                try {
                  cost = getRecipeCost(db, row.recipe_id).costPerUnitCents;
                } catch {
                  cost = null;
                }
              }
              const price = row.min_price ?? 0;
              const gp = cost && price ? Math.round(((price - cost) / price) * 100) : null;
              return (
                <tr key={row.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {row.image ? <img src={row.image} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover" }} /> : null}
                      <div>
                        <b>{row.name}</b>
                        <div className="tiny muted">/{row.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="tiny">{row.category ?? "—"}</td>
                  <td>
                    {money(price)}
                    {row.max_price && row.max_price !== price ? ` – ${money(row.max_price)}` : ""}
                    <div className="tiny muted">
                      {db.prepare("SELECT COUNT(*) AS c FROM item_variants WHERE item_id = ? AND active = 1").get(row.id)
                        ? `${(db.prepare("SELECT COUNT(*) AS c FROM item_variants WHERE item_id = ? AND active = 1").get(row.id) as { c: number }).c} size(s)`
                        : ""}
                    </div>
                  </td>
                  <td>{cost != null ? money(cost) : <span className="muted tiny">no recipe</span>}</td>
                  <td>
                    {gp != null ? (
                      <span className={`badge ${gp >= 65 ? "badge-green" : gp >= 45 ? "badge-amber" : "badge-red"}`}>{gp}%</span>
                    ) : (
                      <span className="muted tiny">—</span>
                    )}
                  </td>
                  <td>{row.review_count}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <span className={`badge ${row.published ? "badge-green" : "badge-muted"}`}>{row.published ? "Live" : "Draft"}</span>
                      <span className={`badge ${row.is_available ? "badge-blue" : "badge-red"}`}>{row.is_available ? "Available" : "Sold out"}</span>
                      {row.is_featured ? <span className="badge badge-amber">Featured</span> : null}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <Link href={`/admin/menu/${row.id}`} className="btn btn-outline btn-sm">
                        Edit
                      </Link>
                      <OpsButton endpoint="/api/ops/menu" payload={{ action: "toggle", id: row.id, field: "is_available" }} className="btn btn-ghost btn-sm">
                        {row.is_available ? "Sold out" : "Restock"}
                      </OpsButton>
                      <OpsButton endpoint="/api/ops/menu" payload={{ action: "toggle", id: row.id, field: "is_featured" }} className="btn btn-ghost btn-sm">
                        {row.is_featured ? "Unfeature" : "Feature"}
                      </OpsButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="notice" style={{ marginTop: 18 }}>
        <Icon name="sparkle" size={15} />
        <span>
          Upload photography and paste a YouTube link on the dish page. New dishes start as drafts — publish when the
          photo, ingredients and allergens are ready.
        </span>
      </div>
    </>
  );
}
