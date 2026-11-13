import { randomUUID } from "node:crypto";
import type { Db } from "./db";

export type Material = {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  pack_qty: number;
  pack_cost_cents: number;
  stock_qty: number;
  reorder_level: number;
  supplier: string | null;
  active: number;
};

export type Recipe = {
  id: number;
  name: string;
  output_kind: "menu_item" | "batch";
  menu_item_id: number | null;
  output_qty: number;
  output_unit: string;
  prep_minutes: number;
  notes: string | null;
  active: number;
};

export type RecipeLine = {
  id: number;
  recipe_id: number;
  material_id: number;
  qty: number;
  unit: string | null;
  material_name?: string;
};

/** Cost of one purchase pack spread across the pack quantity, in cents per base unit. */
export function materialUnitCostCents(material: Pick<Material, "pack_qty" | "pack_cost_cents">): number {
  const packQty = material.pack_qty || 1;
  return material.pack_cost_cents / packQty;
}

export type RecipeCost = {
  recipe: Recipe;
  lines: (RecipeLine & { material_name: string; unit_cost_cents: number; cost_cents: number })[];
  totalCostCents: number;
  costPerUnitCents: number;
};

export function getRecipeCost(db: Db, recipeId: number): RecipeCost {
  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(recipeId) as Recipe;
  if (!recipe) throw new Error("Recipe not found");
  const rows = db
    .prepare(
      `SELECT rl.*, m.name AS material_name, m.unit AS material_unit, m.pack_qty, m.pack_cost_cents
       FROM recipe_lines rl JOIN materials m ON m.id = rl.material_id
       WHERE rl.recipe_id = ? ORDER BY rl.id`,
    )
    .all(recipeId) as (RecipeLine & {
    material_unit: string;
    pack_qty: number;
    pack_cost_cents: number;
  })[];

  const lines = rows.map((row) => {
    const unitCost = materialUnitCostCents({ pack_qty: row.pack_qty, pack_cost_cents: row.pack_cost_cents });
    return {
      ...row,
      unit: row.unit ?? row.material_unit,
      unit_cost_cents: Math.round(unitCost),
      cost_cents: Math.round(unitCost * row.qty),
      material_name: row.material_name ?? "Material",
    };
  });
  const totalCostCents = lines.reduce((sum, line) => sum + line.cost_cents, 0);

  return {
    recipe,
    lines,
    totalCostCents,
    costPerUnitCents: Math.round(totalCostCents / (recipe.output_qty || 1)),
  };
}

function nextBatchRef(db: Db): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = (db.prepare("SELECT COUNT(*) AS c FROM production_batches").get() as { c: number }).c + 1;
  return `BATCH-${stamp}-${String(count).padStart(3, "0")}`;
}

export type BatchSummary = {
  id: number;
  ref: string;
  recipe_id: number;
  recipe_name: string;
  planned_qty: number;
  status: string;
  total_cost_cents: number;
  created_by: string | null;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
};

/** Start a production run (naan, roti, curry base…) without consuming stock yet. */
export function startBatch(
  db: Db,
  input: { recipeId: number; plannedQty: number; actor: string; notes?: string },
): BatchSummary {
  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(input.recipeId) as Recipe | undefined;
  if (!recipe) throw new Error("Recipe not found");
  if (!Number.isFinite(input.plannedQty) || input.plannedQty <= 0) throw new Error("Planned quantity must be positive");
  const ref = nextBatchRef(db);
  const result = db
    .prepare(
      `INSERT INTO production_batches (ref, recipe_id, planned_qty, status, created_by, notes)
       VALUES (?, ?, ?, 'in_progress', ?, ?)`,
    )
    .run(ref, input.recipeId, input.plannedQty, input.actor, input.notes ?? null);
  return getBatch(db, Number(result.lastInsertRowid))!;
}

export function getBatch(db: Db, id: number): BatchSummary | null {
  const row = db
    .prepare(
      `SELECT b.*, r.name AS recipe_name FROM production_batches b
       JOIN recipes r ON r.id = b.recipe_id WHERE b.id = ?`,
    )
    .get(id) as BatchSummary | undefined;
  return row ?? null;
}

/**
 * Complete a production run: lodge the material cost against every line used in
 * the run and draw the quantities down from stock. This is the manufacturing
 * ledger — every gram consumed is traceable to a batch and a cost posting.
 */
export function completeBatch(
  db: Db,
  batchId: number,
  actor: string,
): { batch: BatchSummary; postings: number; totalCostCents: number } {
  const batch = db.prepare("SELECT * FROM production_batches WHERE id = ?").get(batchId) as
    | { id: number; recipe_id: number; planned_qty: number; status: string }
    | undefined;
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "in_progress") throw new Error("Batch has already been closed");

  const cost = getRecipeCost(db, batch.recipe_id);
  const scale = batch.planned_qty / (cost.recipe.output_qty || 1);

  const insertPosting = db.prepare(
    `INSERT INTO cost_postings (batch_id, material_id, material_name, qty, unit, unit_cost_cents, amount_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const consumeStock = db.prepare("UPDATE materials SET stock_qty = MAX(0, stock_qty - ?) WHERE id = ?");

  let total = 0;
  const tx = db.transaction(() => {
    for (const line of cost.lines) {
      const qty = Number((line.qty * scale).toFixed(4));
      const amount = Math.round(line.unit_cost_cents * qty);
      total += amount;
      insertPosting.run(
        batchId,
        line.material_id,
        line.material_name,
        qty,
        line.unit,
        line.unit_cost_cents,
        amount,
      );
      consumeStock.run(qty, line.material_id);
    }
    db.prepare(
      "UPDATE production_batches SET status = 'completed', completed_at = datetime('now'), total_cost_cents = ? WHERE id = ?",
    ).run(total, batchId);
  });
  tx();

  return { batch: getBatch(db, batchId)!, postings: cost.lines.length, totalCostCents: total };
}

export function cancelBatch(db: Db, batchId: number): void {
  db.prepare(
    "UPDATE production_batches SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'in_progress'",
  ).run(batchId);
}

export function lowStockMaterials(db: Db, limit = 8): Material[] {
  return db
    .prepare(
      `SELECT * FROM materials WHERE active = 1 AND stock_qty <= reorder_level
       ORDER BY (stock_qty - reorder_level) ASC LIMIT ?`,
    )
    .all(limit) as Material[];
}

export function materialUsage(db: Db, days = 30) {
  return db
    .prepare(
      `SELECT material_name, unit, SUM(qty) AS qty, SUM(amount_cents) AS cost_cents, COUNT(*) AS postings
       FROM cost_postings WHERE posted_at >= datetime('now', ?)
       GROUP BY material_id, material_name, unit ORDER BY cost_cents DESC`,
    )
    .all(`-${days} days`) as { material_name: string; unit: string; qty: number; cost_cents: number; postings: number }[];
}

export function cogsTotals(db: Db, days = 1) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS cost_cents, COUNT(DISTINCT batch_id) AS batches
       FROM cost_postings WHERE posted_at >= datetime('now', ?)`,
    )
    .get(`-${days} days`) as { cost_cents: number; batches: number };
  return row;
}

export function newMaterialSku(): string {
  return `MAT-${randomUUID().slice(0, 6).toUpperCase()}`;
}
