"use client";

import { useEffect, useState } from "react";

/**
 * Shared diagnosis for both error boundaries.
 *
 * Next.js replaces a server error's message with a digest in production builds,
 * so the message can never be trusted on the client. `/api/health` is a tiny
 * endpoint that already knows whether the database is configured and reachable,
 * so the error screen asks it instead of guessing. Anything else is reported as a
 * generic failure with the digest, which is what the server logs are keyed on.
 */
export type Diagnosis =
  | { state: "checking" }
  | { state: "database-missing" }
  | { state: "database-unreachable"; detail?: string }
  | { state: "unknown" };

export function useDiagnosis(): Diagnosis {
  const [diagnosis, setDiagnosis] = useState<Diagnosis>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = (await response.json()) as {
          ok?: boolean;
          storage?: string;
          error?: string;
        };
        if (cancelled) return;
        if (body.ok) {
          // The database answered, so this page failed for some other reason.
          setDiagnosis({ state: "unknown" });
        } else if (body.storage === "unconfigured") {
          setDiagnosis({ state: "database-missing" });
        } else {
          setDiagnosis({
            state: "database-unreachable",
            detail: body.error,
          });
        }
      } catch {
        if (!cancelled) setDiagnosis({ state: "unknown" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return diagnosis;
}

export function isDatabaseIssue(diagnosis: Diagnosis) {
  return (
    diagnosis.state === "database-missing" ||
    diagnosis.state === "database-unreachable"
  );
}

/** The three steps that fix either database case. */
export function DatabaseSetupSteps({ detail }: { detail?: string }) {
  return (
    <>
      <p className="muted">
        There is no reachable Postgres database, so the menu cannot be loaded.
        Set <code>DATABASE_URL</code> to your Neon <b>pooled</b> connection
        string (<code>postgresql://…-pooler…?sslmode=require</code>) in Vercel →
        Settings → Environment Variables for <b>Production</b> and{" "}
        <b>Preview</b>, then redeploy. The schema and the demo menu are created
        automatically on the first request.
      </p>
      {detail ? (
        <p className="muted tiny">
          Reported by the server: <code>{detail}</code>
        </p>
      ) : null}
      <p className="muted tiny">
        Live status:{" "}
        <a href="/api/health" style={{ color: "var(--amber, #f3ab3f)" }}>
          /api/health
        </a>
      </p>
    </>
  );
}
