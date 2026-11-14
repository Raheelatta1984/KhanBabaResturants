import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import {
  approveDriver,
  assignDriverToJob,
  createDriverApplication,
  DriverError,
  getDriver,
  logVerification,
  settleDriverJob,
  setDriverStatus,
  updateDriverCommercials,
  verifyDriverDocument,
  type DriverRow,
} from "@/lib/drivers";

export const dynamic = "force-dynamic";

/** Driver management: verification, approval, commercials, assignment, payout. */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager", "delivery"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const db = await getDb();
  const actor = session.email;

  try {
    switch (action) {
      case "verify_document": {
        const status = String(body.status ?? "");
        if (!["verified", "rejected", "pending"].includes(status))
          return NextResponse.json(
            { error: "Unknown verification status" },
            { status: 400 },
          );
        await verifyDriverDocument(
          db,
          Number(body.documentId),
          status as "verified" | "rejected" | "pending",
          actor,
          String(body.notes ?? ""),
        );
        return NextResponse.json({ ok: true });
      }
      case "approve": {
        await approveDriver(db, Number(body.driverId), actor);
        return NextResponse.json({ ok: true });
      }
      case "status": {
        const status = String(body.status ?? "");
        if (!["pending", "under_review", "approved", "suspended", "rejected"].includes(status))
          return NextResponse.json({ error: "Unknown status" }, { status: 400 });
        if (status === "approved")
          await approveDriver(db, Number(body.driverId), actor);
        else
          await setDriverStatus(
            db,
            Number(body.driverId),
            status as DriverRow["status"],
            actor,
            String(body.reason ?? ""),
          );
        return NextResponse.json({ ok: true });
      }
      case "commercials": {
        await updateDriverCommercials(
          db,
          Number(body.driverId),
          {
            commissionPercent: Number(body.commissionPercent),
            perDeliveryFeeCents: Number(body.perDeliveryFeeCents),
            maxRadiusKm: Number(body.maxRadiusKm),
          },
          actor,
        );
        return NextResponse.json({ ok: true });
      }
      case "assign": {
        await assignDriverToJob(
          db,
          Number(body.jobId),
          Number(body.driverId),
          actor,
        );
        return NextResponse.json({ ok: true });
      }
      case "settle": {
        const result = await settleDriverJob(db, Number(body.jobId), actor);
        return NextResponse.json({ ok: Boolean(result), result });
      }
      case "payout": {
        const driverId = Number(body.driverId);
        const driver = await getDriver(db, driverId);
        if (!driver)
          return NextResponse.json({ error: "Driver not found" }, { status: 404 });
        const amount = await db.one<{ total: number }>(
          `SELECT COALESCE(SUM(amount_cents),0) AS total FROM driver_ledger
            WHERE driver_id = $1 AND settled_at IS NULL AND kind != 'payout'`,
          [driverId],
        );
        const cents = Number(amount.total);
        if (cents <= 0)
          return NextResponse.json({ error: "Nothing to pay out" }, { status: 400 });
        await db.query(
          "UPDATE driver_ledger SET settled_at = now() WHERE driver_id = $1 AND settled_at IS NULL AND kind != 'payout'",
          [driverId],
        );
        await db.query(
          `INSERT INTO driver_ledger (driver_id, kind, amount_cents, description, settled_at)
           VALUES ($1,'payout',$2,$3,now())`,
          [driverId, -cents, `Commission payout to ${driver.pay_id ?? driver.email}`],
        );
        await logVerification(
          db,
          driverId,
          "payout",
          `Paid $${(cents / 100).toFixed(2)} in delivery fees, commission and bonuses`,
          actor,
        );
        return NextResponse.json({ ok: true, amountCents: cents });
      }
      case "create": {
        const result = await createDriverApplication(db, {
          firstName: String(body.firstName ?? ""),
          lastName: String(body.lastName ?? ""),
          email: String(body.email ?? ""),
          phone: String(body.phone ?? ""),
          vehicleType: String(body.vehicleType ?? "car"),
          vehicleRego: String(body.vehicleRego ?? ""),
          vehicleMake: String(body.vehicleMake ?? ""),
          licenceNumber: String(body.licenceNumber ?? ""),
          licenceState: String(body.licenceState ?? ""),
          licenceExpiry: String(body.licenceExpiry ?? ""),
          insuranceProvider: String(body.insuranceProvider ?? ""),
          insuranceExpiry: String(body.insuranceExpiry ?? ""),
          abn: String(body.abn ?? ""),
          rightToWorkCountry: String(body.rightToWorkCountry ?? ""),
          policeCheckRef: String(body.policeCheckRef ?? ""),
          payId: String(body.payId ?? ""),
          address: String(body.address ?? ""),
          suburb: String(body.suburb ?? ""),
          postcode: String(body.postcode ?? ""),
          baseLat: Number(body.baseLat) || null,
          baseLng: Number(body.baseLng) || null,
          maxRadiusKm: Number(body.maxRadiusKm) || 15,
          notes: String(body.notes ?? "Added by staff"),
          termsAccepted: true,
          privacyAccepted: true,
          documents: (body.documents ?? {}) as Record<string, string>,
        });
        return NextResponse.json({ ok: true, ...result }, { status: 201 });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof DriverError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Driver action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 },
    );
  }
}
