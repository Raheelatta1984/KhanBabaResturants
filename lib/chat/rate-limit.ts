import { createHmac } from "node:crypto";
import type { Db } from "@/lib/db";
import { chatKey } from "./crypto";

/** Vercel supplies its own client-IP header; don't trust a browser-supplied XFF. */
export function clientHash(headers: Headers): string | null {
  const ip = process.env.VERCEL ? headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : "local";
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip) && ip !== "local") return null;
  return createHmac("sha256", chatKey()).update(`chat-rate:${ip}`).digest("hex");
}
export async function allowChatRequest(db: Db, hash: string): Promise<boolean> {
  const row = await db.maybeOne<{ requests: number }>(`INSERT INTO chat_rate_limits(client_hash,minute_bucket,requests)
    VALUES ($1,date_trunc('minute',now()),1)
    ON CONFLICT (client_hash,minute_bucket) DO UPDATE SET requests=chat_rate_limits.requests+1
    WHERE chat_rate_limits.requests < 30 RETURNING requests`, [hash]);
  return row !== null;
}
