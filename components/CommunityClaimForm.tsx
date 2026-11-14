"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

export function CommunityClaimForm({
  token,
  keyword,
  postUrl,
  sandbox,
}: {
  token: string;
  keyword: string;
  postUrl: string | null;
  sandbox: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [claim, setClaim] = useState<{
    pickupCode: string;
    claimOrderCode: string | null;
    autoReply: string | null;
  } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/community/offers/${encodeURIComponent(token)}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, keyword: comment }),
      });
      const data = (await res.json()) as {
        error?: string;
        pickupCode?: string;
        claimOrderCode?: string | null;
        autoReply?: string | null;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not claim this meal");
      setClaim({
        pickupCode: data.pickupCode ?? "",
        claimOrderCode: data.claimOrderCode ?? null,
        autoReply: data.autoReply ?? null,
      });
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not claim");
    } finally {
      setBusy(false);
    }
  }

  if (claim) {
    return (
      <div className="notice notice-green" style={{ display: "block", whiteSpace: "normal" }}>
        <b style={{ fontSize: "1.05rem" }}>Booked for click &amp; collect 🎉</b>
        <p className="small" style={{ margin: "10px 0" }}>
          {claim.autoReply ?? "thank you we have got it booked"}
        </p>
        <p className="small">
          Show pickup code <b className="mono" style={{ fontSize: "1.1rem" }}>{claim.pickupCode}</b>{" "}
          at the counter{claim.claimOrderCode ? ` (ticket ${claim.claimOrderCode})` : ""}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="form-grid">
      {postUrl ? (
        <div className="field full">
          <a href={postUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-block">
            <Icon name="arrow" size={14} />{" "}
            {sandbox ? "View the post preview" : "Comment on the Facebook post"}
          </a>
          <span className="tiny muted">
            Be the first to comment <b>{keyword}</b> on the post to book it.
          </span>
        </div>
      ) : null}
      <div className="field full">
        <span className="label">Your name</span>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name for the booking" required />
      </div>
      <div className="field full">
        <span className="label">First comment / claim word</span>
        <input className="input mono" value={comment} onChange={(event) => setComment(event.target.value.toUpperCase())} placeholder={keyword} required />
      </div>
      <div className="field full">
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Checking…" : "Claim this meal — click & collect only"}
        </button>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          First valid claim wins. We auto-comment to confirm, then close the post
          to further comments. Free of charge — no delivery available.
        </p>
      </div>
      {error ? <div className="field full notice notice-red">{error}</div> : null}
    </form>
  );
}
