import { timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db";

/** A missing or weak secret never permits a cleanup request. */
export function authorisedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
/** Delete bounded batches, atomically rechecking the last activity. Cascades to messages. */
export async function pruneExpiredChats(db: Db): Promise<number> {
  const removed = await db.query<{ id: string }>(`DELETE FROM chat_conversations WHERE id IN (
    SELECT id FROM chat_conversations WHERE updated_at < now() - interval '7 days'
    ORDER BY updated_at LIMIT 10000 FOR UPDATE SKIP LOCKED
  ) AND updated_at < now() - interval '7 days' RETURNING id`);
  await db.run("DELETE FROM chat_rate_limits WHERE minute_bucket < now() - interval '1 day'");
  await db.run("DELETE FROM chat_ai_quota WHERE hour_bucket < now() - interval '1 day'");
  return removed.length;
}
