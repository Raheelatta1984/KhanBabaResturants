import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/auth/customer";
import {
  getChatSuggestions,
  parseCartSnapshot,
} from "@/lib/chat/recommendations";

export const dynamic = "force-dynamic";

const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });

function sameOrigin(request: Request): boolean {
  try {
    return (
      new URL(request.headers.get("origin") ?? "").host ===
      request.headers.get("host")
    );
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    // Customer identity comes strictly from the verified signed session cookie —
    // never from query parameters, headers or request body.
    const customer = await getCurrentCustomer(db);
    const url = new URL(request.url);
    const cart = parseCartSnapshot(url.searchParams.get("cart") ?? "");
    const { payload } = await getChatSuggestions(db, {
      customerId: customer?.id ?? null,
      cart,
    });
    return reply(payload);
  } catch {
    return reply({ error: "Suggestions are currently unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 8192) {
    return reply({ error: "Request too large" }, 413);
  }
  let body: { cart?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  try {
    const db = await getDb();
    // Strictly ignore any customerId/email fields in the body; only use the
    // server-verified customer session cookie.
    const customer = await getCurrentCustomer(db);
    const cart = parseCartSnapshot(body.cart);
    const { payload } = await getChatSuggestions(db, {
      customerId: customer?.id ?? null,
      cart,
    });
    return reply(payload);
  } catch {
    return reply({ error: "Suggestions are currently unavailable." }, 503);
  }
}
