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
  active: boolean;
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
  active: boolean;
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
export function materialUnitCostCents(
  material: Pick<Material, "pack_qty" | "pack_cost_cents">,
): number {
  const packQty = material.pack_qty || 1;
  return material.pack_cost_cents / packQty;
}

export type RecipeCost = {
  recipe: Recipe;
  lines: (RecipeLine & {
    material_name: string;
    unit_cost_cents: number;
    cost_cents: number;
  })[];
  totalCostCents: number;
  costPerUnitCents: number;
};

export async function getRecipeCost(
  db: Db,
  recipeId: number,
): Promise<RecipeCost> {
  const recipe = await db.maybeOne<Recipe>(
    "SELECT * FROM recipes WHERE id = $1",
    [recipeId],
  );
  if (!recipe) throw new Error("Recipe not found");
  const rows = await db.query<
    RecipeLine & {
      material_unit: string;
      pack_qty: number;
      pack_cost_cents: number;
    }
  >(
    `SELECT rl.*, m.name AS material_name, m.unit AS material_unit, m.pack_qty, m.pack_cost_cents
     FROM recipe_lines rl JOIN materials m ON m.id = rl.material_id
     WHERE rl.recipe_id = $1 ORDER BY rl.id`,
    [recipeId],
  );

  const lines = rows.map((row) => {
    const unitCost = materialUnitCostCents({
      pack_qty: row.pack_qty,
      pack_cost_cents: row.pack_cost_cents,
    });
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

async function nextBatchRef(db: Db): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const row = await db.one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM production_batches",
  );
  return `BATCH-${stamp}-${String(Number(row.c) + 1).padStart(3, "0")}`;
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
export async function startBatch(
  db: Db,
  input: {
    recipeId: number;
    plannedQty: number;
    actor: string;
    notes?: string;
  },
): Promise<BatchSummary> {
  const recipe = await db.maybeOne<Recipe>(
    "SELECT * FROM recipes WHERE id = $1",
    [input.recipeId],
  );
  if (!recipe) throw new Error("Recipe not found");
  if (!Number.isFinite(input.plannedQty) || input.plannedQty <= 0)
    throw new Error("Planned quantity must be positive");
  const ref = await nextBatchRef(db);
  const id = await db.insert(
    `INSERT INTO production_batches (ref, recipe_id, planned_qty, status, created_by, notes)
     VALUES ($1, $2, $3, 'in_progress', $4, $5) RETURNING id`,
    [ref, input.recipeId, input.plannedQty, input.actor, input.notes ?? null],
  );
  return (await getBatch(db, id))!;
}

export async function getBatch(
  db: Db,
  id: number,
): Promise<BatchSummary | null> {
  return db.maybeOne<BatchSummary>(
    `SELECT b.*, r.name AS recipe_name FROM production_batches b
     JOIN recipes r ON r.id = b.recipe_id WHERE b.id = $1`,
    [id],
  );
}

/**
 * Complete a production run: lodge the material cost against every line used in
 * the run and draw the quantities down from stock. This is the manufacturing
 * ledger — every gram consumed is traceable to a batch and a cost posting.
 */
export async function completeBatch(
  db: Db,
  batchId: number,
  actor: string,
): Promise<{ batch: BatchSummary; postings: number; totalCostCents: number }> {
  const batch = await db.maybeOne<{
    id: number;
    recipe_id: number;
    planned_qty: number;
    status: string;
  }>(
    "SELECT id, recipe_id, planned_qty, status FROM production_batches WHERE id = $1",
    [batchId],
  );
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "in_progress")
    throw new Error("Batch has already been closed");
  void actor;

  const cost = await getRecipeCost(db, batch.recipe_id);
  const scale = batch.planned_qty / (cost.recipe.output_qty || 1);

  const total = await db.transaction(async (tx) => {
    let running = 0;
    for (const line of cost.lines) {
      const qty = Number((line.qty * scale).toFixed(4));
      const amount = Math.round(line.unit_cost_cents * qty);
      running += amount;
      await tx.query(
        `INSERT INTO cost_postings (batch_id, material_id, material_name, qty, unit, unit_cost_cents, amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          batchId,
          line.material_id,
          line.material_name,
          qty,
          line.unit,
          line.unit_cost_cents,
          amount,
        ],
      );
      await tx.query(
        "UPDATE materials SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id = $2",
        [qty, line.material_id],
      );
    }
    await tx.query(
      "UPDATE production_batches SET status = 'completed', completed_at = now(), total_cost_cents = $1 WHERE id = $2",
      [running, batchId],
    );
    return running;
  });

  return {
    batch: (await getBatch(db, batchId))!,
    postings: cost.lines.length,
    totalCostCents: total,
  };
}

export async function cancelBatch(db: Db, batchId: number): Promise<void> {
  await db.query(
    "UPDATE production_batches SET status = 'cancelled', completed_at = now() WHERE id = $1 AND status = 'in_progress'",
    [batchId],
  );
}

export async function lowStockMaterials(
  db: Db,
  limit = 8,
): Promise<Material[]> {
  return db.query<Material>(
    `SELECT * FROM materials WHERE active AND stock_qty <= reorder_level
     ORDER BY (stock_qty - reorder_level) ASC LIMIT $1`,
    [limit],
  );
}

export async function materialUsage(db: Db, days = 30) {
  return db.query<{
    material_name: string;
    unit: string;
    qty: number;
    cost_cents: number;
    postings: number;
  }>(
    `SELECT material_name, unit, SUM(qty) AS qty, SUM(amount_cents) AS cost_cents, COUNT(*) AS postings
     FROM cost_postings WHERE posted_at >= now() - $1::interval
     GROUP BY material_id, material_name, unit ORDER BY cost_cents DESC`,
    [`${days} days`],
  );
}

export async function cogsTotals(db: Db, days = 1) {
  return db.one<{ cost_cents: number; batches: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cost_cents, COUNT(DISTINCT batch_id) AS batches
     FROM cost_postings WHERE posted_at >= now() - $1::interval`,
    [`${days} days`],
  );
}

export function newMaterialSku(): string {
  return `MAT-${randomUUID().slice(0, 6).toUpperCase()}`;
}
