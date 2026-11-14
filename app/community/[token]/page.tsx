import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { offerByToken } from "@/lib/community";
import { CommunityClaimForm } from "@/components/CommunityClaimForm";
import { Icon } from "@/components/Icon";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Claim a community meal",
  robots: { index: false },
};

export default async function CommunityOfferPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const [offer, settings] = await Promise.all([
    offerByToken(db, token),
    getSettings(),
  ]);
  if (!offer) notFound();
  const claimed = offer.status === "claimed";
  let items: { name: string; qty: number }[] = [];
  try {
    items = JSON.parse(offer.contents ?? "[]") as typeof items;
  } catch {
    items = [];
  }

  return (
    <section className="section-tight" style={{ paddingTop: 40, paddingBottom: 72 }}>
      <div className="container" style={{ maxWidth: 760 }}>
        <nav className="tiny muted" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <Link href="/community">Community meals</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Claim</span>
        </nav>
        <span className="eyebrow">First comment wins</span>
        <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.7rem)", margin: "12px 0 10px" }}>
          {offer.title}
        </h1>
        <p className="muted small" style={{ marginBottom: 22 }}>{offer.description}</p>

        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="row"><span className="small">Collection</span><b>Click &amp; collect only</b></div>
          <div className="row" style={{ marginTop: 8 }}><span className="small">Window</span><b>{settings.community_pickup_hours}</b></div>
          <div className="row" style={{ marginTop: 8 }}><span className="small">Price</span><b style={{ color: "var(--green)" }}>Free</b></div>
          {items.length ? (
            <div style={{ marginTop: 14 }}>
              <span className="label">In the bag</span>
              <div className="small" style={{ marginTop: 6 }}>
                {items.map((item) => `${item.qty}× ${item.name}`).join(" · ")}
              </div>
            </div>
          ) : null}
        </div>

        {claimed ? (
          <div className="notice notice-green" style={{ display: "block" }}>
            <b>{offer.auto_reply_text ?? settings.community_auto_reply}</b>
            <p className="small" style={{ marginTop: 8 }}>
              This post is now closed to further comments. Your booking is for
              click &amp; collect only.
            </p>
            <p className="small">
              Claimed by {offer.claimed_by ?? "a community member"} at{" "}
              {formatDateTime(offer.claimed_at)}. The post is closed to further
              comments so nobody else can claim this meal.
            </p>
          </div>
        ) : offer.status === "posted" ? (
          <div className="panel">
            <div className="panel-head"><h3>Claim this meal</h3><span className="badge badge-green">Available</span></div>
            <CommunityClaimForm
              token={offer.token}
              keyword={offer.claim_keyword}
              postUrl={offer.facebook_post_url}
              sandbox={offer.facebook_mode !== "live"}
            />
          </div>
        ) : (
          <div className="notice">This offer is no longer open for claims.</div>
        )}

        <div className="notice" style={{ marginTop: 20 }}>
          <Icon name="shield" size={15} />
          <span>
            One meal per household. Please only claim if you can collect during
            the window — the counter team needs the pickup code or ticket.
          </span>
        </div>
      </div>
    </section>
  );
}
