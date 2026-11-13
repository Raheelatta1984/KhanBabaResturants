import { headers } from "next/headers";

/** Best-effort absolute base URL for QR codes, payment redirects and webhooks. */
export async function getBaseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
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
