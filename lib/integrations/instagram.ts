/**
 * Instagram Business integration for marketing and menu posts.
 *
 * Posts food preparation, daily menu updates and marketing content.
 * Uses the Instagram Graph API via the connected Facebook Business account.
 */

const API_VERSION = process.env.INSTAGRAM_API_VERSION || "v19.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

export type InstagramConfig = {
  instagramAccountId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
};

export async function instagramConfig(): Promise<InstagramConfig> {
  const getSetting = async (key: string) =>
    (process.env[`INSTAGRAM_${key.toUpperCase()}`] ?? "").trim() ||
    (await import("../settings").then((m) => m.getSetting(key)));

  return {
    instagramAccountId:
      process.env.INSTAGRAM_ACCOUNT_ID ||
      (await getSetting("instagram_account_id")),
    accessToken:
      process.env.INSTAGRAM_ACCESS_TOKEN ||
      (await getSetting("instagram_access_token")),
    appSecret:
      process.env.INSTAGRAM_APP_SECRET ||
      (await getSetting("instagram_app_secret")),
    verifyToken:
      process.env.INSTAGRAM_VERIFY_TOKEN ||
      (await getSetting("instagram_verify_token")),
  };
}

export async function instagramConfigured(): Promise<boolean> {
  const config = await instagramConfig();
  return Boolean(config.instagramAccountId && config.accessToken);
}

async function graph(
  path: string,
  config: InstagramConfig,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${GRAPH}${path}${separator}access_token=${encodeURIComponent(
      config.accessToken,
    )}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    },
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error
      ?.message;
    throw new Error(message ?? `Instagram Graph API error ${res.status}`);
  }
  return (json ?? {}) as Record<string, unknown>;
}

export type MarketingPost = {
  caption: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  menuItems?: string[];
  preparationNotes?: string;
  blogUrl?: string;
};

/** Format a marketing post for Instagram and Facebook */
export function formatMarketingPost(post: MarketingPost): string {
  const lines: string[] = [post.caption];
  if (post.menuItems && post.menuItems.length) {
    lines.push("", "Today's Menu:");
    lines.push(...post.menuItems.map((item) => `• ${item}`));
  }
  if (post.preparationNotes) {
    lines.push("", "Preparation Notes:", post.preparationNotes);
  }
  if (post.blogUrl) {
    lines.push("", "Read more on the blog:", post.blogUrl);
  }
  lines.push("", "#KhanBaba #FoodPreparation #DailyMenu #SydneyEats");
  return lines.join("\n");
}

/** Publish a marketing post to Instagram */
export async function publishInstagramPost(
  post: MarketingPost,
): Promise<{ postId: string; url: string }> {
  const config = await instagramConfig();
  if (!config.instagramAccountId || !config.accessToken)
    throw new Error("Instagram credentials are not configured");

  // Step 1: Create media container (image or video)
  const mediaPayload: Record<string, unknown> = {
    caption: formatMarketingPost(post),
  };
  if (post.imageUrl) mediaPayload.image_url = post.imageUrl;
  if (post.videoUrl) mediaPayload.video_url = post.videoUrl;

  const mediaRes = await graph(
    `/${config.instagramAccountId}/media`,
    config,
    {
      method: "POST",
      body: JSON.stringify(mediaPayload),
    },
  );

  const creationId = mediaRes.id as string | undefined;
  if (!creationId) throw new Error("Instagram did not return a media creation id");

  // Step 2: Publish the container
  const publishRes = await graph(
    `/${config.instagramAccountId}/media_publish`,
    config,
    {
      method: "POST",
      body: JSON.stringify({ creation_id: creationId }),
    },
  );

  const postId = String(publishRes.id ?? "");
  if (!postId) throw new Error("Instagram did not return a post id");

  return {
    postId,
    url: `https://www.instagram.com/p/${postId}/`,
  };
}

/** Publish a marketing post to Facebook */
export async function publishFacebookMarketingPost(
  post: MarketingPost,
): Promise<{ postId: string; url: string }> {
  const { facebookConfig, publishOfferPost, postMessage } = await import(
    "../facebook"
  );
  const config = await facebookConfig();
  if (!config.pageId || !config.accessToken)
    throw new Error("Facebook Page credentials are not configured");

  // Adapt marketing post to Facebook format
  const fbMessage = formatMarketingPost(post);
  const json = await (
    await import("../facebook")
  ).graph(`/${config.pageId}/feed`, config, {
    method: "POST",
    body: JSON.stringify({ message: fbMessage }),
  });

  const postId = String(json.id ?? "");
  if (!postId) throw new Error("Facebook did not return a post id");

  return {
    postId,
    url: `https://www.facebook.com/${config.pageId}/posts/${postId.split("_")[1] ?? postId}`,
  };
}

/** Publish a marketing post to WhatsApp broadcast */
export async function publishWhatsAppBroadcast(
  post: MarketingPost,
  recipients: string[],
): Promise<string[]> {
  const { whatsappConfig, sendWhatsAppText, normalisePhone } = await import(
    "../whatsapp/client"
  );
  const { getDb } = await import("../db");
  const db = await getDb();

  const config = await whatsappConfig();
  if (!config.enabled) {
    throw new Error("WhatsApp channel disabled");
  }

  const broadcastMessage = formatMarketingPost(post);
  const results: string[] = [];

  for (const recipient of recipients) {
    const to = normalisePhone(recipient);
    if (!to) continue;
    const res = await sendWhatsAppText({
      db,
      to,
      body: broadcastMessage,
      system: true,
    });
    results.push(res.ok ? `Sent to ${to}` : `Failed for ${to}: ${res.error}`);
  }

  return results;
}

/** Verify Instagram signature */
export function verifyInstagramSignature(
  raw: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const { createHmac, timingSafeEqual } = require("node:crypto");
  const provided = header.replace(/^sha256=/, "");
  const expected = createHmac("sha256", appSecret)
    .update(raw)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyInstagramChallenge(
  mode: string | null,
  token: string | null,
  verifyToken: string,
): boolean {
  return mode === "subscribe" && Boolean(verifyToken) && token === verifyToken;
}
