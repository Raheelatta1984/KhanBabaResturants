import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/url";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/counter", "/kitchen", "/delivery", "/staff", "/order", "/api"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
