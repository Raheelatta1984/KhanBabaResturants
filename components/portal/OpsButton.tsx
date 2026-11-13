"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  endpoint: string;
  payload: Record<string, unknown>;
  children: React.ReactNode;
  className?: string;
  title?: string;
  confirmMessage?: string;
  redirectTo?: string;
  successMessage?: string;
  onSuccess?: () => void;
  disabled?: boolean;
};

/** Small action button for the staff portals: POST → refresh → optional redirect. */
export function OpsButton({
  endpoint,
  payload,
  children,
  className = "btn btn-outline btn-sm",
  title,
  confirmMessage,
  redirectTo,
  successMessage,
  onSuccess,
  disabled,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setToast(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Action failed");
      if (successMessage) setToast({ kind: "ok", text: successMessage });
      onSuccess?.();
      if (redirectTo) {
        router.push(redirectTo);
      }
      router.refresh();
      window.setTimeout(() => setToast(null), 2600);
    } catch (error) {
      setToast({ kind: "err", text: error instanceof Error ? error.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={run} disabled={busy || disabled} title={title}>
        {busy ? "…" : children}
      </button>
      {toast ? (
        <div className="toast" style={toast.kind === "err" ? { borderColor: "rgba(255,122,107,0.4)" } : undefined}>
          <span style={{ color: toast.kind === "err" ? "var(--red)" : "var(--green)" }}>{toast.kind === "err" ? "!" : "✓"}</span>
          {toast.text}
        </div>
      ) : null}
    </>
  );
}
