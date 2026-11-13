"use client";

import { useState } from "react";

export function ReviewForm({ itemId, requireApproval }: { itemId: number; requireApproval: boolean }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, customerName: name, rating, comment }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save your review");
      setState("done");
      setMessage(
        requireApproval
          ? "Thanks! Your review is with the team and will appear once approved."
          : "Thanks! Your review is published.",
      );
      setName("");
      setComment("");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong");
    }
  }

  if (state === "done") {
    return <div className="notice notice-green">{message}</div>;
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: "1.05rem", marginBottom: 14 }}>Leave a review</h3>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">Your name</span>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={40} placeholder="First name and initial" />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">Rating</span>
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              aria-label={`${value} star${value > 1 ? "s" : ""}`}
              style={{ background: "none", border: 0, fontSize: "1.4rem", color: value <= rating ? "var(--accent)" : "var(--surface-3)", padding: "0 2px" }}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <span className="label">Comment</span>
        <textarea className="textarea" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={400} placeholder="How was it? Portion size, heat level, delivery…" />
      </div>
      {state === "error" ? <div className="notice notice-red" style={{ marginBottom: 12 }}>{message}</div> : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Submit review"}
      </button>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Reviews are moderated by the restaurant. One review per order is plenty.
      </p>
    </form>
  );
}
