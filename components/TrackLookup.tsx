"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";

/**
 * Accepts anything a customer is likely to paste: an order code, a full
 * `/t/<token>` URL, or a bare token. Ambiguity is resolved on the server —
 * this only decides which page to go to.
 */
export function TrackLookup() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return setError("Enter your order code or tracking link.");

    // A pasted link: take the last path segment.
    const fromUrl = raw.match(/\/t\/([A-Za-z0-9_-]+)/);
    const ref = fromUrl ? fromUrl[1] : raw;
    const isCode = /^KB-/i.test(ref);

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(ref)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(
          isCode
            ? "We could not find that order code. Check the receipt and try again."
            : "That tracking link is not recognised. Try the order code instead.",
        );
        setBusy(false);
        return;
      }
      router.push(isCode ? `/order/${ref.toUpperCase()}` : `/t/${ref}`);
    } catch {
      setError("Network problem — check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <span className="label">Order code or tracking link</span>
        <input
          className="input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="KB-DEMO01  or  https://…/t/…"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error ? (
        <div className="notice notice-red" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={busy}
      >
        {busy ? "Looking…" : "Find my order"} <Icon name="arrow" size={15} />
      </button>
    </form>
  );
}
