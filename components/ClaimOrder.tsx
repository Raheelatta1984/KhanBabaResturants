"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";

/**
 * Redeems a one-time claim link. Runs on a button press rather than page load so
 * email clients and link scanners that prefetch the URL cannot burn the token.
 */
export function ClaimOrder({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function claim() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/customer/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as {
        error?: string;
        redirectTo?: string;
        orderCode?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not use that link");
      setDone(true);
      window.setTimeout(() => {
        router.push(data.redirectTo || "/account");
        router.refresh();
      }, 700);
    } catch (claimError) {
      setError(
        claimError instanceof Error ? claimError.message : "Could not use that link",
      );
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.7rem", marginBottom: 8 }}>
        {done ? "You are signed in." : "Bring this order into your account"}
      </h1>
      <p className="small muted" style={{ marginBottom: 18 }}>
        This link proves the order is yours. Accepting it signs you in and adds
        the order to your history — no password needed. It works once.
      </p>

      {error ? (
        <div className="notice notice-red" style={{ marginBottom: 14 }}>
          {error}{" "}
          <a href="/login" style={{ color: "var(--accent)", marginLeft: 4 }}>
            Sign in instead
          </a>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={claim}
        disabled={busy || done}
      >
        {done ? (
          <>
            <Icon name="check" size={15} /> Opening your account…
          </>
        ) : busy ? (
          "Checking the link…"
        ) : (
          "Yes, that's my order"
        )}
      </button>
    </div>
  );
}
