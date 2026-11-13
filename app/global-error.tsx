"use client";

import { useEffect } from "react";
import {
  DatabaseSetupSteps,
  isDatabaseIssue,
  useDiagnosis,
} from "@/components/DatabaseHelp";

/**
 * Last-resort error boundary.
 *
 * `app/error.tsx` catches errors raised *inside* the layout. When the layout
 * itself fails — which is what happened when `DATABASE_URL` was missing, because
 * the layout read restaurant settings from Postgres — Next.js falls back to its
 * bare "Application error: a server-side exception has occurred" screen and the
 * only clue is a digest number. This component is rendered instead, keeps the
 * branding, and turns the two setup mistakes that actually happen into plain
 * instructions.
 *
 * It must include its own <html>/<body>: it replaces the root layout entirely.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Khan Baba fatal error", error.digest, error.message);
  }, [error]);

  const message = error.message ?? "";
  const databaseIssue =
    /DATABASE_URL|Supabase|Neon|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|password authentication|does not exist|pooler/i.test(
      message,
    );
  const databaseMissing = /DATABASE_URL is not set/i.test(message);

  return (
    <html lang="en-AU">
      <body
        style={{
          margin: 0,
          background: "#0a0908",
          color: "#f4efe6",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <main
          style={{ maxWidth: 680, margin: "0 auto", padding: "12vh 24px 64px" }}
        >
          <p
            style={{
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontSize: 12,
              color: "#f3ab3f",
            }}
          >
            Khan Baba Restaurant
          </p>

          {databaseIssue ? (
            <>
              <h1
                style={{
                  fontFamily: "Fraunces, serif",
                  fontSize: 34,
                  lineHeight: 1.15,
                  margin: "14px 0 12px",
                }}
              >
                The database is not connected yet.
              </h1>
              <p style={{ color: "#c9c2b6", lineHeight: 1.6 }}>
                {databaseMissing
                  ? "This deployment has no DATABASE_URL, so there is nowhere to read the menu from."
                  : "The app could not reach Supabase. This is usually an environment variable, a wrong password, or a paused project."}
              </p>
              <ol
                style={{
                  color: "#c9c2b6",
                  lineHeight: 1.9,
                  paddingLeft: 20,
                  marginTop: 18,
                }}
              >
                <li>
                  Supabase → <b>khanbaba</b> → <b>Connect</b> → copy the{" "}
                  <b>Connection pooling</b> (transaction, port 6543) string.
                </li>
                <li>
                  Vercel → this project →{" "}
                  <b>Settings → Environment Variables</b> → set{" "}
                  <code>DATABASE_URL</code> for <b>Production</b> and{" "}
                  <b>Preview</b>. A variable with an empty value counts as
                  missing.
                </li>
                <li>
                  Redeploy. The schema and the demo menu are created
                  automatically on the first request.
                </li>
              </ol>
              <p style={{ color: "#8f877c", fontSize: 13, marginTop: 18 }}>
                Full walkthrough: README → Deployment. Check status any time at{" "}
                <a href="/api/health" style={{ color: "#f3ab3f" }}>
                  /api/health
                </a>
                .
              </p>
            </>
          ) : (
            <>
              <h1
                style={{
                  fontFamily: "Fraunces, serif",
                  fontSize: 34,
                  lineHeight: 1.15,
                  margin: "14px 0 12px",
                }}
              >
                Something went wrong.
              </h1>
              <p style={{ color: "#c9c2b6", lineHeight: 1.6 }}>
                The page could not be rendered. Try again — if it keeps
                happening, the server logs have the details.
              </p>
              <p style={{ color: "#8f877c", fontSize: 13, marginTop: 18 }}>
                Health check:{" "}
                <a href="/api/health" style={{ color: "#f3ab3f" }}>
                  /api/health
                </a>
              </p>
            </>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 28,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#f3ab3f",
                color: "#0a0908",
                border: 0,
                borderRadius: 999,
                padding: "11px 22px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/api/health"
              style={{
                border: "1px solid #3a352e",
                borderRadius: 999,
                padding: "11px 22px",
                color: "#f4efe6",
                textDecoration: "none",
              }}
            >
              Database status
            </a>
          </div>

          {error.digest ? (
            <p style={{ color: "#6f695f", fontSize: 12, marginTop: 26 }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
