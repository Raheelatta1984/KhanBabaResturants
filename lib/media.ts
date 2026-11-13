import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSettings, settingValue } from "./settings";

/**
 * Dish photography storage.
 *
 * Three interchangeable drivers, chosen per upload:
 *
 *  - `blob`   Vercel Blob (`BLOB_READ_WRITE_TOKEN`). Public CDN URL, survives
 *             redeploys — the default on Vercel.
 *  - `gdrive` Google Drive. Requires a service account
 *             (`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, base64 or raw JSON) and a
 *             folder shared with that service account's email
 *             (`GOOGLE_DRIVE_FOLDER_ID`). Photos are made readable by link and
 *             served straight from Google's CDN.
 *  - `local`  `<repo>/data/uploads` served by `/api/media/[name]`. Local dev and
 *             self-hosting only: a Vercel function filesystem is read-only and
 *             per-instance, so this driver is never selected there unless forced.
 *
 * Set `MEDIA_DRIVER=blob|gdrive|local` to force one; with `auto` the first
 * configured driver wins (blob → gdrive → local).
 */

export type MediaDriver = "blob" | "gdrive" | "local";

export type StoredMedia = {
  url: string;
  filename: string;
  driver: MediaDriver;
  /** Set for Google Drive so a later delete can clean up. */
  fileId?: string;
};

export type MediaConfig = {
  driver: MediaDriver;
  configured: boolean;
  /** False when photos would live on a serverless instance's throwaway disk. */
  durable: boolean;
  /** Human explanation for the admin UI. */
  detail: string;
  /** Optional override stored in settings (Admin → Delivery & payments). */
  settingsDriver: string;
  settingsFolderId: string;
};

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export function extensionFor(contentType: string): string | null {
  return ALLOWED[contentType] ?? null;
}

function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY,
  );
}

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function driveServiceAccount(): {
  client_email: string;
  private_key: string;
} | null {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as {
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch {
    return null;
  }
}

export function driveFolderId(
  settingsDriver?: string,
  settingsFolderId?: string,
): string {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || settingsFolderId || "";
}

export async function driveConfigured(): Promise<boolean> {
  const settings = await getSettings();
  return Boolean(
    driveServiceAccount() &&
    driveFolderId(
      settings.media_driver,
      settingValue(settings, "gdrive_folder_id"),
    ),
  );
}

/** Which driver will handle the next upload, and why. */
export async function mediaConfig(): Promise<MediaConfig> {
  const settings = await getSettings();
  const settingsDriver = settingValue(settings, "media_driver", "auto");
  const settingsFolderId = settingValue(settings, "gdrive_folder_id", "");
  const forced = (process.env.MEDIA_DRIVER || "").toLowerCase();
  const prefer =
    forced || (settingsDriver !== "auto" ? settingsDriver : "auto");

  const hasBlob = blobConfigured();
  const hasDrive = Boolean(
    driveServiceAccount() && driveFolderId(settingsDriver, settingsFolderId),
  );

  const choose = (): MediaDriver => {
    if (prefer === "blob") return "blob";
    if (prefer === "gdrive") return "gdrive";
    if (prefer === "local") return "local";
    if (hasBlob) return "blob";
    if (hasDrive) return "gdrive";
    return "local";
  };

  const driver = choose();
  const configured =
    driver === "blob" ? hasBlob : driver === "gdrive" ? hasDrive : true;

  const detail =
    driver === "blob"
      ? hasBlob
        ? "Vercel Blob — photos are stored durably and served from the Vercel CDN."
        : "Vercel Blob selected but BLOB_READ_WRITE_TOKEN is missing."
      : driver === "gdrive"
        ? hasDrive
          ? "Google Drive — photos are uploaded to your Drive folder and served from Google."
          : "Google Drive selected but GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_FOLDER_ID is missing."
        : isServerless()
          ? "Local disk — this host has no persistent disk, so uploaded photos disappear when the instance restarts. Configure Vercel Blob or Google Drive before uploading real photography."
          : "Local disk — photos are written to data/uploads and served by /api/media.";

  const durable = driver !== "local" || !isServerless();
  return {
    driver,
    configured,
    durable,
    detail,
    settingsDriver,
    settingsFolderId,
  };
}

export async function mediaStorageSummary() {
  const config = await mediaConfig();
  return {
    driver: config.driver,
    configured: config.configured,
    durable: config.driver !== "local" || !isServerless(),
  };
}

function fileNameFor(extension: string): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${extension}`;
}

/** Store an image and return the URL a browser can load. */
export async function saveImage(input: {
  bytes: Buffer;
  contentType: string;
  extension: string;
}): Promise<StoredMedia> {
  const config = await mediaConfig();
  if (!config.configured) throw new Error(config.detail);
  const filename = fileNameFor(input.extension);

  if (config.driver === "blob") {
    const { put } = await import("@vercel/blob");
    const blob = await put(`khanbaba/menu/${filename}`, input.bytes, {
      access: "public",
      contentType: input.contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: blob.url, filename, driver: "blob" };
  }

  if (config.driver === "gdrive") {
    const { uploadToDrive } = await import("./media-gdrive");
    const uploaded = await uploadToDrive({
      bytes: input.bytes,
      filename,
      contentType: input.contentType,
      folderId: driveFolderId(config.settingsDriver, config.settingsFolderId),
    });
    return {
      url: uploaded.url,
      filename,
      driver: "gdrive",
      fileId: uploaded.id,
    };
  }

  const dir = path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), input.bytes);
  return { url: `/api/media/${filename}`, filename, driver: "local" };
}

/** Local files only — used by /api/media/[name]. */
export function localUploadPath(name: string): string {
  return path.join(process.cwd(), "data", "uploads", name);
}
