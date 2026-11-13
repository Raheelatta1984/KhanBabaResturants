"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Khan Baba page error", error.digest, error.message);
  }, [error]);

  return (
    <section className="section" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <div className="container-narrow center">
        <span className="eyebrow">Something burned in the kitchen</span>
        <h1 style={{ margin: "16px 0 12px" }}>We could not load this page.</h1>
        <p className="muted">
          Our team has the details. Try again, or head back to the menu — your order is safe if you already placed it.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 26 }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <a href="/menu" className="btn btn-outline">
            Browse the menu
          </a>
        </div>
        {error.digest ? <p className="tiny muted" style={{ marginTop: 22 }}>Reference: {error.digest}</p> : null}
      </div>
    </section>
  );
}
