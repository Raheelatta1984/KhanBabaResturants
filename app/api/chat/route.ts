import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { chatKey, tokenHash } from "@/lib/chat/crypto";
import { addMessage, readMessages, type Conversation } from "@/lib/chat/service";
import { askAssistant } from "@/lib/chat/assistant";
import { allowChatRequest, clientHash } from "@/lib/chat/rate-limit";

export const dynamic = "force-dynamic";
const COOKIE = "kb_chat";
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function sameOrigin(request: Request) {
  try { return new URL(request.headers.get("origin") ?? "").host === request.headers.get("host"); } catch { return false; }
}
async function current(db: Awaited<ReturnType<typeof getDb>>) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.maybeOne<Conversation>("SELECT id,status,handoff_at,handoff_after_message_id,created_at,updated_at FROM chat_conversations WHERE token_hash=$1", [tokenHash(token)]);
}
export async function GET() {
  try {
    chatKey();
    const db = await getDb(); const chat = await current(db);
    if (!chat) return reply({ chat: null, messages: [] });
    return reply({ chat, messages: await readMessages(db, chat.id) });
  } catch { return reply({ error: "Chat is unavailable. Please call the restaurant." }, 503); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return reply({ error: "Request too large" }, 413);
  let body: { action?: unknown; text?: unknown; consent?: unknown };
  try { body = await request.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  try {
    chatKey(); const db = await getDb();
    const hash = clientHash(request.headers);
    if (!hash || !(await allowChatRequest(db, hash))) return reply({ error: "Too many requests, or client identity unavailable. Please try later or call us." }, 429);
    let chat = await current(db);
    if (body.action === "start") {
      if (process.env.NODE_ENV === "production" && (process.env.CRON_SECRET?.length ?? 0) < 32) return reply({ error: "Chat retention is not configured. Please call the restaurant." }, 503);
      if (body.consent !== true) return reply({ error: "Consent is required" }, 400);
      if (chat && chat.status !== "closed") return reply({ ok: true });
      const token = randomBytes(32).toString("hex"); const id = randomUUID();
      await db.run("INSERT INTO chat_conversations (id,token_hash) VALUES ($1,$2)", [id, tokenHash(token)]);
      const result = reply({ ok: true });
      result.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/chat", maxAge: 60 * 60 * 24 * 7 });
      return result;
    }
    if (!chat) return reply({ error: "Start a conversation first" }, 401);
    const chatId = chat.id;
    return await db.transaction(async (tx) => {
      const locked = await tx.maybeOne<Conversation>("SELECT id,status,handoff_at,handoff_after_message_id,created_at,updated_at FROM chat_conversations WHERE id=$1 FOR UPDATE", [chatId]);
      if (!locked || locked.status === "closed") return reply({ error: "This conversation has ended" }, 409);
      if (body.action === "handoff") {
        if (locked.status === "ai") await tx.run("UPDATE chat_conversations SET status='waiting', handoff_at=now(), handoff_after_message_id=(SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE conversation_id=$1), updated_at=now() WHERE id=$1", [chatId]);
        return reply({ ok: true });
      }
      if (body.action === "close") {
        await tx.run("UPDATE chat_conversations SET status='closed', updated_at=now() WHERE id=$1", [chatId]);
        return reply({ ok: true });
      }
      if (body.action !== "message" || typeof body.text !== "string" || !body.text.trim() || body.text.length > 1500) return reply({ error: "Enter a message of up to 1500 characters" }, 400);
      const count = await tx.one<{ count: number }>("SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id=$1", [chatId]);
      if (count.count >= 100) return reply({ error: "Conversation limit reached; please start a new one or call us." }, 429);
      if (locked.status === "ai") {
        if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_CHAT_MODEL) return reply({ error: "AI is not configured. You can request staff or call us." }, 503);
        // Atomic, shared hourly ceiling limits provider costs even if new sessions are created.
        const quota = await tx.maybeOne<{ calls: number }>(`INSERT INTO chat_ai_quota (hour_bucket,calls) VALUES (date_trunc('hour',now()),1) ON CONFLICT (hour_bucket) DO UPDATE SET calls=chat_ai_quota.calls+1 WHERE chat_ai_quota.calls < 60 RETURNING calls`);
        if (!quota) return reply({ error: "AI is busy. Please request staff or try later." }, 429);
      }
      await addMessage(tx, chatId, "customer", body.text.trim());
      if (locked.status === "ai") {
        try { const answer = await askAssistant(tx, await readMessages(tx, chatId)); await addMessage(tx, chatId, "assistant", answer); }
        catch { return reply({ error: "AI could not respond. Your message was saved; please try again or request staff." }, 503); }
      }
      return reply({ ok: true });
    });
  } catch { return reply({ error: "Chat is unavailable. Please call the restaurant." }, 503); }
}
