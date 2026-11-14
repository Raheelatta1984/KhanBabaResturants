import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { facebookConfigured } from "@/lib/integrations/facebook";
import {
  listOffers,
  listReturns,
  offerEvents,
} from "@/lib/community";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { ActionForm } from "@/components/portal/ActionForm";
import { OpsButton } from "@/components/portal/OpsButton";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { SettingsForm } from "@/components/portal/AdminForms";

export const dynamic = "force-dynamic";

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string }>;
}) {
  const { offer: offerParam } = await searchParams;
  const db = await getDb();
  const [returns, offers, settings, liveFacebook] = await Promise.all([
    listReturns(db),
    listOffers(db),
    getSettings(),
    facebookConfigured(),
  ]);
  const selectedId = Number(offerParam) || offers[0]?.id || 0;
  const selected = offers.find((offer) => offer.id === selectedId) ?? null;
  const events = selected ? await offerEvents(db, selected.id) : [];

  return (
    <>
      <AutoRefresh intervalMs={15000} />
      <div className="page-head">
        <div>
          <h1>Returns &amp; community</h1>
          <p>
            Redirect untouched returns to a neighbour in need. The first
            qualifying comment books a free click &amp; collect meal, the post is
            closed, and an automatic thank-you reply confirms the booking.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className={`badge ${liveFacebook ? "badge-green" : "badge-amber"}`}>
            {liveFacebook ? "Facebook Page live" : "Facebook sandbox"}
          </span>
          <Link href="/community" target="_blank" className="btn btn-outline btn-sm">
            Public board
          </Link>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head"><h3>Log a return &amp; redirect it</h3></div>
          <p className="small muted" style={{ marginBottom: 14 }}>
            Choose <b>community</b> to draft and publish a Facebook post in one
            step. The customer&apos;s refund/replacement/waste decisions stay in
            the same audit trail.
          </p>
          <ActionForm
            endpoint="/api/ops/community"
            action="create_return"
            submitLabel="Log return & post"
            confirmMessage="Publish this returned order to the community?"
            fields={[
              { name: "orderCode", label: "Order code", placeholder: "KB-DEMO01" },
              {
                name: "resolution", label: "Resolution", type: "select", defaultValue: "community",
                options: [
                  { value: "community", label: "Redirect to community" },
                  { value: "refund", label: "Refund" },
                  { value: "replacement", label: "Replacement" },
                  { value: "waste", label: "Waste / spoilage" },
                ],
              },
              { name: "reason", label: "Reason", placeholder: "Customer cancelled after packing", full: true },
              { name: "notes", label: "Internal notes", type: "textarea", full: true },
            ]}
          />
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Community programme</h3></div>
          <div className="summary-row"><span>Claim keyword</span><b className="mono">{settings.community_claim_keyword}</b></div>
          <div className="summary-row"><span>Pickup window</span><b>{settings.community_pickup_hours}</b></div>
          <div className="summary-row"><span>Auto reply</span><b className="tiny">{settings.community_auto_reply}</b></div>
          <div className="summary-row"><span>Channel</span><b>Click &amp; collect only</b></div>
          <div className="summary-row"><span>Offers posted</span><b>{offers.filter((o) => o.status !== "draft").length}</b></div>
          <div className="summary-row"><span>Meals claimed</span><b style={{ color: "var(--green)" }}>{offers.filter((o) => o.status === "claimed").length}</b></div>
          <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
            <OpsButton endpoint="/api/ops/community" payload={{ action: "sync" }} successMessage="Comments synced" className="btn btn-outline btn-sm">
              Sync Facebook comments
            </OpsButton>
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Webhook: <code>/api/webhooks/facebook</code>. Without Page
            credentials the post is mirrored locally so staff can rehearse the
            first-comment-wins flow.
          </p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Community offers</h3>
          <span className="tiny muted">First comment wins · comments blocked after booking</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Offer</th><th>Status</th><th>Post</th><th>Claimed by</th><th>Pickup code</th><th>Comments</th><th>Posted</th><th /></tr>
            </thead>
            <tbody>
              {offers.length === 0 ? (
                <tr><td colSpan={8} className="muted">No community offers yet.</td></tr>
              ) : null}
              {offers.map((offer) => (
                <tr key={offer.id}>
                  <td>
                    <Link href={`/admin/community?offer=${offer.id}`} style={{ color: "var(--accent)" }}>
                      <b>{offer.title}</b>
                    </Link>
                    <div className="tiny muted">{offer.channel} · {settings.community_pickup_hours}</div>
                  </td>
                  <td><span className={`badge ${offer.status === "claimed" ? "badge-green" : offer.status === "posted" ? "badge-blue" : "badge-muted"}`}>{offer.status}</span></td>
                  <td className="tiny">
                    {offer.facebook_post_url ? (
                      <a href={offer.facebook_post_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        {offer.facebook_mode === "live" ? "View post" : "Local preview"}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="tiny">{offer.claimed_by ?? "—"}</td>
                  <td className="mono tiny">{offer.status === "claimed" ? offer.pickup_code : "••••••"}</td>
                  <td className="tiny">{offer.comments_closed ? "Closed" : "Open"}{offer.comments_moderated ? " · moderated" : ""}</td>
                  <td className="tiny muted">{formatDateTime(offer.posted_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {offer.status === "draft" ? (
                        <OpsButton endpoint="/api/ops/community" payload={{ action: "publish", offerId: offer.id }} successMessage="Posted" className="btn btn-primary btn-sm">
                          Publish
                        </OpsButton>
                      ) : null}
                      {offer.status === "posted" ? (
                        <>
                          <OpsButton endpoint="/api/ops/community" payload={{ action: "sync", offerId: offer.id }} successMessage="Comments checked" className="btn btn-outline btn-sm">
                            Check comments
                          </OpsButton>
                          <OpsButton endpoint="/api/ops/community" payload={{ action: "expire", offerId: offer.id }} className="btn btn-ghost btn-sm" confirmMessage="Close this offer?">
                            Expire
                          </OpsButton>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h3>Offer audit · {selected.title}</h3>
            <Link href={`/community/${selected.token}`} target="_blank" className="btn btn-outline btn-sm">
              Open public claim page
            </Link>
          </div>
          <div className="grid grid-2">
            <div>
              <div className="timeline">
                {events.map((event) => (
                  <div key={event.id} className="timeline-item">
                    <span className="bar" />
                    <div>
                      <b>{event.kind.replace(/_/g, " ")}</b>
                      <span>{formatDateTime(event.created_at)} · {event.actor}</span>
                      {event.detail ? <p className="tiny muted" style={{ whiteSpace: "pre-wrap" }}>{event.detail}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              {selected.status === "posted" ? (
                <>
                  <p className="small muted" style={{ marginBottom: 10 }}>
                    Staff-assisted claim (the public page does the same thing).
                    The first successful claim closes the post and prints the
                    pickup code.
                  </p>
                  <ActionForm
                    endpoint="/api/ops/community"
                    action="claim"
                    submitLabel="Record first claim"
                    hidden={{ token: selected.token }}
                    fields={[
                      { name: "name", label: "Claimed by", placeholder: "Name from the first comment" },
                      { name: "keyword", label: "Comment keyword", defaultValue: selected.claim_keyword },
                    ]}
                  />
                </>
              ) : (
                <div className="notice notice-green">
                  {selected.status === "claimed"
                    ? `Booked by ${selected.claimed_by} · pickup ${selected.pickup_code} · ticket ${selected.claim_order_code}`
                    : "This offer is not open for claims."}
                </div>
              )}
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Zero-cost click &amp; collect ticket <b>{selected.claim_order_code ?? "—"}</b> appears
                on the counter board for hand-over. No delivery, no payment.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>Return register</h3></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Return</th><th>Order</th><th>Reason</th><th>Resolution</th><th>Status</th><th>Logged</th></tr></thead>
            <tbody>
              {returns.length === 0 ? (
                <tr><td colSpan={6} className="muted">No returns logged.</td></tr>
              ) : null}
              {returns.map((entry) => (
                <tr key={entry.id}>
                  <td><b>{entry.code}</b></td>
                  <td><Link href={`/order/${entry.order_code}`} style={{ color: "var(--accent)" }}>{entry.order_code}</Link></td>
                  <td className="tiny">{entry.reason}</td>
                  <td><span className="tag">{entry.resolution}</span></td>
                  <td><span className="tag">{entry.status}</span></td>
                  <td className="tiny muted">{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ marginTop: 18 }}>
        <SettingsForm
          values={settings}
          groups={[
            {
              title: "Facebook Page & community rules",
              description:
                "Page credentials are env-first (FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_APP_SECRET, FACEBOOK_VERIFY_TOKEN). Without them the post is mirrored locally.",
              fields: [
                { key: "community_enabled", label: "Community programme enabled", type: "toggle" },
                { key: "community_claim_keyword", label: "Claim keyword", type: "text" },
                { key: "community_auto_reply", label: "Automatic thank-you comment", type: "textarea" },
                { key: "community_pickup_hours", label: "Click & collect window", type: "text" },
                { key: "community_facebook_page_id", label: "Facebook Page ID", type: "password" },
                { key: "community_facebook_access_token", label: "Page access token", type: "password" },
                { key: "community_facebook_app_secret", label: "App secret (webhook signature)", type: "password" },
                { key: "community_facebook_verify_token", label: "Webhook verify token", type: "password" },
              ],
            },
          ]}
        />
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        The auto-reply reads &ldquo;{settings.community_auto_reply}&rdquo;.
        Claimed meals are handed over against a zero-value ticket ({money(0)}).
      </p>
    </>
  );
}
