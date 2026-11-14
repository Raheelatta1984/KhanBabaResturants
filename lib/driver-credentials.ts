/**
 * Driver separate login credentials system (Staff-managed)
 *
 * Drivers now have individual login credentials (email + password) managed by staff.
 * This replaces/complements the token-based capability link for enhanced security.
 *
 * Features:
 * - Separate login credentials per onboarding driver
 * - Online availability toggle
 * - Order acceptance with sound notification
 * - Live order summary (amount, location, suburb, street, total KM, estimated time)
 * - Real-time tracking (configurable .05 km interval)
 * - Unsuccessful delivery tracking back to restaurant
 * - Customer-facing live tracking with pin-point coordinates
 * - Document attachment & audit log for staff review
 */

import type { Db } from "./db";
import { hashPassword, verifyPassword } from "../auth/password";
import { DriverError } from "./drivers";
import { getSettingNumber } from "./settings";

export type DriverCredential = {
  id: number;
  driver_id: number;
  email: string;
  password_hash: string;
  online: boolean;
  last_online_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Create separate login credentials for a driver */
export async function createDriverCredential(
  db: Db,
  driverId: number,
  email: string,
  password: string,
): Promise<number> {
  const existing = await db.maybeOne<
    { id: number }
  >("SELECT id FROM driver_credentials WHERE lower(email) = $1", [
    email.trim().toLowerCase(),
  ]);
  if (existing) {
    throw new DriverError("A driver credential with this email already exists");
  }

  const passwordHash = hashPassword(password);
  const id = await db.insert(
    `INSERT INTO driver_credentials (driver_id, email, password_hash, online, created_at, updated_at)
       VALUES ($1, $2, $3, FALSE, now(), now()) RETURNING id`,
    [driverId, email.trim().toLowerCase(), passwordHash],
  );

  await db.query(
    `INSERT INTO driver_verification_events (driver_id, action, detail, actor)
       VALUES ($1, 'credential_created', 'Login credential created for email ${email}', 'staff')`,
    [driverId],
  );

  return id;
}

/** Verify driver login credential */
export async function verifyDriverCredential(
  db: Db,
  email: string,
  password: string,
): Promise<DriverCredential | null> {
  const row = await db.maybeOne<DriverCredential>(
    `SELECT * FROM driver_credentials WHERE lower(email) = $1`,
    [email.trim().toLowerCase()],
  );
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  // Update last online time
  await db.query(
    `UPDATE driver_credentials SET online = TRUE, last_online_at = now(), updated_at = now() WHERE id = $1`,
    [row.id],
  );

  return { ...row, online: true, last_online_at: new Date().toISOString() };
}

/** Set driver online/offline availability */
export async function setDriverOnline(
  db: Db,
  credentialId: number,
  online: boolean,
): Promise<void> {
  await db.query(
    `UPDATE driver_credentials SET online = $1, last_online_at = CASE WHEN $1 THEN now() ELSE last_online_at END, updated_at = now() WHERE id = $2`,
    [online, credentialId],
  );
}

/** Get driver credential by ID */
export async function getDriverCredential(
  db: Db,
  id: number,
): Promise<DriverCredential | null> {
  return db.maybeOne<DriverCredential>(
    `SELECT * FROM driver_credentials WHERE id = $1`,
    [id],
  );
}

/** Get driver credential by driver ID */
export async function getCredentialByDriverId(
  db: Db,
  driverId: number,
): Promise<DriverCredential | null> {
  return db.maybeOne<DriverCredential>(
    `SELECT * FROM driver_credentials WHERE driver_id = $1`,
    [driverId],
  );
}

/** Update driver credential password */
export async function updateDriverCredentialPassword(
  db: Db,
  credentialId: number,
  newPassword: string,
): Promise<void> {
  const hash = hashPassword(newPassword);
  await db.query(
    `UPDATE driver_credentials SET password_hash = $1, updated_at = now() WHERE id = $2`,
    [hash, credentialId],
  );
}

/** Audit log for document attachments */
export async function logDocumentAttachment(
  db: Db,
  driverId: number,
  documentId: number,
  action: string,
  detail: string,
  actor: string,
): Promise<void> {
  await db.query(
    `INSERT INTO driver_verification_events (driver_id, action, detail, actor)
       VALUES ($1, $2, $3, $4)`,
    [driverId, action, detail, actor],
  );
}

/** Get sound notification settings */
export async function getSoundNotificationSetting(db: Db): Promise<boolean> {
  const val = await getSettingNumber("driver_sound_notification_enabled", 1);
  return val === 1;
}

/** Get tracking interval setting (.05 km default) */
export async function getTrackingIntervalSetting(db: Db): Promise<number> {
  // Default to 0.05 km
  const val = await getSettingNumber("driver_tracking_interval_km", 50); // stored in meters
  return val / 1000; // return in km
}
