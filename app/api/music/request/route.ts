import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { submitMusicRequest, defaultRequestCharge } from "@/lib/music";
import { getSettings, settingValue } from "@/lib/settings";
import { money } from "@/lib/money";

export const dynamic = "force-dynamic";

type Body = {
  customerName?: string;
  title?: string;
  url?: string;
  phone?: string;
  email?: string;
  tableCode?: string;
  orderCode?: string;
  note?: string;
};

/**
 * A customer asks the room for a song. The URL is mandatory and validated, the
 * request lands as `pending`, and the counter decides whether it plays and
 * whether it costs anything.
 */
export async function POST(request: Request) {
  const db = await getDb();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const settings = await getSettings();
    if (settingValue(settings, "music_request_enabled", "1") === "0")
      return NextResponse.json({ error: "Song requests are closed right now" }, { status: 400 });

    let orderId: number | null = null;
    if (body.orderCode?.trim()) {
      const order = await db.maybeOne<{ id: number }>(
        "SELECT id FROM orders WHERE code = $1",
        [body.orderCode.trim().toUpperCase()],
      );
      orderId = order?.id ?? null;
    }

    const recent = await db.maybeOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM music_requests
        WHERE created_at > now() - interval '2 minutes'
          AND (($1 <> '' AND phone = $1) OR ($2 <> '' AND table_code = $2))`,
      [body.phone?.trim() ?? "", body.tableCode?.toUpperCase() ?? ""],
    );
    if (Number(recent?.c ?? 0) > 0)
      return NextResponse.json(
        { error: "One request at a time, please — the counter is already looking at your last one." },
        { status: 429 },
      );

    const pending = await submitMusicRequest(db, {
      customerName: body.customerName ?? "",
      title: body.title ?? "",
      url: body.url ?? "",
      phone: body.phone,
      email: body.email,
      tableCode: body.tableCode,
      orderId,
      note: body.note,
    });

    const requiresApproval =
      settingValue(settings, "music_request_requires_approval", "1") !== "0";
    const suggested = requiresApproval
      ? await defaultRequestCharge(db)
      : pending.charge_cents;
    return NextResponse.json(
      {
        ok: true,
        request: { id: pending.id, title: pending.title, status: pending.status },
        message: requiresApproval
          ? `Sent to the counter. On-demand songs are optional and may carry a charge (usually around ${money(suggested)}) — they will confirm before it plays.`
          : `Queued — the room will hear ${pending.title} shortly.`,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not send that request" },
      { status: 400 },
    );
  }
}
