import { headers } from "next/headers";

/** Best-effort absolute base URL for QR codes, payment redirects and webhooks. */
function normalise(value: string): string {
  return value.startsWith("http") ? value.replace(/\/$/, "") : `https://${value.replace(/\/$/, "")}`;
}

export async function getBaseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return normalise(process.env.PUBLIC_BASE_URL);
  // Vercel sets these without needing request headers (used by sitemap/QR codes).
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return normalise(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (process.env.VERCEL_URL) return normalise(process.env.VERCEL_URL);
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    /* not in a request scope */
  }
  return "http://localhost:3000";
}
