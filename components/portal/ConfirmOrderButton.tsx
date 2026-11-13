"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../Icon";

/**
 * Counter acceptance. Once accepted the order is routed to the kitchen display
 * and — by default — the counter is taken straight to the kitchen ticket.
 */
export function ConfirmOrderButton({ orderId, code }: { orderId: number; code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [autoOpen, setAutoOpen] = useState(true);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/ops/orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      const data = (await response.json()) as { error?: string; kitchenUrl?: string };
      if (!response.ok) throw new Error(data.error || "Could not confirm");
      router.refresh();
      if (autoOpen) {
        window.setTimeout(() => router.push(data.kitchenUrl ?? `/kitchen?focus=${code}`), 500);
      }
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Could not confirm");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
          <Icon name="check" size={14} /> {busy ? "Sending…" : "Accept & send to kitchen"}
        </button>
        <label className="check tiny" style={{ whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={autoOpen} onChange={(event) => setAutoOpen(event.target.checked)} />
          Open kitchen after
        </label>
      </div>
      {error ? <div className="notice notice-red" style={{ marginTop: 8 }}>{error}</div> : null}
    </div>
  );
}
