import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { publicBaseUrl } from "@/lib/url";
import { getSettings, settingValue } from "@/lib/settings";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  checkWhatsAppConnection,
  touchConversation,
  whatsappConfig,
  whatsappChatLink,
  normalisePhone,
} from "@/lib/whatsapp/client";
import {
  publishMenuItem,
  setItemStock,
  syncWhatsAppCatalog,
} from "@/lib/whatsapp/catalog";
import { requestOrderPayment } from "@/lib/whatsapp/orders";
import { sendFeedbackInvite } from "@/lib/feedback";

export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  itemId?: number;
  orderId?: number;
  to?: string;
  body?: string;
  waId?: string;
  stockQty?: number | null;
  trackStock?: boolean;
  lowStockLevel?: number;
  available?: boolean;
  channel?: string;
  /** Optional template name for the live test send (defaults to hello_world). */
  template?: string;
};

/**
 * WhatsApp Business console actions.
 *
 * Catalogue publishing and inventory are manager-level (they change what the
 * outside world can buy). Messaging and payment links are counter-level — the
 * person at the till is the one talking to the guest.
 */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager", "counter"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const baseUrl = publicBaseUrl(request);
  const isManager = session.role === "admin" || session.role === "manager";

  try {
    switch (body.action) {
      case "sync": {
        if (!isManager) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        const result = await syncWhatsAppCatalog(db, session.name);
        return NextResponse.json({
          ok: true,
          ...result,
          message: `${result.published} published · ${result.failed} failed · ${result.skipped} skipped`,
        });
      }
      case "publish": {
        if (!isManager) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        if (!body.itemId) throw new Error("Dish is required");
        const result = await publishMenuItem(db, Number(body.itemId), session.name);
        return NextResponse.json({ ok: true, result, message: `${result.name}: ${result.message}` });
      }
      case "unpublish": {
        if (!isManager) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        if (!body.itemId) throw new Error("Dish is required");
        const result = await publishMenuItem(db, Number(body.itemId), session.name, { remove: true });
        return NextResponse.json({ ok: true, result, message: `${result.name}: ${result.message}` });
      }
      case "stock": {
        if (!isManager) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        if (!body.itemId) throw new Error("Dish is required");
        const item = await setItemStock(db, Number(body.itemId), session.name, {
          stockQty: body.stockQty === undefined ? undefined : body.stockQty === null ? null : Number(body.stockQty),
          trackStock: body.trackStock,
          lowStockLevel: body.lowStockLevel === undefined ? undefined : Number(body.lowStockLevel),
          available: body.available,
        });
        return NextResponse.json({
          ok: true,
          item,
          message: `${item.name}: ${item.track_stock ? `${item.stock_qty ?? 0} in stock` : "stock not tracked"}${item.is_available ? "" : " · unavailable"}`,
        });
      }
      case "check": {
        if (!isManager) return NextResponse.json({ error: "Managers only" }, { status: 403 });
        const connection = await checkWhatsAppConnection();
        return NextResponse.json(
          {
            ok: connection.ok,
            connection,
            message: connection.ok
              ? `Connected as ${connection.verifiedName || "the business"} (${connection.displayPhoneNumber || "number hidden"}) — live mode.`
              : `Not connected: ${connection.error}${connection.hint ? ` — ${connection.hint}` : ""}`,
          },
          { status: connection.ok ? 200 : 502 },
        );
      }
      case "test": {
        const settings = await getSettings();
        const config = await whatsappConfig();
        const target =
          normalisePhone(body.to) ||
          normalisePhone(settingValue(settings, "whatsapp_counter_number", ""));
        if (!target)
          throw new Error(
            "Type the number that should receive the message, or add a counter WhatsApp number in the settings below",
          );

        const text =
          (body.body ?? "").trim() ||
          `Khan Baba WhatsApp test from ${session.name}. Reply MENU to see the live menu.`;

        // Sandbox: record exactly what the customer would have received.
        if (!config.configured) {
          const result = await sendWhatsAppText({ db, to: target, body: text });
          return NextResponse.json({
            ok: true,
            mode: "sandbox",
            result,
            message: `Sandbox — logged for +${target}, nothing left the building. Add the phone number id and access token below (or in Vercel) to send for real.`,
          });
        }

        // Live. Meta only lets a business *start* a conversation with an
        // approved template; free text is allowed only inside the 24-hour
        // window that opens when the customer messages us. So pick the order
        // that fits whether this customer has an open window.
        const conversation = await db.maybeOne<{ last_inbound_at: string | null }>(
          "SELECT last_inbound_at FROM whatsapp_conversations WHERE wa_id = $1",
          [target],
        );
        const windowOpen = conversation?.last_inbound_at
          ? Date.now() - new Date(conversation.last_inbound_at).getTime() <
            24 * 60 * 60 * 1000
          : false;

        const attempts: string[] = [];
        const sendText = () => sendWhatsAppText({ db, to: target, body: text });
        const sendTemplate = (language: string) =>
          sendWhatsAppTemplate({
            db,
            to: target,
            name: String(body.template ?? "hello_world"),
            language,
          });

        let result = windowOpen ? await sendText() : await sendTemplate("en_US");
        attempts.push(
          `${windowOpen ? "text" : "template hello_world (en_US)"}: ${result.ok ? "ok" : result.error}`,
        );

        if (!result.ok && !windowOpen && result.errorCode === 132001) {
          result = await sendTemplate("en");
          attempts.push(`template hello_world (en): ${result.ok ? "ok" : result.error}`);
        }
        if (!result.ok) {
          // The template may be missing while the customer *is* reachable: try
          // the plain message before giving up.
          const fallback = windowOpen ? await sendTemplate("en_US") : await sendText();
          attempts.push(`${windowOpen ? "template" : "text"}: ${fallback.ok ? "ok" : fallback.error}`);
          if (fallback.ok) result = fallback;
          else if (!result.hint) result = { ...result, hint: fallback.hint };
        }

        if (!result.ok) {
          return NextResponse.json(
            {
              ok: false,
              attempts,
              result,
              error: `WhatsApp could not deliver to +${target}: ${result.error}${result.hint ? ` — ${result.hint}` : ""}`,
            },
            { status: 502 },
          );
        }

        const viaTemplate = !windowOpen;
        return NextResponse.json({
          ok: true,
          mode: "live",
          attempts,
          result,
          message: `Delivered to +${target}${result.messageId ? ` (id ${result.messageId})` : ""}. ${
            viaTemplate
              ? "That was the hello_world template so it can open a brand-new conversation — the customer's reply reopens free text for 24 hours."
              : "The customer has an open 24-hour window, so this went as a normal message."
          }`,
        });
      }
      case "send": {
        const to = normalisePhone(body.to ?? body.waId);
        const text = (body.body ?? "").trim();
        if (!to) throw new Error("A recipient number is required");
        if (text.length < 2) throw new Error("Write a message first");
        const result = await sendWhatsAppText({ db, to, body: text });
        if (!result.ok) {
          return NextResponse.json(
            {
              ok: false,
              result,
              error: `${result.error}${result.hint ? ` — ${result.hint}` : ""}`,
            },
            { status: 502 },
          );
        }
        return NextResponse.json({
          ok: true,
          result,
          message: result.sandbox ? "Sandbox — message logged, not transmitted" : "Message sent",
        });
      }
      case "payment-link": {
        if (!body.orderId) throw new Error("Order is required");
        const result = await requestOrderPayment(db, Number(body.orderId), session.name, baseUrl);
        return NextResponse.json({
          ok: true,
          ...result,
          message: result.sent
            ? "Payment link sent on WhatsApp"
            : result.sandbox
              ? "Sandbox — payment link prepared (no WhatsApp credentials)"
              : `Payment link ready: ${result.url}`,
        });
      }
      case "feedback-invite": {
        if (!body.orderId) throw new Error("Order is required");
        const result = await sendFeedbackInvite(db, Number(body.orderId), baseUrl, {
          channel: body.channel === "link" ? "link" : "whatsapp",
        });
        return NextResponse.json({
          ok: true,
          ...result,
          message: result.sent
            ? "Feedback link sent on WhatsApp"
            : `Feedback link ready: ${result.url}`,
        });
      }
      case "open-thread": {
        const to = normalisePhone(body.waId ?? body.to);
        if (!to) throw new Error("Conversation is required");
        const conversation = await touchConversation(db, to);
        return NextResponse.json({ ok: true, conversation });
      }
      case "chat-link": {
        const settings = await getSettings();
        const number = settingValue(settings, "whatsapp_display_number", "");
        const link = whatsappChatLink(
          number,
          "Assalam-o-Alaikum Khan Baba! I would like to order.",
        );
        return NextResponse.json({ ok: true, link, message: link || "Add a public WhatsApp number first" });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("whatsapp action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "WhatsApp action failed" },
      { status: 400 },
    );
  }
}
