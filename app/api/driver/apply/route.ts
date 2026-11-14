import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createDriverApplication, DriverError } from "@/lib/drivers";

export const dynamic = "force-dynamic";

/** Public driver onboarding application (no login required). */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  try {
    const db = await getDb();
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
      baseLat: num(body.baseLat),
      baseLng: num(body.baseLng),
      maxRadiusKm: num(body.maxRadiusKm) ?? 15,
      notes: String(body.notes ?? ""),
      termsAccepted: body.termsAccepted === true,
      privacyAccepted: body.privacyAccepted === true,
      documents:
        typeof body.documents === "object" && body.documents
          ? (body.documents as Record<string, string>)
          : {},
    });
    return NextResponse.json(
      {
        ok: true,
        code: result.code,
        message:
          "Application received. The delivery team will verify your documents before approval.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DriverError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Driver application failed", error);
    return NextResponse.json(
      { error: "We could not submit that application. Please try again." },
      { status: 500 },
    );
  }
}
