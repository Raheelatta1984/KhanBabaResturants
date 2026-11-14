import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import {
  cancelOrder,
  completeOrder,
  confirmOrder,
  dispatchOrder,
  getOrderById,
  getOrderItems,
  getOrderByCode,
  markOrderPaid,
  markOrderReady,
  OrderError,
  refreshDeliveryQuote,
  setItemPrepState,
  syncDelivery,
} from "@/lib/orders";
import { createClaimToken } from "@/lib/auth/customer";
import { publicBaseUrl } from "@/lib/url";
import { parkOrder, unparkOrder, settleTableOrder } from "@/lib/dine-in";
import {
  notifyCounterNewOrder,
  notifyCustomerAccepted,
  requestOrderPayment,
} from "@/lib/whatsapp/orders";
import { sendFeedbackInvite } from "@/lib/feedback";
import { triggerTableEncouragement } from "@/lib/music";

export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  itemId?: number;
  state?: "queued" | "preparing" | "ready";
  method?: string;
  reason?: string;
  channel?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession([
    "admin",
    "manager",
    "counter",
    "kitchen",
    "delivery",
  ]);
  if (!session)
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const { id } = await context.params;
  const db = await getDb();
  // Accept either the numeric id or the human order code (KB-XXXX). Staff paste
  // codes from WhatsApp all day; making them look up a number is friction.
  let orderId = Number(id);
  if (!Number.isInteger(orderId)) {
    const byCode = await getOrderByCode(db, decodeURIComponent(id).toUpperCase());
    if (!byCode) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    orderId = byCode.id;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!(await getOrderById(db, orderId)))
    return NextResponse.json({ error: "Order not found" }, { status: 404 });

  try {
    switch (body.action) {
      case "confirm": {
        const order = await confirmOrder(db, orderId, session.name);
        if (order.phone) {
          await notifyCustomerAccepted(db, orderId, publicBaseUrl(request)).catch(() => null);
        }
        return NextResponse.json({
          ok: true,
          order,
          kitchenUrl: `/kitchen?focus=${order.code}`,
        });
      }
      case "paid": {
        const order = await markOrderPaid(
          db,
          orderId,
          session.name,
          body.method === "card" ? "card" : "cash",
        );
        return NextResponse.json({ ok: true, order });
      }
      case "item": {
        if (!body.itemId || !body.state)
          throw new OrderError("Item and state are required");
        const order = await setItemPrepState(
          db,
          orderId,
          Number(body.itemId),
          body.state,
          session.name,
        );
        return NextResponse.json({ ok: true, order });
      }
      case "ready": {
        const order = await markOrderReady(db, orderId, session.name);
        return NextResponse.json({ ok: true, order });
      }
      case "served":
      case "collected": {
        const order = await completeOrder(
          db,
          orderId,
          session.name,
          body.action === "served"
            ? "Served to the table"
            : "Collected by the customer",
        );
        return NextResponse.json({ ok: true, order });
      }
      case "delivered": {
        const order = await completeOrder(
          db,
          orderId,
          session.name,
          "Delivered — enjoy your meal",
        );
        return NextResponse.json({ ok: true, order });
      }
      case "cancel": {
        const order = await cancelOrder(
          db,
          orderId,
          session.name,
          body.reason || "Cancelled by staff",
        );
        return NextResponse.json({ ok: true, order });
      }
      case "park": {
        const order = await parkOrder(db, orderId, session.name, body.reason);
        return NextResponse.json({ ok: true, order });
      }
      case "unpark": {
        const order = await unparkOrder(db, orderId, session.name, body.reason);
        return NextResponse.json({ ok: true, order });
      }
      case "settle-table": {
        const result = await settleTableOrder(
          db,
          orderId,
          session.name,
          body.method === "card" ? "card" : "cash",
          publicBaseUrl(request),
        );
        return NextResponse.json({
          ok: true,
          order: result.order,
          feedbackUrl: result.feedbackUrl,
          whatsappSent: result.whatsappSent,
        });
      }
      case "payment-link": {
        const result = await requestOrderPayment(db, orderId, session.name, publicBaseUrl(request));
        return NextResponse.json({ ok: true, ...result });
      }
      case "feedback-invite": {
        const result = await sendFeedbackInvite(db, orderId, publicBaseUrl(request), {
          channel: body.channel === "link" ? "link" : "whatsapp",
        });
        return NextResponse.json({ ok: true, ...result });
      }
      case "notify-counter": {
        const order = await getOrderById(db, orderId);
        if (!order) throw new OrderError("Order not found", 404);
        const result = await notifyCounterNewOrder(
          db,
          order,
          await getOrderItems(db, orderId),
          publicBaseUrl(request),
        );
        return NextResponse.json({ ok: true, ...result });
      }
      case "encourage-music": {
        await triggerTableEncouragement(db, orderId, session.name);
        return NextResponse.json({ ok: true });
      }
      case "claim-link": {
        // A one-time link the counter can text so a guest can attach this order
        // to an account (and see it later without the code).
        const order = await db.one<{
          id: number;
          code: string;
          email: string | null;
        }>("SELECT id, code, email FROM orders WHERE id = $1", [orderId]);
        if (!order.email)
          throw new OrderError(
            "This order has no email on it, so there is nothing to verify against",
          );
        const token = await createClaimToken(db, order);
        if (!token) throw new OrderError("Could not create a claim link");
        return NextResponse.json({
          ok: true,
          claimUrl: `${publicBaseUrl(request)}/claim/${token}`,
          email: order.email,
        });
      }
      case "quote": {
        const job = await refreshDeliveryQuote(db, orderId, session.name);
        return NextResponse.json({ ok: true, job });
      }
      case "dispatch": {
        const job = await dispatchOrder(db, orderId, session.name);
        return NextResponse.json({ ok: true, job });
      }
      case "sync": {
        const job = await syncDelivery(db, orderId, session.name);
        return NextResponse.json({ ok: true, job });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("order action failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not complete that action",
      },
      { status: 500 },
    );
  }
}
