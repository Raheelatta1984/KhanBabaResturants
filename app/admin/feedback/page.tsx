import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings, settingValue } from "@/lib/settings";
import { getBaseUrl } from "@/lib/url";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import {
  draftsForTeam,
  feedbackStats,
  googleReviewUrl,
} from "@/lib/feedback";
import { OpsButton } from "@/components/portal/OpsButton";
import { CopyField } from "@/components/portal/CopyField";
import { ActionForm } from "@/components/portal/ActionForm";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "Feedback & Google reviews" };

/**
 * Feedback → Google review drafts.
 *
 * The team reads the guest's words, sees the dish photos that will accompany
 * them, the bill range and “served 3 people”, and either copies the draft to
 * Google (the honest route — Google does not allow a restaurant to publish a
 * review on a guest's behalf) or marks it skipped.
 */
export default async function AdminFeedbackPage() {
  const db = await getDb();
  const [drafts, stats, googleUrl, settings, invites, recentOrders, baseUrl] = await Promise.all([
    draftsForTeam(db, 20),
    feedbackStats(db),
    googleReviewUrl(db),
    getSettings(),
    db.query<{
      id: number; token: string; order_id: number; code: string; customer_name: string;
      channel: string; party_size: number; sent_at: string | null; submitted_at: string | null;
      rating: number | null; created_at: string;
    }>(
      `SELECT f.id, f.token, f.order_id, o.code, o.customer_name, f.channel, f.party_size,
         f.sent_at, f.submitted_at, f.rating, f.created_at
       FROM feedback_invites f JOIN orders o ON o.id = f.order_id
       ORDER BY f.id DESC LIMIT 15`,
    ),
    db.query<{
      id: number; code: string; customer_name: string; total_cents: number; channel: string;
      completed_at: string | null;
    }>(
      `SELECT o.id, o.code, o.customer_name, o.total_cents, o.channel, o.completed_at
         FROM orders o
        WHERE o.status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM feedback_invites f WHERE f.order_id = o.id)
        ORDER BY o.completed_at DESC NULLS LAST LIMIT 8`,
    ),
    getBaseUrl(),
  ]);
  const restaurantName = settingValue(settings, "restaurant_name", "Khan Baba Restaurant");

  return (
    <>
      <AutoRefresh intervalMs={25000} />
      <div className="page-head">
        <div>
          <h1>Feedback &amp; Google reviews</h1>
          <p>
            Every settled table gets a two-tap feedback link. The restaurant team turns the best
            responses into a Google review draft with the dish photos, the bill range and how many
            people were served.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={googleUrl} target="_blank" rel="noreferrer noopener" className="btn btn-outline btn-sm">
            <Icon name="star" size={14} /> Google reviews
          </a>
          <Link href="/admin/music" className="btn btn-ghost btn-sm">
            Feedback settings
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span>Invites sent</span>
          <b>{stats.invites}</b>
          <small>{stats.submitted} answered</small>
        </div>
        <div className="stat-card">
          <span>Average rating</span>
          <b>{stats.avgRating ? stats.avgRating.toFixed(1) : "—"}</b>
          <small>out of 5 from guests</small>
        </div>
        <div className="stat-card">
          <span>Drafts ready</span>
          <b style={{ color: stats.drafts > 0 ? "var(--accent)" : undefined }}>{stats.drafts}</b>
          <small>with photos &amp; bill range</small>
        </div>
        <div className="stat-card">
          <span>Shared on Google</span>
          <b style={{ color: "var(--green)" }}>{stats.published}</b>
          <small>recorded by the team</small>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        <span>
          <strong>How the Google step works.</strong> Google’s Business Profile API does not allow a
          third party to publish a review in a guest’s name. So this page prepares the exact review —
          dishes, photos, bill range, party size — and the team copies it with one tap and opens
          Google’s write-a-review page, or sends the same link to the guest. The portal records who
          shared it and when; it never claims an automatic post that did not happen.
        </span>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Review drafts</h3>
          <span className="tiny muted">{drafts.length} recent</span>
        </div>

        {drafts.length === 0 ? (
          <p className="small muted">
            No drafts yet. Send a feedback link below — a guest answer becomes the first draft.
          </p>
        ) : null}

        <div className="draft-list">
          {drafts.map((draft) => {
            const images: string[] = draft.image_refs ? (JSON.parse(draft.image_refs) as string[]) : [];
            return (
              <article key={draft.id} className={`draft-card ${draft.status === "draft" ? "is-open" : ""}`}>
                <div className="draft-head">
                  <div>
                    <b>
                      {"★".repeat(draft.rating ?? 0)}
                      <span style={{ color: "var(--surface-3)" }}>{"★".repeat(5 - (draft.rating ?? 0))}</span>
                    </b>
                    <div className="tiny muted">
                      {draft.order_code ?? "—"} · {draft.customer_name ?? "Guest"} · served {draft.party_size} ·{" "}
                      {money(draft.bill_cents)} bill · {formatDateTime(draft.created_at)}
                    </div>
                  </div>
                  <span className={`badge ${draft.status === "published" ? "badge-green" : draft.status === "skipped" ? "badge-muted" : "badge-amber"}`}>
                    {draft.status}
                  </span>
                </div>

                <p className="draft-body">{draft.body}</p>

                {images.length > 0 ? (
                  <div className="draft-images">
                    {images.map((image) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={image} src={image} alt="Dish served" loading="lazy" />
                    ))}
                  </div>
                ) : null}

                <div className="draft-actions">
                  <CopyField value={draft.body} label="Review text" />
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <a
                      href={draft.google_url ?? googleUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn btn-primary btn-sm"
                    >
                      <Icon name="star" size={13} /> Open Google review
                    </a>
                    <OpsButton
                      endpoint="/api/ops/feedback"
                      payload={{ action: "mark", draftId: draft.id, status: "published" }}
                      className="btn btn-outline btn-sm"
                      successMessage="Recorded as shared"
                    >
                      Mark shared
                    </OpsButton>
                    <OpsButton
                      endpoint="/api/ops/feedback"
                      payload={{ action: "mark", draftId: draft.id, status: "skipped" }}
                      className="btn btn-ghost btn-sm"
                      successMessage="Skipped"
                    >
                      Skip
                    </OpsButton>
                    {draft.order_id ? (
                      <span className="tiny muted" style={{ alignSelf: "center" }}>
                        Photos come from the menu items this guest actually ordered.
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid grid-2" style={{ marginTop: 18, alignItems: "start" }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Send a feedback link</h3>
            <span className="tiny muted">WhatsApp or a plain link / QR</span>
          </div>
          {recentOrders.length === 0 ? (
            <p className="small muted">Every completed order already has an invite.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Order</th><th>Guest</th><th>Total</th><th /></tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <b className="small">{order.code}</b>
                        <div className="tiny muted">{formatDateTime(order.completed_at)}</div>
                      </td>
                      <td className="tiny">{order.customer_name}</td>
                      <td>{money(order.total_cents)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <OpsButton
                          endpoint="/api/ops/feedback"
                          payload={{ action: "invite", orderId: order.id, channel: "whatsapp" }}
                          className="btn btn-primary btn-sm"
                          successMessage="Feedback link sent"
                        >
                          WhatsApp
                        </OpsButton>
                        <OpsButton
                          endpoint="/api/ops/feedback"
                          payload={{ action: "invite", orderId: order.id, channel: "link" }}
                          className="btn btn-ghost btn-sm"
                          successMessage="Link ready"
                        >
                          Link
                        </OpsButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ fontSize: "1rem", margin: "16px 0 8px" }}>Or create an invite by order code</h4>
          <ActionForm
            endpoint="/api/ops/feedback"
            action="invite"
            submitLabel="Create invite"
            fields={[
              { name: "orderId", label: "Order ID", type: "number", help: "The numeric id shown in Admin → Orders." },
              {
                name: "channel",
                label: "Channel",
                type: "select",
                options: [
                  { value: "link", label: "Link only" },
                  { value: "whatsapp", label: "WhatsApp" },
                ],
              },
            ]}
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Recent invites</h3>
            <span className="tiny muted">One-time links</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Order</th><th>Guest</th><th>Party</th><th>Rating</th><th>Link</th></tr>
              </thead>
              <tbody>
                {invites.length === 0 ? (
                  <tr><td colSpan={5} className="muted">No invites yet.</td></tr>
                ) : null}
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td className="small">{invite.code}</td>
                    <td className="tiny">{invite.customer_name}</td>
                    <td className="tiny">{invite.party_size}</td>
                    <td className="tiny">
                      {invite.rating ? `${"★".repeat(invite.rating)}` : invite.submitted_at ? "—" : "pending"}
                    </td>
                    <td>
                      <a
                        className="tiny"
                        style={{ color: "var(--blue)" }}
                        href={`${baseUrl}/feedback/${invite.token}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            {restaurantName} · Google place configured:{" "}
            {settingValue(settings, "feedback_google_place_id", "") ? "yes" : "no (add one in the feedback settings)"}.
          </p>
        </section>
      </div>
    </>
  );
}
