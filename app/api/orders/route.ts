import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createOrder, OrderError, type CartLineInput } from "@/lib/orders";
import type { Channel } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type Body = {
  channel?: Channel;
  customerName?: string;
  phone?: string;
  email?: string;
  address?: string;
  suburb?: string;
  postcode?: string;
  notes?: string;
  tableCode?: string;
  priority?: boolean;
  paymentMethod?: "online" | "counter";
  paymentLast4?: string;
  quoteToken?: string;
  items?: (CartLineInput & { spiceLevel?: string })[];
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body.items?.length)
    return NextResponse.json({ error: "Your cart is empty" }, { status: 400 });
  if (
    body.paymentMethod &&
    !["online", "counter"].includes(body.paymentMethod)
  ) {
    return NextResponse.json(
      { error: "Unknown payment method" },
      { status: 400 },
    );
  }

  const db = await getDb();
  try {
    const result = await createOrder(db, {
      channel: body.channel ?? "delivery",
      customerName: body.customerName ?? "",
      phone: body.phone,
      email: body.email,
      address: body.address,
      suburb: body.suburb,
      postcode: body.postcode,
      notes: body.notes,
      tableCode: body.tableCode,
      priority: Boolean(body.priority),
      paymentMethod: body.paymentMethod ?? "online",
      paymentLast4: body.paymentLast4,
      quoteToken: body.quoteToken,
      items: body.items.map((item) => ({
        itemId: Number(item.itemId),
        variantId: Number(item.variantId),
        qty: Number(item.qty),
        spiceLevel: item.spiceLevel ?? null,
        notes: item.notes ?? null,
      })),
    });

    return NextResponse.json(
      {
        code: result.order.code,
        totalCents: result.order.total_cents,
        paymentStatus: result.order.payment_status,
        redirectUrl: result.redirectUrl ?? null,
        redirectTo: result.redirectUrl ?? `/order/${result.order.code}?new=1`,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("createOrder failed", error);
    return NextResponse.json(
      { error: "We could not place that order. Please try again." },
      { status: 500 },
    );
  }
}
