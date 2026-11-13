"use client";

import { useState } from "react";
import { Icon } from "../Icon";

/**
 * Counter action: mint a one-time link for a guest order and put it on the
 * clipboard (or show it, when the clipboard is blocked) so staff can text it.
 * The token is redeemed only when the customer taps it, so it is safe to paste
 * into an SMS.
 */
export function ClaimLinkButton({
  orderId,
  hasEmail,
}: {
  orderId: number;
  hasEmail: boolean;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError("");
    setLink("");
    try {
      const response = await fetch(`/api/ops/orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim-link" }),
      });
      const data = (await response.json()) as { error?: string; claimUrl?: string };
      if (!response.ok) throw new Error(data.error || "Could not create a link");
      setLink(data.claimUrl ?? "");
      try {
        await navigator.clipboard.writeText(data.claimUrl ?? "");
      } catch {
        /* shown on screen instead */
      }
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Could not create a link",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={create}
        disabled={busy || !hasEmail}
        title={
          hasEmail
            ? "Create a one-time link the customer can text themselves"
            : "No email on this order"
        }
      >
        <Icon name="user" size={13} /> {busy ? "…" : link ? "New link" : "Account link"}
      </button>
      {link ? (
        <code className="tiny" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
          {link} · copied
        </code>
      ) : null}
      {error ? (
        <span className="tiny" style={{ color: "var(--red)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
