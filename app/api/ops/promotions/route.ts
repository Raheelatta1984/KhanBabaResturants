import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import {
  createPromotion,
  PromotionError,
  setPromotionActive,
} from "@/lib/promotions";

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
  const action = String(body.action ?? "create");
  try {
    if (action === "toggle") {
      await setPromotionActive(
        db,
        Number(body.id),
        body.active === true || body.active === "1",
      );
      return NextResponse.json({ ok: true });
    }
    if (action !== "create")
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const id = await createPromotion(db, {
      code: String(body.code ?? ""),
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      audience: String(body.audience ?? "customer"),
      kind: String(body.kind ?? "percent"),
      value: Number(body.value ?? 0),
      maxDiscountCents: Number(body.maxDiscountCents ?? 0),
      minSubtotalCents: Number(body.minSubtotalCents ?? 0),
      channels: String(body.channels ?? ""),
      driverId: body.driverId ? Number(body.driverId) : null,
      startsAt: body.startsAt ? String(body.startsAt) : null,
      endsAt: body.endsAt ? String(body.endsAt) : null,
      usageLimit: Number(body.usageLimit ?? 0),
      perCustomerLimit: Number(body.perCustomerLimit ?? 0),
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    if (error instanceof PromotionError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Promotion action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 },
    );
  }
}
