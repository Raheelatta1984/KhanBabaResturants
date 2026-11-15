import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { publicBaseUrl } from "@/lib/url";
import {
  broadcastRecipients,
  broadcastTodayMenu,
  menuBroadcastBody,
  menuCaption,
  menuHashtags,
  todayMenu,
} from "@/lib/marketing/engine";
import { saveDraft } from "@/lib/marketing/engine";
import { withActionLog } from "@/lib/ops/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * "Today's menu" in one call.
 *
 * GET  — a preview of the exact WhatsApp body, caption, hashtags and audience
 *        size. Nothing is sent and no customer is contacted.
 * POST — { action: "broadcast" | "draft" | "preview", requireLive?: boolean }
 *
 * The broadcast only ever targets customers who have opted in
 * (`customers.marketing_opt_in` or a conversation that has ordered), and every
 * attempt is written to `broadcast_logs` with per-recipient detail.
 */
export async function GET(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const db = await getDb();
  const baseUrl = publicBaseUrl(request);
  const menu = await todayMenu(db, baseUrl);
  const audience = await broadcastRecipients(db, 500);

  return NextResponse.json({
    ok: true,
    date: menu.date,
    weekday: menu.weekday,
    dishes: menu.totalDishes,
    soldOut: menu.soldOut,
    featured: menu.featured,
    whatsappBody: menuBroadcastBody(menu),
    caption: menuCaption(menu),
    hashtags: menuHashtags(menu),
    audience: audience.length,
    message:
      audience.length === 0
        ? "Menu ready, but no opted-in customers yet — the preview is shown for approval before anything is sent."
        : `Menu ready for ${menu.totalDishes} dishes. ${audience.length} opted-in customer(s) would receive it. Nothing has been sent.`,
  });
}

async function post(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const db = await getDb();
  const baseUrl = publicBaseUrl(request);

  let body: { action?: string; requireLive?: boolean } = {};
  try {
    body = (await request.json()) as { action?: string; requireLive?: boolean };
  } catch {
    /* an empty body means "preview" */
  }

  try {
    if (body.action === "draft") {
      const menu = await todayMenu(db, baseUrl);
      const saved = await saveDraft(db, {
        kind: "menu",
        title: `Today's menu — ${menu.date}`,
        caption: menuCaption(menu),
        hook: `${menu.totalDishes} dishes on today`,
        cta: "Order on WhatsApp",
        hashtags: menuHashtags(menu),
        actor: session.name,
      });
      return NextResponse.json({
        ok: true,
        socialPostId: saved.id,
        message: `Draft #${saved.id} saved for approval. Publish it from the Marketing screen.`,
      });
    }

    if (body.action === "broadcast") {
      const result = await broadcastTodayMenu(db, {
        actor: session.name,
        baseUrl,
        requireLive: Boolean(body.requireLive),
      });
      return NextResponse.json({
        ok: true,
        ...result,
        message:
          result.recipients === 0
            ? "No opted-in customers to message. The menu copy is saved in the broadcast log for the next run."
            : result.sandbox
              ? `Sandbox: ${result.recipients} recipient(s) logged, nothing left the building. Fix the WhatsApp credentials to send for real.`
              : `Sent to ${result.sent} of ${result.recipients} opted-in customer(s)${result.failed > 0 ? `, ${result.failed} failed` : ""}. Log #${result.logId}.`,
      });
    }

    // Default: preview only. Safe to call from a button labelled "Preview".
    const menu = await todayMenu(db, baseUrl);
    const audience = await broadcastRecipients(db, 500);
    return NextResponse.json({
      ok: true,
      preview: true,
      date: menu.date,
      whatsappBody: menuBroadcastBody(menu),
      caption: menuCaption(menu),
      hashtags: menuHashtags(menu),
      audience: audience.length,
      message: "Preview only — nothing was sent.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Broadcast failed" },
      { status: 500 },
    );
  }
}

/** Every call is written to the action log: who, what, the outcome, what to do next. */
export const POST = withActionLog("marketing", post, { fallback: "preview", quiet: ["preview"] });
