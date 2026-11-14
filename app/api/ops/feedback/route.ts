import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { publicBaseUrl } from "@/lib/url";
import {
  createFeedbackInvite,
  googleReviewUrl,
  markGoogleDraft,
  sendFeedbackInvite,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";

/** Counter/admin feedback actions: send a link, share or skip a Google draft. */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager", "counter"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: {
    action?: string;
    orderId?: number;
    draftId?: number;
    status?: string;
    channel?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const baseUrl = publicBaseUrl(request);

  try {
    switch (body.action) {
      case "invite": {
        if (!body.orderId) throw new Error("Order is required");
        if (body.channel === "link") {
          const invite = await createFeedbackInvite(db, Number(body.orderId), { channel: "link" });
          return NextResponse.json({
            ok: true,
            url: `${baseUrl}/feedback/${invite.token}`,
            message: "Feedback link ready — text it or show the QR",
          });
        }
        const result = await sendFeedbackInvite(db, Number(body.orderId), baseUrl, {
          channel: "whatsapp",
        });
        return NextResponse.json({
          ok: true,
          ...result,
          message: result.sent
            ? "Feedback link sent on WhatsApp"
            : `Feedback link ready: ${result.url}`,
        });
      }
      case "mark": {
        if (!body.draftId) throw new Error("Draft is required");
        const status = body.status === "skipped" ? "skipped" : "published";
        const draft = await markGoogleDraft(db, Number(body.draftId), session.name, status);
        return NextResponse.json({
          ok: true,
          draft,
          message:
            status === "published"
              ? "Recorded as shared on Google"
              : "Draft skipped",
        });
      }
      case "google-url": {
        return NextResponse.json({ ok: true, url: await googleReviewUrl(db) });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("feedback action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Feedback action failed" },
      { status: 400 },
    );
  }
}
