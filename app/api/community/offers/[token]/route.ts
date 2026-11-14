import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { offerByToken } from "@/lib/community";

export const dynamic = "force-dynamic";

/** Public offer detail — pickup code is only returned after a successful claim. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const db = await getDb();
  const offer = await offerByToken(db, token);
  if (!offer)
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  return NextResponse.json({
    offer: {
      token: offer.token,
      title: offer.title,
      description: offer.description,
      contents: offer.contents,
      status: offer.status,
      claimKeyword: offer.claim_keyword,
      facebookPostUrl: offer.facebook_post_url,
      claimedBy: offer.claimed_by,
      claimedAt: offer.claimed_at,
      commentsClosed: offer.comments_closed,
      autoReplyText: offer.auto_reply_text,
      pickupCode:
        offer.status === "claimed" ? offer.pickup_code : null,
      pickupDeadline: offer.pickup_deadline,
      claimOrderCode:
        offer.status === "claimed" ? offer.claim_order_code : null,
    },
  });
}
