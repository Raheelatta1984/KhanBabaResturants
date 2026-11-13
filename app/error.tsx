"use client";

import { useEffect } from "react";

/**
 * `app/error.tsx` is the boundary Next.js renders for a page that throws, and it
 * is a *client* component — so the error's message is all it can inspect. The one
 * setup mistake that takes the whole site down is an unconfigured database, so
 * recognise it here and show the fix instead of "we could not load this page".
 */
function looksLikeDatabaseSetup(message: string) {
  return /DATABASE_URL|Neon|ECONNREFUSED|ENOTFOUND|getaddrinfo|password authentication/i.test(
    message,
  );
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Khan Baba page error", error.digest, error.message);
  }, [error]);

  const database = looksLikeDatabaseSetup(error.message ?? "");

  return (
    <section
      className="section"
      style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}
    >
      <div className="container-narrow center">
        <span className="eyebrow">
          {database ? "Setup needed" : "Something burned in the kitchen"}
        </span>
        <h1 style={{ margin: "16px 0 12px" }}>
          {database
            ? "The database is not connected yet."
            : "We could not load this page."}
        </h1>
        {database ? (
          <>
            <p className="muted">
              This deployment cannot reach Postgres, so there is nowhere to read
              the menu from. Set <code>DATABASE_URL</code> to your Neon pooled
              connection string in Vercel → Settings → Environment Variables
              (Production and Preview), then redeploy. The schema and demo menu
              are created automatically on the first request.
            </p>
            <p className="muted tiny">
              Status:{" "}
              <a href="/api/health" style={{ color: "var(--amber, #f3ab3f)" }}>
                /api/health
              </a>
            </p>
          </>
        ) : (
          <p className="muted">
            Our team has the details. Try again, or head back to the menu — your
            order is safe if you already placed it.
          </p>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            marginTop: 26,
          }}
        >
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <a href="/menu" className="btn btn-outline">
            Browse the menu
          </a>
        </div>
        {error.digest ? (
          <p className="tiny muted" style={{ marginTop: 22 }}>
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </section>
  );
}
