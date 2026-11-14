"use client";

import Link from "next/link";
import { useState } from "react";

type Item = { name: string; qty: number; image: string | null };

/**
 * The guest feedback form behind a one-time link.
 *
 * Three quick questions — rating, how many were at the table, which dishes — and
 * an optional comment. The dishes are pre-filled from the actual order, so a
 * guest who cannot be bothered to type still produces a specific review.
 */
export function FeedbackForm({
  token,
  code,
  restaurantName,
  items,
  partySize,
  googleUrl,
}: {
  token: string;
  code: string;
  restaurantName: string;
  items: Item[];
  partySize: number;
  googleUrl: string;
}) {
  const [rating, setRating] = useState(5);
  const [people, setPeople] = useState(partySize || 2);
  const [picked, setPicked] = useState<string[]>(items.slice(0, 4).map((item) => item.name));
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function toggle(name: string) {
    setPicked((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/feedback/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, partySize: people, highlights: picked, comment }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save your feedback");
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel" style={{ padding: 28 }}>
        <span className="eyebrow">Shukriya</span>
        <h2 style={{ fontSize: "1.9rem", margin: "12px 0" }}>
          Your feedback is with the {restaurantName} team.
        </h2>
        <p className="small muted" style={{ marginBottom: 18 }}>
          The team reads every word. If you have a moment, the same words — with the photos of what
          you ate — make a Google review that helps another family find us.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={googleUrl} target="_blank" rel="noreferrer noopener">
            Open Google and post it
          </a>
          <Link href={`/order/${code}`} className="btn btn-outline">
            Back to my order
          </Link>
        </div>
        <p className="tiny muted" style={{ marginTop: 14 }}>
          Google does not allow a restaurant to post a review in your name, so it opens Google’s own
          review page — your words, your account.
        </p>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={submit} style={{ padding: 26 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">Two minutes · order {code}</span>
          <h2 style={{ fontSize: "1.9rem", marginTop: 10 }}>How was the meal?</h2>
        </div>
        <span className="badge badge-green">Paid &amp; served</span>
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <span className="label">Your rating</span>
        <div className="rating-input" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} star${value > 1 ? "s" : ""}`}
              className={value <= rating ? "is-on" : ""}
              onClick={() => setRating(value)}
            >
              ★
            </button>
          ))}
          <span className="tiny muted" style={{ marginLeft: 8 }}>{rating} / 5</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <span className="label">How many people were served?</span>
        <div className="party-row">
          {[1, 2, 3, 4, 5, 6].map((value) => (
            <button
              key={value}
              type="button"
              className={`party-pill ${people === value ? "is-on" : ""}`}
              onClick={() => setPeople(value)}
            >
              {value}
            </button>
          ))}
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            min={1}
            max={40}
            value={people}
            onChange={(event) => setPeople(Number(event.target.value) || 1)}
            aria-label="Number of people served"
          />
          <span className="tiny muted">people</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <span className="label">What did you eat? (pick the dishes that stood out)</span>
        <div className="dish-chips">
          {items.map((item) => (
            <button
              key={item.name}
              type="button"
              className={`dish-chip ${picked.includes(item.name) ? "is-on" : ""}`}
              onClick={() => toggle(item.name)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <span className="label">Anything else? (optional)</span>
        <textarea
          className="input"
          rows={3}
          maxLength={1200}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="The naan, the heat, the service — tell it like it was."
        />
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <span className="label">First name (optional)</span>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="How should the team sign the reply?"
        />
      </div>

      {error ? <div className="notice notice-red" style={{ marginTop: 14 }}>{error}</div> : null}

      <button type="submit" className="btn btn-primary" style={{ marginTop: 18 }} disabled={busy}>
        {busy ? "Sending…" : "Send feedback"}
      </button>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Your review is drafted with the dishes you picked, the photos from our menu and your bill
        range — no personal details are published.
      </p>
    </form>
  );
}
