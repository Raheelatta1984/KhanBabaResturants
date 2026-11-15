import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { instagramConfigured } from "@/lib/integrations/instagram";
import { facebookConfigured } from "@/lib/integrations/facebook";
import { ActionForm } from "@/components/portal/ActionForm";
import { SettingsForm } from "@/components/portal/AdminForms";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { IntegrationDiagnostics } from "@/components/portal/IntegrationDiagnostics";
import { marketingSnapshot, todayMenu } from "@/lib/marketing/engine";
import { publicBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketing & Social Media",
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  const db = await getDb();
  const [settings, fbConfiguredStatus, igConfiguredStatus, snapshot, menu] = await Promise.all([
    getSettings(),
    facebookConfigured(),
    instagramConfigured(),
    marketingSnapshot(db),
    todayMenu(db, publicBaseUrl()),
  ]);
  const published = snapshot.posts.filter((post) => post.status === "published").length;
  const drafts = snapshot.posts.filter((post) => post.status === "draft").length;
  const lastBroadcast = snapshot.broadcasts[0] ?? null;

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <div className="page-head">
        <div>
          <h1>Marketing & Social Media</h1>
          <p>
            Manage Facebook, Instagram, and WhatsApp broadcast marketing.
            Publish daily menu updates, food preparation posts, and blog links.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Platform Status</h3>
          <span className="tiny muted">Credentials are stored in environment or settings</span>
        </div>
        <div className="grid grid-3">
          <div className="card" style={{ padding: 14 }}>
            <div className="row">
              <b className="small">Facebook Page</b>
              <span className={`badge ${fbConfiguredStatus ? "badge-green" : "badge-amber"}`}>
                {fbConfiguredStatus ? "configured" : "needs setup"}
              </span>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Publish menu updates and food preparation posts
            </p>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="row">
              <b className="small">Instagram Business</b>
              <span className={`badge ${igConfiguredStatus ? "badge-green" : "badge-amber"}`}>
                {igConfiguredStatus ? "configured" : "needs setup"}
              </span>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Visual marketing and daily menu posts
            </p>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="row">
              <b className="small">WhatsApp Broadcast</b>
              <span className={`badge ${lastBroadcast ? (lastBroadcast.sandbox ? "badge-amber" : "badge-green") : "badge-amber"}`}>
                {lastBroadcast
                  ? lastBroadcast.sandbox
                    ? "last run: sandbox"
                    : `last run: ${lastBroadcast.sent} sent`
                  : "not run yet"}
              </span>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {lastBroadcast
                ? `${lastBroadcast.recipients} recipient(s) · ${lastBroadcast.sent} sent · ${lastBroadcast.failed} failed`
                : "Broadcast today's menu to opted-in customers only"}
            </p>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Today's menu — one click</h3>
          <span className="tiny muted">{menu.weekday} · {menu.totalDishes} dishes on the pass</span>
        </div>
        <p className="small muted" style={{ marginBottom: 12 }}>
          Reads the live menu from Supabase, drafts the WhatsApp broadcast, the Facebook/Instagram
          caption and a blog post. Broadcasts only reach customers who have opted in.
        </p>
        <ActionForm
          endpoint="/api/broadcast/todays-menu"
          action="broadcast"
          submitLabel="Broadcast today's menu"
          confirmMessage="Send today's menu to every opted-in customer? Nothing is sent to customers who have not opted in."
          fields={[]}
        />
        <ActionForm
          endpoint="/api/broadcast/todays-menu"
          action="draft"
          submitLabel="Save as draft instead"
          fields={[]}
        />
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Content</h3>
          <span className="tiny muted">
            {drafts} draft(s) · {published} published · {snapshot.blogs.length} blog post(s)
          </span>
        </div>
        <table className="table small">
          <thead>
            <tr>
              <th>#</th>
              <th>Post</th>
              <th>Status</th>
              <th>Channels</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {snapshot.posts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No content yet — use “Save as draft instead” to generate the first post.
                </td>
              </tr>
            ) : (
              snapshot.posts.map((post) => (
                <tr key={post.id}>
                  <td>{post.id}</td>
                  <td>
                    <b>{post.title ?? post.kind}</b>
                    <div className="tiny muted">{post.caption.slice(0, 90)}</div>
                  </td>
                  <td>
                    <span className={`badge ${post.status === "published" ? "badge-green" : post.status === "failed" ? "badge-amber" : ""}`}>
                      {post.status}
                    </span>
                  </td>
                  <td className="tiny muted">
                    {post.facebook_post_id ? "FB " : ""}
                    {post.instagram_post_id ? "IG" : ""}
                    {!post.facebook_post_id && !post.instagram_post_id ? "—" : ""}
                  </td>
                  <td className="tiny muted">
                    {new Date(post.created_at).toLocaleDateString("en-AU")}
                  </td>
                  <td>
                    {post.status !== "published" ? (
                      <ActionForm
                        endpoint="/api/ops/marketing"
                        action="publish-saved"
                        hidden={{ postId: post.id }}
                        submitLabel="Publish"
                        compact
                        fields={[]}
                      />
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {snapshot.broadcasts.length > 0 ? (
          <>
            <h4 style={{ marginTop: 16 }} className="small">Broadcast log</h4>
            <table className="table tiny">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Recipients</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.broadcasts.map((log) => (
                  <tr key={log.id}>
                    <td>{log.id}</td>
                    <td>{new Date(log.created_at).toLocaleString("en-AU")}</td>
                    <td>{log.recipients}</td>
                    <td>{log.sent}</td>
                    <td>{log.failed}</td>
                    <td>{log.sandbox ? "sandbox" : "live"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Publish Marketing Post</h3>
        </div>
        <ActionForm
          endpoint="/api/ops/marketing"
          action="publish"
          submitLabel="Publish to all channels"
          fields={[
            { name: "caption", label: "Caption / Message", type: "textarea", placeholder: "Today's special: Lamb Biryani..." },
            { name: "menuItems", label: "Menu Items (comma separated)", placeholder: "Lamb Biryani, Chicken Tikka, Naan..." },
            { name: "preparationNotes", label: "Preparation Notes", type: "textarea", placeholder: "Slow cooked for 4 hours..." },
            { name: "blogUrl", label: "Blog URL (optional)", placeholder: "https://khanbaba.com/blog/..." },
            { name: "imageUrl", label: "Image URL (optional for Instagram)", placeholder: "https://..." },
            { name: "videoUrl", label: "Video URL (optional for Instagram)", placeholder: "https://..." },
            { name: "whatsappRecipients", label: "WhatsApp Recipients (comma separated phone numbers)", placeholder: "+61410913853, +614..." },
          ]}
        />
      </section>

      <div style={{ marginTop: 18 }}>
        <SettingsForm
          values={settings}
          groups={[
            {
              title: "Facebook Marketing",
              description: "Page ID and Access Token for Facebook posts",
              fields: [
                { key: "community_facebook_page_id", label: "Facebook Page ID", type: "text" },
                { key: "community_facebook_access_token", label: "Facebook Access Token", type: "password" },
                { key: "community_facebook_app_secret", label: "Facebook App Secret", type: "password" },
                { key: "community_facebook_verify_token", label: "Facebook Verify Token", type: "text" },
              ],
            },
            {
              title: "Instagram Marketing",
              description: "Instagram Business Account ID and Access Token",
              fields: [
                { key: "instagram_account_id", label: "Instagram Account ID", type: "text" },
                { key: "instagram_access_token", label: "Instagram Access Token", type: "password" },
                { key: "instagram_app_secret", label: "Instagram App Secret", type: "password" },
                { key: "instagram_verify_token", label: "Instagram Verify Token", type: "text" },
              ],
            },
            {
              title: "WhatsApp Broadcast",
              description: "Temporary WhatsApp Business account mapping (+61410913853 is the main account, this section manages the temporary broadcast account)",
              fields: [
                // Credentials, catalogue id and phone numbers are NOT repeated
                // here. They live in Admin → WhatsApp Business, which posts
                // through the same settings table — two forms writing the same
                // keys is how a value gets silently reverted by whichever page
                // was saved last. This form keeps only the broadcast switch.
                { key: "whatsapp_enabled", label: "Enable WhatsApp broadcast", type: "toggle" },
              ],
            },
          ]}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <IntegrationDiagnostics />
      </div>
    </>
  );
}
