import { createSign } from "node:crypto";
import { driveServiceAccount } from "./media";

/**
 * Google Drive uploader using a service account — no SDK, just the two REST
 * calls involved (OAuth2 JWT grant + multipart upload).
 *
 * Setup (one time):
 *   1. Google Cloud console → create a project → enable the **Google Drive API**.
 *   2. Create a **service account** and download its JSON key.
 *   3. In Google Drive, create a folder (e.g. "Khan Baba menu photos"), share it
 *      with the service account's `client_email` as **Editor**, and copy the
 *      folder id out of the URL.
 *   4. Set `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (the whole JSON, base64 or raw)
 *      and `GOOGLE_DRIVE_FOLDER_ID` in Vercel / `.env.local`.
 *
 * Files are made readable by anyone with the link, so the browser can load them
 * directly from Google's CDN (`lh3.googleusercontent.com`).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000)
    return tokenCache.token;

  const account = driveServiceAccount();
  if (!account)
    throw new Error("Google Drive service account is not configured");

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claim));
  const signature = base64url(
    createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(account.private_key),
  );

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${signature}`,
    }),
    cache: "no-store",
  });
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(
      `Google Drive auth failed: ${json.error_description ?? response.status}`,
    );
  }
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export async function uploadToDrive(input: {
  bytes: Buffer;
  filename: string;
  contentType: string;
  folderId: string;
}): Promise<{ id: string; url: string }> {
  if (!input.folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set");
  const token = await accessToken();

  // Multipart upload: metadata part + media part in one request.
  const boundary = `khanbaba${Date.now().toString(36)}`;
  const metadata = JSON.stringify({
    name: input.filename,
    parents: [input.folderId],
    mimeType: input.contentType,
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`,
    ),
    input.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const upload = await fetch(
    `${UPLOAD_URL}?uploadType=multipart&fields=id,webContentLink,thumbnailLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      cache: "no-store",
    },
  );
  const uploaded = (await upload.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!upload.ok || !uploaded.id) {
    throw new Error(
      `Google Drive upload failed: ${uploaded.error?.message ?? upload.status}`,
    );
  }

  // Make the photo readable by anyone with the link so the storefront can <img src> it.
  const share = await fetch(`${DRIVE_API}/files/${uploaded.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
    cache: "no-store",
  });
  if (!share.ok) {
    const detail = (await share.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      `Google Drive permission update failed: ${detail.error?.message ?? share.status}`,
    );
  }

  return {
    id: uploaded.id,
    url: `${DRIVE_API}/files/${uploaded.id}?alt=media`,
  };
}

/** Remove a Drive photo (best effort — an orphaned file is not worth failing an edit). */
export async function deleteFromDrive(fileId: string): Promise<void> {
  try {
    const token = await accessToken();
    await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    /* ignore */
  }
}
