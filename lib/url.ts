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

/**
 * The same idea for route handlers, which already have the `Request` in hand
 * (so no `headers()` call is needed). Used for links we hand to customers:
 * tracking and claim links must point at the deployment they were created on,
 * not at `http://0.0.0.0:3000`.
 */
export function publicBaseUrl(request?: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL ?? "").trim();
  if (configured) return normalise(configured);
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return normalise(vercel);
  if (request) {
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto =
      request.headers.get("x-forwarded-proto") ??
      (host && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host)
        ? "http"
        : "https");
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}
