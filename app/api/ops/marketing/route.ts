import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { publicBaseUrl } from "@/lib/url";
import {
  broadcastRecipients,
  broadcastTodayMenu,
  marketingSnapshot,
  menuBlog,
  menuCaption,
  menuHashtags,
  publishSavedPost,
  saveDraft,
  todayMenu,
} from "@/lib/marketing/engine";
import {
  publishFacebookMarketingPost,
  publishInstagramPost,
  publishWhatsAppBroadcast,
  type MarketingPost,
} from "@/lib/integrations/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Marketing console API.
 *
 * This route previously had **no authentication at all**: anyone who found the
 * URL could post to the Facebook page, the Instagram account and broadcast
 * WhatsApp messages to a list of phone numbers. It is now manager/admin only,
 * and every write is attributed to the signed-in staff member.
 */
export async function GET() {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const db = await getDb();
  const snapshot = await marketingSnapshot(db);
  return NextResponse.json({ ok: true, ...snapshot });
}

type Body = {
  action?: string;
  caption?: string;
  menuItems?: string;
  preparationNotes?: string;
  blogUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  whatsappRecipients?: string;
  postId?: number;
};

export async function POST(request: NextRequest) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const db = await getDb();
  const baseUrl = publicBaseUrl(request);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    switch (body.action) {
      // ── Draft the day automatically ────────────────────────────────────────
      case "draft-today": {
        const menu = await todayMenu(db, baseUrl);
        const blog = menuBlog(menu);
        const hashtags = menuHashtags(menu);
        const saved = await saveDraft(db, {
          kind: "menu",
          title: `${menu.weekday}'s menu — ${menu.date}`,
          caption: menuCaption(menu),
          hook: `${menu.totalDishes} dishes on the pass today`,
          cta: "Order on WhatsApp or online",
          hashtags,
          imagePrompt: `Overhead flat-lay of ${menu.featured
            .map((dish) => dish.name)
            .join(", ")} on a dark wooden table, steam rising, warm Lahore truck-art colours, natural window light, 4:5 vertical`,
          blogSlug: blog.slug,
          blogBody: blog.body,
          actor: session.name,
        });
        return NextResponse.json({
          ok: true,
          socialPostId: saved.id,
          blogSlug: blog.slug,
          preview: menuCaption(menu),
          hashtags,
          message: `Draft #${saved.id} created with ${menu.totalDishes} dishes and a blog post at /blog/${blog.slug}. Nothing has been published yet.`,
        });
      }

      // ── Publish a saved draft ──────────────────────────────────────────────
      case "publish-saved": {
        if (!body.postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
        const result = await publishSavedPost(db, Number(body.postId), session.name);
        return NextResponse.json({
          ...result,
          message: result.ok
            ? `Published. Facebook: ${result.facebook.ok ? "ok" : result.facebook.error}. Instagram: ${result.instagram.ok ? "ok" : result.instagram.error}.`
            : `Neither channel accepted the post. Facebook: ${result.facebook.error}. Instagram: ${result.instagram.error}.`,
        });
      }

      // ── Ad-hoc composed post (the original form) ───────────────────────────
      case "publish": {
        const caption = (body.caption ?? "").trim();
        if (caption.length < 4)
          return NextResponse.json({ error: "Write a caption first" }, { status: 400 });

        const split = (value: string | undefined) =>
          (value ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);

        const post: MarketingPost = {
          caption,
          imageUrl: body.imageUrl?.trim() || null,
          videoUrl: body.videoUrl?.trim() || null,
          menuItems: split(body.menuItems),
          preparationNotes: (body.preparationNotes ?? "").trim(),
          blogUrl: body.blogUrl?.trim() || undefined,
        };

        const results: Record<string, unknown> = {};

        try {
          const fb = await publishFacebookMarketingPost(post);
          results.facebook = { success: true, url: fb.url, postId: fb.postId };
        } catch (error) {
          results.facebook = {
            success: false,
            error: error instanceof Error ? error.message : "Facebook publish failed",
          };
        }

        try {
          const ig = await publishInstagramPost(post);
          results.instagram = { success: true, url: ig.url, postId: ig.postId };
        } catch (error) {
          results.instagram = {
            success: false,
            error: error instanceof Error ? error.message : "Instagram publish failed",
          };
        }

        const recipients = split(body.whatsappRecipients);
        if (recipients.length > 0) {
          try {
            const wa = await publishWhatsAppBroadcast(post, recipients);
            results.whatsapp = { success: true, details: wa };
          } catch (error) {
            results.whatsapp = {
              success: false,
              error: error instanceof Error ? error.message : "WhatsApp broadcast failed",
            };
          }
        } else {
          // No hand-typed numbers: offer the consented list instead of
          // pretending a broadcast happened.
          const lucky = await broadcastRecipients(db, 200);
          results.whatsapp = {
            skipped: true,
            message: `No recipients typed. ${lucky.length} opted-in customer(s) are available — use "Broadcast today's menu" for the consented list.`,
          };
        }

        const saved = await saveDraft(db, {
          kind: "offer",
          title: caption.slice(0, 70),
          caption,
          imageUrl: body.imageUrl?.trim() || null,
          actor: session.name,
        });

        return NextResponse.json({ ...results, socialPostId: saved.id });
      }

      // ── Audience preview ───────────────────────────────────────────────────
      case "audience": {
        const list = await broadcastRecipients(db, 500);
        return NextResponse.json({
          ok: true,
          count: list.length,
          recipients: list,
          message:
            list.length === 0
              ? "No opted-in customers yet. Broadcasts only go to customers with marketing_opt_in."
              : `${list.length} opted-in customer(s) will receive the next broadcast.`,
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Marketing action failed" },
      { status: 500 },
    );
  }
}
