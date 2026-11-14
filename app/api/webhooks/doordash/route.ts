import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { applyCourierStatus } from "@/lib/delivery/webhooks";
import { verifyDoordashWebhook } from "@/lib/delivery/doordash";

export const dynamic = "force-dynamic";

/** DoorDash Drive delivery status webhook (JWT-signed or shared HMAC secret). */
export async function POST(request: Request) {
  const raw = await request.text();
  const db = await getDb();
  const secret =
    process.env.DOORDASH_WEBHOOK_SECRET ||
    (await getSetting("doordash_webhook_secret"));

  if (secret) {
    const provided = (
      request.headers.get("x-doordash-signature") ??
      request.headers.get("x-signature") ??
      ""
    ).replace(/^sha256=/, "");
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (
    !(await verifyDoordashWebhook(request.headers.get("authorization"), db))
  ) {
    // No shared secret and no valid DoorDash JWT: only accept when the
    // integration itself is unconfigured (sandbox rehearsal).
    const signingSecret = await getSetting("doordash_signing_secret");
    if (signingSecret)
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    delivery_id?: string;
    external_delivery_id?: string;
    delivery_status?: string;
    status?: string;
    tracking_url?: string;
    courier?: { name?: string; first_name?: string; phone_number?: string };
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const deliveryId = payload.external_delivery_id ?? payload.delivery_id;
  const status = payload.delivery_status ?? payload.status;
  if (!deliveryId || !status)
    return NextResponse.json(
      { error: "Missing delivery id or status" },
      { status: 400 },
    );

  const result = await applyCourierStatus(db, {
    provider: "doordash_drive",
    deliveryId,
    status,
    courierName:
      payload.courier?.name ?? payload.courier?.first_name ?? null,
    courierPhone: payload.courier?.phone_number ?? null,
    trackingUrl: payload.tracking_url ?? null,
    actor: "doordash-webhook",
  });
  return NextResponse.json({ ok: true, ...result });
}
