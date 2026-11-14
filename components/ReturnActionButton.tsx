"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Counter / admin shortcut: send an order to the community programme. */
export function ReturnActionButton({ orderCode }: { orderCode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    if (!window.confirm(`Redirect ${orderCode} to the community? The post will be published and the first comment can book it for click & collect.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/ops/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_return",
          orderCode,
          resolution: "community",
          reason: "Redirected from the order desk",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not redirect");
      setMessage("Published");
      router.push("/admin/community");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not redirect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={submit}>
        {busy ? "Publishing…" : "Redirect to community"}
      </button>
      {message ? <span className="tiny muted">{message}</span> : null}
    </span>
  );
}
