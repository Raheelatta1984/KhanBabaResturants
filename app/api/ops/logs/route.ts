import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { logSummary, openLogs, runAudit, setLogStatus } from "@/lib/ops/log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The operational log.
 *
 *   GET  ?summary=1   counts by severity and kind
 *   GET               open findings
 *   POST { action: "audit" }                  re-audit the live system
 *   POST { action: "set-status", id, status, note }
 *
 * Staff-only. The audit is read-only against the system it inspects: it looks
 * and reports, and changes nothing except the log itself.
 */
export async function GET(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  const db = await getDb();
  const url = new URL(request.url);

  if (url.searchParams.get("summary") === "1") {
    return NextResponse.json({ ok: true, summary: await logSummary(db) });
  }

  const kind = url.searchParams.get("kind") ?? undefined;
  const all = await openLogs(db, 200);
  return NextResponse.json({
    ok: true,
    logs: kind ? all.filter((row) => row.kind === kind) : all,
  });
}

export async function POST(request: Request) {
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
    return NextResponse.json({
      ok: true,
      found: result.findings.length,
      written: result.written,
      updated: result.updated,
      skipped: result.skipped,
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
    return NextResponse.json({ ok: true, id, status });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
