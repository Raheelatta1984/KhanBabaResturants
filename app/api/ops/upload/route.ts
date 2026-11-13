import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import {
  extensionFor,
  mediaConfig,
  saveImage,
  MAX_UPLOAD_BYTES,
} from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Dish photography upload.
 *
 * The bytes go to whichever driver is configured (Vercel Blob, Google Drive or
 * local disk — see lib/media.ts) and the response carries the URL to store on
 * the dish. The response also says which driver ran, so the admin editor can
 * warn when the photo is only stored on local disk.
 */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "Choose an image to upload" },
      { status: 400 },
    );
  }

  const type = file.type || "";
  const extension = extensionFor(type);
  if (!extension) {
    return NextResponse.json(
      { error: "Use a JPG, PNG, WebP or AVIF image" },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Images must be under 6 MB" },
      { status: 413 },
    );
  }

  const config = await mediaConfig();
  if (!config.configured) {
    return NextResponse.json({ error: config.detail }, { status: 503 });
  }

  try {
    const stored = await saveImage({
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: type,
      extension,
    });
    return NextResponse.json(
      {
        ok: true,
        url: stored.url,
        filename: stored.filename,
        driver: stored.driver,
        note: config.detail,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("image upload failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not store that image",
      },
      { status: 502 },
    );
  }
}

/** Which driver is active — shown in the admin dish editor before uploading. */
export async function GET() {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const config = await mediaConfig();
  return NextResponse.json({
    driver: config.driver,
    configured: config.configured,
    detail: config.detail,
    durable: config.driver !== "local",
  });
}
