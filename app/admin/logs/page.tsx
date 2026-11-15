import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db";
import { closedLogs, ensureFreshAudit, lastAuditAt, logSummary, openLogs, type LogRow } from "@/lib/ops/log";
import { actionSummary, listActions, parseCourse, type ActionRow } from "@/lib/ops/actions";
import { findingSteps, formatActionText, formatFindingText } from "@/lib/ops/format";
import type { Step } from "@/lib/ops/playbook";
import { CopyText, LogActions, RunAudit } from "@/components/portal/LogActions";
import { BUILD, buildLabel } from "@/lib/build";
import { RESTAURANT_TZ } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operational log",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;
type View = "findings" | "actions" | "history";

/** Each entry carries its full record, so a page of them is not small. */
const PAGE_SIZE = 50;

/**
 * The operational log.
 *
 * Two records, one format:
 *
 *   Findings    what is wrong right now — raised by the audit, closed by it
 *   Action log  what was done — one row per staff or system action
 *
 * Every entry carries a reference to quote and a course of action: ordered
 * steps, each with an owner, a place to do it, and how to tell it worked. The
 * page audits on arrival (at most every ten minutes), so it is never empty for
 * want of somebody pressing a button.
 *
 * Deliberately dense: this is a page for someone fixing a fault.
 */
export default async function LogsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const view: View = one("view") === "actions" ? "actions" : one("view") === "history" ? "history" : "findings";

  const db = await getDb();
  const audit = await ensureFreshAudit(db);
  const [summary, actions, auditedAt] = await Promise.all([logSummary(db), actionSummary(db), lastAuditAt(db)]);

  const tabs: { view: View; label: string; count: number; href: string }[] = [
    { view: "findings", label: "Findings", count: summary.open, href: "/admin/logs" },
    { view: "actions", label: "Action log", count: actions.total, href: "/admin/logs?view=actions" },
    { view: "history", label: "History", count: summary.resolved + summary.ignored, href: "/admin/logs?view=history" },
  ];

  return (
    <>
      <div className="page-head">
        <div style={{ maxWidth: 720 }}>
          <h1>Operational log</h1>
          <p>
            <b>Findings</b> are what is wrong now. The <b>action log</b> is what was done. Every entry has a
            reference to quote and a course of action: who does what, where, and how to confirm it worked.
          </p>
        </div>
        <RunAudit />
      </div>

      <div className="log-strip">
        <div>
          <span>Open findings</span>
          <b>{summary.open}</b>
          <small>
            {summary.critical} critical · {summary.error} error · {summary.warning} warning
          </small>
        </div>
        <div>
          <span>Actions · 24 h</span>
          <b>{actions.last24h}</b>
          <small>{actions.ok24h} completed</small>
        </div>
        <div>
          <span>Problems · 24 h</span>
          <b style={actions.problems24h > 0 ? { color: "var(--red)" } : undefined}>{actions.problems24h}</b>
          <small>
            {actions.failed24h} failed · {actions.problems24h - actions.failed24h} refused
          </small>
        </div>
        <div>
          <span>Last audit</span>
          <b className="mono-text" style={{ fontSize: "0.95rem", marginTop: 8 }}>
            {audit.ran ? "just now" : local(auditedAt)}
          </b>
          <small>{audit.ran ? "ran when this page opened" : "re-runs when older than 10 min"}</small>
        </div>
        <div>
          <span>Build serving this page</span>
          <b className="mono-text" style={{ fontSize: "0.95rem", marginTop: 8 }}>
            {buildLabel()}
          </b>
          <small>{BUILD.builtAt ? `built ${local(BUILD.builtAt)}` : "local build"}</small>
        </div>
      </div>

      <nav className="section-nav" aria-label="Log views">
        {tabs.map((tab) => (
          <Link key={tab.view} href={tab.href} data-active={tab.view === view ? "true" : "false"}>
            {tab.label}
            <b>{tab.count}</b>
          </Link>
        ))}
      </nav>

      {view === "findings" ? <Findings rows={await openLogs(db, 200)} byKind={summary.byKind} /> : null}
      {view === "history" ? <History rows={await closedLogs(db, 200)} /> : null}
      {view === "actions" ? <Actions db={db} one={one} components={actions.components} oldest={actions.oldest} /> : null}

      <div className="card" style={{ padding: 18, marginTop: 22 }}>
        <b className="small">How to read an entry</b>
        <dl className="log-kv" style={{ marginTop: 10 }}>
          <dt>reference</dt>
          <dd>
            LOG-… is a finding and keeps the same reference every time the same fault is seen. ACT-… is one action
            that happened once. Quote either and it can be found: /admin/logs?view=actions&amp;q=ACT-…
          </dd>
          <dt>level</dt>
          <dd>info · notice (a sensitive change that worked) · warning (refused) · error · critical</dd>
          <dt>outcome</dt>
          <dd>ok · rejected (a rule refused it) · denied (not signed in or not permitted) · failed (the system failed)</dd>
          <dt>course of action</dt>
          <dd>Ordered steps. Each names an owner, where to do it, and what you should see when it has worked.</dd>
          <dt>privacy</dt>
          <dd>
            Passwords, tokens and setting values are never stored. Customer and driver details are withheld, and an
            email address or phone number inside a request is masked. The one address kept in full is the login of
            the member of staff who acted, because the log exists to say who did what.
          </dd>
          <dt>retention</dt>
          <dd>
            Routine actions are kept 30 days; sensitive changes (notice) and every problem are kept 180 days.
            Findings are kept.
          </dd>
        </dl>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ findings */

function Findings({ rows, byKind }: { rows: LogRow[]; byKind: { kind: string; count: number }[] }) {
  return (
    <>
      <Exports base="/api/ops/logs?view=findings" note={byKind.map((entry) => `${entry.kind} ${entry.count}`).join(" · ")} />

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <b>No open findings.</b>
          <p className="small muted" style={{ marginTop: 6 }}>
            The audit ran and every check passed. It runs again when this page is opened, or on demand with “Run
            audit now”.
          </p>
        </div>
      ) : null}

      {rows.map((row) => (
        <details key={row.id} className="log-entry" data-level={row.severity} open={row.severity === "critical"}>
          <summary>
            <Level level={row.severity} />
            <code className="log-ref">{row.reference}</code>
            <span className="log-title">{row.title}</span>
            <span className="log-line">
              {row.code ? `${row.code} · ` : ""}owner={row.owner} · seen={row.occurrences}× · last={stamp(row.last_seen_at)}
              {row.status === "acknowledged" ? " · acknowledged" : ""}
            </span>
          </summary>

          <div className="log-body">
            {row.detail ? (
              <Block title="Observed">
                <p className="small">{row.detail}</p>
              </Block>
            ) : null}

            <Block title="Course of action">
              <Steps steps={findingSteps(row)} />
            </Block>

            {row.context ? (
              <Block title="Why this matters">
                <p className="small muted">{row.context}</p>
              </Block>
            ) : null}

            {row.evidence ? (
              <Block title="Evidence">
                <pre className="log-pre">{pretty(row.evidence)}</pre>
              </Block>
            ) : null}

            <Block title="Record">
              <dl className="log-kv">
                <dt>reference</dt>
                <dd>{row.reference}</dd>
                <dt>code</dt>
                <dd>{row.code ?? "—"}</dd>
                <dt>component</dt>
                <dd>{row.kind}</dd>
                <dt>severity</dt>
                <dd>{row.severity}</dd>
                <dt>status</dt>
                <dd>{row.status}</dd>
                <dt>subject</dt>
                <dd>{row.subject ?? "—"}</dd>
                <dt>first_seen</dt>
                <dd>
                  {stamp(row.first_seen_at)} ({local(row.first_seen_at)})
                </dd>
                <dt>last_seen</dt>
                <dd>
                  {stamp(row.last_seen_at)} ({local(row.last_seen_at)})
                </dd>
                <dt>occurrences</dt>
                <dd>{row.occurrences}</dd>
                {row.resolution_note ? (
                  <>
                    <dt>note</dt>
                    <dd>{row.resolution_note}</dd>
                  </>
                ) : null}
              </dl>
            </Block>

            <Raw text={formatFindingText(row)} />
            <LogActions id={row.id} status={row.status} />
          </div>
        </details>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------- history */

function History({ rows }: { rows: LogRow[] }) {
  return (
    <>
      <Exports base="/api/ops/logs?view=history" note="Closed findings, most recently closed first." />

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <b>Nothing has been closed yet.</b>
          <p className="small muted" style={{ marginTop: 6 }}>
            A finding moves here when the audit stops seeing the fault, or when someone resolves or ignores it.
          </p>
        </div>
      ) : null}

      {rows.map((row) => (
        <details key={row.id} className="log-entry" data-level="closed">
          <summary>
            <span className="lvl">{row.status}</span>
            <code className="log-ref">{row.reference}</code>
            <span className="log-title">{row.title}</span>
            <span className="log-line">
              closed={stamp(row.resolved_at)} · by={row.resolved_by ?? "—"} · was={row.severity}
            </span>
          </summary>
          <div className="log-body">
            <Block title="How it was closed">
              <p className="small">{row.resolution_note ?? "No note recorded."}</p>
            </Block>
            <Block title="Course of action that applied">
              <Steps steps={findingSteps(row)} />
            </Block>
            <Raw text={formatFindingText(row)} />
            <LogActions id={row.id} status={row.status} />
          </div>
        </details>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------- actions */

async function Actions({
  db,
  one,
  components,
  oldest,
}: {
  db: Awaited<ReturnType<typeof getDb>>;
  one: (key: string) => string;
  components: string[];
  oldest: string | null;
}) {
  const filter = {
    q: one("q"),
    level: one("level"),
    component: one("component"),
    outcome: one("outcome"),
    since: one("since"),
    problems: one("problems") === "1",
  };
  const offset = Math.max(Number(one("offset")) || 0, 0);
  const { rows, total } = await listActions(db, { ...filter, limit: PAGE_SIZE, offset });

  const query = new URLSearchParams({ view: "actions" });
  for (const [key, value] of Object.entries(filter)) {
    if (value === true) query.set(key, "1");
    else if (typeof value === "string" && value) query.set(key, value);
  }
  const filtered = [...query.keys()].length > 1;
  const page = (next: number) => {
    const copy = new URLSearchParams(query);
    if (next > 0) copy.set("offset", String(next));
    return `/admin/logs?${copy.toString()}`;
  };

  return (
    <>
      <form className="log-filters" method="get" action="/admin/logs">
        <input type="hidden" name="view" value="actions" />
        <label>
          Search
          <input className="input" name="q" defaultValue={filter.q} placeholder="reference, person, order…" />
        </label>
        <label>
          Level
          <select className="select" name="level" defaultValue={filter.level}>
            <option value="">any</option>
            {["info", "notice", "warning", "error", "critical"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Component
          <select className="select" name="component" defaultValue={filter.component}>
            <option value="">any</option>
            {components.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Outcome
          <select className="select" name="outcome" defaultValue={filter.outcome}>
            <option value="">any</option>
            {["ok", "rejected", "denied", "failed"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Since
          <input className="input" type="date" name="since" defaultValue={filter.since} />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 9 }}>
          <input type="checkbox" name="problems" value="1" defaultChecked={filter.problems} />
          problems only
        </label>
        <button className="btn btn-sm btn-primary" type="submit">
          Apply
        </button>
        {filtered ? (
          <Link className="btn btn-sm btn-ghost" href="/admin/logs?view=actions">
            Clear
          </Link>
        ) : null}
      </form>

      <Exports
        base={`/api/ops/logs?${query.toString()}`}
        note={`${rows.length === 0 ? 0 : offset + 1}–${offset + rows.length} of ${total}${filtered ? " matching" : ""}${
          oldest ? ` · recording since ${local(oldest)}` : ""
        }`}
      />

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <b>{filtered ? "No actions match those filters." : "No actions recorded yet."}</b>
          <p className="small muted" style={{ marginTop: 6 }}>
            {filtered
              ? "Widen the filters, or clear them to see everything."
              : "Every staff action from now on is recorded here: sign-ins, order steps, menu and price changes, settings, publishing."}
          </p>
        </div>
      ) : null}

      {rows.map((row) => {
        const course = parseCourse(row.course);
        return (
          <details key={row.id} className="log-entry" data-level={row.level}>
            <summary>
              <Level level={row.level} />
              <code className="log-ref">{row.reference}</code>
              <span className="log-title">
                <span className="mono-text">{row.action}</span>
                {row.target ? <span className="muted"> → {row.target}</span> : null}
              </span>
              <span className="log-line">
                {stamp(row.occurred_at)} · <b>{row.outcome}</b>
                {row.http_status ? ` ${row.http_status}` : ""}
                {row.error_code ? ` ${row.error_code}` : ""} · {row.actor}
                {row.duration_ms !== null ? ` · ${row.duration_ms} ms` : ""}
              </span>
            </summary>

            <div className="log-body">
              <Block title="What happened">
                <p className="small">{row.message}</p>
              </Block>

              <Block title={`Course of action · ${course.code}`}>
                <p className="small muted" style={{ marginBottom: 10 }}>
                  {course.summary}
                </p>
                <Steps steps={course.steps} />
              </Block>

              <Block title="Record">
                <dl className="log-kv">
                  <dt>reference</dt>
                  <dd>{row.reference}</dd>
                  <dt>occurred_at</dt>
                  <dd>
                    {stamp(row.occurred_at)} ({local(row.occurred_at)})
                  </dd>
                  <dt>action</dt>
                  <dd>{row.action}</dd>
                  <dt>outcome</dt>
                  <dd>
                    {row.outcome}
                    {row.http_status ? ` · HTTP ${row.http_status}` : ""}
                    {row.error_code ? ` · ${row.error_code}` : ""}
                  </dd>
                  <dt>actor</dt>
                  <dd>
                    {row.actor}
                    {row.actor_role ? ` (${row.actor_role})` : ""}
                  </dd>
                  <dt>target</dt>
                  <dd>{row.target ?? "—"}</dd>
                  <dt>request</dt>
                  <dd>
                    {row.method ?? "—"} {row.route ?? ""}
                    {row.duration_ms !== null ? ` · ${row.duration_ms} ms` : ""}
                  </dd>
                  <dt>build</dt>
                  <dd>{row.build ?? "—"}</dd>
                  {row.request_id ? (
                    <>
                      <dt>request_id</dt>
                      <dd>{row.request_id}</dd>
                    </>
                  ) : null}
                  {row.finding_reference ? (
                    <>
                      <dt>related_finding</dt>
                      <dd>
                        <Link href="/admin/logs" style={{ color: "var(--accent)" }}>
                          {row.finding_reference}
                        </Link>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </Block>

              {row.detail ? (
                <Block title="Request and response (redacted)">
                  <pre className="log-pre">{pretty(row.detail)}</pre>
                </Block>
              ) : null}

              <Raw text={formatActionText(row)} />
            </div>
          </details>
        );
      })}

      {total > PAGE_SIZE ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 14 }}>
          {offset > 0 ? (
            <Link className="btn btn-sm btn-outline" href={page(Math.max(offset - PAGE_SIZE, 0))}>
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {offset + rows.length < total ? (
            <Link className="btn btn-sm btn-outline" href={page(offset + PAGE_SIZE)}>
              Older →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------- pieces */

function Level({ level }: { level: string }) {
  return <span className={`lvl lvl-${level}`}>{level}</span>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="log-h">{title}</div>
      {children}
    </section>
  );
}

/** Screens a step can link to. Anything else is shown as text. */
const LINKABLE = /^\/(admin|counter|kitchen|delivery|staff|menu|checkout|whats-new|api\/health)(\/|$|#|\?)/;

/** Turn in-app paths inside a "where" into links; leave everything else as text. */
function Where({ text }: { text: string }) {
  const parts = text.split(/(\/[a-z][\w\-/#?=&.%]*)/g);
  return (
    <>
      {parts.map((part, index) =>
        LINKABLE.test(part) ? (
          <Link key={index} href={part}>
            {part}
          </Link>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return <p className="small muted">No steps recorded.</p>;
  return (
    <ol className="log-steps">
      {steps.map((step, index) => (
        <li key={index}>
          <div>
            <span className="owner-chip">{step.owner}</span>
            {step.do}
            {step.where ? (
              <span className="where">
                Where: <Where text={step.where} />
              </span>
            ) : null}
            {step.verify ? <span className="verify">Verify: {step.verify}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The plain-text record: identical to what the export contains. */
function Raw({ text }: { text: string }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div className="log-h" style={{ marginBottom: 0 }}>
          Technical record
        </div>
        <CopyText text={text} />
      </div>
      <pre className="log-pre">{text}</pre>
    </section>
  );
}

function Exports({ base, note }: { base: string; note?: string }) {
  const href = (format: string) => `${base}${base.includes("?") ? "&" : "?"}format=${format}`;
  return (
    <p className="tiny muted" style={{ marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
      {note ? <span>{note}</span> : null}
      <span>
        Export:{" "}
        <a href={href("text")} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
          plain text
        </a>
        {" · "}
        <a href={href("csv")} style={{ color: "var(--accent)" }}>
          CSV
        </a>
        {" · "}
        <a href={href("ndjson")} style={{ color: "var(--accent)" }}>
          NDJSON
        </a>
      </span>
    </p>
  );
}

/** ISO-8601 UTC to the second: unambiguous, sortable, greppable. */
function stamp(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : `${date.toISOString().slice(0, 19)}Z`;
}

/** The same instant on the restaurant's clock. */
function local(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: RESTAURANT_TZ,
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Stored JSON, indented. Falls back to the raw text: a malformed payload is still information. */
function pretty(raw: unknown): string {
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
