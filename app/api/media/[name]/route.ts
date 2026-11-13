import fs from "node:fs";
import path from "node:path";
import { getUploadsDir } from "@/lib/db/paths";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/** Serves uploaded dish photography from the data directory. */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return new Response("Not found", { status: 404 });

  const file = path.join(getUploadsDir(), name);
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
