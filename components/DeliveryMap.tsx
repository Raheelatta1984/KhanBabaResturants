"use client";

import { useEffect, useState } from "react";
import { tileXY, type LatLng } from "@/lib/geo";

/**
 * Live delivery map, shared by the customer tracking page and the staff
 * delivery desk. Pure SVG + OpenStreetMap raster tiles (optional): no mapping
 * library, no API key, no tracking scripts. With `mapTiles = false` (the
 * `map_tile_provider = none` setting) it renders an offline grid, so the map
 * still works in a kiosk or a locked-down network.
 */
export type DeliveryMapData = {
  origin: LatLng;
  dropoff: LatLng;
  driver: LatLng | null;
  simulated: boolean;
  breadcrumbs: { lat: number; lng: number; at: string }[];
  driverName: string | null;
  driverCode: string | null;
  provider: string | null;
  jobStatus: string | null;
  etaMinutes: number;
  distanceKm: number;
  lastPingAt: string | null;
  speedKmh: number | null;
  mapTiles: boolean;
};

const W = 800;
const H = 320;
const TILE = 256;

function project(point: LatLng, zoom: number) {
  const { x, y } = tileXY(point.lat, point.lng, zoom);
  return { x: x * TILE, y: y * TILE };
}

function zoomFor(a: LatLng, b: LatLng): number {
  const span = Math.max(Math.abs(a.lat - b.lat) / 0.12, Math.abs(a.lng - b.lng) / 0.18);
  return Math.max(11, Math.min(16, 15 - Math.ceil(Math.log2(Math.max(1, span)))));
}

function timeLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

export function DeliveryMap({
  data,
  title = "Live delivery tracking",
  refreshUrl,
}: {
  data: DeliveryMapData;
  title?: string;
  /** Optional poller for staff maps (customers already poll the order API). */
  refreshUrl?: string;
}) {
  const [live, setLive] = useState(data);

  useEffect(() => setLive(data), [data]);

  useEffect(() => {
    if (!refreshUrl) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(refreshUrl, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          tracking?: DeliveryMapData | null;
          positions?: { tracking?: DeliveryMapData }[];
        };
        const next = json.tracking ?? json.positions?.[0]?.tracking;
        if (alive && next) setLive(next);
      } catch {
        /* keep the last known position */
      }
    };
    const timer = window.setInterval(tick, 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshUrl]);

  const points: LatLng[] = [live.origin, live.dropoff];
  if (live.driver) points.push(live.driver);
  for (const crumb of live.breadcrumbs) points.push({ lat: crumb.lat, lng: crumb.lng });
  const minLat = Math.min(...points.map((p) => p.lat));
  const maxLat = Math.max(...points.map((p) => p.lat));
  const minLng = Math.min(...points.map((p) => p.lng));
  const maxLng = Math.max(...points.map((p) => p.lng));
  const center: LatLng = {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
  const zoom = zoomFor({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng });
  const c = project(center, zoom);
  const toScreen = (point: LatLng) => {
    const p = project(point, zoom);
    return { x: p.x - c.x + W / 2, y: p.y - c.y + H / 2 };
  };

  const origin = toScreen(live.origin);
  const dropoff = toScreen(live.dropoff);
  const driver = live.driver ? toScreen(live.driver) : null;
  const trail = live.breadcrumbs.map((crumb) =>
    toScreen({ lat: crumb.lat, lng: crumb.lng }),
  );
  const routePoints = [origin, ...trail, ...(driver ? [driver] : []), dropoff]
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const tiles: { key: string; url: string; x: number; y: number }[] = [];
  if (live.mapTiles) {
    const centerTile = tileXY(center.lat, center.lng, zoom);
    const cx = Math.floor(centerTile.x);
    const cy = Math.floor(centerTile.y);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= 2 ** zoom || ty >= 2 ** zoom) continue;
        tiles.push({
          key: `${zoom}-${tx}-${ty}`,
          url: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`,
          x: tx * TILE - c.x + W / 2,
          y: ty * TILE - c.y + H / 2,
        });
      }
    }
  }

  return (
    <div className="map-panel">
      <div className="panel-head" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: "1rem" }}>{title}</h3>
        <span className="badge badge-green">
          <span className="live-dot" /> {live.etaMinutes} min ETA
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Delivery map: restaurant to ${live.dropoff.lat.toFixed(4)}, ${live.dropoff.lng.toFixed(4)}`}
        className="map-svg"
      >
        <defs>
          <linearGradient id="kb-route" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f3ab3f" />
            <stop offset="100%" stopColor="#5fd39a" />
          </linearGradient>
          <filter id="kb-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>
        <rect width={W} height={H} fill="#101b24" />
        {live.mapTiles ? (
          <g opacity="0.78">
            {tiles.map((tile) => (
              <image
                key={tile.key}
                href={tile.url}
                x={tile.x}
                y={tile.y}
                width={TILE}
                height={TILE}
              />
            ))}
          </g>
        ) : (
          <g stroke="#1d2c38" strokeWidth="1">
            {Array.from({ length: 17 }, (_, i) => (
              <line key={`v${i}`} x1={i * 50} y1={0} x2={i * 50} y2={H} />
            ))}
            {Array.from({ length: 8 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={i * 40} x2={W} y2={i * 40} />
            ))}
          </g>
        )}
        <polyline
          points={routePoints}
          fill="none"
          stroke="#0b1219"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <polyline
          points={routePoints}
          fill="none"
          stroke="url(#kb-route)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="14 9"
        />
        {trail.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="3.5" fill="#7fb6ff" opacity="0.85" />
        ))}
        <g filter="url(#kb-shadow)">
          <circle cx={origin.x} cy={origin.y} r="13" fill="#f3ab3f" />
          <circle cx={origin.x} cy={origin.y} r="5" fill="#101b24" />
          <circle cx={dropoff.x} cy={dropoff.y} r="13" fill="#5fd39a" />
          <circle cx={dropoff.x} cy={dropoff.y} r="5" fill="#101b24" />
          {driver ? (
            <>
              <circle cx={driver.x} cy={driver.y} r="17" fill="#7fb6ff" opacity="0.22" />
              <circle cx={driver.x} cy={driver.y} r="11" fill="#7fb6ff" />
              <path
                d={`M ${driver.x} ${driver.y - 5} L ${driver.x + 7} ${driver.y + 5} L ${driver.x} ${driver.y + 2} L ${driver.x - 7} ${driver.y + 5} Z`}
                fill="#0b1219"
              />
            </>
          ) : null}
        </g>
        <text x={origin.x + 18} y={origin.y - 12} className="map-label">Khan Baba</text>
        <text x={dropoff.x + 18} y={dropoff.y - 12} className="map-label">Drop-off</text>
        {live.mapTiles ? (
          <text x={W - 8} y={H - 8} textAnchor="end" className="map-credit">
            © OpenStreetMap contributors
          </text>
        ) : null}
      </svg>
      <div className="map-legend">
        <span><i style={{ background: "#f3ab3f" }} /> Restaurant</span>
        <span><i style={{ background: "#7fb6ff" }} /> {live.driverName ?? "Driver"}</span>
        <span><i style={{ background: "#5fd39a" }} /> Drop-off</span>
        <span className="muted tiny">
          {live.distanceKm} km ·{" "}
          {live.lastPingAt
            ? `GPS ${timeLabel(live.lastPingAt)}`
            : live.simulated
              ? "estimated position"
              : "awaiting GPS"}
        </span>
      </div>
    </div>
  );
}
