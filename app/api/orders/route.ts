import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createOrder, OrderError, type CartLineInput } from "@/lib/orders";
import { getCustomerSession } from "@/lib/auth/customer";
import { publicBaseUrl } from "@/lib/url";
import type { Channel } from "@/lib/pricing";
import { isPaymentOption } from "@/lib/payments";

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
  paymentOption?: string;
  quoteToken?: string;
  promoCode?: string;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
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
  if (body.paymentOption && !isPaymentOption(body.paymentOption)) {
    return NextResponse.json(
      { error: "Unknown payment option" },
      { status: 400 },
    );
  }

  const db = await getDb();
  // The account comes from the signed cookie — never from the request body, or
  // anyone could place orders against someone else's history.
  const session = await getCustomerSession();
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
      paymentOption: body.paymentOption,
      quoteToken: body.quoteToken,
      promoCode: body.promoCode,
      deliveryLat: body.deliveryLat,
      deliveryLng: body.deliveryLng,
      customerId: session?.id ?? null,
      items: body.items.map((item) => ({
        itemId: Number(item.itemId),
        variantId: Number(item.variantId),
        qty: Number(item.qty),
        spiceLevel: item.spiceLevel ?? null,
        notes: item.notes ?? null,
      })),
    });

    const trackingPath = result.trackingToken
      ? `/t/${result.trackingToken}`
      : `/order/${result.order.code}`;
    return NextResponse.json(
      {
        code: result.order.code,
        totalCents: result.order.total_cents,
        paymentStatus: result.order.payment_status,
        trackingToken: result.trackingToken,
        trackingPath,
        trackingUrl: `${publicBaseUrl(request)}${trackingPath}`,
        redirectUrl: result.redirectUrl ?? null,
        redirectTo: result.redirectUrl ?? `${trackingPath}?new=1`,
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
