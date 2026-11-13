import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSettings, settingValue } from "./settings";

/**
 * Dish photography storage.
 *
 * Four interchangeable drivers, chosen per upload:
 *
 *  - `supabase` Supabase Storage (`SUPABASE_URL` + a secret key +
 *             `SUPABASE_STORAGE_BUCKET`, default `menu-photos`). Public bucket
 *             URL served from Supabase's CDN — the default on this deployment.
 *  - `blob`   Vercel Blob (`BLOB_READ_WRITE_TOKEN`). Public CDN URL, survives
 *             redeploys.
 *  - `gdrive` Google Drive. Requires a service account
 *             (`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, base64 or raw JSON) and a
 *             folder shared with that service account's email
 *             (`GOOGLE_DRIVE_FOLDER_ID`). Photos are made readable by link and
 *             served straight from Google's CDN.
 *  - `local`  `<repo>/data/uploads` served by `/api/media/[name]`. Local dev and
 *             self-hosting only: a Vercel function filesystem is read-only and
 *             per-instance, so this driver is never selected there unless forced.
 *
 * Set `MEDIA_DRIVER=supabase|blob|gdrive|local` to force one; with `auto` the
 * first configured driver wins (supabase → blob → gdrive → local).
 */

export type MediaDriver = "supabase" | "blob" | "gdrive" | "local";

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

// ------------------------------- Supabase ----------------------------------

/**
 * Supabase renamed "service_role" to "secret" keys. Both work in the same
 * `Authorization` header for server-side Storage calls, so accept either name.
 */
export function supabaseStorageKey(): string {
  for (const key of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = (process.env[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function supabaseUrl(): string {
  return (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function supabaseBucket(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET ?? "").trim() || "menu-photos";
}

export function supabaseStorageConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseStorageKey());
}

/** Public URL for an object in the (public) photos bucket. */
export function supabasePublicUrl(objectPath: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/${supabaseBucket()}/${objectPath}`;
}

function supabaseHeaders(contentType?: string): Record<string, string> {
  const key = supabaseStorageKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    apikey: key,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

/**
 * Upload one object to Supabase Storage, creating the public bucket the first
 * time (a fresh project has no buckets, and "create it in the dashboard" is an
 * easy step to miss from a deploy log).
 */
async function uploadToSupabase(input: {
  bytes: Buffer;
  objectPath: string;
  contentType: string;
}): Promise<string> {
  const base = supabaseUrl();
  if (!base) throw new Error("SUPABASE_URL is not configured");

  const put = async () =>
    fetch(
      `${base}/storage/v1/object/${supabaseBucket()}/${input.objectPath}`,
      {
        method: "POST",
        headers: supabaseHeaders(input.contentType),
        body: new Uint8Array(input.bytes),
      },
    );

  let response = await put();

  if (response.status === 404) {
    // Bucket missing: create it as public with the same type/size rules the app
    // enforces, then retry once.
    const created = await fetch(`${base}/storage/v1/bucket`, {
      method: "POST",
      headers: supabaseHeaders("application/json"),
      body: JSON.stringify({
        id: supabaseBucket(),
        name: supabaseBucket(),
        public: true,
        file_size_limit: MAX_UPLOAD_BYTES,
        allowed_mime_types: Object.keys(ALLOWED),
      }),
    });
    if (!created.ok && created.status !== 409) {
      const detail = await created.text().catch(() => "");
      throw new Error(
        `Supabase bucket "${supabaseBucket()}" is missing and could not be created (${created.status}) ${detail.slice(0, 200)}`,
      );
    }
    response = await put();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Supabase Storage rejected the upload (${response.status}) ${detail.slice(0, 200)}`,
    );
  }

  return supabasePublicUrl(input.objectPath);
}

// --------------------------------- Others -----------------------------------

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

  const hasSupabase = supabaseStorageConfigured();
  const hasBlob = blobConfigured();
  const hasDrive = Boolean(
    driveServiceAccount() && driveFolderId(settingsDriver, settingsFolderId),
  );

  const choose = (): MediaDriver => {
    if (prefer === "supabase") return "supabase";
    if (prefer === "blob") return "blob";
    if (prefer === "gdrive") return "gdrive";
    if (prefer === "local") return "local";
    if (hasSupabase) return "supabase";
    if (hasBlob) return "blob";
    if (hasDrive) return "gdrive";
    return "local";
  };

  const driver = choose();
  const configured =
    driver === "supabase"
      ? hasSupabase
      : driver === "blob"
        ? hasBlob
        : driver === "gdrive"
          ? hasDrive
          : true;

  const detail =
    driver === "supabase"
      ? hasSupabase
        ? `Supabase Storage — photos are stored in the "${supabaseBucket()}" bucket and served from Supabase's CDN.`
        : "Supabase Storage selected but SUPABASE_URL / SUPABASE_SECRET_KEY is missing."
      : driver === "blob"
        ? hasBlob
          ? "Vercel Blob — photos are stored durably and served from the Vercel CDN."
          : "Vercel Blob selected but BLOB_READ_WRITE_TOKEN is missing."
        : driver === "gdrive"
          ? hasDrive
            ? "Google Drive — photos are uploaded to your Drive folder and served from Google."
            : "Google Drive selected but GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_FOLDER_ID is missing."
          : isServerless()
            ? "Local disk — this host has no persistent disk, so uploaded photos disappear when the instance restarts. Configure Supabase Storage before uploading real photography."
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

  if (config.driver === "supabase") {
    const objectPath = `menu/${filename}`;
    const url = await uploadToSupabase({
      bytes: input.bytes,
      objectPath,
      contentType: input.contentType,
    });
    return { url, filename, driver: "supabase" };
  }

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
