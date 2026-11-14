import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { applyCourierStatus } from "@/lib/delivery/webhooks";

export const dynamic = "force-dynamic";

/** Uber Direct delivery status webhook — shares the courier status mapper. */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret =
    process.env.UBER_WEBHOOK_SECRET ||
    (await getSetting("uber_webhook_secret"));

  if (secret) {
    const signature =
      request.headers.get("x-uber-signature") ??
      request.headers.get("x-signature") ??
      "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const provided = signature.replace(/^sha256=/, "");
    const valid =
      provided.length === expected.length &&
      (() => {
        try {
          return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
        } catch {
          return false;
        }
      })();
    if (!valid)
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    delivery_id?: string;
    id?: string;
    status?: string;
    courier?: { name?: string; phone_number?: string };
    tracking_url?: string;
    eta_minutes?: number;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const deliveryId = payload.delivery_id ?? payload.id;
  const status = String(payload.status ?? "").toLowerCase();
  if (!deliveryId || !status)
    return NextResponse.json(
      { error: "Missing delivery id or status" },
      { status: 400 },
    );

  const db = await getDb();
  const result = await applyCourierStatus(db, {
    provider: "uber_direct",
    deliveryId,
    status,
    courierName: payload.courier?.name,
    courierPhone: payload.courier?.phone_number,
    trackingUrl: payload.tracking_url,
    etaMinutes: payload.eta_minutes,
    actor: "uber-webhook",
  });
  return NextResponse.json({ ok: true, ...result });
}
