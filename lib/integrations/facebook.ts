import { createHmac, timingSafeEqual } from "node:crypto";
import { getSetting } from "../settings";

/**
 * Facebook Page integration for the "community in need" programme.
 *
 * A returned, untouched order is published as a Page post. The FIRST comment
 * wins the meal, the platform replies with the configured thank-you message,
 * and further comments are closed (or hidden, on Page API versions that do not
 * expose `comment_enabled`). Without credentials everything is simulated
 * locally so the workflow can be rehearsed end to end.
 */
const API_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

export type FacebookConfig = {
  pageId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
};

export async function facebookConfig(): Promise<FacebookConfig> {
  return {
    pageId:
      process.env.FACEBOOK_PAGE_ID ||
      (await getSetting("community_facebook_page_id")),
    accessToken:
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN ||
      (await getSetting("community_facebook_access_token")),
    appSecret:
      process.env.FACEBOOK_APP_SECRET ||
      (await getSetting("community_facebook_app_secret")),
    verifyToken:
      process.env.FACEBOOK_VERIFY_TOKEN ||
      (await getSetting("community_facebook_verify_token")),
  };
}

export async function facebookConfigured(): Promise<boolean> {
  const config = await facebookConfig();
  return Boolean(config.pageId && config.accessToken);
}

async function graph(
  path: string,
  config: FacebookConfig,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}${path}${separator}access_token=${encodeURIComponent(config.accessToken)}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
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
    throw new Error(message ?? `Facebook Graph API error ${res.status}`);
  }
  return (json ?? {}) as Record<string, unknown>;
}

export type OfferPost = {
  title: string;
  description?: string | null;
  contents?: string | null;
  claimKeyword: string;
  pickupHours: string;
  restaurantName: string;
  pickupUrl?: string;
};

export function postMessage(offer: OfferPost): string {
  const lines: string[] = [
    `🍛 ${offer.title}`,
    "",
    offer.description || "Freshly prepared and untouched — free to a neighbour who needs a meal tonight.",
  ];
  if (offer.contents) {
    try {
      const items = JSON.parse(offer.contents) as { name: string; qty: number }[];
      if (Array.isArray(items) && items.length)
        lines.push("", "In the bag: " + items.map((i) => `${i.qty}× ${i.name}`).join(", "));
    } catch {
      /* contents is free text */
    }
  }
  lines.push(
    "",
    `FIRST COMMENT WINS: be the first to comment "${offer.claimKeyword}" and it is yours.`,
    "Click & collect only — no delivery, no payment.",
    `Pick up from ${offer.restaurantName} (${offer.pickupHours}). Bring your booking code from our reply.`,
  );
  if (offer.pickupUrl) lines.push(`Details: ${offer.pickupUrl}`);
  lines.push("", "One meal per household. Please only claim if you can collect today.");
  return lines.join("\n");
}

export async function publishOfferPost(
  offer: OfferPost,
): Promise<{ postId: string; url: string }> {
  const config = await facebookConfig();
  if (!config.pageId || !config.accessToken)
    throw new Error("Facebook Page credentials are not configured");
  const json = await graph(`/${config.pageId}/feed`, config, {
    method: "POST",
    body: JSON.stringify({ message: postMessage(offer) }),
  });
  const postId = String(json.id ?? "");
  if (!postId) throw new Error("Facebook did not return a post id");
  return {
    postId,
    url: `https://www.facebook.com/${config.pageId}/posts/${postId.split("_")[1] ?? postId}`,
  };
}

export type PostComment = {
  id: string;
  message: string;
  fromName: string;
  createdAt: string;
};

export async function listPostComments(
  postId: string,
): Promise<PostComment[]> {
  const config = await facebookConfig();
  const json = await graph(
    `/${postId}/comments?fields=id,message,from,created_time&order=chronological&limit=100`,
    config,
    { method: "GET" },
  );
  const rows = (json.data ?? []) as {
    id?: string;
    message?: string;
    from?: { name?: string };
    created_time?: string;
  }[];
  return rows
    .filter((row) => row.id)
    .map((row) => ({
      id: String(row.id),
      message: String(row.message ?? ""),
      fromName: String(row.from?.name ?? "Community member"),
      createdAt: String(row.created_time ?? new Date().toISOString()),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function replyToComment(
  commentId: string,
  message: string,
): Promise<boolean> {
  const config = await facebookConfig();
  try {
    await graph(`/${commentId}/comments`, config, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop further comments. Newer Page API versions accept `comment_enabled=false`
 * on the post; when they do not, `syncOfferComments` falls back to hiding any
 * later comment (`is_hidden=true`), which is the same effect for the public.
 */
export async function closePostComments(postId: string): Promise<boolean> {
  const config = await facebookConfig();
  try {
    await graph(`/${postId}`, config, {
      method: "POST",
      body: JSON.stringify({ comment_enabled: false }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function hideComment(commentId: string): Promise<boolean> {
  const config = await facebookConfig();
  try {
    await graph(`/${commentId}`, config, {
      method: "POST",
      body: JSON.stringify({ is_hidden: true }),
    });
    return true;
  } catch {
    return false;
  }
}

/** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>` */
export function verifyFacebookSignature(
  raw: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const provided = header.replace(/^sha256=/, "");
  const expected = createHmac("sha256", appSecret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyFacebookChallenge(
  mode: string | null,
  token: string | null,
  verifyToken: string,
): boolean {
  return mode === "subscribe" && Boolean(verifyToken) && token === verifyToken;
}
