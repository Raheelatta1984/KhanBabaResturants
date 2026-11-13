import fs from "node:fs";
import { localUploadPath } from "@/lib/media";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/**
 * Serves locally-stored dish photography (the `local` media driver).
 * Photos on Vercel Blob or Google Drive have absolute URLs and never come here.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!/^[a-zA-Z0-9._-]+$/.test(name))
    return new Response("Not found", { status: 404 });

  const file = localUploadPath(name);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });

  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[extension] ?? "application/octet-stream";
  const data = fs.readFileSync(file);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
