import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/auth/customer";
import { chatKey, tokenHash } from "@/lib/chat/crypto";
import {
  addMessage,
  publicConversation,
  readMessages,
  type ConversationRecord,
} from "@/lib/chat/service";
import { askAssistant, isAiChatConfigured } from "@/lib/chat/assistant";
import {
  getChatSuggestions,
  parseCartSnapshot,
} from "@/lib/chat/recommendations";
import { allowChatRequest, clientHash } from "@/lib/chat/rate-limit";

export const dynamic = "force-dynamic";
const COOKIE = "kb_chat";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
  });

function sameOrigin(request: Request) {
  try {
    return (
      new URL(request.headers.get("origin") ?? "").host ===
      request.headers.get("host")
    );
  } catch {
    return false;
  }
}

async function current(
  db: Awaited<ReturnType<typeof getDb>>,
  customerId: number | null,
): Promise<ConversationRecord | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db.maybeOne<ConversationRecord>(
    "SELECT id,status,handoff_at,handoff_after_message_id,customer_id,created_at,updated_at FROM chat_conversations WHERE token_hash=$1",
    [tokenHash(token)],
  );
  if (!row) return null;
  // A conversation associated with a signed-in customer must never be readable
  // after logout or by a different signed-in customer on the same browser.
  if (row.customer_id !== null && row.customer_id !== customerId) return null;
  return row;
}

export async function GET() {
  const aiEnabled = isAiChatConfigured();
  try {
    chatKey();
    const db = await getDb();
    const customer = await getCurrentCustomer(db);
    const chat = await current(db, customer?.id ?? null);
    if (!chat) return reply({ aiEnabled, chat: null, messages: [] });
    return reply({
      aiEnabled,
      chat: publicConversation(chat),
      messages: await readMessages(db, chat.id),
    });
  } catch {
    return reply(
      { error: "Chat is unavailable. Please call the restaurant." },
      503,
    );
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 8192)
    return reply({ error: "Request too large" }, 413);
  let body: {
    action?: unknown;
    text?: unknown;
    consent?: unknown;
    mode?: unknown;
    cart?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  const aiEnabled = isAiChatConfigured();
  try {
    chatKey();
    const db = await getDb();
    const hash = clientHash(request.headers);
    if (!hash || !(await allowChatRequest(db, hash))) {
      return reply(
        {
          error:
            "Too many requests, or client identity unavailable. Please try later or call us.",
        },
        429,
      );
    }
    const customer = await getCurrentCustomer(db);
    const currentCustomerId = customer?.id ?? null;
    const chat = await current(db, currentCustomerId);

    if (body.action === "start") {
      if (
        process.env.NODE_ENV === "production" &&
        (process.env.CRON_SECRET?.length ?? 0) < 32
      ) {
        return reply(
          { error: "Chat retention is not configured. Please call the restaurant." },
          503,
        );
      }
      if (body.consent !== true)
        return reply({ error: "Consent is required" }, 400);
      const startWithStaff = !aiEnabled || body.mode === "staff";
      if (chat && chat.status !== "closed") {
        let status = chat.status;
        if (startWithStaff && chat.status === "ai") {
          const count = await db.one<{ count: number }>(
            "SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id=$1",
            [chat.id],
          );
          if (Number(count.count) === 0) {
            await db.run(
              "UPDATE chat_conversations SET status='waiting', handoff_at=now(), handoff_after_message_id=0, updated_at=now() WHERE id=$1",
              [chat.id],
            );
            status = "waiting";
          }
        }
        return reply({ ok: true, aiEnabled, status });
      }
      const token = randomBytes(32).toString("hex");
      const id = randomUUID();
      if (startWithStaff) {
        await db.run(
          "INSERT INTO chat_conversations (id,token_hash,status,handoff_at,handoff_after_message_id,customer_id) VALUES ($1,$2,'waiting',now(),0,$3)",
          [id, tokenHash(token), currentCustomerId],
        );
      } else {
        await db.run(
          "INSERT INTO chat_conversations (id,token_hash,status,customer_id) VALUES ($1,$2,'ai',$3)",
          [id, tokenHash(token), currentCustomerId],
        );
      }
      const result = reply({
        ok: true,
        aiEnabled,
        status: startWithStaff ? "waiting" : "ai",
      });
      result.cookies.set(COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/api/chat",
        maxAge: 60 * 60 * 24 * 7,
      });
      return result;
    }

    if (!chat) return reply({ error: "Start a conversation first" }, 401);
    const chatId = chat.id;
    return await db.transaction(async (tx) => {
      const locked = await tx.maybeOne<ConversationRecord>(
        "SELECT id,status,handoff_at,handoff_after_message_id,customer_id,created_at,updated_at FROM chat_conversations WHERE id=$1 FOR UPDATE",
        [chatId],
      );
      if (
        !locked ||
        (locked.customer_id !== null && locked.customer_id !== currentCustomerId)
      ) {
        return reply({ error: "Start a conversation first" }, 401);
      }
      if (locked.status === "closed")
        return reply({ error: "This conversation has ended" }, 409);

      if (body.action === "handoff") {
        if (locked.status === "ai") {
          await tx.run(
            "UPDATE chat_conversations SET status='waiting', handoff_at=now(), handoff_after_message_id=(SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE conversation_id=$1), updated_at=now() WHERE id=$1",
            [chatId],
          );
        }
        return reply({ ok: true, aiEnabled, status: "waiting" });
      }
      if (body.action === "close") {
        await tx.run(
          "UPDATE chat_conversations SET status='closed', updated_at=now() WHERE id=$1",
          [chatId],
        );
        return reply({ ok: true, aiEnabled, status: "closed" });
      }
      if (
        body.action !== "message" ||
        typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.length > 1500
      ) {
        return reply(
          { error: "Enter a message of up to 1500 characters" },
          400,
        );
      }
      const count = await tx.one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id=$1",
        [chatId],
      );
      if (Number(count.count) >= 100) {
        return reply(
          {
            error:
              "Conversation limit reached; please start a new one or call us.",
          },
          429,
        );
      }

      // Bind previously anonymous conversation to the signed-in customer once
      // they send a message while signed in so it cannot leak after logout.
      if (locked.customer_id === null && currentCustomerId !== null) {
        await tx.run(
          "UPDATE chat_conversations SET customer_id=$1 WHERE id=$2 AND customer_id IS NULL",
          [currentCustomerId, chatId],
        );
      }

      let effectiveStatus = locked.status;
      if (effectiveStatus === "ai" && !aiEnabled) {
        if (Number(count.count) === 0) {
          // Empty pre-existing AI session: safe to route directly to counter staff.
          await tx.run(
            "UPDATE chat_conversations SET status='waiting', handoff_at=now(), handoff_after_message_id=0, updated_at=now() WHERE id=$1",
            [chatId],
          );
          effectiveStatus = "waiting";
        } else {
          // Prior AI messages exist: require explicit handoff so pre-handoff AI
          // exchanges remain hidden from counter staff.
          return reply(
            {
              error:
                "AI assistant is currently offline. Click Talk to counter staff to continue with our team.",
            },
            503,
          );
        }
      }

      if (effectiveStatus === "ai") {
        // Atomic, shared hourly ceiling limits provider costs even if new sessions are created.
        const quota = await tx.maybeOne<{ calls: number }>(
          `INSERT INTO chat_ai_quota (hour_bucket,calls) VALUES (date_trunc('hour',now()),1) ON CONFLICT (hour_bucket) DO UPDATE SET calls=chat_ai_quota.calls+1 WHERE chat_ai_quota.calls < 60 RETURNING calls`,
        );
        if (!quota) {
          return reply(
            { error: "AI is busy. Please request counter staff or try later." },
            429,
          );
        }
      }

      await addMessage(tx, chatId, "customer", body.text.trim());

      if (effectiveStatus === "ai") {
        try {
          const { aiHint } = await getChatSuggestions(tx, {
            customerId: currentCustomerId,
            cart: parseCartSnapshot(body.cart),
          });
          const answer = await askAssistant(
            tx,
            await readMessages(tx, chatId),
            aiHint,
          );
          await addMessage(tx, chatId, "assistant", answer);
        } catch {
          return reply(
            {
              error:
                "AI could not respond. Your message was saved; please try again or request counter staff.",
            },
            503,
          );
        }
      }
      return reply({ ok: true, aiEnabled, status: effectiveStatus });
    });
  } catch {
    return reply(
      { error: "Chat is unavailable. Please call the restaurant." },
      503,
    );
  }
}
