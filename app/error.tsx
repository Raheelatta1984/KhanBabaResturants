"use client";

import { useEffect } from "react";
import {
  DatabaseSetupSteps,
  isDatabaseIssue,
  useDiagnosis,
} from "@/components/DatabaseHelp";

/**
 * Page-level boundary. A failure here is usually setup rather than a real bug,
 * so ask `/api/health` what is wrong before showing a generic apology.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const diagnosis = useDiagnosis();

  useEffect(() => {
    console.error("Khan Baba page error", error.digest, error.message);
  }, [error]);

  const database = isDatabaseIssue(diagnosis);

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
          <DatabaseSetupSteps
            blank={
              diagnosis.state === "database-missing" &&
              diagnosis.reason === "blank-connection-string"
            }
            detail={
              diagnosis.state === "database-unreachable"
                ? diagnosis.detail
                : undefined
            }
            hint={
              diagnosis.state === "database-unreachable"
                ? diagnosis.hint
                : undefined
            }
          />
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
