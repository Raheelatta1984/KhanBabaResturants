"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Material = { id: number; name: string; unit: string; pack_qty: number; pack_cost_cents: number; stock_qty: number };

export function AddMaterialForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    sku: "",
    unit: "kg",
    packQty: "1",
    packCost: "",
    stockQty: "0",
    reorderLevel: "0",
    supplier: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ops/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "material",
          material: {
            name: form.name,
            sku: form.sku,
            unit: form.unit,
            packQty: Number(form.packQty),
            packCost: Number(form.packCost),
            stockQty: Number(form.stockQty),
            reorderLevel: Number(form.reorderLevel),
            supplier: form.supplier,
          },
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not add material");
      setMessage("Material added");
      setForm({ ...form, name: "", sku: "", packCost: "", stockQty: "0", reorderLevel: "0" });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add material");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <span className="label">Material name</span>
          <input className="input" value={form.name} onChange={(event) => set("name", event.target.value)} required placeholder="Chicken (bone-in)" />
        </div>
        <div className="field">
          <span className="label">SKU</span>
          <input className="input" value={form.sku} onChange={(event) => set("sku", event.target.value)} placeholder="MAT-CHK" />
        </div>
        <div className="field">
          <span className="label">Unit</span>
          <select className="select" value={form.unit} onChange={(event) => set("unit", event.target.value)}>
            {["kg", "g", "L", "ml", "each", "bunch", "piece"].map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">Pack quantity (in unit)</span>
          <input className="input" type="number" step="0.001" value={form.packQty} onChange={(event) => set("packQty", event.target.value)} />
        </div>
        <div className="field">
          <span className="label">Pack cost (AUD)</span>
          <input className="input" type="number" step="0.01" value={form.packCost} onChange={(event) => set("packCost", event.target.value)} required placeholder="129.90" />
        </div>
        <div className="field">
          <span className="label">Current stock</span>
          <input className="input" type="number" step="0.001" value={form.stockQty} onChange={(event) => set("stockQty", event.target.value)} />
        </div>
        <div className="field">
          <span className="label">Reorder level</span>
          <input className="input" type="number" step="0.001" value={form.reorderLevel} onChange={(event) => set("reorderLevel", event.target.value)} />
        </div>
        <div className="field">
          <span className="label">Supplier</span>
          <input className="input" value={form.supplier} onChange={(event) => set("supplier", event.target.value)} placeholder="Sydney Halal Meats" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Adding…" : "Add material"}
        </button>
        {message ? <span className="tiny muted">{message}</span> : null}
      </div>
    </form>
  );
}

export function RecipeBuilder({ materials, menuItems }: { materials: Material[]; menuItems: { id: number; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    outputKind: "batch" as "batch" | "menu_item",
    menuItemId: "",
    outputQty: "1",
    outputUnit: "portion",
    prepMinutes: "30",
    notes: "",
  });
  const [lines, setLines] = useState<{ materialId: number; qty: string }[]>([
    { materialId: materials[0]?.id ?? 0, qty: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const costPreview = lines.reduce((sum, line) => {
    const material = materials.find((entry) => entry.id === line.materialId);
    if (!material) return sum;
    const unitCost = material.pack_cost_cents / (material.pack_qty || 1);
    return sum + unitCost * Number(line.qty || 0);
  }, 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ops/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recipe",
          recipe: {
            name: form.name,
            outputKind: form.outputKind,
            menuItemId: form.menuItemId ? Number(form.menuItemId) : null,
            outputQty: Number(form.outputQty),
            outputUnit: form.outputUnit,
            prepMinutes: Number(form.prepMinutes),
            notes: form.notes,
            lines: lines.filter((line) => line.materialId && Number(line.qty) > 0).map((line) => ({
              materialId: line.materialId,
              qty: Number(line.qty),
            })),
          },
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save recipe");
      setMessage("Recipe created");
      setForm({ ...form, name: "", notes: "" });
      setLines([{ materialId: materials[0]?.id ?? 0, qty: "" }]);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save recipe");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field full">
          <span className="label">Recipe name</span>
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Naan — 50 piece batch" />
        </div>
        <div className="field">
          <span className="label">Output type</span>
          <select
            className="select"
            value={form.outputKind}
            onChange={(event) => setForm({ ...form, outputKind: event.target.value as "batch" | "menu_item" })}
          >
            <option value="batch">Production batch</option>
            <option value="menu_item">Plated menu item</option>
          </select>
        </div>
        <div className="field">
          <span className="label">Linked menu item (optional)</span>
          <select className="select" value={form.menuItemId} onChange={(event) => setForm({ ...form, menuItemId: event.target.value })}>
            <option value="">None</option>
            {menuItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">Yield quantity</span>
          <input className="input" type="number" min={1} step="0.01" value={form.outputQty} onChange={(event) => setForm({ ...form, outputQty: event.target.value })} />
        </div>
        <div className="field">
          <span className="label">Yield unit</span>
          <input className="input" value={form.outputUnit} onChange={(event) => setForm({ ...form, outputUnit: event.target.value })} placeholder="pieces / portion" />
        </div>
        <div className="field">
          <span className="label">Prep minutes</span>
          <input className="input" type="number" min={1} value={form.prepMinutes} onChange={(event) => setForm({ ...form, prepMinutes: event.target.value })} />
        </div>
        <div className="field">
          <span className="label">Notes</span>
          <input className="input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <span className="label">Materials used</span>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {lines.map((line, index) => {
            const material = materials.find((entry) => entry.id === line.materialId);
            return (
              <div key={index} className="form-row" style={{ alignItems: "center" }}>
                <select
                  className="select"
                  style={{ flex: 2, minWidth: 180 }}
                  value={line.materialId}
                  onChange={(event) =>
                    setLines((current) => current.map((entry, position) => (position === index ? { ...entry, materialId: Number(event.target.value) } : entry)))
                  }
                >
                  {materials.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ width: 120 }}
                  type="number"
                  step="0.001"
                  placeholder={`Qty (${material?.unit ?? "unit"})`}
                  value={line.qty}
                  onChange={(event) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, qty: event.target.value } : entry)))}
                />
                <span className="tiny muted" style={{ minWidth: 90 }}>
                  {material
                    ? `$${(((material.pack_cost_cents / (material.pack_qty || 1)) * Number(line.qty || 0)) / 100).toFixed(2)}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setLines((current) => current.filter((_, position) => position !== index))}
                  disabled={lines.length <= 1}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setLines((current) => [...current, { materialId: materials[0]?.id ?? 0, qty: "" }])}>
            + Add material
          </button>
          <span className="tiny muted">Estimated material cost: ${(costPreview / 100).toFixed(2)}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Create recipe"}
        </button>
        {message ? <span className="tiny muted">{message}</span> : null}
      </div>
    </form>
  );
}
