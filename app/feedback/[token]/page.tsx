import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { feedbackInviteByToken, googleReviewUrl } from "@/lib/feedback";
import { getSettings, settingValue } from "@/lib/settings";
import { FeedbackForm } from "@/components/FeedbackForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How was your meal?",
  robots: { index: false },
};

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const found = await feedbackInviteByToken(db, token);
  if (!found) notFound();
  const settings = await getSettings();
  const googleUrl = await googleReviewUrl(db);
  const restaurantName = settingValue(settings, "restaurant_name", "Khan Baba Restaurant");

  return (
    <section className="section-tight" style={{ paddingTop: 28 }}>
      <div className="container-narrow">
        <nav className="tiny muted" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Link href="/">{restaurantName}</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Feedback</span>
        </nav>

        {found.invite.submitted_at ? (
          <div className="panel" style={{ padding: 28 }}>
            <span className="eyebrow">Already received · {found.order.code}</span>
            <h1 style={{ fontSize: "2.3rem", margin: "12px 0" }}>Shukriya — we have your feedback.</h1>
            <p className="small muted" style={{ marginBottom: 18 }}>
              {found.invite.rating
                ? `You rated the meal ${found.invite.rating}/5 for ${found.invite.party_size} ${
                    found.invite.party_size === 1 ? "person" : "people"
                  }.`
                : "The team has it."}{" "}
              If you have a moment, the same words make a Google review that helps another family find
              us.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <a className="btn btn-primary" href={googleUrl} target="_blank" rel="noreferrer noopener">
                Open Google review
              </a>
              <Link href={`/order/${found.order.code}`} className="btn btn-outline">
                Back to my order
              </Link>
            </div>
          </div>
        ) : (
          <FeedbackForm
            token={token}
            code={found.order.code}
            restaurantName={restaurantName}
            items={found.items.map((item) => ({ name: item.name, qty: item.qty, image: item.image }))}
            partySize={found.invite.party_size}
            googleUrl={googleUrl}
          />
        )}
      </div>
    </section>
  );
}
