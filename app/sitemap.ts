import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { getBaseUrl } from "@/lib/url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getBaseUrl();
  const db = await getDb();
  const items = await db.query<{ slug: string; updated_at: string }>(
    "SELECT slug, updated_at FROM menu_items WHERE published",
  );

  return [
    { url: base, lastModified: new Date(), priority: 1 },
    { url: `${base}/menu`, lastModified: new Date(), priority: 0.9 },
    { url: `${base}/track`, lastModified: new Date(), priority: 0.7 },
    { url: `${base}/login`, lastModified: new Date(), priority: 0.5 },
    { url: `${base}/whats-new`, lastModified: new Date(), priority: 0.6 },
    { url: `${base}/music`, lastModified: new Date(), priority: 0.6 },
    ...items.map((item) => ({
      url: `${base}/menu/${item.slug}`,
      lastModified: new Date(item.updated_at),
      priority: 0.7,
    })),
  ];
}

export const dynamic = "force-dynamic";
