import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings, settingValue } from "@/lib/settings";
import { getBaseUrl } from "@/lib/url";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import {
  whatsappConfig,
  whatsappChatLink,
  whatsappErrorHint,
  prettyPhone,
} from "@/lib/whatsapp/client";
import {
  catalogForPublishing,
  catalogStats,
  recentStockMovements,
} from "@/lib/whatsapp/catalog";
import { ActionForm } from "@/components/portal/ActionForm";
import { SettingsForm } from "@/components/portal/AdminForms";
import { OpsButton } from "@/components/portal/OpsButton";
import { CopyField } from "@/components/portal/CopyField";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "WhatsApp Business" };

/** The one-page setup guide, kept in the repo so it versions with the code. */
const GO_LIVE_DOC =
  "https://github.com/Raheelatta1984/KhanBabaResturants/blob/main/docs/whatsapp-go-live.md";

/**
 * The WhatsApp Business centre.
 *
 * Three things in one place because they are one job: publish the menu to the
 * WhatsApp catalogue, keep stock truthful, and work the conversations that turn
 * into orders. Every message — sent, received or sandboxed — is in the log, so
 * the counter never has to guess what the guest saw.
 */
export default async function AdminWhatsAppPage() {
  const db = await getDb();
  const [settings, config, stats, items, movements, conversations, messages, orders, baseUrl] =
    await Promise.all([
      getSettings(),
      whatsappConfig(),
      catalogStats(db),
      catalogForPublishing(db),
      recentStockMovements(db),
      db.query<{
        id: number; wa_id: string; display_name: string | null; state: string;
        order_count: number; opt_in: boolean; last_message_at: string | null;
      }>("SELECT * FROM whatsapp_conversations ORDER BY last_message_at DESC NULLS LAST LIMIT 12"),
      db.query<{
        id: number; direction: string; wa_id: string; kind: string; body: string | null;
        status: string; created_at: string; order_id: number | null;
        error: string | null; payload: string | null;
      }>("SELECT * FROM whatsapp_messages ORDER BY id DESC LIMIT 30"),
      db.query<{
        id: number; code: string; customer_name: string; phone: string | null;
        total_cents: number; payment_status: string; status: string; created_at: string;
        payment_link_token: string | null;
      }>(
        "SELECT * FROM orders WHERE source = 'whatsapp' ORDER BY id DESC LIMIT 12",
      ),
      getBaseUrl(),
    ]);

  // The last message we actually tried to deliver (catalogue rows are local
  // bookkeeping, not sends). If it failed, the failure belongs at the top of the
  // page — the log used to record Meta's error without ever showing it, which
  // made a rejected message look like a message that was simply ignored.
  const lastAttempt = await db.maybeOne<{
    id: number; wa_id: string; status: string; error: string | null;
    payload: string | null; created_at: string;
  }>(
    `SELECT id, wa_id, status, error, payload, created_at FROM whatsapp_messages
      WHERE direction = 'outbound' AND kind IN ('text','template','cta')
      ORDER BY id DESC LIMIT 1`,
  );
  const lastAttemptCode = (() => {
    try {
      const payload = JSON.parse(lastAttempt?.payload ?? "{}") as {
        error?: { code?: number };
      };
      return payload.error?.code;
    } catch {
      return undefined;
    }
  })();
  const deliveryFailure =
    lastAttempt && lastAttempt.status === "failed"
      ? {
          ...lastAttempt,
          hint: whatsappErrorHint(lastAttemptCode),
        }
      : null;

  const publicNumber = settingValue(settings, "whatsapp_display_number", "");
  const chatLink = whatsappChatLink(
    publicNumber,
    "Assalam-o-Alaikum Khan Baba! I would like to order.",
  );
  const counterNumber = settingValue(settings, "whatsapp_counter_number", "");

  // The go-live checklist: one row per value the channel needs, whether it is
  // already present (and from where) and the shortest possible hint on where it
  // comes from. Everything is read server-side; no secret is ever sent to the
  // browser, only its presence.
  const goLive: {
    field: keyof typeof config.sources;
    env: string;
    label: string;
    hint: string;
    required: boolean;
  }[] = [
    {
      field: "phoneNumberId",
      env: "WHATSAPP_PHONE_NUMBER_ID",
      label: "Phone number id",
      hint: "Meta → WhatsApp → API setup",
      required: true,
    },
    {
      field: "accessToken",
      env: "WHATSAPP_ACCESS_TOKEN",
      label: "Permanent access token",
      hint: "Meta → System user → token with whatsapp_business_messaging",
      required: true,
    },
    {
      field: "verifyToken",
      env: "WHATSAPP_VERIFY_TOKEN",
      label: "Webhook verify token",
      hint: "Any passphrase — the same string goes into Meta's webhook form",
      required: true,
    },
    {
      field: "appSecret",
      env: "WHATSAPP_APP_SECRET",
      label: "App secret (signature check)",
      hint: "Meta → App settings → Basic → App secret",
      required: true,
    },
    {
      field: "catalogId",
      env: "WHATSAPP_CATALOG_ID",
      label: "Catalogue id",
      hint: "Commerce Manager → Catalogue → Settings",
      required: false,
    },
  ];
  const missing = goLive.filter(
    (row) => row.required && config.sources[row.field] === "none",
  );

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <div className="page-head">
        <div>
          <h1>WhatsApp Business</h1>
          <p>
            Publish the whole menu to WhatsApp, keep stock central, and take orders in the chat. An
            order arrives in the counter portal; once the counter accepts it, the guest receives a
            secure payment link and — after payment — the ticket goes to the kitchen.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/counter" className="btn btn-outline btn-sm">
            <Icon name="arrow" size={14} /> Counter
          </Link>
          <Link href="/admin/feedback" className="btn btn-ghost btn-sm">
            Feedback &amp; Google
          </Link>
        </div>
      </div>

      {deliveryFailure ? (
        <div
          className="notice"
          style={{
            borderColor: "rgba(255,122,107,0.45)",
            alignItems: "flex-start",
            marginBottom: 18,
          }}
        >
          <span>
            <strong style={{ color: "var(--red)" }}>
              The last WhatsApp message did not send.
            </strong>{" "}
            {prettyPhone(deliveryFailure.wa_id)} · {formatDateTime(deliveryFailure.created_at)} ·{" "}
            <span className="mono">{deliveryFailure.error || "no error recorded"}</span>
            {deliveryFailure.hint ? <> — {deliveryFailure.hint}</> : null}{" "}
            <span className="tiny muted">
              Meta accepted nothing, so nothing arrived on that phone. Fix the cause above, then use{" "}
              <strong>Check connection</strong> and <strong>Send a real WhatsApp test</strong> below.
            </span>
          </span>
        </div>
      ) : null}

      <div className="grid grid-3">
        <div className="stat-card">
          <span>Channel</span>
          <b style={{ fontSize: "1.2rem", color: config.mode === "live" ? "var(--green)" : "var(--accent)" }}>
            {config.mode}
          </b>
          <small>{config.configured ? "Cloud API credentials present" : "Sandbox — messages logged only"}</small>
        </div>
        <div className="stat-card">
          <span>Catalogue</span>
          <b>{stats.published}/{stats.publishable}</b>
          <small>{stats.errors} error(s) · {stats.dishes} dishes</small>
        </div>
        <div className="stat-card">
          <span>Stock</span>
          <b style={{ color: stats.outOfStock > 0 ? "var(--red)" : undefined }}>{stats.tracked}</b>
          <small>{stats.lowStock} low · {stats.outOfStock} sold out</small>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18, alignItems: "start" }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Connection</h3>
            <span className={`badge ${config.configured ? "badge-green" : "badge-amber"}`}>
              {config.configured ? "live credentials" : "sandbox"}
            </span>
          </div>
          <div className="kv">
            <div><span>Business number</span><b>{config.displayNumber || publicNumber || "not set"}</b></div>
            <div><span>Counter number</span><b>{config.counterNumber || counterNumber || "not set"}</b></div>
            <div><span>Phone number id</span><b>{config.phoneNumberId ? `${config.phoneNumberId.slice(0, 6)}…` : "not set"}</b></div>
            <div><span>Catalogue id</span><b>{config.catalogId ? `${config.catalogId.slice(0, 6)}…` : "not set"}</b></div>
            <div><span>Webhook</span><b className="tiny mono">{baseUrl}/api/webhooks/whatsapp</b></div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <b className="small">Go-live variables</b>
              <a className="tiny" href={GO_LIVE_DOC} target="_blank" rel="noreferrer">
                Setup guide ↗
              </a>
            </div>
            <div className="kv" style={{ marginTop: 8 }}>
              {goLive.map((row) => {
                const source = config.sources[row.field];
                return (
                  <div key={row.env}>
                    <span>
                      {row.label}
                      <br />
                      <code className="tiny muted">{row.env}</code>
                    </span>
                    <b style={{ textAlign: "right" }}>
                      <span
                        className={`badge ${
                          source === "none" ? (row.required ? "badge-red" : "badge-amber") : "badge-green"
                        }`}
                      >
                        {source === "none" ? "missing" : source === "env" ? "Vercel env" : "portal setting"}
                      </span>
                      <br />
                      <span className="tiny muted">{row.hint}</span>
                    </b>
                  </div>
                );
              })}
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {missing.length === 0
                ? "Every required value is present. Changes to Vercel environment variables need a redeploy before they reach the running functions."
                : `${missing.length} required value${missing.length === 1 ? "" : "s"} still missing — the channel stays in sandbox and logs every message until the phone number id and access token are present.`}{" "}
              Values can live in Vercel (Project → Settings → Environment Variables) or in the
              portal settings below (stored in the database); Vercel wins when both are set.
            </p>
          </div>

          {chatLink ? (
            <div style={{ marginTop: 14 }}>
              <CopyField value={chatLink} label="Customer chat link (put this on the website and QR)" />
            </div>
          ) : (
            <div className="notice" style={{ marginTop: 12 }}>
              Add the public WhatsApp number below to generate the wa.me chat link.
            </div>
          )}

          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <OpsButton
              endpoint="/api/ops/whatsapp"
              payload={{ action: "sync" }}
              className="btn btn-primary btn-sm"
              successMessage="Catalogue sync complete"
            >
              <Icon name="layers" size={14} /> Publish whole menu
            </OpsButton>
            <OpsButton
              endpoint="/api/ops/whatsapp"
              payload={{ action: "test" }}
              className="btn btn-outline btn-sm"
              successMessage="Test sent to the counter number"
            >
              Test to counter
            </OpsButton>
            <OpsButton
              endpoint="/api/ops/whatsapp"
              payload={{ action: "check" }}
              className="btn btn-outline btn-sm"
              successMessage="Credentials work — connected"
            >
              <Icon name="shield" size={13} /> Check connection
            </OpsButton>
            <Link href="/music" className="btn btn-ghost btn-sm">
              <Icon name="eye" size={13} /> Guest site
            </Link>
          </div>

          <div className="notice" style={{ marginTop: 14 }}>
            <span>
              <strong>{config.mode === "sandbox" ? "Sandbox mode. " : "Live mode. "}</strong>
              {config.mode === "sandbox"
                ? "Every outbound message is written to the log below with the exact text the guest would receive. Add WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN and WHATSAPP_CATALOG_ID to go live; the webhook signature is verified with WHATSAPP_APP_SECRET."
                : "Messages are delivered through the Cloud API. Inbound messages are verified against WHATSAPP_APP_SECRET and answered by the order parser."}
            </span>
          </div>

          <div className="panel-head" style={{ marginTop: 18 }}>
            <h3>Send a real WhatsApp test</h3>
            <span className="tiny muted">Straight to that phone — customer or your own</span>
          </div>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            A customer who has never messaged the business cannot be sent free text — Meta only
            allows an approved template to open the conversation. This form works that out for you:
            if that number has messaged the business in the last 24 hours your message goes as
            written, otherwise the pre-approved <code>hello_world</code> template is sent first.
            While the Meta app is in Development mode only numbers added as test recipients in
            WhatsApp Manager can receive anything.
          </p>
          <ActionForm
            endpoint="/api/ops/whatsapp"
            action="test"
            submitLabel="Send test message"
            fields={[
              {
                name: "to",
                label: "Recipient WhatsApp number",
                placeholder: "+61412345678",
                help: "Country code, no spaces. This is the phone that should buzz.",
              },
              {
                name: "body",
                label: "Message (optional)",
                type: "textarea",
                full: true,
                placeholder: "Left blank, a short Khan Baba test greeting is used.",
                help: "Used when the 24-hour window is open. A template is used when it is not.",
              },
            ]}
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>WhatsApp orders</h3>
            <span className="tiny muted">Counter accepts → payment link → kitchen</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No WhatsApp orders yet. Message the business number with “2 chicken biryani” to see the flow.
                    </td>
                  </tr>
                ) : null}
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <b className="small">{order.code}</b>
                      <div className="tiny muted">{formatDateTime(order.created_at)}</div>
                    </td>
                    <td className="tiny">
                      {order.customer_name}
                      <div className="muted">{prettyPhone(order.phone)}</div>
                    </td>
                    <td>{money(order.total_cents)}</td>
                    <td>
                      <span className={`badge ${order.payment_status === "paid" ? "badge-green" : "badge-amber"}`}>
                        {order.payment_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <OpsButton
                        endpoint="/api/ops/whatsapp"
                        payload={{ action: "payment-link", orderId: order.id }}
                        className="btn btn-outline btn-sm"
                        successMessage="Payment link ready"
                      >
                        Pay link
                      </OpsButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Central publishing &amp; inventory</h3>
          <span className="tiny muted">
            One menu, every channel. Stock hits zero → the dish is unpublished from WhatsApp automatically.
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dish</th>
                <th>Price</th>
                <th>Stock</th>
                <th>WhatsApp</th>
                <th>Publish</th>
                <th>Stock actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <b className="small">{item.name}</b>
                    <div className="tiny muted">{item.category_name ?? "Uncategorised"} · {item.slug}</div>
                  </td>
                  <td>{money(item.min_price)}</td>
                  <td className="tiny">
                    {item.track_stock ? (
                      <>
                        <b style={{ color: (item.stock_qty ?? 0) <= 0 ? "var(--red)" : (item.stock_qty ?? 0) <= item.low_stock_level ? "var(--accent)" : undefined }}>
                          {item.stock_qty ?? 0}
                        </b>
                        <div className="muted">low at {item.low_stock_level}</div>
                      </>
                    ) : (
                      <span className="muted">not tracked</span>
                    )}
                    {!item.is_available ? <div><span className="badge badge-red">unavailable</span></div> : null}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        item.publication_status === "published"
                          ? "badge-green"
                          : item.publication_status === "error"
                            ? "badge-red"
                            : "badge-muted"
                      }`}
                    >
                      {item.publication_status ?? "not published"}
                    </span>
                    {item.publication_message ? (
                      <div className="tiny muted" style={{ maxWidth: 240 }}>{item.publication_message}</div>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <OpsButton
                      endpoint="/api/ops/whatsapp"
                      payload={{ action: "publish", itemId: item.id }}
                      className="btn btn-outline btn-sm"
                      successMessage="Published"
                    >
                      Publish
                    </OpsButton>
                    <OpsButton
                      endpoint="/api/ops/whatsapp"
                      payload={{ action: "unpublish", itemId: item.id }}
                      className="btn btn-ghost btn-sm"
                      successMessage="Removed"
                    >
                      Off
                    </OpsButton>
                  </td>
                  <td>
                    <ActionForm
                      endpoint="/api/ops/whatsapp"
                      action="stock"
                      submitLabel="Stock"
                      compact
                      hidden={{ itemId: item.id }}
                      fields={[
                        {
                          name: "stockQty",
                          label: "Count",
                          type: "number",
                          defaultValue: item.stock_qty ?? 0,
                        },
                        {
                          name: "trackStock",
                          label: "Track stock",
                          type: "checkbox",
                          defaultValue: item.track_stock,
                        },
                        {
                          name: "lowStockLevel",
                          label: "Low level",
                          type: "number",
                          defaultValue: item.low_stock_level,
                        },
                        {
                          name: "available",
                          label: "Available on the menu",
                          type: "checkbox",
                          defaultValue: item.is_available,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {movements.length > 0 ? (
          <details style={{ marginTop: 14 }}>
            <summary className="tiny muted" style={{ cursor: "pointer" }}>
              Recent stock movements ({movements.length})
            </summary>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Dish</th><th>Change</th><th>After</th><th>Reason</th><th>By</th></tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className="tiny muted">{formatDateTime(movement.created_at)}</td>
                      <td className="tiny">{movement.item_name ?? "—"}</td>
                      <td className="tiny" style={{ color: movement.delta < 0 ? "var(--red)" : "var(--green)" }}>
                        {movement.delta > 0 ? "+" : ""}{movement.delta}
                      </td>
                      <td className="tiny">{movement.stock_after ?? "—"}</td>
                      <td className="tiny">{movement.reason}</td>
                      <td className="tiny muted">{movement.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      <div className="grid grid-2" style={{ marginTop: 18, alignItems: "start" }}>
        <section className="panel">
          <div className="panel-head">
            <h3>Message log</h3>
            <span className="tiny muted">Every inbound and outbound message</span>
          </div>
          <div className="wa-log">
            {messages.length === 0 ? (
              <p className="small muted">No messages yet. Send a test above, or message the business number.</p>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={`wa-bubble ${message.direction}`}>
                <div className="tiny muted">
                  {message.direction === "inbound" ? "Guest" : "Khan Baba"} · {prettyPhone(message.wa_id)} ·{" "}
                  {formatDateTime(message.created_at)} · {message.kind}/{message.status}
                </div>
                <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                  {message.body}
                </p>
                {message.status === "failed" ? (
                  <div className="tiny" style={{ color: "var(--red)", marginTop: 4 }}>
                    Not delivered — {message.error || "no error recorded"}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Conversations</h3>
            <span className="tiny muted">{conversations.length} recent</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Guest</th><th>Orders</th><th>Opt-in</th><th>Last</th></tr>
              </thead>
              <tbody>
                {conversations.length === 0 ? (
                  <tr><td colSpan={4} className="muted">No conversations yet.</td></tr>
                ) : null}
                {conversations.map((conversation) => (
                  <tr key={conversation.id}>
                    <td className="small">
                      {conversation.display_name ?? "WhatsApp guest"}
                      <div className="tiny muted">{prettyPhone(conversation.wa_id)}</div>
                    </td>
                    <td className="tiny">{conversation.order_count}</td>
                    <td>
                      <span className={`badge ${conversation.opt_in ? "badge-green" : "badge-muted"}`}>
                        {conversation.opt_in ? "in" : "out"}
                      </span>
                    </td>
                    <td className="tiny muted">{formatDateTime(conversation.last_message_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 style={{ fontSize: "1rem", margin: "18px 0 10px" }}>Reply on WhatsApp</h4>
          <ActionForm
            endpoint="/api/ops/whatsapp"
            action="send"
            submitLabel="Send message"
            fields={[
              { name: "to", label: "Number", placeholder: "+61412345678" },
              { name: "body", label: "Message", type: "textarea", full: true },
            ]}
          />
        </section>
      </div>

      <div style={{ marginTop: 22 }}>
        <SettingsForm
          values={settings}
          groups={[
            {
              title: "WhatsApp Business connection",
              description:
                "Environment variables win over these values in production: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_CATALOG_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_COUNTER_NUMBER, WHATSAPP_DISPLAY_NUMBER.",
              fields: [
                { key: "whatsapp_enabled", label: "WhatsApp channel on", type: "toggle" },
                { key: "whatsapp_publish_enabled", label: "Publish menu to the catalogue", type: "toggle" },
                { key: "whatsapp_phone_number_id", label: "Phone number id", type: "password" },
                { key: "whatsapp_business_account_id", label: "Business account id", type: "password" },
                { key: "whatsapp_access_token", label: "Access token", type: "password" },
                { key: "whatsapp_catalog_id", label: "Commerce catalogue id", type: "password" },
                { key: "whatsapp_verify_token", label: "Webhook verify token", type: "password" },
                { key: "whatsapp_app_secret", label: "App secret", type: "password" },
                { key: "whatsapp_display_number", label: "Public business number", type: "text" },
                { key: "whatsapp_counter_number", label: "Counter notification number", type: "text" },
                { key: "whatsapp_currency", label: "Catalogue currency", type: "text" },
                { key: "whatsapp_auto_confirm_paid", label: "Auto-accept paid pickup orders", type: "toggle" },
                { key: "whatsapp_order_greeting", label: "Greeting", type: "textarea" },
                { key: "whatsapp_payment_message", label: "Payment message", type: "textarea" },
              ],
            },
            {
              title: "Inventory",
              fields: [
                { key: "inventory_track_enabled", label: "Track stock through orders", type: "toggle" },
                {
                  key: "inventory_decrement_on",
                  label: "Deduct stock when",
                  type: "select",
                  options: [
                    { value: "confirm", label: "The counter accepts the order" },
                    { value: "paid", label: "Payment clears" },
                  ],
                },
              ],
            },
          ]}
        />
      </div>
    </>
  );
}
