import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { cancelBatch, completeBatch, startBatch } from "@/lib/production";
import { getSettingNumber } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  batchId?: number;
  recipeId?: number;
  plannedQty?: number;
  notes?: string;
  material?: {
    name?: string;
    sku?: string;
    unit?: string;
    packQty?: number;
    packCost?: number;
    stockQty?: number;
    reorderLevel?: number;
    supplier?: string;
  };
  recipe?: {
    name?: string;
    outputKind?: "menu_item" | "batch";
    menuItemId?: number | null;
    outputQty?: number;
    outputUnit?: string;
    prepMinutes?: number;
    notes?: string;
    lines?: { materialId: number; qty: number }[];
  };
};

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager", "kitchen"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();

  try {
    switch (body.action) {
      case "start": {
        if (!body.recipeId) throw new Error("Choose a recipe");
        const batch = startBatch(db, {
          recipeId: Number(body.recipeId),
          plannedQty: Number(body.plannedQty ?? 0),
          actor: session.name,
          notes: body.notes,
        });
        return NextResponse.json({ ok: true, batch }, { status: 201 });
      }
      case "complete": {
        if (!body.batchId) throw new Error("Missing batch");
        const result = completeBatch(db, Number(body.batchId), session.name);
        return NextResponse.json({ ok: true, ...result });
      }
      case "cancel": {
        if (!body.batchId) throw new Error("Missing batch");
        cancelBatch(db, Number(body.batchId));
        return NextResponse.json({ ok: true });
      }
      case "material": {
        const material = body.material ?? {};
        const name = (material.name ?? "").trim();
        if (name.length < 2) throw new Error("Material name is required");
        const packQty = Number(material.packQty ?? 1);
        const packCostCents = Math.round(Number(material.packCost ?? 0) * 100);
        if (packQty <= 0) throw new Error("Pack quantity must be greater than zero");
        const info = db
          .prepare(
            `INSERT INTO materials (name, sku, unit, pack_qty, pack_cost_cents, stock_qty, reorder_level, supplier)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            name,
            (material.sku ?? "").trim() || null,
            (material.unit ?? "kg").trim(),
            packQty,
            packCostCents,
            Number(material.stockQty ?? 0),
            Number(material.reorderLevel ?? 0),
            (material.supplier ?? "").trim() || null,
          );
        return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) }, { status: 201 });
      }
      case "recipe": {
        const recipe = body.recipe ?? {};
        const name = (recipe.name ?? "").trim();
        if (name.length < 3) throw new Error("Recipe name is required");
        if (!recipe.lines?.length) throw new Error("Add at least one material line");
        const info = db
          .prepare(
            `INSERT INTO recipes (name, output_kind, menu_item_id, output_qty, output_unit, prep_minutes, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            name,
            recipe.outputKind === "menu_item" ? "menu_item" : "batch",
            recipe.menuItemId ?? null,
            Number(recipe.outputQty ?? 1),
            (recipe.outputUnit ?? "portion").trim(),
            Number(recipe.prepMinutes ?? 30),
            (recipe.notes ?? "").trim() || null,
          );
        const recipeId = Number(info.lastInsertRowid);
        const insertLine = db.prepare("INSERT INTO recipe_lines (recipe_id, material_id, qty) VALUES (?, ?, ?)");
        for (const line of recipe.lines) {
          if (!line.materialId || !(line.qty > 0)) continue;
          insertLine.run(recipeId, line.materialId, line.qty);
        }
        return NextResponse.json({ ok: true, id: recipeId }, { status: 201 });
      }
      case "settings": {
        // kept for future production-specific settings
        return NextResponse.json({ ok: true, cogsWindowDays: getSettingNumber("cogs_window_days", 30) });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Production action failed" },
      { status: 400 },
    );
  }
}
