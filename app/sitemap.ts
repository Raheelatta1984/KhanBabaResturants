import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { getBaseUrl } from "@/lib/url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getBaseUrl();
  const db = getDb();
  const items = db.prepare("SELECT slug, updated_at FROM menu_items WHERE published = 1").all() as {
    slug: string;
    updated_at: string;
  }[];

  return [
    { url: base, lastModified: new Date(), priority: 1 },
    { url: `${base}/menu`, lastModified: new Date(), priority: 0.9 },
    { url: `${base}/whats-new`, lastModified: new Date(), priority: 0.6 },
    ...items.map((item) => ({
      url: `${base}/menu/${item.slug}`,
      lastModified: new Date(item.updated_at.replace(" ", "T") + "Z"),
      priority: 0.7,
    })),
  ];
}

export const dynamic = "force-dynamic";
