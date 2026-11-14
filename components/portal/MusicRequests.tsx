"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/money";

export type RequestRow = {
  id: number;
  customer_name: string;
  title: string;
  url: string;
  table_code: string | null;
  order_code?: string | null;
  note: string | null;
  status: string;
  charge_cents: number;
  charge_note: string | null;
  created_at: string;
};

/**
 * Approving a song request. The money is deliberately explicit: the field is
 * pre-filled with the rule's amount, and staff may set it to 0 (a gift), lower it
 * or raise it. Nothing is added to a bill until Approve is pressed, and the
 * request only enters the room's queue when it is approved.
 */
export function MusicRequests({
  requests,
  suggested,
  freeAllowed,
}: {
  requests: RequestRow[];
  suggested: number;
  freeAllowed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [charges, setCharges] = useState<Record<number, number>>(() =>
    Object.fromEntries(requests.map((request) => [request.id, suggested])),
  );
  const [playNow, setPlayNow] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(requests.map((request) => [request.id, true])),
  );

  async function act(id: number, action: "approve-request" | "reject-request") {
    setBusy(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/ops/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          requestId: id,
          chargeCents: charges[id] ?? 0,
          playNow: playNow[id] ?? true,
        }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Action failed");
      setMessage(data.message ?? "Done");
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (requests.length === 0) {
    return <p className="small muted">No song requests yet. Guests can ask from the /music page or the table screen.</p>;
  }

  return (
    <div className="music-requests">
      {error ? <div className="notice notice-red" style={{ marginBottom: 10 }}>{error}</div> : null}
      {message ? <p className="tiny" style={{ color: "var(--green)", marginBottom: 10 }}>✓ {message}</p> : null}
      {requests.map((request) => {
        const pending = request.status === "pending";
        return (
          <article key={request.id} className={`music-request ${pending ? "is-pending" : ""}`}>
            <div className="music-request-head">
              <div>
                <b>{request.title}</b>
                <div className="tiny muted">
                  {request.customer_name}
                  {request.table_code ? ` · table ${request.table_code}` : ""}
                  {request.order_code ? ` · ${request.order_code}` : ""} ·{" "}
                  {new Date(request.created_at).toLocaleString("en-AU", {
                    day: "2-digit",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <span
                className={`badge ${
                  request.status === "pending"
                    ? "badge-amber"
                    : request.status === "approved" || request.status === "played"
                      ? "badge-green"
                      : "badge-muted"
                }`}
              >
                {request.status}
              </span>
            </div>
            <a className="tiny" href={request.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--blue)", wordBreak: "break-all" }}>
              {request.url}
            </a>
            {request.note ? <p className="tiny muted" style={{ marginTop: 6 }}>“{request.note}”</p> : null}

            {pending ? (
              <div className="music-request-actions">
                <label className="tiny muted">
                  Charge
                  <input
                    className="input"
                    type="number"
                    min={freeAllowed ? 0 : 0}
                    max={500}
                    step="0.5"
                    value={((charges[request.id] ?? 0) / 100).toFixed(2)}
                    onChange={(event) =>
                      setCharges((current) => ({
                        ...current,
                        [request.id]: Math.round(Number(event.target.value) * 100),
                      }))
                    }
                    style={{ width: 90, marginLeft: 6 }}
                  />
                  <span style={{ marginLeft: 6 }}>AUD</span>
                </label>
                <label className="check tiny">
                  <input
                    type="checkbox"
                    checked={playNow[request.id] ?? true}
                    onChange={(event) =>
                      setPlayNow((current) => ({ ...current, [request.id]: event.target.checked }))
                    }
                  />
                  Play now
                </label>
                <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={busy === request.id}
                    onClick={() => {
                      setCharges((current) => ({ ...current, [request.id]: 0 }));
                      void act(request.id, "approve-request");
                    }}
                    title="Approve as a gift"
                  >
                    Waive &amp; play
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={busy === request.id}
                    onClick={() => {
                      setCharges((current) => ({ ...current, [request.id]: suggested }));
                      void act(request.id, "approve-request");
                    }}
                  >
                    Approve {money(suggested)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy === request.id}
                    onClick={() => act(request.id, "approve-request")}
                  >
                    {busy === request.id ? "…" : "Approve custom"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy === request.id}
                    onClick={() => act(request.id, "reject-request")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : request.charge_cents > 0 ? (
              <p className="tiny" style={{ color: "var(--accent)", marginTop: 6 }}>
                Charged {money(request.charge_cents)}
                {request.charge_note ? ` · ${request.charge_note}` : ""}
              </p>
            ) : request.status === "approved" ? (
              <p className="tiny muted" style={{ marginTop: 6 }}>Approved with no charge</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
