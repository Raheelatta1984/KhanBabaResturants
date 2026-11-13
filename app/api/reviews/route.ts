import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Body = {
  itemId?: number;
  customerName?: string;
  rating?: number;
  comment?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const itemId = Number(body.itemId);
  const rating = Number(body.rating);
  const name = (body.customerName ?? "").trim().slice(0, 40);
  const comment = (body.comment ?? "").trim().slice(0, 400);

  if (!Number.isInteger(itemId))
    return NextResponse.json({ error: "Unknown dish" }, { status: 400 });
  if (name.length < 2)
    return NextResponse.json(
      { error: "Please add your name" },
      { status: 400 },
    );
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "Choose a rating from 1 to 5" },
      { status: 400 },
    );
  }

  const db = await getDb();
  const item = await db.maybeOne(
    "SELECT id FROM menu_items WHERE id = $1 AND published",
    [itemId],
  );
  if (!item)
    return NextResponse.json({ error: "Dish not found" }, { status: 404 });

  const requiresApproval =
    (await getSetting("reviews_require_approval", "1")) === "1";
  await db.query(
    "INSERT INTO reviews (item_id, customer_name, rating, comment, status) VALUES ($1, $2, $3, $4, $5)",
    [
      itemId,
      name,
      rating,
      comment || null,
      requiresApproval ? "pending" : "published",
    ],
  );

  return NextResponse.json({ ok: true, requiresApproval }, { status: 201 });
}
