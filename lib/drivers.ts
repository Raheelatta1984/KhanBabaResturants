import type { Db } from "./db";
import {
  getSettingNumber,
  getSettings,
  settingNumber,
  settingValue,
} from "./settings";
import { getTimeParts } from "./time";
import { signToken, verifyToken } from "./auth/token";
import { driverPromotionBonus } from "./promotions";
import {
  estimateCoordinates,
  haversineKm,
  interpolate,
  pathKm,
  roadKm,
  SYDNEY_CBD,
  type LatLng,
} from "./geo";

/**
 * Driver partner lifecycle: onboarding → document verification → approval →
 * assignment → GPS tracking → commission settlement → ATO kilometre report.
 *
 * Nothing here is importable by the customer storefront: the only public
 * surface is a signed capability link for the driver and an application form.
 */

export class DriverError extends Error {
  status = 400;
}

export const REQUIRED_DOCUMENTS = [
  "photo_id",
  "licence",
  "insurance",
  "police_check",
  "right_to_work",
  "abn",
  "bank",
] as const;

export const DOCUMENT_LABELS: Record<string, string> = {
  photo_id: "Photo ID (passport / Australian photo card)",
  licence: "Driver licence (front & back)",
  insurance: "Vehicle insurance / CTP certificate",
  police_check: "National police check",
  right_to_work: "Right to work in Australia",
  abn: "ABN registration (sole trader)",
  bank: "Bank / PayID details for commission payouts",
  vehicle_photo: "Vehicle photo",
};

export type DriverRow = {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: "pending" | "under_review" | "approved" | "suspended" | "rejected";
  vehicle_type: string;
  vehicle_rego: string | null;
  vehicle_make: string | null;
  licence_number: string | null;
  licence_state: string | null;
  licence_expiry: string | null;
  insurance_provider: string | null;
  insurance_expiry: string | null;
  abn: string | null;
  right_to_work_country: string | null;
  police_check_ref: string | null;
  pay_id: string | null;
  address: string | null;
  suburb: string | null;
  postcode: string | null;
  base_lat: number | null;
  base_lng: number | null;
  current_lat: number | null;
  current_lng: number | null;
  commission_percent: number;
  per_delivery_fee_cents: number;
  max_radius_km: number;
  terms_accepted_at: string | null;
  privacy_accepted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
};

export type DriverDocumentRow = {
  id: number;
  driver_id: number;
  kind: string;
  reference: string | null;
  file_ref: string | null;
  status: "pending" | "submitted" | "verified" | "rejected";
  verified_by: string | null;
  verified_at: string | null;
  expires_on: string | null;
  notes: string | null;
};

/** Australian financial year label, e.g. 2026-27, in restaurant local time. */
export function financialYear(date = new Date()): string {
  const { iso } = getTimeParts(date);
  const [year, month] = iso.split("-").map(Number);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * ATO cents-per-kilometre determinations. The rate is stored on each trip so
 * old reports never change when a new rate is published; `ato_cents_per_km_current`
 * is the admin override for future years. The method is capped at 5,000 business
 * km per car per year — the report applies that cap too.
 */
export const ATO_RATES: Record<string, number> = {
  "2026-27": 91,
  "2025-26": 88,
  "2024-25": 88,
  "2023-24": 85,
  "2022-23": 78,
  "2021-22": 72,
  "2020-21": 72,
};
export const ATO_KM_CAP = 5000;

export async function atoRateCentsPerKm(fy: string): Promise<number> {
  return (
    ATO_RATES[fy] ?? (await getSettingNumber("ato_cents_per_km_current", 91))
  );
}

async function newDriverCode(db: Db): Promise<string> {
  const row = await db.one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM drivers",
  );
  return `DRV-${String(Number(row.c) + 1).padStart(4, "0")}`;
}

export type DriverApplication = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  vehicleType?: string;
  vehicleRego?: string;
  vehicleMake?: string;
  licenceNumber?: string;
  licenceState?: string;
  licenceExpiry?: string;
  insuranceProvider?: string;
  insuranceExpiry?: string;
  abn?: string;
  rightToWorkCountry?: string;
  policeCheckRef?: string;
  payId?: string;
  address?: string;
  suburb?: string;
  postcode?: string;
  baseLat?: number | null;
  baseLng?: number | null;
  maxRadiusKm?: number;
  notes?: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  /** Reference numbers supplied for each verification check. */
  documents?: Record<string, string>;
};

/** Public onboarding: create a pending application plus its verification checklist. */
export async function createDriverApplication(
  db: Db,
  input: DriverApplication,
): Promise<{ id: number; code: string }> {
  const email = (input.email ?? "").trim().toLowerCase();
  const phone = (input.phone ?? "").trim();
  const firstName = (input.firstName ?? "").trim();
  const lastName = (input.lastName ?? "").trim();
  if (firstName.length < 2 || lastName.length < 2)
    throw new DriverError("Please enter your full name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new DriverError("Enter a valid email address");
  if (phone.replace(/\D/g, "").length < 8)
    throw new DriverError("Enter a mobile number we can reach you on");
  if (!input.termsAccepted || !input.privacyAccepted)
    throw new DriverError("Please accept the driver terms and privacy policy");
  if ((await getSettingNumber("driver_onboarding_enabled", 1)) !== 1)
    throw new DriverError("Driver onboarding is currently closed");

  const existing = await db.maybeOne<{ id: number }>(
    "SELECT id FROM drivers WHERE lower(email) = $1",
    [email],
  );
  if (existing)
    throw new DriverError(
      "An application with this email already exists — contact the delivery team",
    );

  const code = await newDriverCode(db);
  const id = await db.transaction(async (tx) => {
    const driverId = await tx.insert(
      `INSERT INTO drivers (code, first_name, last_name, email, phone, status, vehicle_type,
        vehicle_rego, vehicle_make, licence_number, licence_state, licence_expiry,
        insurance_provider, insurance_expiry, abn, right_to_work_country, police_check_ref,
        pay_id, address, suburb, postcode, base_lat, base_lng, max_radius_km,
        terms_accepted_at, privacy_accepted_at, notes)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        now(), now(), $24) RETURNING id`,
      [
        code,
        firstName.slice(0, 80),
        lastName.slice(0, 80),
        email,
        phone.slice(0, 30),
        input.vehicleType || "car",
        input.vehicleRego || null,
        input.vehicleMake || null,
        input.licenceNumber || null,
        input.licenceState || null,
        input.licenceExpiry || null,
        input.insuranceProvider || null,
        input.insuranceExpiry || null,
        input.abn || null,
        input.rightToWorkCountry || null,
        input.policeCheckRef || null,
        input.payId || null,
        input.address || null,
        input.suburb || null,
        input.postcode || null,
        input.baseLat ?? null,
        input.baseLng ?? null,
        Number(input.maxRadiusKm) || 15,
        input.notes?.slice(0, 500) ?? null,
      ],
    );
    for (const kind of REQUIRED_DOCUMENTS) {
      const reference = input.documents?.[kind]?.trim() || null;
      await tx.query(
        `INSERT INTO driver_documents (driver_id, kind, reference, status)
         VALUES ($1, $2, $3, $4)`,
        [driverId, kind, reference, reference ? "submitted" : "pending"],
      );
    }
    await logVerification(
      tx,
      driverId,
      "application_submitted",
      `Onboarding application ${code} received; ${REQUIRED_DOCUMENTS.length} checks queued`,
      "driver",
    );
    return driverId;
  });
  return { id, code };
}

export async function logVerification(
  db: Db,
  driverId: number,
  action: string,
  detail: string,
  actor: string,
  documentId?: number,
): Promise<void> {
  await db.query(
    "INSERT INTO driver_verification_events (driver_id, action, detail, actor, document_id) VALUES ($1,$2,$3,$4,$5)",
    [driverId, action, detail, actor, documentId || null],
  );
}

export async function listDrivers(db: Db) {
  return db.query<
    DriverRow & {
      verified_count: number;
      completed_jobs: number;
      unpaid_cents: number;
      km_this_fy: number;
    }
  >(
    `SELECT d.*,
       (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.status = 'verified') AS verified_count,
       (SELECT COUNT(*) FROM delivery_jobs j WHERE j.driver_id = d.id AND j.status = 'delivered') AS completed_jobs,
       (SELECT COALESCE(SUM(l.amount_cents),0) FROM driver_ledger l
          WHERE l.driver_id = d.id AND l.settled_at IS NULL AND l.kind != 'payout') AS unpaid_cents,
       (SELECT COALESCE(SUM(t.distance_km),0) FROM driver_trips t
          WHERE t.driver_id = d.id AND t.financial_year = $1) AS km_this_fy
      FROM drivers d ORDER BY
        CASE d.status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
        d.created_at DESC`,
    [financialYear()],
  );
}

export async function getDriver(
  db: Db,
  id: number,
): Promise<DriverRow | null> {
  return db.maybeOne<DriverRow>("SELECT * FROM drivers WHERE id = $1", [id]);
}

export async function driverDocuments(
  db: Db,
  driverId: number,
): Promise<DriverDocumentRow[]> {
  return db.query<DriverDocumentRow>(
    "SELECT * FROM driver_documents WHERE driver_id = $1 ORDER BY id",
    [driverId],
  );
}

export async function driverEvents(db: Db, driverId: number) {
  return db.query<{
    id: number;
    action: string;
    detail: string | null;
    actor: string;
    created_at: string;
  }>(
    "SELECT * FROM driver_verification_events WHERE driver_id = $1 ORDER BY id DESC LIMIT 30",
    [driverId],
  );
}

/** Approve / reject one verification check. */
export async function verifyDriverDocument(
  db: Db,
  documentId: number,
  status: "verified" | "rejected" | "pending",
  actor: string,
  notes?: string,
): Promise<void> {
  const document = await db.maybeOne<DriverDocumentRow>(
    "SELECT * FROM driver_documents WHERE id = $1",
    [documentId],
  );
  if (!document) throw new DriverError("Document not found");
  await db.query(
    `UPDATE driver_documents SET status = $1, verified_by = $2,
      verified_at = CASE WHEN $1 = 'verified' THEN now() ELSE NULL END,
      notes = $3, updated_at = now() WHERE id = $4`,
    [status, actor, notes?.slice(0, 400) ?? null, documentId],
  );
  await logVerification(
    db,
    document.driver_id,
    `document_${status}`,
    `${DOCUMENT_LABELS[document.kind] ?? document.kind}: ${status}${
      notes ? ` — ${notes}` : ""
    }`,
    actor,
    documentId,
  );
  await db.query(
    `UPDATE drivers SET status = 'under_review', updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [document.driver_id],
  );
}

/** Only fully verified drivers can be approved for dispatch. */
export async function approveDriver(
  db: Db,
  driverId: number,
  actor: string,
): Promise<void> {
  const driver = await getDriver(db, driverId);
  if (!driver) throw new DriverError("Driver not found");
  const docs = await driverDocuments(db, driverId);
  const outstanding = REQUIRED_DOCUMENTS.filter(
    (kind) => !docs.some((doc) => doc.kind === kind && doc.status === "verified"),
  );
  if (outstanding.length > 0)
    throw new DriverError(
      `Verify every document first — outstanding: ${outstanding
        .map((kind) => DOCUMENT_LABELS[kind])
        .join(", ")}`,
    );
  await db.query(
    `UPDATE drivers SET status = 'approved', approved_at = now(), approved_by = $1,
      rejection_reason = NULL, updated_at = now() WHERE id = $2`,
    [actor, driverId],
  );
  await logVerification(
    db,
    driverId,
    "approved",
    "All verification checks passed — driver is now eligible for dispatch",
    actor,
  );
}

export async function setDriverStatus(
  db: Db,
  driverId: number,
  status: DriverRow["status"],
  actor: string,
  reason?: string,
): Promise<void> {
  await db.query(
    "UPDATE drivers SET status = $1, rejection_reason = $2, updated_at = now() WHERE id = $3",
    [status, reason?.slice(0, 300) ?? null, driverId],
  );
  await logVerification(
    db,
    driverId,
    `status_${status}`,
    reason || `Status changed to ${status}`,
    actor,
  );
}

export async function updateDriverCommercials(
  db: Db,
  driverId: number,
  input: { commissionPercent?: number; perDeliveryFeeCents?: number; maxRadiusKm?: number },
  actor: string,
): Promise<void> {
  const driver = await getDriver(db, driverId);
  if (!driver) throw new DriverError("Driver not found");
  await db.query(
    `UPDATE drivers SET commission_percent = $1, per_delivery_fee_cents = $2,
      max_radius_km = $3, updated_at = now() WHERE id = $4`,
    [
      Math.max(0, Math.min(100, Number(input.commissionPercent ?? driver.commission_percent))),
      Math.max(0, Math.round(Number(input.perDeliveryFeeCents ?? driver.per_delivery_fee_cents))),
      Math.max(1, Math.min(100, Number(input.maxRadiusKm ?? driver.max_radius_km))),
      driverId,
    ],
  );
  await logVerification(
    db,
    driverId,
    "commercials_updated",
    `Commission ${input.commissionPercent ?? driver.commission_percent}% · base ${input.perDeliveryFeeCents ?? driver.per_delivery_fee_cents}c · radius ${input.maxRadiusKm ?? driver.max_radius_km} km`,
    actor,
  );
}

/** Signed capability link — the driver's portal, no password to manage. */
export async function issueDriverToken(driver: DriverRow): Promise<string> {
  return signToken(
    { aud: "kb_driver", driverId: driver.id, code: driver.code },
    60 * 60 * 24 * 180,
  );
}

export async function verifyDriverToken(
  token: string,
): Promise<{ driverId: number; code: string } | null> {
  const payload = await verifyToken<{
    exp?: number;
    aud?: string;
    driverId?: number;
    code?: string;
  }>(token);
  if (!payload || payload.aud !== "kb_driver" || !payload.driverId) return null;
  return { driverId: Number(payload.driverId), code: String(payload.code ?? "") };
}

export async function assignDriverToJob(
  db: Db,
  jobId: number,
  driverId: number,
  actor: string,
): Promise<void> {
  const driver = await getDriver(db, driverId);
  if (!driver || driver.status !== "approved")
    throw new DriverError("Only approved drivers can be assigned");
  await db.query(
    "UPDATE delivery_jobs SET driver_id = $1 WHERE id = $2",
    [driverId, jobId],
  );
  await logVerification(
    db,
    driverId,
    "job_assigned",
    `Assigned to delivery job #${jobId}`,
    actor,
  );
}

/** GPS breadcrumb from the driver's phone; also refreshes their last position. */
export async function recordDriverPing(
  db: Db,
  driverId: number,
  input: {
    lat: number;
    lng: number;
    accuracyM?: number;
    heading?: number;
    speedKmh?: number;
    orderCode?: string;
    jobId?: number; // Optional for credential-based tracking
  },
): Promise<{ jobId: number | null; orderId: number | null }> {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new DriverError("Invalid GPS coordinates");
  
  // If jobId is provided (credential-based), use it; otherwise find the active job
  let job: { id: number; order_id: number; status: string } | null = null;
  if (input.jobId) {
    job = await db.maybeOne<{ id: number; order_id: number; status: string }>(
      `SELECT id, order_id, status FROM delivery_jobs WHERE id = $1`,
      [input.jobId],
    );
  } else {
    job = await db.maybeOne<{ id: number; order_id: number; status: string }>(
      `SELECT j.id, j.order_id, j.status FROM delivery_jobs j
        WHERE j.driver_id = $1 AND j.status IN ('requested','accepted','pickup','dropoff','returning')
        ORDER BY j.id DESC LIMIT 1`,
      [driverId],
    );
  }

  // Unsuccessful delivery tracking: if status is 'returning', continue tracking until returned to restaurant
  // The status will be updated to 'delivered' or 'failed' when the driver returns to restaurant
  // (handled by the client or a separate endpoint)

  await db.query(
    `INSERT INTO driver_location_pings (driver_id, order_id, job_id, lat, lng,
      accuracy_m, heading, speed_kmh, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'driver_app')`,
    [
      driverId,
      job?.order_id ?? null,
      job?.id ?? null,
      lat,
      lng,
      input.accuracyM ?? null,
      input.heading ?? null,
      input.speedKmh ?? null,
    ],
  );
  await db.query(
    "UPDATE drivers SET current_lat = $1, current_lng = $2, last_seen_at = now() WHERE id = $3",
    [lat, lng, driverId],
  );
  return { jobId: job?.id ?? null, orderId: job?.order_id ?? null };
}

/**
 * Post commission and create the ATO trip record when (and only when) a
 * delivery has been marked delivered. Idempotent: re-running a webhook or a
 * status sync never pays a driver twice.
 */
export async function settleDriverJob(
  db: Db,
  jobId: number,
  actor = "system",
): Promise<{ feeCents: number; distanceKm: number } | null> {
  const job = await db.maybeOne<{
    id: number;
    order_id: number;
    driver_id: number | null;
    customer_fee_cents: number;
    distance_km: number | null;
    driver_settled_at: string | null;
    dispatched_at: string | null;
    completed_at: string | null;
  }>("SELECT * FROM delivery_jobs WHERE id = $1", [jobId]);
  if (!job || !job.driver_id || job.driver_settled_at) return null;

  const driver = await getDriver(db, job.driver_id);
  if (!driver) return null;
  const settings = await getSettings();
  const base = Math.max(
    0,
    Math.round(
      driver.per_delivery_fee_cents ||
        settingNumber(settings, "driver_base_fee_cents", 300),
    ),
  );
  const commission = Math.round(
    (job.customer_fee_cents * driver.commission_percent) / 100,
  );
  const bonus = await driverPromotionBonus(
    db,
    driver.id,
    job.id,
    job.customer_fee_cents,
  );
  const feeCents = base + commission;

  for (const [kind, amount, description] of [
    ["delivery_fee", base, "Per-delivery fee"],
    ["commission", commission, `${driver.commission_percent}% of the delivery fee`],
    ["bonus", bonus, "Driver partner promotion"],
  ] as const) {
    if (amount <= 0) continue;
    await db.query(
      `INSERT INTO driver_ledger (driver_id, job_id, order_id, kind, amount_cents, description)
       SELECT $1,$2,$3,$4,$5,$6
       WHERE NOT EXISTS (SELECT 1 FROM driver_ledger
         WHERE driver_id = $1 AND job_id = $2 AND kind = $4)`,
      [driver.id, job.id, job.order_id, kind, amount, description],
    );
  }

  // Distance: real GPS breadcrumbs when the driver shared location, otherwise
  // a conservative one-way road estimate from the restaurant to the drop-off.
  const pings = await db.query<{ lat: number; lng: number }>(
    "SELECT lat, lng FROM driver_location_pings WHERE job_id = $1 ORDER BY recorded_at ASC, id ASC",
    [job.id],
  );
  let distanceKm = Number(job.distance_km ?? 0);
  let source = "estimated";
  if (pings.length >= 2) {
    distanceKm = pathKm(pings);
    source = "gps";
  } else if (distanceKm <= 0) {
    const order = await db.maybeOne<{
      delivery_lat: number | null;
      delivery_lng: number | null;
      address: string | null;
      suburb: string | null;
      postcode: string | null;
      code: string;
    }>("SELECT * FROM orders WHERE id = $1", [job.order_id]);
    if (order) {
      const origin: LatLng = {
        lat: Number.parseFloat(settingValue(settings, "restaurant_lat", "")) || SYDNEY_CBD.lat,
        lng: Number.parseFloat(settingValue(settings, "restaurant_lng", "")) || SYDNEY_CBD.lng,
      };
      const dropoff: LatLng =
        order.delivery_lat != null && order.delivery_lng != null
          ? { lat: order.delivery_lat, lng: order.delivery_lng }
          : estimateCoordinates(
              order.address ?? "",
              order.suburb ?? "",
              order.postcode ?? "",
              origin,
            );
      distanceKm = roadKm(origin, dropoff);
    }
  }
  distanceKm = Math.round(distanceKm * 100) / 100;
  const endedAt = job.completed_at ?? new Date().toISOString();
  const fy = financialYear(new Date(endedAt));
  const rate = await atoRateCentsPerKm(fy);
  const used = await db.one<{ km: number }>(
    `SELECT COALESCE(SUM(distance_km),0) AS km FROM driver_trips
      WHERE driver_id = $1 AND financial_year = $2`,
    [driver.id, fy],
  );
  const claimableKm = Math.max(
    0,
    Math.min(distanceKm, ATO_KM_CAP - Number(used.km)),
  );
  const claimCents = Math.round(claimableKm * rate);

  const orderCode = await db.maybeOne<{ code: string }>(
    "SELECT code FROM orders WHERE id = $1",
    [job.order_id],
  );
  await db.query(
    `INSERT INTO driver_trips (driver_id, job_id, order_id, order_code, distance_km,
      method, source, financial_year, rate_cents_per_km, claim_cents, started_at,
      ended_at, notes)
     VALUES ($1,$2,$3,$4,$5,'cents_per_km',$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (job_id, driver_id) DO NOTHING`,
    [
      driver.id,
      job.id,
      job.order_id,
      orderCode?.code ?? null,
      distanceKm,
      source,
      fy,
      rate,
      claimCents,
      job.dispatched_at ?? endedAt,
      endedAt,
      `One-way delivery distance · ${source === "gps" ? "GPS breadcrumbs" : "estimated from geocoded addresses"}${
        claimableKm < distanceKm ? " · ATO 5,000 km cap reached" : ""
      }`,
    ],
  );

  await db.query(
    "UPDATE delivery_jobs SET driver_fee_cents = $1, driver_settled_at = now(), distance_km = $2 WHERE id = $3",
    [feeCents + bonus, distanceKm, job.id],
  );
  await logVerification(
    db,
    driver.id,
    "job_settled",
    `$${((feeCents + bonus) / 100).toFixed(2)} posted for job #${job.id} · ${distanceKm} km logged for ${fy} ATO report`,
    actor,
  );
  return { feeCents: feeCents + bonus, distanceKm };
}

export type AtoReportRow = {
  id: number;
  order_code: string | null;
  started_at: string | null;
  ended_at: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  distance_km: number;
  source: string;
  financial_year: string;
  rate_cents_per_km: number;
  claim_cents: number;
  method: string;
  notes: string | null;
};

/** Driver history report for an ATO cents-per-km claim, with the 5,000 km cap. */
export async function driverAtoReport(
  db: Db,
  driverId: number,
  fy = financialYear(),
) {
  const driver = await getDriver(db, driverId);
  if (!driver) throw new DriverError("Driver not found");
  const trips = await db.query<AtoReportRow>(
    `SELECT * FROM driver_trips WHERE driver_id = $1 AND financial_year = $2
      ORDER BY ended_at DESC, id DESC`,
    [driverId, fy],
  );
  const totalKm = trips.reduce((sum, row) => sum + Number(row.distance_km), 0);
  const claimableKm = Math.min(totalKm, ATO_KM_CAP);
  const rate = await atoRateCentsPerKm(fy);
  return {
    driver,
    fy,
    trips,
    rate,
    capKm: ATO_KM_CAP,
    totalKm: Math.round(totalKm * 100) / 100,
    claimableKm: Math.round(claimableKm * 100) / 100,
    claimCents: Math.round(claimableKm * rate),
  };
}

export function atoReportCsv(report: Awaited<ReturnType<typeof driverAtoReport>>): string {
  const esc = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /["\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = [
    "Date",
    "Order",
    "Purpose",
    "Start",
    "End",
    "Distance (km)",
    "Source",
    "Method",
    "Financial year",
    "ATO rate (c/km)",
    "Claim (AUD)",
  ];
  const rows = report.trips.map((trip) => [
    trip.ended_at?.slice(0, 10) ?? "",
    trip.order_code ?? "",
    "Delivering customer orders",
    trip.start_lat != null ? `${trip.start_lat},${trip.start_lng ?? ""}` : "",
    trip.end_lat != null ? `${trip.end_lat},${trip.end_lng ?? ""}` : "",
    Number(trip.distance_km).toFixed(2),
    trip.source,
    trip.method,
    trip.financial_year,
    trip.rate_cents_per_km,
    (Number(trip.claim_cents) / 100).toFixed(2),
  ]);
  rows.push([] as string[]);
  rows.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    report.totalKm.toFixed(2),
    "",
    `Capped at ${report.capKm} km`,
    report.fy,
    report.rate,
    (report.claimCents / 100).toFixed(2),
  ]);
  return [header, ...rows].map((row) => row.map(esc).join(",")).join("\r\n");
}

/** Everything the live map needs for one order, for customers and staff alike. */
export async function trackingSnapshot(
  db: Db,
  order: {
    id: number;
    code: string;
    address: string | null;
    suburb: string | null;
    postcode: string | null;
    delivery_lat?: number | null;
    delivery_lng?: number | null;
    dispatched_at?: string | null;
    status?: string;
  },
) {
  const settings = await getSettings();
  const origin: LatLng = {
    lat: Number.parseFloat(settingValue(settings, "restaurant_lat", "")) || SYDNEY_CBD.lat,
    lng: Number.parseFloat(settingValue(settings, "restaurant_lng", "")) || SYDNEY_CBD.lng,
  };
  const dropoff: LatLng =
    order.delivery_lat != null && order.delivery_lng != null
      ? { lat: order.delivery_lat, lng: order.delivery_lng }
      : estimateCoordinates(
          order.address ?? "",
          order.suburb ?? "",
          order.postcode ?? "",
          origin,
        );
  const job = await db.maybeOne<{
    id: number;
    driver_id: number | null;
    status: string;
    eta_minutes: number | null;
    dispatched_at: string | null;
    provider: string;
  }>(
    "SELECT * FROM delivery_jobs WHERE order_id = $1 ORDER BY id DESC LIMIT 1",
    [order.id],
  );
  const driver = job?.driver_id ? await getDriver(db, job.driver_id) : null;
  const pings = job
    ? await db.query<{
        lat: number;
        lng: number;
        recorded_at: string;
        speed_kmh: number | null;
      }>(
        "SELECT lat, lng, recorded_at, speed_kmh FROM driver_location_pings WHERE job_id = $1 ORDER BY id DESC LIMIT 80",
        [job.id],
      )
    : [];
  const breadcrumbs = pings.reverse();
  const lastPing = breadcrumbs[breadcrumbs.length - 1];
  let driverPoint: LatLng | null = lastPing
    ? { lat: lastPing.lat, lng: lastPing.lng }
    : driver && driver.current_lat != null && driver.current_lng != null
      ? { lat: driver.current_lat, lng: driver.current_lng }
      : null;
  let simulated = false;
  if (!driverPoint && job?.dispatched_at && job.status !== "delivered") {
    const elapsed =
      (Date.now() - new Date(job.dispatched_at).getTime()) / 60_000;
    driverPoint = interpolate(origin, dropoff, Math.min(0.92, elapsed / 30));
    simulated = true;
  }
  const distanceKm = roadKm(origin, dropoff);
  const remainingKm = driverPoint ? haversineKm(driverPoint, dropoff) * 1.28 : distanceKm;
  return {
    origin,
    dropoff,
    driver: driverPoint,
    simulated,
    breadcrumbs: breadcrumbs.map((ping) => ({
      lat: ping.lat,
      lng: ping.lng,
      at: ping.recorded_at,
    })),
    driverName: driver ? `${driver.first_name} ${driver.last_name}` : null,
    driverCode: driver?.code ?? null,
    provider: job?.provider ?? null,
    jobStatus: job?.status ?? null,
    etaMinutes:
      job?.eta_minutes ??
      Math.max(4, Math.round((remainingKm / 24) * 60)),
    distanceKm: Math.round(distanceKm * 10) / 10,
    lastPingAt: lastPing?.recorded_at ?? null,
    speedKmh: lastPing?.speed_kmh ?? null,
    mapTiles: settingValue(settings, "map_tile_provider", "osm") !== "none",
  };
}

export async function driverStats(db: Db) {
  const [counts, earnings] = await Promise.all([
    db.one<{ total: number; approved: number; pending: number }>(
      `SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status IN ('pending','under_review')) AS pending
       FROM drivers`,
    ),
    db.one<{ owed: number; paid: number }>(
      `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE settled_at IS NULL AND kind != 'payout'),0) AS owed,
        COALESCE(SUM(amount_cents) FILTER (WHERE settled_at IS NOT NULL AND kind != 'payout'),0) AS paid
       FROM driver_ledger`,
    ),
  ]);
  return {
    total: Number(counts.total),
    approved: Number(counts.approved),
    pending: Number(counts.pending),
    owedCents: Number(earnings.owed),
    paidCents: Number(earnings.paid),
  };
}
