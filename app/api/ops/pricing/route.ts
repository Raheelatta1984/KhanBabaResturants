import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const action = String(body.action ?? "");

  try {
    if (action === "rule-update") {
      const id = Number(body.id);
      const value = Number(body.value);
      const active = body.active !== false && body.active !== 0;
      if (!Number.isInteger(id) || !Number.isFinite(value) || value < 0) {
        return NextResponse.json(
          { error: "Invalid rule value" },
          { status: 400 },
        );
      }
      await db.query(
        "UPDATE pricing_rules SET value = $1, active = $2 WHERE id = $3",
        [value, active, id],
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "rule-create") {
      const code = String(body.code ?? "").trim();
      const label = String(body.label ?? "").trim();
      const kind = String(body.kind ?? "peak");
      const calc = body.calc === "flat" ? "flat" : "percent";
      if (!label)
        return NextResponse.json(
          { error: "Rule label is required" },
          { status: 400 },
        );
      if (!["weekend", "public_holiday", "priority", "peak"].includes(kind)) {
        return NextResponse.json(
          { error: "Unknown rule type" },
          { status: 400 },
        );
      }
      const id = await db.insert(
        `INSERT INTO pricing_rules (code, label, kind, calc, value, applies_to, days, start_time, end_time, min_subtotal_cents, description, active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, TRUE, 60)
         RETURNING id`,
        [
          code || `rule_${Date.now()}`,
          label,
          kind,
          calc,
          Number(body.value ?? 0),
          String(body.appliesTo ?? "delivery,pickup"),
          body.days ? String(body.days) : null,
          body.startTime ? String(body.startTime) : null,
          body.endTime ? String(body.endTime) : null,
          body.description ? String(body.description) : null,
        ],
      );
      return NextResponse.json({ ok: true, id }, { status: 201 });
    }

    if (action === "holiday-add") {
      const date = String(body.date ?? "").trim();
      const name = String(body.name ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return NextResponse.json(
          { error: "Use YYYY-MM-DD for the date" },
          { status: 400 },
        );
      if (name.length < 2)
        return NextResponse.json(
          { error: "Holiday name is required" },
          { status: 400 },
        );
      const percent =
        body.percent === "" || body.percent == null
          ? null
          : Number(body.percent);
      await db.query(
        `INSERT INTO holidays (date, name, surcharge_percent) VALUES ($1, $2, $3)
         ON CONFLICT (date) DO UPDATE SET name = excluded.name, surcharge_percent = excluded.surcharge_percent, active = TRUE`,
        [date, name, Number.isFinite(percent as number) ? percent : null],
      );
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (action === "holiday-delete") {
      await db.query("DELETE FROM holidays WHERE id = $1", [Number(body.id)]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not update pricing",
      },
      { status: 400 },
    );
  }
}
