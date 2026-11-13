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
  | { state: "database-missing"; reason?: string }
  | { state: "database-unreachable"; detail?: string; hint?: string }
  | { state: "unknown" };

type HealthBody = {
  ok?: boolean;
  storage?: string;
  reason?: string;
  error?: string;
  hint?: string;
};

export function useDiagnosis(): Diagnosis {
  const [diagnosis, setDiagnosis] = useState<Diagnosis>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = (await response.json()) as HealthBody;
        if (cancelled) return;
        if (body.ok) {
          // The database answered, so this page failed for some other reason.
          setDiagnosis({ state: "unknown" });
        } else if (body.storage === "unconfigured") {
          setDiagnosis({ state: "database-missing", reason: body.reason });
        } else {
          setDiagnosis({
            state: "database-unreachable",
            detail: body.error,
            hint: body.hint,
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

/**
 * What to do about it, in the order people actually hit it. The copy is written
 * for whoever owns the Vercel project — it names the exact variable, the exact
 * Supabase screen, and the one detail that breaks the connection string (the
 * pooler host and the port).
 */
export function DatabaseSetupSteps({
  detail,
  hint,
  blank,
}: {
  detail?: string;
  hint?: string;
  blank?: boolean;
}) {
  return (
    <>
      <p className="muted">
        {blank
          ? "This deployment has a DATABASE_URL variable but its value is empty, so the menu has nowhere to load from."
          : "There is no reachable Postgres database, so the menu cannot be loaded."}{" "}
        The app now runs on <b>Supabase</b>: paste the <b>connection pooler</b>{" "}
        string into Vercel → Settings → Environment Variables as{" "}
        <code>DATABASE_URL</code> for <b>Production</b> and <b>Preview</b>, then
        redeploy. The schema and the demo menu are created automatically on the
        first request.
      </p>
      <ol className="muted tiny" style={{ textAlign: "left", lineHeight: 1.9 }}>
        <li>
          Supabase → <b>khanbaba</b> → <b>Connect</b> → copy the{" "}
          <b>Connection pooling</b> / <b>Transaction</b> string. It looks like{" "}
          <code>
            postgresql://postgres.phjsppfyhlgeznhiaqsc:…@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres
          </code>
        </li>
        <li>
          Use port <code>6543</code> (transaction pooler) — not the direct{" "}
          <code>db.…supabase.co</code> host, which is IPv6-only and unreachable
          from Vercel.
        </li>
        <li>
          If the password has <code>@ : / ? #</code> in it, URL-encode those
          characters, or reset the password in Supabase → Project Settings →
          Database.
        </li>
        <li>
          Photos ride on the same project:{" "}
          <code>SUPABASE_URL</code>, <code>SUPABASE_SECRET_KEY</code> and{" "}
          <code>SUPABASE_STORAGE_BUCKET=menu-photos</code>.
        </li>
      </ol>
      {detail ? (
        <p className="muted tiny">
          Reported by the server: <code>{detail}</code>
        </p>
      ) : null}
      {hint ? <p className="muted tiny">{hint}</p> : null}
      <p className="muted tiny">
        Live status:{" "}
        <a href="/api/health" style={{ color: "var(--amber, #f3ab3f)" }}>
          /api/health
        </a>{" "}
        — it says whether the variable is missing, blank, or just unreachable.
      </p>
    </>
  );
}
