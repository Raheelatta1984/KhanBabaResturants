import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  recordSquareWebhook,
  verifySquareWebhook,
} from "@/lib/integrations/square";

export const dynamic = "force-dynamic";

/**
 * Square POS webhook. `x-square-hmacsha256-signature` is HMAC-SHA256 over the
 * notification URL plus the raw body, as documented by Square. In sandbox
 * mirror mode (no signature key) events are still recorded but clearly marked
 * as unverified, so the ledger is useful for rehearsal without pretending to
 * be secure.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");
  const verified = await verifySquareWebhook(request.url, raw, signature);
  if (!verified) {
    // Only allow unsigned events when no key has been configured yet.
    const { getSetting } = await import("@/lib/settings");
    const key =
      process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ||
      (await getSetting("square_webhook_signature_key"));
    if (key)
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    event_type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const db = await getDb();
  await recordSquareWebhook(db, payload);
  return NextResponse.json({ ok: true, verified });
}
