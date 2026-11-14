import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { publicBaseUrl } from "@/lib/url";
import { whatsappConfig, verifyWhatsAppSignature } from "@/lib/whatsapp/client";
import { handleInboundWhatsApp } from "@/lib/whatsapp/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * WhatsApp Business Cloud API webhook.
 *
 * GET  — Meta's verification handshake (`hub.challenge` echoed only when the
 *        verify token matches). With no token configured the endpoint answers
 *        in sandbox mode so local testing works.
 * POST — inbound messages and delivery statuses. Every message is handled in
 *        isolation: one malformed message in a batch cannot fail the rest, and
 *        Meta always receives a 200 so it does not retry forever.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const config = await whatsappConfig();

  if (mode !== "subscribe") {
    return NextResponse.json({ ok: true, endpoint: "whatsapp", mode: config.mode });
  }
  const expected = config.verifyToken;
  if (expected && token !== expected) {
    return new NextResponse("Verification failed", { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

type Inbound = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  image?: { caption?: string };
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: Inbound[];
        statuses?: { id?: string; status?: string; recipient_id?: string }[];
      };
    }[];
  }[];
};

function messageText(message: Inbound): string {
  if (message?.text?.body) return message.text.body;
  if (message?.button?.text) return message.button.text;
  if (message?.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message?.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message?.image?.caption) return message.image.caption;
  return "";
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!(await verifyWhatsAppSignature(raw, signature))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(raw) as WhatsAppWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (body.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = await getDb();
  const baseUrl = publicBaseUrl(request);
  const handled: { messageId?: string; orderCode?: string; replies: number }[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const contactName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages ?? []) {
        if (!message.from) continue;
        const text = messageText(message);
        if (!text) continue;
        try {
          const result = await handleInboundWhatsApp(
            db,
            {
              from: message.from,
              name: contactName,
              text,
              externalId: message.id ?? null,
              type: message.type ?? "text",
            },
            baseUrl,
          );
          handled.push({
            messageId: message.id,
            orderCode: result.orderCode,
            replies: result.replies.length,
          });
        } catch (error) {
          console.error("whatsapp inbound failed", error);
        }
      }

      // Delivery receipts keep the audit trail honest.
      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        await db
          .query("UPDATE whatsapp_messages SET status = $1 WHERE external_id = $2", [
            status.status,
            status.id,
          ])
          .catch(() => null);
      }
    }
  }

  return NextResponse.json({ ok: true, handled });
}
