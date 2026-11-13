"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicCustomer } from "@/lib/auth/customer";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/customer/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={signOut} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function AccountDetailsForm({
  customer,
  hasPassword,
}: {
  customer: PublicCustomer;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState({
    name: customer.name,
    phone: customer.phone ?? "",
    address: customer.address ?? "",
    suburb: customer.suburb ?? "",
    postcode: customer.postcode ?? "",
    marketingOptIn: customer.marketingOptIn,
  });
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/customer/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state,
          newPassword: newPassword.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save");
      setMessage({
        kind: "ok",
        text: newPassword
          ? "Saved — you can sign in with that password next time."
          : "Saved — your next checkout is prefilled.",
      });
      setNewPassword("");
      router.refresh();
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Could not save",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="form-grid">
        <div className="field">
          <span className="label">Name</span>
          <input
            className="input"
            value={state.name}
            onChange={(event) => setState({ ...state, name: event.target.value })}
          />
        </div>
        <div className="field">
          <span className="label">Mobile</span>
          <input
            className="input"
            value={state.phone}
            onChange={(event) => setState({ ...state, phone: event.target.value })}
            placeholder="0412 345 678"
          />
        </div>
        <div className="field full">
          <span className="label">Delivery address</span>
          <input
            className="input"
            value={state.address}
            onChange={(event) => setState({ ...state, address: event.target.value })}
            placeholder="12/48 Pirrama Road"
          />
        </div>
        <div className="field">
          <span className="label">Suburb</span>
          <input
            className="input"
            value={state.suburb}
            onChange={(event) => setState({ ...state, suburb: event.target.value })}
          />
        </div>
        <div className="field">
          <span className="label">Postcode</span>
          <input
            className="input"
            value={state.postcode}
            onChange={(event) => setState({ ...state, postcode: event.target.value })}
          />
        </div>
        <label className="check full">
          <input
            type="checkbox"
            checked={state.marketingOptIn}
            onChange={(event) =>
              setState({ ...state, marketingOptIn: event.target.checked })
            }
          />
          Send me the occasional specials message
        </label>
      </div>

      {!hasPassword ? (
        <div className="field full" style={{ marginTop: 14 }}>
          <span className="label">Set a password</span>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <span className="tiny muted">
            You are signed in as a guest account. Setting a password lets you sign
            in from any device — your orders stay where they are.
          </span>
        </div>
      ) : null}

      {message ? (
        <div
          className={`notice ${message.kind === "ok" ? "notice-green" : "notice-red"}`}
          style={{ marginTop: 14 }}
        >
          {message.text}
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 16 }} disabled={busy}>
        {busy ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
