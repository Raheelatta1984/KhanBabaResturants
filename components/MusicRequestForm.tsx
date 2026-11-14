"use client";

import { useState } from "react";

/**
 * A guest asks for a song. The link is mandatory — the room needs a source it
 * can actually play — and the request goes to the counter for approval. Charges
 * are decided by staff, never by the form.
 */
export function MusicRequestForm({ open }: { open: boolean }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [table, setTable] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <div className="panel" style={{ padding: 22 }}>
        <h3>Song requests are closed</h3>
        <p className="small muted" style={{ marginTop: 8 }}>
          The room is running a set programme right now. Ask the counter — they may still take a
          request.
        </p>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/music/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          title,
          url,
          tableCode: table,
          note,
        }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Could not send that request");
      setMessage(data.message ?? "Sent to the counter.");
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel" style={{ padding: 24 }}>
        <div className="pay-tick" aria-hidden="true" style={{ width: 42, height: 42, fontSize: "1.1rem" }}>
          ♪
        </div>
        <h3 style={{ margin: "12px 0 6px" }}>Request sent</h3>
        <p className="small muted">{message}</p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 14 }}
          onClick={() => {
            setDone(false);
            setTitle("");
            setUrl("");
            setNote("");
          }}
        >
          Ask for another
        </button>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={submit} style={{ padding: 24 }}>
      <span className="eyebrow">On demand</span>
      <h3 style={{ margin: "10px 0 4px" }}>Ask the room for a song</h3>
      <p className="tiny muted" style={{ marginBottom: 16 }}>
        Paste a YouTube or audio link. The counter approves requests; a small charge may apply and
        they will tell you before it plays.
      </p>

      <div className="form-grid">
        <div className="field">
          <span className="label">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={60}
            placeholder="Who is it for?"
          />
        </div>
        <div className="field">
          <span className="label">Table (optional)</span>
          <input
            className="input"
            value={table}
            onChange={(event) => setTable(event.target.value)}
            placeholder="T04"
            maxLength={10}
          />
        </div>
        <div className="field full">
          <span className="label">Song title</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={120}
            placeholder="e.g. Mast Qalandar"
          />
        </div>
        <div className="field full">
          <span className="label">Link to the song (required)</span>
          <input
            className="input"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </div>
        <div className="field full">
          <span className="label">Note for the counter (optional)</span>
          <input
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder="It's our anniversary — play it after the mains?"
          />
        </div>
      </div>

      {error ? <div className="notice notice-red" style={{ marginTop: 14 }}>{error}</div> : null}

      <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy}>
        {busy ? "Sending…" : "Send request to the counter"}
      </button>
    </form>
  );
}
