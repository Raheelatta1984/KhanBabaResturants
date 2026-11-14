import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  publishFacebookMarketingPost,
  publishInstagramPost,
  publishWhatsAppBroadcast,
  MarketingPost,
} from "@/lib/integrations/instagram";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === "publish") {
      const caption = body.caption?.trim() || "";
      const menuItems = body.menuItems
        ?.split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0) || [];
      const preparationNotes = body.preparationNotes?.trim() || "";
      const blogUrl = body.blogUrl?.trim() || "";
      const imageUrl = body.imageUrl?.trim() || null;
      const videoUrl = body.videoUrl?.trim() || null;
      const whatsappRecipients = body.whatsappRecipients
        ?.split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0) || [];

      const post: MarketingPost = {
        caption,
        imageUrl,
        videoUrl,
        menuItems,
        preparationNotes,
        blogUrl,
      };

      const results: Record<string, unknown> = {};

      // 1. Facebook
      try {
        const fb = await publishFacebookMarketingPost(post);
        results.facebook = { success: true, url: fb.url, postId: fb.postId };
      } catch (e: any) {
        results.facebook = { success: false, error: e.message };
      }

      // 2. Instagram
      try {
        const ig = await publishInstagramPost(post);
        results.instagram = { success: true, url: ig.url, postId: ig.postId };
      } catch (e: any) {
        results.instagram = { success: false, error: e.message };
      }

      // 3. WhatsApp Broadcast
      try {
        const wa = await publishWhatsAppBroadcast(post, whatsappRecipients);
        results.whatsapp = { success: true, details: wa };
      } catch (e: any) {
        results.whatsapp = { success: false, error: e.message };
      }

      return NextResponse.json(results);
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
