import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createDriverCredential,
  verifyDriverCredential,
  setDriverOnline,
  getDriverCredential,
  updateDriverCredentialPassword,
  logDocumentAttachment,
  getSoundNotificationSetting,
  getTrackingIntervalSetting,
} from "@/lib/driver-credentials";
import { DriverError } from "@/lib/drivers";
import { getDriver } from "@/lib/drivers";
import { trackingSnapshot } from "@/lib/drivers";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    const body = await request.json();

    // /api/driver/auth/login
    if (path === "/api/driver/auth/login") {
      const { email, password } = body;
      const db = await getDb();
      const credential = await verifyDriverCredential(db, email, password);
      if (!credential) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }
      const driver = await getDriver(db, credential.driver_id);
      if (!driver) {
        return NextResponse.json(
          { error: "Driver account not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        credentialId: credential.id,
        driverId: driver.id,
        driverCode: driver.code,
        driverName: `${driver.first_name} ${driver.last_name}`,
        online: credential.online,
        soundNotification: await getSoundNotificationSetting(db),
        trackingIntervalKm: await getTrackingIntervalSetting(db),
      });
    }

    // /api/driver/auth/online
    if (path === "/api/driver/auth/online") {
      const { credentialId, online } = body;
      const db = await getDb();
      await setDriverOnline(db, credentialId, online);
      return NextResponse.json({ success: true });
    }

    // /api/driver/auth/password
    if (path === "/api/driver/auth/password") {
      const { credentialId, currentPassword, newPassword } = body;
      const db = await getDb();
      const credential = await getDriverCredential(db, credentialId);
      if (!credential) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 }
        );
      }
      // Note: verifyPassword logic from lib/auth/password
      const { verifyPassword } = await import("@/lib/auth/password");
      if (!verifyPassword(currentPassword, credential.password_hash)) {
        return NextResponse.json(
          { error: "Current password incorrect" },
          { status: 401 }
        );
      }
      await updateDriverCredentialPassword(db, credentialId, newPassword);
      return NextResponse.json({ success: true });
    }

    // /api/driver/auth/document
    if (path === "/api/driver/auth/document") {
      const { credentialId, documentId, action, notes } = body;
      const db = await getDb();
      const credential = await getDriverCredential(db, credentialId);
      if (!credential) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 }
        );
      }
      const driverId = credential.driver_id;
      await logDocumentAttachment(
        db,
        driverId,
        documentId,
        action,
        notes || `Document ${action} by driver credential ${credentialId}`,
        `driver_${credentialId}`,
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Unknown endpoint" },
      { status: 404 }
    );
  } catch (error: any) {
    const status = error instanceof DriverError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status }
    );
  }
}
