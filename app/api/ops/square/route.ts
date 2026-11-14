import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import {
  pullSquarePayments,
  pushOrderToSquare,
  squareStatus,
  syncSquare,
  testSquareConnection,
} from "@/lib/integrations/square";

export const dynamic = "force-dynamic";

/** Detached Square POS bridge: status + manual/test/sync actions. */
export async function GET() {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const db = await getDb();
  const [status, records, transactions] = await Promise.all([
    squareStatus(db),
    db.query(
      "SELECT * FROM square_sync_records ORDER BY id DESC LIMIT 40",
    ),
    db.query(
      "SELECT * FROM square_transactions ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT 40",
    ),
  ]);
  return NextResponse.json({ status, records, transactions });
}

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  let body: { action?: string; orderCode?: string; sinceDays?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const db = await getDb();
  const action = String(body.action ?? "sync");
  try {
    switch (action) {
      case "test": {
        const result = await testSquareConnection();
        return NextResponse.json(result);
      }
      case "push_order": {
        if (!body.orderCode)
          return NextResponse.json(
            { error: "Choose an order" },
            { status: 400 },
          );
        const result = await pushOrderToSquare(db, body.orderCode);
        return NextResponse.json(result);
      }
      case "pull": {
        const imported = await pullSquarePayments(db, Number(body.sinceDays) || 7);
        return NextResponse.json({ ok: true, imported });
      }
      case "sync":
      default: {
        const result = await syncSquare(db, {
          sinceDays: Number(body.sinceDays) || 7,
        });
        return NextResponse.json({ ok: true, ...result });
      }
    }
  } catch (error) {
    console.error("Square action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Square action failed" },
      { status: 500 },
    );
  }
}
