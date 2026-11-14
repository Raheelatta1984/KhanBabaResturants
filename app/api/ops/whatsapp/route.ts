import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { publicBaseUrl } from "@/lib/url";
import { getSettings, settingValue } from "@/lib/settings";
import {
  sendWhatsAppText,
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
      case "test": {
        const settings = await getSettings();
        const config = await whatsappConfig();
        const target =
          normalisePhone(body.to) ||
          normalisePhone(settingValue(settings, "whatsapp_counter_number", ""));
        if (!target)
          throw new Error("Add a counter WhatsApp number in the settings below, or type a number to test");
        const result = await sendWhatsAppText({
          db,
          to: target,
          body: `Khan Baba WhatsApp test message from ${session.name}. Channel mode: ${config.mode}. Reply MENU to see the live menu.`,
        });
        return NextResponse.json({
          ok: true,
          result,
          message: result.sandbox
            ? `Sandbox — message logged for +${target}. Add WhatsApp Cloud API credentials to send for real.`
            : `Sent to +${target}`,
        });
      }
      case "send": {
        const to = normalisePhone(body.to ?? body.waId);
        const text = (body.body ?? "").trim();
        if (!to) throw new Error("A recipient number is required");
        if (text.length < 2) throw new Error("Write a message first");
        const result = await sendWhatsAppText({ db, to, body: text });
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
