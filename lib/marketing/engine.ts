import type { Db } from "../db";
import { getSettings, settingValue } from "../settings";
import { money } from "../money";
import { listDeliveryZones } from "../delivery/zones";
import { publishFacebookMarketingPost, publishInstagramPost, formatMarketingPost, type MarketingPost } from "../integrations/instagram";
import { sendWhatsAppText, normalisePhone } from "../whatsapp/client";

/**
 * The AI content engine.
 *
 * One module turns the live Supabase menu into a Facebook/Instagram post, a
 * WhatsApp broadcast and a website blog post — then publishes it through the
 * Graph API and records exactly what each channel said.
 *
 * Deliberate choices:
 *   - Drafts are deterministic and menu-derived. There is no external model
 *     call to fail silently at 5 pm; the copy is built from the real dish
 *     names, prices and availability in Postgres, so it can never advertise a
 *     sold-out dish.
 *   - Nothing is sent to a customer unless `marketing_opt_in` is true AND the
 *     WhatsApp conversation has not opted out. Opt-outs are checked per row.
 *   - Every attempt is written to `social_posts`, `blog_posts` and
 *     `broadcast_logs`, so "did it go out?" is a query, not a memory.
 */

export type MenuLine = {
  item_id: number;
  name: string;
  slug: string;
  price_cents: number;
  is_veg: boolean;
  category: string | null;
};

export type TodayMenu = {
  date: string;
  weekday: string;
  featured: MenuLine[];
  categories: { name: string; items: MenuLine[] }[];
  totalDishes: number;
  soldOut: number;
  restaurantName: string;
  currency: string;
  baseUrl: string;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** The menu as it stands right now — the same rows the website sells from. */
export async function todayMenu(db: Db, baseUrl: string): Promise<TodayMenu> {
  const settings = await getSettings();
  const rows = await db.query<MenuLine & { is_available: boolean }>(
    `SELECT mi.id AS item_id, mi.name, mi.slug, mi.is_veg, mi.is_available,
            MIN(v.price_cents) AS price_cents, c.name AS category,
            c.sort_order AS category_sort
       FROM menu_items mi
       JOIN item_variants v ON v.item_id = mi.id AND v.active
       LEFT JOIN categories c ON c.id = mi.category_id
      WHERE mi.published
      GROUP BY mi.id, mi.name, mi.slug, mi.is_veg, mi.is_available, c.name, c.sort_order
      ORDER BY c.sort_order NULLS LAST, MIN(mi.sort_order), mi.id`,
  );
  const available = rows.filter((row) => {
    return row.is_available;
  });
  const soldOut = await db.maybeOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM menu_items
      WHERE track_stock AND stock_qty IS NOT NULL AND stock_qty <= 0`,
  );

  const grouped = new Map<string, MenuLine[]>();
  for (const row of available) {
    const key = row.category ?? "Today's kitchen";
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const featured = await db.query<MenuLine>(
    `SELECT mi.id AS item_id, mi.name, mi.slug, mi.is_veg,
            MIN(v.price_cents) AS price_cents, c.name AS category
       FROM menu_items mi
       JOIN item_variants v ON v.item_id = mi.id AND v.active
       LEFT JOIN categories c ON c.id = mi.category_id
      WHERE mi.published AND mi.is_available AND mi.is_featured
      GROUP BY mi.id, mi.name, mi.slug, mi.is_veg, c.name
      ORDER BY MIN(mi.sort_order), mi.id LIMIT 3`,
  );

  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    weekday: WEEKDAYS[now.getUTCDay()] ?? "Today",
    featured: featured.length > 0 ? featured : available.slice(0, 3),
    categories: [...grouped.entries()].map(([name, items]) => ({ name, items })),
    totalDishes: available.length,
    soldOut: Number(soldOut?.c ?? 0),
    restaurantName: settingValue(settings, "restaurant_name", "Khan Baba Restaurant"),
    currency: settingValue(settings, "whatsapp_currency", "AUD"),
    baseUrl,
  };
}

/** A readable WhatsApp broadcast, inside WhatsApp's 4096-character limit. */
export function menuBroadcastBody(menu: TodayMenu, zoneNote?: string): string {
  const lines: string[] = [
    `*${menu.restaurantName} — ${menu.weekday}'s menu*`,
    "",
  ];
  if (menu.featured.length > 0) {
    lines.push("*Chef's picks today*");
    for (const dish of menu.featured) {
      lines.push(
        `• ${dish.name} — ${money(dish.price_cents)}${dish.is_veg ? " (v)" : ""}`,
      );
    }
    lines.push("");
  }
  // Keep the message scannable: at most three dishes per category, and stop
  // once the body is close to the limit.
  for (const group of menu.categories) {
    const picked = group.items.slice(0, 3);
    if (picked.length === 0) continue;
    lines.push(`*${group.name}*`);
    for (const dish of picked) {
      lines.push(
        `• ${dish.name} — ${money(dish.price_cents)}${dish.is_veg ? " (v)" : ""}`,
      );
    }
    const more = group.items.length - picked.length;
    if (more > 0) lines.push(`  +${more} more`);
    lines.push("");
    if (lines.join("\n").length > 2800) break;
  }
  if (menu.soldOut > 0) {
    lines.push(`_${menu.soldOut} dish${menu.soldOut === 1 ? " is" : "es are"} sold out today._`);
    lines.push("");
  }
  if (zoneNote) {
    lines.push(zoneNote);
    lines.push("");
  }
  lines.push(`Order on WhatsApp (reply with your order) or online: ${menu.baseUrl}/menu`);
  lines.push("Reply STOP to stop these messages.");
  return lines.join("\n").slice(0, 4000);
}

/** The same content as a Facebook/Instagram caption. */
export function menuCaption(menu: TodayMenu): string {
  const picks = menu.featured
    .map((dish) => `${dish.name} ${money(dish.price_cents)}`)
    .join(" · ");
  return [
    `${menu.weekday} at ${menu.restaurantName}`,
    "",
    picks ? `On today: ${picks}.` : `${menu.totalDishes} dishes on today.`,
    "",
    "Fresh out of the kitchen — biryani, karahi, naan straight from the tandoor.",
    "",
    `Order: ${menu.baseUrl}/menu`,
    "Delivery across Sydney, or collect at the counter.",
  ].join("\n");
}

export function menuHashtags(menu: TodayMenu): string[] {
  const base = [
    "KhanBabaRestaurant",
    "SydneyFood",
    "PakistaniFood",
    "LahoriFood",
    "BiryaniLovers",
    "SydneyEats",
    "HalalSydney",
    "Karahi",
    "NaanLife",
    "SydneyRestaurants",
    "FoodieSydney",
    "DesiFood",
    "WhatsAppOrder",
    "SupportLocalSydney",
    "ChaiLovers",
  ];
  const fromMenu = menu.categories.map((group) =>
    group.name.replace(/[^A-Za-z0-9]/g, ""),
  );
  return [...new Set([...base, ...fromMenu.filter(Boolean)])].slice(0, 15);
}

/** Turn a menu into a blog post for the website. */
export function menuBlog(menu: TodayMenu): {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
} {
  const slug = `todays-menu-${menu.date}`;
  const picks = menu.featured
    .map((dish) => `- **${dish.name}** — ${money(dish.price_cents)}${dish.is_veg ? " (vegetarian)" : ""}`)
    .join("\n");
  const sections = menu.categories
    .map((group) => {
      const items = group.items
        .map((dish) => `- ${dish.name} — ${money(dish.price_cents)}${dish.is_veg ? " (v)" : ""}`)
        .join("\n");
      return `## ${group.name}\n\n${items}`;
    })
    .join("\n\n");
  return {
    slug,
    title: `${menu.weekday}'s menu at ${menu.restaurantName} — ${menu.date}`,
    excerpt: `${menu.totalDishes} dishes on the pass today, cooked to order. Order on WhatsApp or online for delivery across Sydney.`,
    body: [
      `# ${menu.restaurantName} — ${menu.weekday}`,
      "",
      `Everything below is cooking today. ${menu.soldOut > 0 ? `${menu.soldOut} dishes are already sold out, so the list updates live.` : "Nothing is pre-cooked."}`,
      "",
      "## Chef's picks",
      picks || "_Ask the counter what just came out of the tandoor._",
      "",
      sections,
      "",
      "## How to order",
      "",
      `- WhatsApp: reply to the business number with your order, or tap ${menu.baseUrl}/menu`,
      `- Delivery across Sydney, collection at the counter`,
    ].join("\n"),
  };
}

export type BroadcastRecipient = {
  wa_id: string;
  display_name: string | null;
  customer_name: string | null;
};

/**
 * Everyone who has actually agreed to marketing messages.
 *
 * A customer qualifies when `marketing_opt_in` is true and their WhatsApp
 * conversation has not opted out. Numbers that only ever ordered once are not
 * included — a broadcast list is consent, not a contact dump.
 */
export async function broadcastRecipients(
  db: Db,
  limit = 500,
): Promise<BroadcastRecipient[]> {
  return db.query<BroadcastRecipient>(
    // Consent is `customers.marketing_opt_in`, nothing else. Having ordered once
    // is not permission to send marketing — that is how a broadcast list turns
    // into spam and a business number into a blocked contact. The conversation
    // must also not have opted out (STOP).
    `SELECT wc.wa_id, wc.display_name, cu.name AS customer_name
       FROM whatsapp_conversations wc
       JOIN customers cu
         ON regexp_replace(coalesce(cu.phone, ''), '[^0-9]', '', 'g') = wc.wa_id
      WHERE wc.opt_in
        AND cu.marketing_opt_in
        AND cu.active
      ORDER BY wc.last_inbound_at DESC NULLS LAST
      LIMIT $1`,
    [Math.max(1, Math.min(limit, 1000))],
  );
}

/** Save a drafted post; returns the row so the caller can show its id. */
export async function saveDraft(
  db: Db,
  input: {
    kind: "menu" | "offer" | "story" | "blog";
    title: string;
    caption: string;
    hook?: string;
    cta?: string;
    hashtags?: string[];
    imagePrompt?: string;
    imageUrl?: string | null;
    blogSlug?: string;
    blogBody?: string;
    actor: string;
  },
): Promise<{ id: number }> {
  const row = await db.one<{ id: number }>(
    `INSERT INTO social_posts (kind, title, caption, hook, cta, hashtags, image_prompt,
        image_url, blog_slug, blog_body, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
     RETURNING id`,
    [
      input.kind,
      input.title,
      input.caption,
      input.hook ?? null,
      input.cta ?? null,
      (input.hashtags ?? []).join(","),
      input.imagePrompt ?? null,
      input.imageUrl ?? null,
      input.blogSlug ?? null,
      input.blogBody ?? null,
      input.actor,
    ],
  );
  if (input.blogSlug && input.blogBody) {
    await db.query(
      `INSERT INTO blog_posts (slug, title, excerpt, body, image_url, status, social_post_id)
       VALUES ($1,$2,$3,$4,$5,'draft',$6)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, body = EXCLUDED.body,
         image_url = COALESCE(EXCLUDED.image_url, blog_posts.image_url),
         social_post_id = EXCLUDED.social_post_id, updated_at = now()`,
      [
        input.blogSlug,
        input.title,
        input.caption.slice(0, 280),
        input.blogBody,
        input.imageUrl ?? null,
        row.id,
      ],
    ).catch(() => null);
  }
  return row;
}

/**
 * Publish one saved post to Facebook and Instagram.
 *
 * Failures are recorded per channel and the post only becomes `published` when
 * at least one channel accepted it, so the admin list never claims a post went
 * out when every call failed.
 */
export async function publishSavedPost(
  db: Db,
  postId: number,
  actor: string,
): Promise<{
  ok: boolean;
  socialPostId: number;
  facebook: { ok: boolean; error?: string };
  instagram: { ok: boolean; error?: string };
  blog: { published: boolean; url: string | null };
}> {
  const row = await db.maybeOne<{
    id: number;
    caption: string;
    title: string | null;
    image_url: string | null;
    hashtags: string | null;
    blog_slug: string | null;
  }>("SELECT * FROM social_posts WHERE id = $1", [postId]);
  if (!row) throw new Error("Post not found");

  const caption = [row.caption, row.hashtags ? row.hashtags.split(",").map((tag) => `#${tag.replace(/^#/, "")}`).join(" ") : ""]
    .filter(Boolean)
    .join("\n\n");
  const post: MarketingPost = {
    caption,
    imageUrl: row.image_url,
    videoUrl: null,
    menuItems: [],
    preparationNotes: "",
  };

  let facebook: { ok: boolean; error?: string } = { ok: false };
  let instagram: { ok: boolean; error?: string } = { ok: false };
  let facebookId: string | null = null;
  let instagramId: string | null = null;

  try {
    const fb = await publishFacebookMarketingPost(post);
    facebook = { ok: true };
    facebookId = fb.postId;
  } catch (error) {
    facebook = { ok: false, error: error instanceof Error ? error.message : "Facebook publish failed" };
  }
  try {
    const ig = await publishInstagramPost(post);
    instagram = { ok: true };
    instagramId = ig.postId;
  } catch (error) {
    instagram = { ok: false, error: error instanceof Error ? error.message : "Instagram publish failed" };
  }

  const anyOk = facebook.ok || instagram.ok;
  await db.query(
    `UPDATE social_posts SET status = $1, facebook_post_id = $2, instagram_post_id = $3,
       published_at = CASE WHEN $1 = 'published' THEN now() ELSE published_at END,
       result = $4, updated_at = now() WHERE id = $5`,
    [
      anyOk ? "published" : "failed",
      facebookId,
      instagramId,
      JSON.stringify({ facebook, instagram, actor, at: new Date().toISOString() }),
      postId,
    ],
  );

  let blogUrl: string | null = null;
  if (row.blog_slug) {
    await db.query(
      `UPDATE blog_posts SET status = 'published',
         published_at = COALESCE(published_at, now()), updated_at = now()
       WHERE slug = $1 AND status = 'draft'`,
      [row.blog_slug],
    ).catch(() => null);
    blogUrl = `/blog/${row.blog_slug}`;
  }

  return {
    ok: anyOk,
    socialPostId: postId,
    facebook,
    instagram,
    blog: { published: Boolean(blogUrl), url: blogUrl },
  };
}

/**
 * Send today's menu to the opted-in list and log every attempt.
 *
 * This is the one-click broadcast. It refuses to run when the WhatsApp channel
 * is in sandbox mode only if `requireLive` is set — otherwise it records the
 * exact message it *would* have sent, which is what a rebuild needs to verify
 * the copy without messaging customers.
 */
export async function broadcastTodayMenu(
  db: Db,
  options: { actor: string; baseUrl: string; limit?: number; requireLive?: boolean },
): Promise<{
  menu: TodayMenu;
  body: string;
  recipients: number;
  sent: number;
  failed: number;
  sandbox: boolean;
  logId: number;
  attempts: { waId: string; ok: boolean; sandbox: boolean; error?: string }[];
}> {
  const menu = await todayMenu(db, options.baseUrl);
  const zones = await listDeliveryZones(db);
  const zoneNote =
    zones.length > 0
      ? `Delivery: ${zones.map((zone) => `${zone.name} (${zone.postcodes})`).join(" · ")}. Minimum order applies per area.`
      : undefined;
  const body = menuBroadcastBody(menu, zoneNote);
  const recipients = await broadcastRecipients(db, options.limit ?? 500);

  const attempts: { waId: string; ok: boolean; sandbox: boolean; error?: string }[] = [];
  let sent = 0;
  let failed = 0;
  let sandbox = false;

  for (const recipient of recipients) {
    const to = normalisePhone(recipient.wa_id);
    if (!to) continue;
    if (options.requireLive) {
      const { whatsappConfig } = await import("../whatsapp/client");
      const config = await whatsappConfig();
      if (!config.configured) {
        throw new Error(
          "WhatsApp is not configured, so the broadcast would not reach anyone. Fix the credentials first or run it in preview mode.",
        );
      }
    }
    const result = await sendWhatsAppText({ db, to, body, system: true });
    sandbox = sandbox || result.sandbox;
    if (result.ok) sent += 1;
    else failed += 1;
    attempts.push({
      waId: to,
      ok: result.ok,
      sandbox: result.sandbox,
      error: result.error,
    });
  }

  const log = await db.one<{ id: number }>(
    `INSERT INTO broadcast_logs (kind, body, recipients, sent, failed, skipped, sandbox, detail, actor)
     VALUES ('todays_menu',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      body,
      recipients.length,
      sent,
      failed,
      Math.max(0, recipients.length - sent - failed),
      sandbox || !(sent > 0),
      JSON.stringify({ attempts, date: menu.date, dishes: menu.totalDishes }),
      options.actor,
    ],
  );

  return {
    menu,
    body,
    recipients: recipients.length,
    sent,
    failed,
    sandbox: sandbox || !(sent > 0),
    logId: log.id,
    attempts,
  };
}

/** Everything the marketing console renders. */
export async function marketingSnapshot(db: Db) {
  const [posts, broadcasts, blogs] = await Promise.all([
    db.query<{
      id: number;
      kind: string;
      title: string | null;
      caption: string;
      status: string;
      created_at: string;
      facebook_post_id: string | null;
      instagram_post_id: string | null;
    }>(
      `SELECT id, kind, title, caption, status, created_at::text, facebook_post_id, instagram_post_id
         FROM social_posts ORDER BY id DESC LIMIT 20`,
    ),
    db.query<{
      id: number;
      kind: string;
      recipients: number;
      sent: number;
      failed: number;
      sandbox: boolean;
      created_at: string;
    }>(
      `SELECT id, kind, recipients, sent, failed, sandbox, created_at::text
         FROM broadcast_logs ORDER BY id DESC LIMIT 10`,
    ),
    db.query<{ slug: string; title: string; status: string; published_at: string | null }>(
      `SELECT slug, title, status, published_at::text FROM blog_posts ORDER BY id DESC LIMIT 10`,
    ),
  ]);
  return { posts, broadcasts, blogs };
}
