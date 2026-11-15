"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Run the audit, close a finding, copy a record.
 *
 * The first two talk to /api/ops/logs and then refresh the server component,
 * so the page always reflects the database rather than an optimistic local
 * guess. Closing a finding requires a note: a row marked resolved with no
 * explanation is indistinguishable from one closed to clear the screen.
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
        found?: number;
        written?: number;
        updated?: number;
        reopened?: number;
        cleared?: number;
        skipped?: number;
        failedChecks?: string[];
        error?: string;
      };
      if (json.error) {
        setNote(json.error);
      } else {
        const parts = [
          `${json.found ?? 0} finding(s)`,
          `${json.written ?? 0} new`,
          `${json.updated ?? 0} still open`,
          `${json.reopened ?? 0} reopened`,
          `${json.cleared ?? 0} cleared`,
        ];
        if (json.skipped) parts.push(`${json.skipped} ignored`);
        if (json.failedChecks?.length) parts.push(`checks that could not run: ${json.failedChecks.join(", ")}`);
        setNote(parts.join(" · "));
      }
      router.refresh();
    } catch {
      setNote("The audit request did not complete. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ textAlign: "right" }}>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run()}>
        {busy ? "Auditing…" : "Run audit now"}
      </button>
      {note ? (
        <div className="tiny muted" role="status" style={{ marginTop: 6, maxWidth: 360 }}>
          {note}
        </div>
      ) : null}
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
    } catch {
      setError("That did not save. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || pending;
  const closed = status === "resolved" || status === "ignored";

  return (
    <div>
      {closed ? (
        <button className="btn btn-sm btn-outline" disabled={disabled} onClick={() => void set("open")}>
          Reopen
        </button>
      ) : (
        <>
          <input
            className="input"
            style={{ marginBottom: 8, padding: "9px 12px", fontSize: "0.84rem" }}
            placeholder="Note: what did you change? (required to resolve or ignore)"
            aria-label="Resolution note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status !== "acknowledged" ? (
              <button className="btn btn-sm btn-outline" disabled={disabled} onClick={() => void set("acknowledged")}>
                Acknowledge
              </button>
            ) : null}
            <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => void set("resolved")}>
              Mark resolved
            </button>
            <button className="btn btn-sm btn-ghost" disabled={disabled} onClick={() => void set("ignored")}>
              Ignore
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            <b>Resolved</b> is checked: if the next audit still sees the fault, it reopens. <b>Ignore</b> mutes this
            reference until someone reopens it.
          </p>
        </>
      )}
      {error ? (
        <div className="tiny" role="alert" style={{ color: "var(--red)", marginTop: 6 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Copy a record's text — what gets pasted into a message to the developer. */
export function CopyText({ text, label = "Copy record" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 1800);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select the text and copy" : label}
    </button>
  );
}
