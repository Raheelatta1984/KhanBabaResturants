import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getUploadsDir } from "@/lib/db/paths";
import { getApiSession } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Dish photography upload — files live under data/uploads and are served by /api/media. */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Choose an image to upload" }, { status: 400 });
  }

  const type = file.type || "";
  const extension = ALLOWED[type];
  if (!extension) {
    return NextResponse.json({ error: "Use a JPG, PNG, WebP or AVIF image" }, { status: 415 });
  }
  if (file.size > 6 * 1024 * 1024) {
    return NextResponse.json({ error: "Images must be under 6 MB" }, { status: 413 });
  }

  const dir = getUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(dir, filename), buffer);

  return NextResponse.json({ ok: true, url: `/api/media/${filename}`, filename }, { status: 201 });
}
