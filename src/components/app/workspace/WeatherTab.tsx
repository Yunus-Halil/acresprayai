// Extracted from OrthomosaicViewer.tsx. Mechanical move only - no
// behaviour changes. See docs/features/workspace.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, ChevronUp, ChevronDown, Eye, EyeOff,
  Layers, Image as ImageIcon, Ruler, Settings,
  Maximize2, Plus, Minus, Loader2, MapPin, Activity,
  Sparkles, Download, AlertTriangle, X, Plane, CloudSun,
  FileBarChart, Map as MapIcon, Bot, Pencil, Cloud,
  Wind, Droplets, ThermometerSun, CloudRain, Sun, CloudSnow, CloudFog,
  CheckCircle2, XCircle, Trash2, Hexagon,
  Play, Pause, RotateCcw, FastForward, History,
} from "lucide-react";
import UserPolygonTool, { type DraftPolygon } from "@/components/app/UserPolygonTool";
import ReportsTab from "@/components/app/ReportsTab";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  type DroneSpec, DRONE_SPECS, resolveDroneSpec,
} from "@/lib/droneSpecs";
import {
  type AiZone, type CustomInput, type FarmerSettings, type LastFlownMission,
  COST_MAP, DEFAULT_FARMER_SETTINGS, INPUT_LABELS,
  growthStage, issueToCostKey, mergeFarmerSettings, normalizeBoundary,
} from "@/lib/farmerSettings";
import {
  type LatLng2,
  M_PER_DEG_LAT,
  bboxOfRings, centroidOfRings, centroidSafe, distM, lerp, mPerDegLng,
  pointInAnyRing, pointInRing, polygonAreaM2, polylineLengthM,
  principalAxisAngle, ringContaining, ringsAreaM2, rotateLL,
  routeInsideBoundary, segRingIntersections, segSegT, segmentInsideRings,
} from "@/lib/geo";
import {
  type Mission, type MissionAction, type MissionParams, type MissionWP,
  buildFieldSweep, buildMission, exportMissionFile,
} from "@/lib/mission";
import {
  type BoundaryRing, type FieldRow, type TaskRow,
} from "./types";
import { FN_BASE, NDVI_BASE, TILE_BASE } from "./constants";
import {
  type Annotation, type LayerState, type MeasureStats, type UserPoly,
  AiZonesLayer, AnnotateTool, BoundaryTool, FitBounds, LayerRow, MapControls,
  MeasurePanel, MeasureTool, MouseReadout, USER_POLY_ISSUES, UserPolyLayer,
  escapeHtml, loadAnnotations, saveAnnotations, sevColor,
} from "./layers";
import {
  type Forecast, cToF as wxCToF, fetchWeather, kmhToMph as wxKmhToMph,
  readCachedWeather,
} from "@/lib/weather";
import {
  DEFAULT_SPRAY_LIMITS, findSprayWindows, formatReason, rainAhead,
  sprayVerdict as verdictOf,
} from "@/lib/sprayWindow";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtTemp, fmtWindSpeed } from "@/lib/units";


export function PlaceholderTab({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#0f0f0f" }}>
      <div className="text-center max-w-md px-6">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-sm border border-[#222] mb-4"
             style={{ background: "#1a1a1a" }}>
          <Icon className="h-5 w-5 text-[#4CAF50]" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight mb-1">{title}</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">{body}</p>
        <div className="mt-4 text-[11px] uppercase tracking-wider text-neutral-600">Coming soon</div>
      </div>
    </div>
  );
}

// ---------------------------- Weather tab ------------------------------------
// OpenWeather One Call 3.0 via the `weather` edge function. Values are normalized
// (temp °C, wind km/h). We display both °F and °C and mph and km/h.

// Compact live-weather pill rendered in the top status bar. Uses the same
// 20-min localStorage cache as <WeatherTab/> so opening Weather doesn't re-fetch.
export function HeaderWeather({ center, onClick }: { center: [number, number]; onClick: () => void }) {
  const [lat, lng] = center;
  const [cur, setCur] = useState<{ temp_c: number; desc: string; code: number; icon: string } | null>(null);
  const [err, setErr] = useState(false);
  const units = useUnitSystem();

  useEffect(() => {
    let cancelled = false;
    // Shares the cache with the Weather tab, so opening that tab costs nothing.
    fetchWeather(lat, lng)
      .then(c => { if (!cancelled) setCur(c.data.current); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [lat, lng]);

  const temp = cur ? fmtTemp(cur.temp_c, units).text : null;
  return (
    <button
      onClick={onClick}
      title="Open Weather tab"
      className="hidden sm:flex items-center gap-2 px-3 h-7 rounded-sm border border-[#222] bg-[#161616] hover:bg-[#1c1c1c] text-xs transition-colors"
    >
      {cur ? <OwGlyph code={cur.code} icon={cur.icon} className="h-3.5 w-3.5 text-neutral-400" />
           : <Cloud className="h-3.5 w-3.5 text-neutral-400" />}
      <span className="text-neutral-200 tabular-nums">{temp ?? (err ? "-" : "…")}</span>
      <span className="text-neutral-500">{cur?.desc ?? (err ? "Weather unavailable" : "Live weather")}</span>
    </button>
  );
}

export type OwHour = {
  time: number; temp_c: number; humidity: number; wind_kmh: number; gust_kmh: number;
  wind_dir: number; precip_mm: number; precip_prob: number; clouds: number;
  code: number; icon: string; desc: string;
};
export type OwDay = {
  time: number; tmin_c: number; tmax_c: number; humidity: number;
  wind_kmh: number; gust_kmh: number; precip_mm: number; precip_prob: number;
  code: number; icon: string; desc: string;
};

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kmhToMph = (k: number) => k * 0.621371;
export const compass = (deg: number) => {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
};

export function OwGlyph({ icon, code, className }: { icon: string; code: number; className?: string }) {
  // OpenWeather group ranges: 2xx thunder, 3xx drizzle, 5xx rain, 6xx snow, 7xx atmosphere, 800 clear, 80x clouds
  if (code >= 200 && code < 300) return <CloudRain className={className} />;
  if (code >= 300 && code < 600) return <CloudRain className={className} />;
  if (code >= 600 && code < 700) return <CloudSnow className={className} />;
  if (code >= 700 && code < 800) return <CloudFog className={className} />;
  if (code === 800) return <Sun className={className} />;
  if (icon?.endsWith("d") && code === 801) return <CloudSun className={className} />;
  return <Cloud className={className} />;
}

// Spray suitability now lives in @/lib/sprayWindow, because the dashboard asks
// the same question across every field and two copies of a safety rule is two
// copies that drift. Re-exported here so existing importers keep working.
export type { Verdict } from "@/lib/sprayWindow";
export { sprayVerdict } from "@/lib/sprayWindow";

export function WeatherTab({ center, fieldName }: { center: [number, number]; fieldName: string }) {
  const [lat, lng] = center;
  // Fetching and caching live in @/lib/weather so this tab, the standalone
  // Weather screen and the planner all share one normalisation path and one
  // cache entry. See the note on wxCacheKey before changing anything there.
  const initial = readCachedWeather(lat, lng);
  const [data, setData] = useState<Forecast | null>(initial?.data ?? null);
  const [savedAt, setSavedAt] = useState<number | null>(initial?.savedAt ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const units = useUnitSystem();

  // The thresholds, stated in the operator's own units. A green tick that does
  // not say what it checked is a green tick nobody can argue with, and this is
  // a decision a person is legally responsible for.
  const L = DEFAULT_SPRAY_LIMITS;
  const wind = (kmh: number) => fmtWindSpeed(kmh / 3.6, units).text;
  const limitsLine =
    `Wind ≤ ${wind(L.windMaxKmh)} · gusts ≤ ${wind(L.gustMaxKmh)} · no rain 6h · ` +
    `${L.humidityMin}-${L.humidityMax}% RH · temp ≥ ${fmtTemp(L.tempMinC, units).text}`;

  const load = useCallback(async (force = false) => {
    setErr(null); setRefreshing(true);
    try {
      const c = await fetchWeather(lat, lng, { force });
      setData(c.data);
      setSavedAt(c.savedAt);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Weather unavailable");
    } finally {
      setRefreshing(false);
    }
  }, [lat, lng]);

  useEffect(() => { load(false); }, [load]);

  if (err && !data) return (
    <div className="absolute inset-0 grid place-items-center text-sm text-red-400 p-6 text-center gap-3" style={{ background: "#0f0f0f" }}>
      <div>{err}</div>
      <button onClick={() => load(true)} className="px-3 py-1.5 rounded bg-neutral-800 text-neutral-200 text-xs">Retry</button>
    </div>
  );
  if (!data) return (
    <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400 gap-2" style={{ background: "#0f0f0f" }}>
      <Loader2 className="h-4 w-4 animate-spin" /> Loading weather…
    </div>
  );

  const cur = data.current;
  const hourly = data.hourly;
  const daily = data.daily;

  // Rain in next 6 hours (sum of precip mm)
  const rainNext6 = rainAhead(hourly, 0);

  // Verdict for "right now" uses current + next-6h rain.
  const nowHour: OwHour = {
    time: cur.time, temp_c: cur.temp_c, humidity: cur.humidity,
    wind_kmh: cur.wind_kmh, gust_kmh: cur.gust_kmh, wind_dir: cur.wind_dir,
    precip_mm: cur.precip_mm, precip_prob: 0, clouds: cur.clouds,
    code: cur.code, icon: cur.icon, desc: cur.desc,
  };
  const now = verdictOf(nowHour, rainNext6);

  const bestWindows = findSprayWindows(hourly).slice(0, 3).map(w => ({
    ...w,
    dayLabel: new Date(w.startTs * 1000).toLocaleDateString([], { weekday: "long" }),
  }));

  const fmtHour = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric" });
  const fmtDay = (ts: number) => new Date(ts * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const verdictColor = now.verdict === "green" ? "#4CAF50" : now.verdict === "yellow" ? "#facc15" : "#ef4444";
  const verdictBorder = now.verdict === "green" ? "border-[#4CAF50]/40" : now.verdict === "yellow" ? "border-yellow-400/40" : "border-red-500/40";
  const verdictLabel =
    now.verdict === "green" ? "Good to spray right now" :
    now.verdict === "yellow" ? "Marginal, proceed with caution" : "Do not spray right now";

  return (
    <div className="absolute inset-0 overflow-auto p-8" style={{ background: "#0f0f0f" }}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <CloudSun className="h-5 w-5 text-[#4CAF50]" />
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Weather · {fieldName}</h1>
            <div className="text-xs text-neutral-500 font-mono">{lat.toFixed(4)}, {lng.toFixed(4)} · OpenWeather One Call 3.0</div>
          </div>
          <div className="text-[11px] text-neutral-500 text-right">
            {savedAt && <div>Updated {new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}
            <button onClick={() => load(true)} disabled={refreshing}
              className="mt-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] inline-flex items-center gap-1 disabled:opacity-50">
              {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Refresh
            </button>
          </div>
        </div>

        {/* Verdict banner */}
        <div className={`rounded-sm border ${verdictBorder} p-5`} style={{ background: "#1a1a1a" }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full grid place-items-center" style={{ background: verdictColor + "22", border: `1px solid ${verdictColor}` }}>
              {now.verdict === "green" ? <CheckCircle2 className="h-4 w-4" style={{ color: verdictColor }} />
                : now.verdict === "yellow" ? <AlertTriangle className="h-4 w-4" style={{ color: verdictColor }} />
                : <XCircle className="h-4 w-4" style={{ color: verdictColor }} />}
            </div>
            <div>
              <div className="text-base font-semibold" style={{ color: verdictColor }}>{verdictLabel}</div>
              <div className="text-[11px] text-neutral-500">{limitsLine}</div>
            </div>
          </div>
          {now.reasons.length > 0 && (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-400">
              {now.reasons.map((r, i) => <li key={i}>• {formatReason(r, units)}</li>)}
            </ul>
          )}
        </div>

        {/* Current + Best windows */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-sm border border-[#222] p-5" style={{ background: "#1a1a1a" }}>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Current</div>
            <div className="flex items-center gap-4">
              <OwGlyph code={cur.code} icon={cur.icon} className="h-12 w-12 text-[#4CAF50]" />
              <div>
                <div className="text-4xl font-semibold tabular-nums">{fmtTemp(cur.temp_c, units).text}</div>
                <div className="text-xs text-neutral-400">{cur.desc}</div>
                <div className="text-[11px] text-neutral-500">Feels {fmtTemp(cur.feels_c, units).text}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Wind className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Wind</div>
                <div className="font-mono">{wind(cur.wind_kmh)} {compass(cur.wind_dir)}</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Droplets className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Humidity</div>
                <div className="font-mono">{cur.humidity}%</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <ThermometerSun className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Gust</div>
                <div className="font-mono">{wind(cur.gust_kmh)}</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Cloud className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Cloud cover</div>
                <div className="font-mono">{cur.clouds}%</div>
              </div>
            </div>
          </div>

          <div className="rounded-sm border border-[#222] p-5 md:col-span-2" style={{ background: "#1a1a1a" }}>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Best spray windows · next 3 days</div>
            {bestWindows.length === 0 ? (
              <div className="text-sm text-neutral-500">No GREEN windows of 2+ hours in the next 72 hours. Recheck after weather shifts.</div>
            ) : (
              <div className="space-y-2">
                {bestWindows.map((w, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-sm border border-[#4CAF50]/30 p-3" style={{ background: "#0f0f0f" }}>
                    <CheckCircle2 className="h-4 w-4 text-[#4CAF50]" />
                    <div className="flex-1">
                      <div className="text-sm">
                        {w.active ? "Now" : w.dayLabel}{" "}
                        <span className="text-[#4CAF50] font-mono">{fmtHour(w.startTs)} - {fmtHour(w.endTs)}</span>
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {w.hours} hour{w.hours === 1 ? "" : "s"} with wind, humidity and temperature all in range, no rain
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hourly 24h strip */}
        <div className="rounded-sm border border-[#222] p-4" style={{ background: "#1a1a1a" }}>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Next 24 hours</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {hourly.slice(0, 24).map((h, i) => {
              const v = verdictOf(h, rainAhead(hourly, i)).verdict;
              const dot = v === "green" ? "bg-[#4CAF50]" : v === "yellow" ? "bg-yellow-400" : "bg-red-500";
              return (
                <div key={i} className="min-w-[88px] rounded-sm border border-[#222] p-2 text-center" style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] text-neutral-500">{fmtHour(h.time)}</div>
                  <OwGlyph code={h.code} icon={h.icon} className="h-5 w-5 mx-auto my-1 text-neutral-300" />
                  <div className="text-sm font-mono tabular-nums">{fmtTemp(h.temp_c, units).text}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">{wind(h.wind_kmh)}</div>
                  <div className="text-[10px] text-neutral-500 font-mono">{h.precip_prob}%</div>
                  <div className={`mt-1 h-1 rounded-full ${dot}`} />
                </div>
              );
            })}
          </div>
        </div>

        {/* 7-day */}
        <div className="rounded-sm border border-[#222] p-4" style={{ background: "#1a1a1a" }}>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">7-day forecast</div>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
            {daily.slice(0, 7).map((d, i) => (
              <div key={i} className="rounded-sm border border-[#222] p-3" style={{ background: "#0f0f0f" }}>
                <div className="text-[11px] text-neutral-400">{fmtDay(d.time)}</div>
                <div className="flex items-center gap-2 mt-1">
                  <OwGlyph code={d.code} icon={d.icon} className="h-5 w-5 text-neutral-300" />
                  <div className="text-sm font-mono">
                    <span className="text-[#f0f0f0]">{Math.round(fmtTemp(d.tmax_c, units).value)}°</span>
                    <span className="text-neutral-500"> / {Math.round(fmtTemp(d.tmin_c, units).value)}°</span>
                  </div>
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mt-1">{d.precip_prob}% · {wind(d.wind_kmh)}</div>
                <div className="text-[10px] text-neutral-600 font-mono">{d.precip_mm.toFixed(1)} mm</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[10px] text-neutral-600">Data: OpenWeather · Updated {new Date().toLocaleTimeString()}</div>
      </div>
    </div>
  );
}

export default WeatherTab;
