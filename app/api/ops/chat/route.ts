import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { chatKey } from "@/lib/chat/crypto";
import { addMessage, readMessages, type Conversation } from "@/lib/chat/service";
import { recordAction, withActionLog } from "@/lib/ops/actions";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const session = await getApiSession(["admin", "manager", "counter"]);
  if (!session) return reply({ error: "Not authorised" }, 401);
  const url = new URL(request.url); const archive = url.searchParams.get("archive") === "1";
  if (archive && session.role !== "admin") return reply({ error: "Not authorised" }, 403);
  try {
    chatKey(); const db = await getDb(); const id = url.searchParams.get("id");
    if (!id) {
      const chats = await db.query<Conversation>(`SELECT id,status,handoff_at,handoff_after_message_id,created_at,updated_at FROM chat_conversations ${archive ? "" : "WHERE status='waiting'"} ORDER BY updated_at DESC LIMIT 100`);
      return reply({ chats });
    }
    const chat = await db.maybeOne<Conversation>("SELECT id,status,handoff_at,handoff_after_message_id,created_at,updated_at FROM chat_conversations WHERE id=$1", [id]);
    if (!chat || (!archive && (chat.status !== "waiting" || chat.handoff_after_message_id === null))) return reply({ error: "Not found" }, 404);
    const messages = await readMessages(db, id, archive ? null : chat.handoff_after_message_id);
    await recordAction(db, { component: "chat", action: archive ? "archive_read" : "handoff_read", actor: session.email, actorRole: session.role, outcome: "ok", target: `chat:${id}` });
    return reply({ chat, messages });
  } catch { return reply({ error: "Chat is unavailable" }, 503); }
}
async function post(request: Request) {
  const session = await getApiSession(["admin", "manager", "counter"]);
  if (!session) return reply({ error: "Not authorised" }, 401);
  try { if (new URL(request.headers.get("origin") ?? "").host !== request.headers.get("host")) return reply({ error: "Invalid origin" }, 403); } catch { return reply({ error: "Invalid origin" }, 403); }
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return reply({ error: "Request too large" }, 413);
  let body: { id?: unknown; action?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (typeof body.id !== "string" || body.id.length > 40) return reply({ error: "Invalid conversation" }, 400);
  try {
    chatKey(); const db = await getDb();
    if (body.action !== "close" && !(body.action === "reply" && typeof body.text === "string" && body.text.trim() && body.text.length <= 1500)) return reply({ error: "Invalid request" }, 400);
    const changed = await db.transaction(async (tx) => {
      const chat = await tx.maybeOne<Conversation>("SELECT id,status,handoff_at,handoff_after_message_id,created_at,updated_at FROM chat_conversations WHERE id=$1 FOR UPDATE", [body.id]);
      if (!chat || chat.status !== "waiting") return false;
      if (body.action === "close") await tx.run("UPDATE chat_conversations SET status='closed', updated_at=now() WHERE id=$1", [chat.id]);
      else {
        const count = await tx.one<{ count: number }>("SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id=$1", [chat.id]);
        if (count.count >= 100) return false;
        await addMessage(tx, chat.id, "staff", (body.text as string).trim());
      }
      return true;
    });
    return changed ? reply({ ok: true }) : reply({ error: "Conversation is closed or has reached its message limit" }, 409);
  } catch { return reply({ error: "Chat is unavailable" }, 503); }
}
// The chat component is redacted by the action logger; it never records message text.
export const POST = withActionLog("chat", post);
