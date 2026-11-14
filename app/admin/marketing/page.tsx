import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { instagramConfigured } from "@/lib/integrations/instagram";
import { facebookConfigured } from "@/lib/integrations/facebook";
import { ActionForm } from "@/components/portal/ActionForm";
import { SettingsForm } from "@/components/portal/AdminForms";
import { AutoRefresh } from "@/components/portal/AutoRefresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketing & Social Media",
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  const db = await getDb();
  const [settings, fbConfiguredStatus, igConfiguredStatus] = await Promise.all([
    getSettings(),
    facebookConfigured(),
    instagramConfigured(),
  ]);

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
              <span className="badge badge-green">active</span>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Broadcast menu and preparation updates to customer list
            </p>
          </div>
        </div>
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
                { key: "whatsapp_phone_number_id", label: "WhatsApp Phone Number ID (Temporary)", type: "text" },
                { key: "whatsapp_access_token", label: "WhatsApp Access Token (Temporary)", type: "password" },
                { key: "whatsapp_business_account_id", label: "WhatsApp Business Account ID (Temporary)", type: "text" },
                { key: "whatsapp_catalog_id", label: "WhatsApp Catalog ID (Temporary)", type: "text" },
                { key: "whatsapp_verify_token", label: "WhatsApp Verify Token (Temporary)", type: "text" },
                { key: "whatsapp_app_secret", label: "WhatsApp App Secret (Temporary)", type: "password" },
                { key: "whatsapp_counter_number", label: "WhatsApp Counter Number (Temporary)", type: "text" },
                { key: "whatsapp_display_number", label: "WhatsApp Display Number (Temporary)", type: "text" },
                { key: "whatsapp_enabled", label: "Enable Temporary WhatsApp Broadcast", type: "toggle" },
              ],
            },
          ]}
        />
      </div>
    </>
  );
}
