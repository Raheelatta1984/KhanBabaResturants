"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Run the audit, and close a finding.
 *
 * Both talk to /api/ops/logs and then refresh the server component, so the page
 * always reflects the database rather than an optimistic local guess. Closing a
 * finding requires a note: a row marked resolved with no explanation is
 * indistinguishable from one that was closed to clear the screen.
 */
export function RunAudit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/ops/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "audit" }),
      });
      const json = (await res.json()) as {
        written?: number;
        updated?: number;
        skipped?: number;
        error?: string;
      };
      setNote(
        json.error ??
          `${json.written ?? 0} new, ${json.updated ?? 0} updated, ${json.skipped ?? 0} left resolved.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ textAlign: "right" }}>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run()}>
        {busy ? "Auditing…" : "Run audit"}
      </button>
      {note ? <div className="tiny muted" style={{ marginTop: 6 }}>{note}</div> : null}
    </div>
  );
}

export function LogActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = async (next: "acknowledged" | "resolved" | "ignored" | "open") => {
    if ((next === "resolved" || next === "ignored") && note.trim().length < 4) {
      setError("Add a short note explaining what you did, then close it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-status", id, status: next, note }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (json.error) setError(json.error);
      else startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || pending;

  return (
    <div style={{ marginTop: 12 }}>
      {status !== "resolved" && status !== "ignored" ? (
        <>
          <input
            className="input input-sm"
            style={{ width: "100%", marginBottom: 8 }}
            placeholder="Note: what did you change? (required to close)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" disabled={disabled} onClick={() => void set("acknowledged")}>
              Acknowledge
            </button>
            <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => void set("resolved")}>
              Mark resolved
            </button>
            <button className="btn btn-sm" disabled={disabled} onClick={() => void set("ignored")}>
              Ignore
            </button>
          </div>
        </>
      ) : (
        <button className="btn btn-sm" disabled={disabled} onClick={() => void set("open")}>
          Reopen
        </button>
      )}
      {error ? <div className="tiny" style={{ color: "var(--danger, #b3261e)", marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}
