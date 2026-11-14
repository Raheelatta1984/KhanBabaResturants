import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { publicOffers } from "@/lib/community";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community meals",
  description:
    "Free, untouched Khan Baba meals for neighbours in need. First comment wins, click & collect only.",
};

export default async function CommunityPage() {
  const db = await getDb();
  const [offers, settings] = await Promise.all([publicOffers(db), getSettings()]);
  const enabled = settings.community_enabled === "1";

  return (
    <section className="section-tight" style={{ paddingTop: 40, paddingBottom: 72 }}>
      <div className="container">
        <span className="eyebrow">Khan Baba community</span>
        <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", margin: "12px 0 10px" }}>
          Good food should never go to waste.
        </h1>
        <p className="muted small" style={{ maxWidth: 680, marginBottom: 24 }}>
          When a returned order is untouched and safe, we offer it free to a
          neighbour in need. Be the first to claim, then collect from the
          counter — {settings.community_pickup_hours}. No delivery, no payment,
          one meal per household.
        </p>

        {!enabled ? (
          <div className="notice">The community programme is paused right now. Please check back later.</div>
        ) : offers.length === 0 ? (
          <div className="panel empty">
            <div className="icon"><Icon name="bag" size={28} /></div>
            <h3>No meals available right now</h3>
            <p className="small">
              New offers appear here and on our Facebook Page as soon as a
              return is redirected.
            </p>
          </div>
        ) : (
          <div className="grid grid-2">
            {offers.map((offer) => {
              let items: { name: string; qty: number }[] = [];
              try {
                items = JSON.parse(offer.contents ?? "[]") as typeof items;
              } catch {
                items = [];
              }
              const claimed = offer.status === "claimed";
              return (
                <article className="panel" key={offer.token}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <h3 style={{ fontSize: "1.15rem" }}>{offer.title}</h3>
                    <span className={`badge ${claimed ? "badge-muted" : "badge-green"}`}>
                      {claimed ? "Claimed" : "Available"}
                    </span>
                  </div>
                  <p className="small muted">{offer.description}</p>
                  {items.length ? (
                    <div className="tiny" style={{ margin: "12px 0" }}>
                      {items.map((item) => (
                        <span key={item.name} className="tag" style={{ marginRight: 6 }}>
                          {item.qty}× {item.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
                    <Link href={`/community/${offer.token}`} className="btn btn-primary btn-sm">
                      {claimed ? "See who got it" : "Claim details"}
                    </Link>
                    <span className="tiny muted">
                      Keyword <b className="mono">{offer.claim_keyword}</b> · click &amp; collect only
                    </span>
                  </div>
                  {claimed && offer.claimed_by ? (
                    <p className="tiny" style={{ color: "var(--green)", marginTop: 10 }}>
                      Booked by {offer.claimed_by}. thank you we have got it
                      booked — click &amp; collect only.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        <div className="notice" style={{ marginTop: 26 }}>
          <Icon name="shield" size={15} />
          <span>
            Allergen information is available at the counter. Meals are handed
            over sealed and untouched; please collect within the stated window.
          </span>
        </div>
      </div>
    </section>
  );
}
