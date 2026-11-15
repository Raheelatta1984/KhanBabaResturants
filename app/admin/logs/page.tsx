import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { logSummary, openLogs, type LogRow } from "@/lib/ops/log";
import { LogActions, RunAudit } from "@/components/portal/LogActions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operational log",
  robots: { index: false, follow: false },
};

/**
 * The operational log.
 *
 * Deliberately dense and technical: this is a page for someone fixing a fault,
 * not a dashboard for a customer. Every row answers the same four questions in
 * the same order — what, how do I confirm it, what do I do, who owns it — so a
 * fault that has never been seen before can still be acted on.
 */
export default async function LogsPage() {
  const session = await getApiSession(["admin", "manager"]);
  const db = await getDb();
  const [rows, summary] = await Promise.all([openLogs(db, 100), logSummary(db)]);

  const severityBadge: Record<string, string> = {
    critical: "badge-red",
    error: "badge-red",
    warning: "badge-amber",
    info: "badge-green",
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Operational log</h1>
          <p className="muted">
            Findings with a reference, the evidence behind them, and the course of action. Re-running
            the audit updates an existing row rather than duplicating it, so a reference stays
            meaningful between visits.
          </p>
        </div>
        <RunAudit />
      </div>

      <div className="row" style={{ gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          ["Open", summary.open],
          ["Critical", summary.critical],
          ["Error", summary.error],
          ["Warning", summary.warning],
          ["Resolved", summary.resolved],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <div className="tiny muted">{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      {summary.byKind.length > 0 ? (
        <p className="tiny muted" style={{ marginBottom: 14 }}>
          {summary.byKind.map((entry) => `${entry.kind} ${entry.count}`).join(" · ")}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <b>No open findings.</b>
          <p className="small muted" style={{ marginTop: 6 }}>
            Either everything is healthy or the audit has not run since the last change. Press
            “Run audit” above to check the live system.
          </p>
        </div>
      ) : null}

      {rows.map((row) => (
        <details key={row.id} className="card" style={{ marginBottom: 12, padding: 0 }} open={row.severity === "critical"}>
          <summary style={{ padding: 14, cursor: "pointer", listStyle: "none" }}>
            <span className={`badge ${severityBadge[row.severity] ?? "badge-amber"}`}>{row.severity}</span>{" "}
            <code className="tiny" style={{ marginLeft: 6 }}>
              {row.reference}
            </code>{" "}
            <code className="tiny muted">[{row.kind}]</code>
            <span style={{ marginLeft: 10, fontWeight: 600 }}>{row.title}</span>
            <span className="tiny muted" style={{ marginLeft: 10 }}>
              owner: {row.owner} · seen {row.occurrences}× · last {row.last_seen_at.slice(0, 16).replace("T", " ")}
            </span>
          </summary>

          <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--line)" }}>
            {row.detail ? (
              <div style={{ marginTop: 12 }}>
                <div className="tiny muted" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>
                  Finding
                </div>
                <p className="small" style={{ marginTop: 4 }}>
                  {row.detail}
                </p>
              </div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              <div className="tiny muted" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>
                Course of action
              </div>
              <p className="small" style={{ marginTop: 4 }}>
                {row.action}
              </p>
            </div>

            {row.context ? (
              <div style={{ marginTop: 12 }}>
                <div className="tiny muted" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>
                  Why this matters
                </div>
                <p className="small muted" style={{ marginTop: 4 }}>
                  {row.context}
                </p>
              </div>
            ) : null}

            {row.evidence ? (
              <div style={{ marginTop: 12 }}>
                <div className="tiny muted" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>
                  Evidence
                </div>
                <pre
                  className="tiny"
                  style={{
                    marginTop: 4,
                    padding: 10,
                    background: "var(--surface-2, #f6f6f4)",
                    borderRadius: 6,
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {prettyEvidence(row.evidence)}
                </pre>
              </div>
            ) : null}

            <table className="table tiny" style={{ marginTop: 12 }}>
              <tbody>
                <tr>
                  <td style={{ width: 150 }} className="muted">Reference</td>
                  <td><code>{row.reference}</code></td>
                </tr>
                <tr>
                  <td className="muted">Kind / severity</td>
                  <td>{row.kind} · {row.severity}</td>
                </tr>
                <tr>
                  <td className="muted">Owner</td>
                  <td>{row.owner}</td>
                </tr>
                <tr>
                  <td className="muted">Subject</td>
                  <td>{row.subject ?? "—"}</td>
                </tr>
                <tr>
                  <td className="muted">Status</td>
                  <td>{row.status}</td>
                </tr>
                <tr>
                  <td className="muted">First seen</td>
                  <td>{row.first_seen_at.slice(0, 19).replace("T", " ")}</td>
                </tr>
                <tr>
                  <td className="muted">Last seen</td>
                  <td>{row.last_seen_at.slice(0, 19).replace("T", " ")}</td>
                </tr>
              </tbody>
            </table>

            {session ? <LogActions id={row.id} status={row.status} /> : null}
          </div>
        </details>
      ))}

      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <b className="small">How to read this</b>
        <ul className="small muted" style={{ marginTop: 8, paddingLeft: 18 }}>
          <li>
            <b>Reference</b> — stable and quotable. The same fault keeps the same reference across
            audits, so “LOG-WA-… A1B2” means one specific problem, not a category.
          </li>
          <li>
            <b>Evidence</b> — the rows and values behind the finding. Enough to confirm it yourself
            without trusting the log.
          </li>
          <li>
            <b>Course of action</b> — ordered by what to try first. Written for a person at 6pm on a
            Friday, not for a developer with the schema open.
          </li>
          <li>
            <b>Resolved</b> stays resolved. If the fault returns after you close it, reopen it
            deliberately — an auto-reopening log becomes noise nobody reads.
          </li>
        </ul>
      </div>
    </>
  );
}

/**
 * Evidence is stored as JSON text. Pretty-print it when it parses, and fall back
 * to the raw text when it does not — a malformed payload is still information.
 */
function prettyEvidence(raw: unknown): string {
  if (typeof raw !== "string") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export type { LogRow };
