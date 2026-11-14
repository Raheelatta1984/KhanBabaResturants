import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { claimOfferByToken, CommunityError } from "@/lib/community";

export const dynamic = "force-dynamic";

/**
 * First-comment-wins claim. The conditional UPDATE in `claimOffer` is the
 * single source of truth: two simultaneous claims cannot both succeed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  let body: { name?: string; keyword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const db = await getDb();
    const offer = await claimOfferByToken(db, token, {
      name: String(body.name ?? ""),
      keyword: String(body.keyword ?? ""),
    });
    return NextResponse.json({
      ok: true,
      pickupCode: offer.pickup_code,
      claimOrderCode: offer.claim_order_code,
      autoReply: offer.auto_reply_text,
      claimedBy: offer.claimed_by,
    });
  } catch (error) {
    if (error instanceof CommunityError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status === 400 ? 409 : 400 },
      );
    console.error("Community claim failed", error);
    return NextResponse.json({ error: "Could not claim" }, { status: 500 });
  }
}
