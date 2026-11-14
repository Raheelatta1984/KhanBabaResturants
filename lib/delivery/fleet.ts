import { randomBytes } from "node:crypto";
import type {
  DeliveryProvider,
  DispatchRequest,
  DispatchResult,
  ProviderQuote,
  ProviderStatus,
  QuoteRequest,
} from "./types";
import { getDb, type Db } from "../db";
import { getSettings, settingNumber, settingValue } from "../settings";
import {
  estimateCoordinates,
  roadKm,
  etaMinutes,
  SYDNEY_CBD,
  type LatLng,
} from "../geo";

/**
 * Our own verified driver fleet — a first-class courier partner.
 *
 * Quotes are distance-based (restaurant → drop-off), dispatch picks the least
 * busy approved driver inside their radius, and status comes from the driver's
 * own GPS pings. Because the platform owns the coordinates, this provider also
 * feeds the live map and the ATO kilometre log.
 */
export class OwnFleetProvider implements DeliveryProvider {
  name = "own_fleet";
  live = true;
  private db?: Db;

  constructor(db?: Db) {
    this.db = db;
  }

  private async handle(): Promise<Db> {
    return this.db ?? (await getDb());
  }

  private dropoffPoint(request: {
    dropoffAddress: string;
    dropoffSuburb?: string;
    dropoffPostcode?: string;
    dropoffLat?: number | null;
    dropoffLng?: number | null;
  }): LatLng {
    if (request.dropoffLat != null && request.dropoffLng != null) {
      return { lat: Number(request.dropoffLat), lng: Number(request.dropoffLng) };
    }
    return estimateCoordinates(
      request.dropoffAddress,
      request.dropoffSuburb,
      request.dropoffPostcode,
    );
  }

  private async origin(): Promise<LatLng> {
    const settings = await getSettings();
    const lat = Number.parseFloat(settingValue(settings, "restaurant_lat", ""));
    const lng = Number.parseFloat(settingValue(settings, "restaurant_lng", ""));
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : SYDNEY_CBD;
  }

  /** Approved drivers with capacity, closest first. */
  private async availableDrivers(db: Db, point: LatLng) {
    const settings = await getSettings();
    const enabled = settingValue(settings, "own_fleet_enabled", "1") !== "0";
    if (!enabled) return [];
    const rows = await db.query<{
      id: number;
      code: string;
      first_name: string;
      last_name: string;
      phone: string;
      base_lat: number | null;
      base_lng: number | null;
      current_lat: number | null;
      current_lng: number | null;
      max_radius_km: number;
      open_jobs: number;
    }>(
      `SELECT d.id, d.code, d.first_name, d.last_name, d.phone, d.base_lat, d.base_lng,
              d.current_lat, d.current_lng, d.max_radius_km,
              (SELECT COUNT(*) FROM delivery_jobs j
                WHERE j.driver_id = d.id AND j.status IN ('requested','accepted','pickup','dropoff')) AS open_jobs
         FROM drivers d
        WHERE d.status = 'approved'
        ORDER BY open_jobs ASC, d.id ASC`,
    );
    return rows
      .map((row) => {
        const start: LatLng =
          row.current_lat != null && row.current_lng != null
            ? { lat: row.current_lat, lng: row.current_lng }
            : row.base_lat != null && row.base_lng != null
              ? { lat: row.base_lat, lng: row.base_lng }
              : SYDNEY_CBD;
        return { ...row, distanceKm: roadKm(start, point) };
      })
      .filter((row) => row.distanceKm <= Math.max(1, row.max_radius_km));
  }

  async quote(request: QuoteRequest): Promise<ProviderQuote> {
    const db = await this.handle();
    const settings = await getSettings();
    const point = this.dropoffPoint(request);
    const from = await this.origin();
    const distanceKm = roadKm(from, point);
    const radius = settingNumber(settings, "delivery_radius_km", 12);
    if (distanceKm > radius) {
      throw new Error("Outside our own delivery radius");
    }
    const drivers = await this.availableDrivers(db, point);
    if (drivers.length === 0) {
      throw new Error("No verified drivers are available right now");
    }
    const base = settingNumber(settings, "own_fleet_base_fee_cents", 349);
    const perKm = settingNumber(settings, "own_fleet_per_km_cents", 185);
    const smallOrderLevy = request.orderValueCents < 3500 ? 150 : 0;
    const feeCents = Math.round(
      base + perKm * distanceKm + smallOrderLevy,
    );
    const quoteId = `fleet_q_${randomBytes(6).toString("hex")}`;
    return {
      provider: this.name,
      quoteId,
      feeCents,
      etaMinutes: etaMinutes(
        distanceKm,
        settingNumber(settings, "delivery_prep_lead_minutes", 15),
      ),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      live: true,
      distanceKm,
      raw: {
        distance_km: Number(distanceKm.toFixed(2)),
        available_drivers: drivers.length,
        nearest_driver: drivers[0]?.code,
      },
    };
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const db = await this.handle();
    const point = this.dropoffPoint(request);
    const drivers = await this.availableDrivers(db, point);
    const driver = drivers[0];
    if (!driver) throw new Error("No verified drivers are available right now");
    const deliveryId = `fleet_d_${randomBytes(6).toString("hex")}`;
    return {
      provider: this.name,
      deliveryId,
      status: "accepted",
      trackingUrl: `/order/${request.orderCode}?track=1`,
      courierName: `${driver.first_name} ${driver.last_name?.[0] ?? ""}.`.trim(),
      courierPhone: driver.phone,
      driverId: driver.id,
      raw: {
        driver_id: driver.id,
        driver_code: driver.code,
        distance_km: Number(driver.distanceKm.toFixed(2)),
        own_fleet: true,
      },
    };
  }

  async status(deliveryId: string): Promise<ProviderStatus> {
    const db = await this.handle();
    const job = await db.maybeOne<{
      driver_id: number | null;
      status: string;
      pings: number;
    }>(
      `SELECT j.driver_id, j.status,
              (SELECT COUNT(*) FROM driver_location_pings p WHERE p.job_id IS NOT NULL
                 AND p.job_id = j.id) AS pings
         FROM delivery_jobs j WHERE j.provider_delivery_id = $1
        ORDER BY j.id DESC LIMIT 1`,
      [deliveryId],
    );
    if (!job) return { status: "unknown" };
    if (job.status === "delivered") return { status: "delivered" };
    return {
      status: job.pings > 1 ? "en_route_to_dropoff" : "accepted",
      raw: { driver_id: job.driver_id },
    };
  }
}
