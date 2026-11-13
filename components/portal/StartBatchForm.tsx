"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartBatchForm({
  recipes,
}: {
  recipes: { id: number; name: string; output_unit: string; prep_minutes: number }[];
}) {
  const router = useRouter();
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? 0);
  const [plannedQty, setPlannedQty] = useState(recipes[0]?.output_unit === "pieces" ? 50 : 10);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected = recipes.find((recipe) => recipe.id === recipeId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ops/production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", recipeId, plannedQty, notes }),
      });
      const data = (await response.json()) as { error?: string; batch?: { ref: string } };
      if (!response.ok) throw new Error(data.error || "Could not start batch");
      setMessage(`Batch ${data.batch?.ref} started`);
      setNotes("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start batch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-row">
      <div className="field" style={{ minWidth: 200, flex: 1 }}>
        <span className="label">Recipe</span>
        <select
          className="select"
          value={recipeId}
          onChange={(event) => {
            const nextId = Number(event.target.value);
            setRecipeId(nextId);
            const next = recipes.find((recipe) => recipe.id === nextId);
            setPlannedQty(next?.output_unit === "pieces" ? 50 : 10);
          }}
        >
          {recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ width: 120 }}>
        <span className="label">Quantity ({selected?.output_unit ?? "units"})</span>
        <input className="input" type="number" min={1} step={1} value={plannedQty} onChange={(event) => setPlannedQty(Number(event.target.value))} />
      </div>
      <div className="field" style={{ minWidth: 160, flex: 1 }}>
        <span className="label">Note (optional)</span>
        <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Lunch service prep" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Starting…" : "Start production"}
      </button>
      {message ? <span className="tiny muted" style={{ flexBasis: "100%" }}>{message}</span> : null}
    </form>
  );
}
