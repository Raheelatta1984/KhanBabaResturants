import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { publicBaseUrl } from "@/lib/url";
import {
  claimOfferByToken,
  CommunityError,
  createReturnRequest,
  expireOffer,
  publishOffer,
  syncAllPostedOffers,
  syncOfferComments,
} from "@/lib/community";

export const dynamic = "force-dynamic";

/** Returns, community posts, comment sync and first-comment claim actions. */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager", "counter", "delivery"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const db = await getDb();
  const actor = session.email;
  try {
    switch (action) {
      case "create_return": {
        const result = await createReturnRequest(db, {
          orderCode: String(body.orderCode ?? ""),
          reason: String(body.reason ?? ""),
          resolution: String(body.resolution ?? "community") as
            | "refund"
            | "replacement"
            | "community"
            | "waste",
          notes: String(body.notes ?? ""),
          actor,
        });
        if (result.offerId && body.publish !== false) {
          await publishOffer(db, result.offerId, actor, publicBaseUrl(request));
        }
        return NextResponse.json({ ok: true, ...result }, { status: 201 });
      }
      case "publish": {
        const offer = await publishOffer(
          db,
          Number(body.offerId),
          actor,
          publicBaseUrl(request),
        );
        return NextResponse.json({ ok: true, offer });
      }
      case "sync": {
        const result = body.offerId
          ? await syncOfferComments(db, Number(body.offerId), actor)
          : { offers: await syncAllPostedOffers(db, actor) };
        return NextResponse.json({ ok: true, result });
      }
      case "claim": {
        const offer = await claimOfferByToken(db, String(body.token ?? ""), {
          name: String(body.name ?? ""),
          keyword: String(body.keyword ?? ""),
        });
        return NextResponse.json({ ok: true, offer });
      }
      case "expire": {
        await expireOffer(db, Number(body.offerId), actor);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof CommunityError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Community action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 },
    );
  }
}
