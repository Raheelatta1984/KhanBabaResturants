import { getDb } from "@/lib/db";
import {
  cogsTotals,
  getRecipeCost,
  materialUsage,
  type Material,
} from "@/lib/production";
import { formatDateTime } from "@/lib/time";
import { money } from "@/lib/money";
import {
  AddMaterialForm,
  RecipeBuilder,
} from "@/components/portal/ProductionForms";
import { OpsButton } from "@/components/portal/OpsButton";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function AdminProductionPage() {
  const db = await getDb();
  const [materials, recipes, batches, postings, usage, cogs30, menuItems] =
    await Promise.all([
      db.query<Material>("SELECT * FROM materials WHERE active ORDER BY name"),
      db.query<{
        id: number;
        name: string;
        output_kind: string;
        output_qty: number;
        output_unit: string;
        prep_minutes: number;
        menu_item_name: string | null;
        line_count: number;
      }>(
        `SELECT r.*, mi.name AS menu_item_name,
        (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.recipe_id = r.id) AS line_count
       FROM recipes r LEFT JOIN menu_items mi ON mi.id = r.menu_item_id
       WHERE r.active ORDER BY r.output_kind, r.name`,
      ),
      db.query<{
        id: number;
        ref: string;
        recipe_name: string;
        planned_qty: number;
        output_unit: string;
        status: string;
        total_cost_cents: number;
        started_at: string;
        completed_at: string | null;
        created_by: string | null;
      }>(
        `SELECT b.*, r.name AS recipe_name, r.output_unit FROM production_batches b
       JOIN recipes r ON r.id = b.recipe_id ORDER BY b.id DESC LIMIT 10`,
      ),
      db.query<{
        id: number;
        material_name: string;
        qty: number;
        unit: string;
        unit_cost_cents: number;
        amount_cents: number;
        posted_at: string;
        batch_ref: string;
      }>(
        `SELECT cp.*, b.ref AS batch_ref FROM cost_postings cp
       JOIN production_batches b ON b.id = cp.batch_id ORDER BY cp.id DESC LIMIT 15`,
      ),
      materialUsage(db, 30),
      cogsTotals(db, 30),
      db.query<{ id: number; name: string }>(
        "SELECT id, name FROM menu_items WHERE published ORDER BY name",
      ),
    ]);
  const recipeCosts = new Map(
    await Promise.all(
      recipes.map(
        async (recipe) =>
          [recipe.id, await getRecipeCost(db, recipe.id)] as const,
      ),
    ),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Production &amp; costing</h1>
          <p>
            Run naan, roti and prep batches. Completing a batch draws stock down
            and lodges a cost against every material used.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="badge badge-amber">
            {money(cogs30.cost_cents)} COGS / 30d
          </span>
          <span className="badge">{materials.length} materials</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Material ledger</h3>
          <span className="tiny muted">
            Unit cost = pack cost ÷ pack quantity
          </span>
        </div>
        <div
          className="table-wrap"
          style={{ maxHeight: 420, overflowY: "auto" }}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Supplier</th>
                <th>Pack</th>
                <th>Unit cost</th>
                <th>Stock</th>
                <th>Reorder</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {materials.map((material) => {
                const unitCost =
                  material.pack_cost_cents / (material.pack_qty || 1);
                const low = material.stock_qty <= material.reorder_level;
                return (
                  <tr key={material.id}>
                    <td>
                      <b>{material.name}</b>
                      <div className="tiny muted">{material.sku}</div>
                    </td>
                    <td className="tiny">{material.supplier ?? "—"}</td>
                    <td className="tiny">
                      {material.pack_qty} {material.unit} ·{" "}
                      {money(material.pack_cost_cents)}
                    </td>
                    <td>
                      ${(unitCost / 100).toFixed(2)} / {material.unit}
                    </td>
                    <td>
                      <span style={{ color: low ? "var(--red)" : undefined }}>
                        {material.stock_qty} {material.unit}
                      </span>
                    </td>
                    <td className="tiny muted">
                      {material.reorder_level} {material.unit}
                    </td>
                    <td>
                      {low ? (
                        <span className="badge badge-red">Reorder</span>
                      ) : (
                        <span className="badge badge-green">OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary
            className="small"
            style={{ cursor: "pointer", color: "var(--accent)" }}
          >
            + Add a material
          </summary>
          <div style={{ marginTop: 16 }}>
            <AddMaterialForm />
          </div>
        </details>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Recipes &amp; cost per portion</h3>
          <span className="tiny muted">
            Costed from current material prices
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Yield</th>
                <th>Lines</th>
                <th>Batch cost</th>
                <th>Per unit</th>
                <th>Linked dish</th>
                <th>Prep</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((recipe) => {
                const cost = recipeCosts.get(recipe.id)!;
                return (
                  <tr key={recipe.id}>
                    <td>
                      <b>{recipe.name}</b>
                      <div className="tiny muted">
                        {recipe.output_kind === "batch"
                          ? "Production batch"
                          : "Plated item"}
                      </div>
                    </td>
                    <td className="tiny">
                      {recipe.output_qty} {recipe.output_unit}
                    </td>
                    <td>{recipe.line_count}</td>
                    <td>{money(cost.totalCostCents)}</td>
                    <td>
                      <b>{money(cost.costPerUnitCents)}</b>
                    </td>
                    <td className="tiny">{recipe.menu_item_name ?? "—"}</td>
                    <td className="tiny muted">{recipe.prep_minutes} min</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: 14 }}>
          <summary
            className="small"
            style={{ cursor: "pointer", color: "var(--accent)" }}
          >
            + Build a new recipe
          </summary>
          <div style={{ marginTop: 16 }}>
            <RecipeBuilder materials={materials} menuItems={menuItems} />
          </div>
        </details>
      </section>

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head">
            <h3>Production runs</h3>
            <span className="tiny muted">Last 10</span>
          </div>
          <div
            className="table-wrap"
            style={{ maxHeight: 380, overflowY: "auto" }}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Recipe</th>
                  <th>Qty</th>
                  <th>Cost</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <b>{batch.ref}</b>
                      <div className="tiny muted">
                        {formatDateTime(batch.started_at)}
                      </div>
                    </td>
                    <td className="tiny">{batch.recipe_name}</td>
                    <td className="tiny">
                      {batch.planned_qty} {batch.output_unit}
                    </td>
                    <td>{money(batch.total_cost_cents)}</td>
                    <td>
                      <span
                        className={`badge ${batch.status === "completed" ? "badge-green" : batch.status === "cancelled" ? "badge-muted" : "badge-amber"}`}
                      >
                        {batch.status}
                      </span>
                    </td>
                    <td>
                      {batch.status === "in_progress" ? (
                        <OpsButton
                          endpoint="/api/ops/production"
                          payload={{ action: "complete", batchId: batch.id }}
                          className="btn btn-green btn-sm"
                          confirmMessage="Post material costs and close this batch?"
                          successMessage="Costs posted"
                        >
                          Complete
                        </OpsButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Material usage (30d)</h3>
            <span className="tiny muted">From cost postings</span>
          </div>
          {usage.length === 0 ? (
            <p className="small muted">No consumption posted yet.</p>
          ) : null}
          {usage.slice(0, 8).map((row) => (
            <div key={row.material_name} className="summary-row">
              <span>
                {row.material_name} · {row.qty.toFixed(2)} {row.unit}
              </span>
              <b>{money(row.cost_cents)}</b>
            </div>
          ))}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>
            <Icon name="layers" size={16} /> Cost postings (material ledger)
          </h3>
          <span className="tiny muted">
            Each row is a cost lodged against a material for a batch
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Posted</th>
                <th>Batch</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Unit cost</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {postings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No costs posted yet. Complete a production batch from the
                    kitchen or above.
                  </td>
                </tr>
              ) : (
                postings.map((posting) => (
                  <tr key={posting.id}>
                    <td className="tiny">
                      {formatDateTime(posting.posted_at)}
                    </td>
                    <td className="tiny">{posting.batch_ref}</td>
                    <td>{posting.material_name}</td>
                    <td>
                      {posting.qty} {posting.unit}
                    </td>
                    <td>${(posting.unit_cost_cents / 100).toFixed(2)}</td>
                    <td>
                      <b>{money(posting.amount_cents)}</b>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
