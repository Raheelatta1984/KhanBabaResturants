import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  facebookConfig,
  facebookConfigured,
  verifyFacebookChallenge,
  verifyFacebookSignature,
} from "@/lib/integrations/facebook";
import { syncAllPostedOffers } from "@/lib/community";

export const dynamic = "force-dynamic";

/** Facebook subscription handshake. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = await facebookConfig();
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!verifyFacebookChallenge(mode, token, config.verifyToken))
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  return new NextResponse(challenge ?? "", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Feed/comment change notification. We simply re-read every live post and let
 * the first-comment-wins claim logic decide — polling after a webhook is more
 * reliable than trusting the partial payload Facebook sends.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const config = await facebookConfig();
  if (config.appSecret) {
    if (
      !verifyFacebookSignature(
        raw,
        request.headers.get("x-hub-signature-256"),
        config.appSecret,
      )
    )
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  } else if (!(await facebookConfigured())) {
    return NextResponse.json({ error: "Facebook not configured" }, { status: 400 });
  }
  const db = await getDb();
  const results = await syncAllPostedOffers(db, "facebook-webhook");
  return NextResponse.json({ ok: true, offers: results.length, results });
}
