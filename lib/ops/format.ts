import type { ActionRow } from "./actions";
import { parseCourse } from "./actions";
import type { Course, Step } from "./playbook";

/**
 * The technical rendering of a log row.
 *
 * One header line of `key=value` pairs that a person can read and `grep` can
 * match, then indented blocks. The same text is shown on the page, returned by
 * the export, and is what gets pasted into a support ticket — so there is one
 * format, not a pretty one and a real one.
 */

export type FindingRow = {
  id: number;
  reference: string;
  kind: string;
  severity: string;
  code: string | null;
  title: string;
  detail: string | null;
  evidence: string | null;
  action: string;
  steps: string | null;
  context: string | null;
  owner: string;
  subject: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

/** Quote a value for a key=value line only when it needs it. */
function kv(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  return /[\s"=]/.test(text) ? `${key}="${text.replace(/"/g, '\\"')}"` : `${key}=${text}`;
}

function iso(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function stepLines(steps: Step[], indent: string): string[] {
  if (steps.length === 0) return [`${indent}(none recorded)`];
  const lines: string[] = [];
  steps.forEach((step, index) => {
    lines.push(`${indent}${index + 1}. [${step.owner}] ${step.do}`);
    if (step.where) lines.push(`${indent}   where:  ${step.where}`);
    if (step.verify) lines.push(`${indent}   verify: ${step.verify}`);
  });
  return lines;
}

function prettyJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

/** The single header line for an action. */
export function actionHeadline(row: ActionRow): string {
  return [
    iso(row.occurred_at),
    row.level.toUpperCase().padEnd(8),
    row.reference,
    row.action,
    kv("outcome", row.outcome),
    kv("http", row.http_status),
    kv("code", row.error_code),
    kv("actor", row.actor),
    kv("role", row.actor_role),
    kv("target", row.target),
    kv("duration_ms", row.duration_ms),
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatActionText(row: ActionRow): string {
  const course = parseCourse(row.course);
  const lines = [
    actionHeadline(row),
    `  message: ${row.message}`,
    `  request: ${[kv("method", row.method), kv("route", row.route), kv("request_id", row.request_id), kv("build", row.build)]
      .filter(Boolean)
      .join(" ") || "-"}`,
    `  course_of_action: ${course.code} — ${course.summary}`,
    ...stepLines(course.steps, "    "),
  ];
  if (row.finding_reference) lines.push(`  related_finding: ${row.finding_reference}`);
  const detail = prettyJson(row.detail);
  if (detail) lines.push("  detail:", indentBlock(detail, "    "));
  return lines.join("\n");
}

export function findingSteps(row: Pick<FindingRow, "steps" | "action" | "owner">): Step[] {
  try {
    const parsed = JSON.parse(row.steps ?? "") as Step[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // A row written before steps existed has only the paragraph.
  }
  return row.action ? [{ do: row.action, owner: row.owner as Step["owner"] }] : [];
}

export function findingHeadline(row: FindingRow): string {
  return [
    iso(row.last_seen_at),
    row.severity.toUpperCase().padEnd(8),
    row.reference,
    row.code ?? `${row.kind}.finding`,
    kv("status", row.status),
    kv("component", row.kind),
    kv("owner", row.owner),
    kv("subject", row.subject),
    kv("occurrences", row.occurrences),
    kv("first_seen", iso(row.first_seen_at)),
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatFindingText(row: FindingRow): string {
  const lines = [findingHeadline(row), `  finding: ${row.title}`];
  if (row.detail) lines.push(`  observed: ${row.detail}`);
  lines.push("  course_of_action:", ...stepLines(findingSteps(row), "    "));
  if (row.context) lines.push(`  rationale: ${row.context}`);
  const evidence = prettyJson(row.evidence);
  if (evidence) lines.push("  evidence:", indentBlock(evidence, "    "));
  if (row.resolved_at) {
    lines.push(
      `  closed: ${[kv("at", iso(row.resolved_at)), kv("by", row.resolved_by), kv("note", row.resolution_note)]
        .filter(Boolean)
        .join(" ")}`,
    );
  }
  return lines.join("\n");
}

/* ----------------------------------------------------------------- exports */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A cell that starts with = + - @ is a formula to a spreadsheet. A log is
  // exactly the kind of file that gets opened in one.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function courseText(course: Course): string {
  return course.steps
    .map((step, index) => `${index + 1}. [${step.owner}] ${step.do}${step.where ? ` @ ${step.where}` : ""}${step.verify ? ` => ${step.verify}` : ""}`)
    .join(" | ");
}

export function actionsCsv(rows: ActionRow[]): string {
  const header = [
    "occurred_at", "level", "reference", "component", "action", "outcome", "http_status", "error_code",
    "actor", "actor_role", "target", "method", "route", "duration_ms", "message", "course_code",
    "course_summary", "course_of_action", "finding_reference", "build", "request_id",
  ];
  const lines = rows.map((row) => {
    const course = parseCourse(row.course);
    return [
      iso(row.occurred_at), row.level, row.reference, row.component, row.action, row.outcome, row.http_status,
      row.error_code, row.actor, row.actor_role, row.target, row.method, row.route, row.duration_ms, row.message,
      course.code, course.summary, courseText(course), row.finding_reference, row.build, row.request_id,
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

export function findingsCsv(rows: FindingRow[]): string {
  const header = [
    "last_seen_at", "severity", "reference", "code", "component", "status", "owner", "subject", "occurrences",
    "first_seen_at", "finding", "observed", "course_of_action", "rationale", "resolved_at", "resolved_by",
    "resolution_note",
  ];
  const lines = rows.map((row) =>
    [
      iso(row.last_seen_at), row.severity, row.reference, row.code, row.kind, row.status, row.owner, row.subject,
      row.occurrences, iso(row.first_seen_at), row.title, row.detail,
      courseText({ code: row.code ?? "", summary: "", steps: findingSteps(row) }), row.context,
      row.resolved_at ? iso(row.resolved_at) : "", row.resolved_by, row.resolution_note,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** One JSON object per line — what a log pipeline ingests. */
export function actionsNdjson(rows: ActionRow[]): string {
  return (
    rows
      .map((row) =>
        JSON.stringify({
          ts: iso(row.occurred_at),
          level: row.level,
          ref: row.reference,
          component: row.component,
          action: row.action,
          outcome: row.outcome,
          http_status: row.http_status,
          error_code: row.error_code,
          actor: row.actor,
          actor_role: row.actor_role,
          target: row.target,
          method: row.method,
          route: row.route,
          duration_ms: row.duration_ms,
          message: row.message,
          course_of_action: parseCourse(row.course),
          finding_ref: row.finding_reference,
          detail: safeParse(row.detail),
          build: row.build,
          request_id: row.request_id,
        }),
      )
      .join("\n") + (rows.length ? "\n" : "")
  );
}

export function findingsNdjson(rows: FindingRow[]): string {
  return (
    rows
      .map((row) =>
        JSON.stringify({
          ts: iso(row.last_seen_at),
          level: row.severity,
          ref: row.reference,
          code: row.code,
          component: row.kind,
          status: row.status,
          owner: row.owner,
          subject: row.subject,
          occurrences: row.occurrences,
          first_seen: iso(row.first_seen_at),
          finding: row.title,
          observed: row.detail,
          course_of_action: findingSteps(row),
          rationale: row.context,
          evidence: safeParse(row.evidence),
          resolved_at: row.resolved_at ? iso(row.resolved_at) : null,
          resolved_by: row.resolved_by,
          resolution_note: row.resolution_note,
        }),
      )
      .join("\n") + (rows.length ? "\n" : "")
  );
}
