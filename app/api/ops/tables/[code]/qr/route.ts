import QRCode from "qrcode";
import { getBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/** Downloadable SVG QR code for a table, pointing at the table ordering portal. */
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  if (!/^[A-Za-z0-9-]{2,10}$/.test(code)) return new Response("Invalid table", { status: 400 });
  const url = new URL(request.url);
  const target = url.searchParams.get("target") || `${await getBaseUrl()}/table/${code.toUpperCase()}`;
  const svg = await QRCode.toString(target, {
    type: "svg",
    margin: 2,
    width: 512,
    color: { dark: "#0a0908", light: "#ffffff" },
  });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `attachment; filename="khan-baba-${code.toUpperCase()}-qr.svg"`,
      "Cache-Control": "no-store",
    },
  });
}
