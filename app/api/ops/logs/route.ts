import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import {
  allLogs,
  closedLogs,
  logSummary,
  openLogs,
  runAudit,
  setLogStatus,
  type LogRow,
} from "@/lib/ops/log";
import {
  actionSummary,
  getAction,
  listActions,
  pruneActions,
  withActionLog,
  type ActionFilter,
} from "@/lib/ops/actions";
import {
  actionsCsv,
  actionsNdjson,
  findingsCsv,
  findingsNdjson,
  formatActionText,
  formatFindingText,
} from "@/lib/ops/format";
import { buildLabel } from "@/lib/build";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The operational log.
 *
 *   GET                         open findings (what is wrong now)
 *   GET ?view=history           closed findings
 *   GET ?view=all               every finding
 *   GET ?view=actions           the action log (what was done), newest first
 *        &level= &component= &outcome= &q= &since=YYYY-MM-DD &problems=1 &limit=
 *   GET ?ref=ACT-… | LOG-…      one entry
 *   GET ?summary=1              counts
 *   …any of the above with &format=text | csv | ndjson to export
 *
 *   POST { action: "audit" }                       re-audit the live system
 *   POST { action: "set-status", id, status, note }
 *
 * Staff-only. The audit is read-only against the system it inspects: it looks
 * and reports, and changes nothing except the log itself.
 */

type Format = "json" | "text" | "csv" | "ndjson";

function formatOf(url: URL): Format {
  const value = url.searchParams.get("format") ?? "json";
  return value === "text" || value === "csv" || value === "ndjson" ? value : "json";
}

function download(body: string, format: Exclude<Format, "json">, name: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  const types = {
    text: ["text/plain; charset=utf-8", "log"],
    csv: ["text/csv; charset=utf-8", "csv"],
    ndjson: ["application/x-ndjson; charset=utf-8", "ndjson"],
  } as const;
  const [type, extension] = types[format];
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${format === "text" ? "inline" : "attachment"}; filename="khanbaba-${name}-${stamp}.${extension}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** The header every text export opens with: what produced it, from which build. */
function preamble(view: string, count: number, total: number, filter: string): string {
  return [
    `# khanbaba operational log · view=${view}`,
    `# generated=${new Date().toISOString()} build=${buildLabel()} rows=${count}${total > count ? ` of ${total}` : ""}`,
    filter ? `# filter: ${filter}` : null,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function actionFilter(url: URL): ActionFilter {
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  return {
    level: get("level"),
    component: get("component"),
    outcome: get("outcome"),
    q: get("q"),
    since: get("since"),
    problems: get("problems") === "1",
    limit: Number(get("limit")) || undefined,
    offset: Number(get("offset")) || undefined,
  };
}

export async function GET(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  const db = await getDb();
  const url = new URL(request.url);
  const format = formatOf(url);

  if (url.searchParams.get("summary") === "1") {
    return NextResponse.json({
      ok: true,
      build: buildLabel(),
      summary: await logSummary(db),
      actions: await actionSummary(db),
    });
  }

  // One entry, by the reference somebody quoted.
  const ref = (url.searchParams.get("ref") ?? "").trim().toUpperCase();
  if (ref) {
    if (ref.startsWith("ACT-")) {
      const row = await getAction(db, ref);
      if (!row) return NextResponse.json({ error: `No action ${ref}` }, { status: 404 });
      if (format === "json") return NextResponse.json({ ok: true, action: row });
      if (format === "csv") return download(actionsCsv([row]), "csv", ref);
      if (format === "ndjson") return download(actionsNdjson([row]), "ndjson", ref);
      return download(`${formatActionText(row)}\n`, "text", ref);
    }
    const row = await db.maybeOne<LogRow>("SELECT * FROM operation_logs WHERE reference = $1", [ref]);
    if (!row) return NextResponse.json({ error: `No finding ${ref}` }, { status: 404 });
    if (format === "json") return NextResponse.json({ ok: true, finding: row });
    if (format === "csv") return download(findingsCsv([row]), "csv", ref);
    if (format === "ndjson") return download(findingsNdjson([row]), "ndjson", ref);
    return download(`${formatFindingText(row)}\n`, "text", ref);
  }

  const view = url.searchParams.get("view") ?? "findings";

  if (view === "actions") {
    const filter = actionFilter(url);
    // An export is the whole filtered set, not the first screen of it.
    if (format !== "json" && !filter.limit) filter.limit = 5000;
    const { rows, total } = await listActions(db, filter);
    if (format === "json") return NextResponse.json({ ok: true, total, actions: rows });
    if (format === "csv") return download(actionsCsv(rows), "csv", "actions");
    if (format === "ndjson") return download(actionsNdjson(rows), "ndjson", "actions");
    const described = [...url.searchParams.entries()]
      .filter(([key, value]) => value && !["view", "format"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return download(
      `${preamble("actions", rows.length, total, described)}${rows.map(formatActionText).join("\n\n")}\n`,
      "text",
      "actions",
    );
  }

  const kind = url.searchParams.get("kind") ?? undefined;
  const source =
    view === "history" ? await closedLogs(db, 500) : view === "all" ? await allLogs(db, 2000) : await openLogs(db, 200);
  const rows = kind ? source.filter((row) => row.kind === kind) : source;
  const name = view === "history" ? "findings-history" : view === "all" ? "findings-all" : "findings";

  if (format === "json") return NextResponse.json({ ok: true, logs: rows });
  if (format === "csv") return download(findingsCsv(rows), "csv", name);
  if (format === "ndjson") return download(findingsNdjson(rows), "ndjson", name);
  return download(
    `${preamble(name, rows.length, rows.length, kind ? `kind=${kind}` : "")}${rows.map(formatFindingText).join("\n\n")}\n`,
    "text",
    name,
  );
}

async function post(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  let body: { action?: string; id?: number; status?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();

  if (body.action === "audit") {
    const result = await runAudit(db);
    const pruned = await pruneActions(db).catch(() => 0);
    return NextResponse.json({
      ok: true,
      found: result.findings.length,
      written: result.written,
      updated: result.updated,
      reopened: result.reopened,
      cleared: result.cleared,
      skipped: result.skipped,
      failedChecks: result.failedChecks.map((entry) => entry.check),
      pruned,
    });
  }

  if (body.action === "set-status") {
    const status = body.status ?? "";
    if (!["open", "acknowledged", "resolved", "ignored"].includes(status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "A log id is required" }, { status: 400 });
    }
    // A closed row with no explanation is indistinguishable from one closed to
    // clear the screen, so a note is required to close.
    if ((status === "resolved" || status === "ignored") && (body.note ?? "").trim().length < 4) {
      return NextResponse.json(
        { error: "Add a short note explaining what you did before closing." },
        { status: 400 },
      );
    }
    const actor = session.name || session.email || "staff";
    const ok = await setLogStatus(db, id, status as never, actor, body.note);
    if (!ok) return NextResponse.json({ error: "No such log entry" }, { status: 404 });
    const row = await db.maybeOne<{ reference: string }>(
      "SELECT reference FROM operation_logs WHERE id = $1",
      [id],
    );
    return NextResponse.json({ ok: true, id, status, reference: row?.reference ?? null });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** Every call is written to the action log: who, what, the outcome, what to do next. */
export const POST = withActionLog("logs", post);
