import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Fail closed: never fall back to a shared, derived or development key. */
export function chatKey(): Buffer {
  const encoded = process.env.CHAT_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) throw new Error("Chat encryption key is not configured");
  return Buffer.from(encoded, "hex");
}
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function encryptMessage(text: string, conversation: string, sender: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chatKey(), iv);
  cipher.setAAD(Buffer.from(`${conversation}:${sender}`));
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}
export function decryptMessage(value: string, conversation: string, sender: string): string {
  const [version, iv, tag, body, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra !== undefined) throw new Error("Invalid encrypted message");
  const cipher = createDecipheriv("aes-256-gcm", chatKey(), Buffer.from(iv, "base64"));
  cipher.setAAD(Buffer.from(`${conversation}:${sender}`));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([cipher.update(Buffer.from(body, "base64")), cipher.final()]).toString("utf8");
}
