// One weather client for the whole app.
//
// There used to be two: the standalone /app/weather screen called Open-Meteo
// directly from the browser in imperial units, while the workspace's Weather tab
// went through the `weather` edge function in metric. Two normalisation paths,
// two shapes, and two caches — of which the planner silently depended on one.
//
// Everything now goes through the edge function, which keeps the OpenWeather key
// server-side and falls back to Open-Meteo itself. Storage units are metric
// (°C, km/h, mm); presentation converts.
import { supabase } from "@/integrations/supabase/client";
import { storageKey } from "@/lib/storage";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

/** Long enough that panning around does not re-fetch; short enough to stay useful. */
export const WEATHER_TTL_MS = 20 * 60 * 1000;

export type WxCurrent = {
  time: number; temp_c: number; feels_c: number; humidity: number;
  wind_kmh: number; gust_kmh: number; wind_dir: number;
  clouds: number; precip_mm: number; code: number; icon: string; desc: string;
};
export type WxHour = WxCurrent & { precip_prob: number };
export type WxDay = {
  time: number; tmin_c: number; tmax_c: number; humidity: number | null;
  wind_kmh: number; gust_kmh: number; wind_dir: number;
  precip_mm: number; precip_prob: number; clouds: number;
  code: number; icon: string; desc: string;
};
export type Forecast = {
  tz?: string; tz_offset?: number; source?: string;
  current: WxCurrent; hourly: WxHour[]; daily: WxDay[];
};

export type CachedForecast = { savedAt: number; data: Forecast };

// The key format is load-bearing: the flight planner reads this same entry to
// derate its battery estimate for wind and temperature. Changing the shape or
// the rounding without updating PlannerTab silently drops that derating.
export const wxCacheKey = (lat: number, lng: number) =>
  storageKey("weather", `${lat.toFixed(3)},${lng.toFixed(3)}`);

/** Cached forecast for a location, or null when absent or stale. */
export function readCachedWeather(lat: number, lng: number): CachedForecast | null {
  try {
    const raw = localStorage.getItem(wxCacheKey(lat, lng));
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedForecast;
    if (!c?.savedAt || !c?.data?.current) return null;
    if (Date.now() - c.savedAt > WEATHER_TTL_MS) return null;
    return c;
  } catch { return null; }
}

function writeCachedWeather(lat: number, lng: number, data: Forecast): number {
  const savedAt = Date.now();
  try {
    localStorage.setItem(wxCacheKey(lat, lng), JSON.stringify({ savedAt, data }));
  } catch { /* quota or private mode - the fetch still succeeded */ }
  return savedAt;
}

/**
 * Fetch a normalised forecast, serving the cache when it is fresh.
 * `force` bypasses the cache for an explicit refresh.
 */
export async function fetchWeather(
  lat: number,
  lng: number,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<CachedForecast> {
  if (!opts.force) {
    const hit = readCachedWeather(lat, lng);
    if (hit) return hit;
  }
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  const res = await fetch(`${FN_BASE}/weather?lat=${lat}&lon=${lng}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: opts.signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.current) {
    throw new Error(json?.error ?? `Forecast unavailable (${res.status})`);
  }
  return { savedAt: writeCachedWeather(lat, lng, json as Forecast), data: json as Forecast };
}

// ---- presentation helpers --------------------------------------------------
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kmhToMph = (k: number) => k * 0.621371;
export const mmToIn = (mm: number) => mm / 25.4;

export const compass = (deg: number) => {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
};
