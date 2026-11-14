import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { priceCart } from "@/lib/cart";
import { computePricing, type Channel } from "@/lib/pricing";
import { quoteDelivery } from "@/lib/delivery";
import { addressHash, signQuote } from "@/lib/quotes";
import { getSettingNumber } from "@/lib/settings";
import { validatePromotion, PromotionError } from "@/lib/promotions";
import { coordinate, estimateCoordinates, SYDNEY_CBD } from "@/lib/geo";

export const dynamic = "force-dynamic";

type Body = {
  channel?: Channel;
  items?: { variantId: number; qty: number }[];
  address?: string;
  suburb?: string;
  postcode?: string;
  priority?: boolean;
  customerName?: string;
  phone?: string;
  notes?: string;
  promoCode?: string;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
};

/** Pricing + live courier quote preview for the checkout. */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const channel: Channel =
    body.channel && ["delivery", "pickup", "dine_in"].includes(body.channel)
      ? body.channel
      : "delivery";
  const db = await getDb();

  try {
    const { subtotalCents } = await priceCart(db, body.items ?? []);

    if (channel === "delivery") {
      const minOrder = await getSettingNumber("delivery_min_order_cents", 2500);
      if (subtotalCents < minOrder) {
        return NextResponse.json(
          {
            error: `Delivery minimum is $${(minOrder / 100).toFixed(2)} — add a little more to your order.`,
            shortfallCents: minOrder - subtotalCents,
          },
          { status: 422 },
        );
      }
    }

    const hasAddress = Boolean(body.address && body.address.trim().length >= 5);
    let delivery = null;
    let quoteToken: string | undefined;

    if (channel === "delivery" && hasAddress) {
      const fallback = estimateCoordinates(
        body.address ?? "",
        body.suburb ?? "",
        body.postcode ?? "",
        SYDNEY_CBD,
      );
      delivery = await quoteDelivery({
        orderCode: "QUOTE",
        customerName: body.customerName || "Guest",
        phone: body.phone,
        dropoffAddress: body.address!.trim(),
        dropoffSuburb: body.suburb,
        dropoffPostcode: body.postcode,
        dropoffNotes: body.notes,
        dropoffLat: coordinate(body.deliveryLat) ?? fallback.lat,
        dropoffLng: coordinate(body.deliveryLng) ?? fallback.lng,
        orderValueCents: subtotalCents,
      });
      quoteToken = signQuote({
        provider: delivery.provider,
        quoteId: delivery.providerQuoteId,
        costCents: delivery.costCents,
        customerFeeCents: delivery.customerFeeCents,
        etaMinutes: delivery.etaMinutes,
        expiresAt: delivery.expiresAt,
        live: delivery.live,
        addressHash: addressHash(
          `${body.address ?? ""}|${body.suburb ?? ""}|${body.postcode ?? ""}`,
        ),
      });
    }

    // A promo code is checked here for the preview AND again when the order
    // is created, so a tampered client cannot get a discount for free.
    let promotion: {
      code: string;
      label: string;
      discountCents: number;
      kind: string;
    } | null = null;
    let promotionError: string | null = null;
    if (body.promoCode?.trim()) {
      try {
        const check = await validatePromotion(db, body.promoCode, {
          subtotalCents,
          channel,
          deliveryFeeCents: delivery?.customerFeeCents ?? 0,
        });
        promotion = {
          code: check.promotion.code,
          label: check.label,
          discountCents: check.discountCents,
          kind: check.promotion.kind,
        };
      } catch (error) {
        promotionError =
          error instanceof PromotionError
            ? error.message
            : "Could not apply that promotion";
      }
    }

    const pricing = await computePricing(db, {
      subtotalCents,
      channel,
      priority: Boolean(body.priority),
      delivery,
      discountCents: promotion?.discountCents ?? 0,
      promotionLabel: promotion?.label,
    });

    return NextResponse.json({
      pricing,
      promotion,
      promotionError,
      quoteToken,
      delivery: delivery
        ? {
            provider: delivery.provider,
            feeCents: delivery.customerFeeCents,
            costCents: delivery.costCents,
            serviceFeeCents: delivery.serviceFeeCents,
            etaMinutes: delivery.etaMinutes,
            live: delivery.live,
            expiresAt: delivery.expiresAt,
            distanceKm:
              (delivery.raw as { distanceKm?: number } | undefined)
                ?.distanceKm ?? null,
            fallbackReason:
              (delivery.raw as { fallbackReason?: string } | undefined)
                ?.fallbackReason ?? null,
          }
        : null,
      addressRequired: channel === "delivery" && !hasAddress,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not price your order",
      },
      { status: 400 },
    );
  }
}
