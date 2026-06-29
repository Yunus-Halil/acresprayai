import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { supabase } from "@/integrations/supabase/client";
import { Unzip, UnzipInflate } from "fflate";
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
import HistoryTab from "@/components/app/HistoryTab";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
// Static pre-baked tiles live in the private `tiles` bucket and are streamed
// through the `tile` edge function. Leaflet loads them as plain <img> GETs.
const TILE_BASE = `${FN_BASE}/tile`;
const NDVI_BASE = `${FN_BASE}/ndvi-tile`;

// Streams the all.zip from a signed URL, pulls out odm_orthophoto.tif WITHOUT
// buffering the full archive in RAM, and PUTs the .tif to a Supabase signed
// upload URL. Designed for the WebODM Lightning case where the edge function
// can't extract the orthomosaic itself within its 256 MB memory cap.
async function extractAndUpload(
  zipUrl: string,
  upload: { path: string; token: string; bucket: string },
  onProgress: (stage: string, pct: number) => void,
): Promise<void> {
  onProgress("Downloading processing archive…", 1);
  const res = await fetch(zipUrl);
  if (!res.ok || !res.body) throw new Error(`zip download failed (${res.status})`);
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : 0;

  const matcher = /odm_orthophoto[\\/]odm_orthophoto\.tif$/i;
  const fallbackMatcher = /(^|[\\/])orthophoto\.tif$/i;

  const tifBytes = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let matchedName: string | null = null;
    let done = false;

    const unz = new Unzip((file) => {
      if (done) return;
      const primary = matcher.test(file.name);
      const fallback = !matchedName && fallbackMatcher.test(file.name);
      if (!primary && !fallback) return;
      if (primary) { chunks.length = 0; size = 0; }
      matchedName = file.name;
      file.ondata = (err, chunk, final) => {
        if (done) return;
        if (err) { done = true; reject(err); return; }
        chunks.push(chunk);
        size += chunk.byteLength;
        if (final && file.name === matchedName) {
          done = true;
          const out = new Uint8Array(size);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.byteLength; }
          resolve(out);
        }
      };
      file.start();
    });
    unz.register(UnzipInflate);

    const reader = res.body!.getReader();
    let read = 0;
    (async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (done) { try { reader.cancel(); } catch { /* noop */ } return; }
          const { value, done: rdone } = await reader.read();
          if (rdone) { unz.push(new Uint8Array(0), true); break; }
          if (value && value.byteLength) {
            read += value.byteLength;
            unz.push(value, false);
            const pct = total ? Math.min(95, (read / total) * 95) : Math.min(95, (read / (50_000_000)) * 95);
            onProgress(matchedName ? "Extracting orthomosaic…" : "Downloading processing archive…", pct);
          }
        }
        if (!done) reject(new Error("orthomosaic file not found in archive"));
      } catch (e) {
        if (!done) { done = true; reject(e as Error); }
      }
    })();
  });

  onProgress("Uploading orthomosaic…", 96);
  const buf = tifBytes.buffer.slice(tifBytes.byteOffset, tifBytes.byteOffset + tifBytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type: "image/tiff" });
  const { error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, blob, { contentType: "image/tiff", upsert: true });
  if (error) throw error;
  onProgress("Finalizing…", 100);
}

type TaskRow = { odm_uuid: string | null; field_id: string; created_at: string };
type BoundaryRing = { lat: number; lng: number }[];
type FieldRow = {
  id: string;
  name: string;
  boundary: BoundaryRing[] | BoundaryRing | null;
  boundary_area_hectares: number | null;
  settings?: FarmerSettings | null;
};

// ===================== Farmer settings (per field) =========================
// Stored as JSON in `fields.settings`. Drives cost calculations and AI prompt.
export type CustomInput = { name: string; cost: number };

// ----- Drone specs (for flight battery estimation) ------------------------
// Keyed by `drones.model` string in the fleet table. "Custom" lets the user
// enter their own. Specs intentionally conservative — typical real-world,
// not marketing numbers.
export type DroneSpec = {
  tank_l: number;          // spray tank capacity in litres
  payload_kg: number;      // max payload incl. tank
  max_flight_min: number;  // realistic single-battery flight time
  max_speed_ms: number;    // max horizontal speed
  spray_swath_m: number;   // effective spray swath width at typical AGL (0 = non-sprayer)
  min_turn_radius_m: number; // tightest physically achievable horizontal turn radius
  climb_rate_ms: number;     // max sustained vertical climb rate
};
export const DRONE_SPECS: Record<string, DroneSpec> = {
  "DJI Agras T40":   { tank_l: 40, payload_kg: 50, max_flight_min: 18, max_speed_ms: 10,   spray_swath_m: 9,   min_turn_radius_m: 4,   climb_rate_ms: 6 },
  "DJI Agras T30":   { tank_l: 30, payload_kg: 40, max_flight_min: 18, max_speed_ms: 10,   spray_swath_m: 6.5, min_turn_radius_m: 3.5, climb_rate_ms: 6 },
  "DJI Agras T25":   { tank_l: 20, payload_kg: 25, max_flight_min: 18, max_speed_ms: 10,   spray_swath_m: 5,   min_turn_radius_m: 3,   climb_rate_ms: 6 },
  "XAG P100":        { tank_l: 40, payload_kg: 50, max_flight_min: 18, max_speed_ms: 13.8, spray_swath_m: 7,   min_turn_radius_m: 4.5, climb_rate_ms: 5 },
  "XAG V40":         { tank_l: 16, payload_kg: 20, max_flight_min: 18, max_speed_ms: 13.8, spray_swath_m: 5,   min_turn_radius_m: 3.5, climb_rate_ms: 5 },
  "DJI Mavic 3M":    { tank_l: 0,  payload_kg: 0,  max_flight_min: 43, max_speed_ms: 21,   spray_swath_m: 0,   min_turn_radius_m: 1,   climb_rate_ms: 8 },
  "Parrot Anafi USA":{ tank_l: 0,  payload_kg: 0,  max_flight_min: 32, max_speed_ms: 14.7, spray_swath_m: 0,   min_turn_radius_m: 1,   climb_rate_ms: 4 },
  "Custom":          { tank_l: 30, payload_kg: 40, max_flight_min: 20, max_speed_ms: 10,   spray_swath_m: 6,   min_turn_radius_m: 3,   climb_rate_ms: 5 },
};

export type FarmerSettings = {
  crop_type: string;          // "wheat" | "corn" | ...
  planting_date: string;      // YYYY-MM-DD or ""
  harvest_date: string;       // YYYY-MM-DD or ""
  area_acres_override: number | null;
  input_costs: {
    nitrogen_fertilizer: number;
    phosphorus_fertilizer: number;
    potassium_fertilizer: number;
    herbicide: number;
    fungicide: number;
    insecticide: number;
    reseeding: number;
  };
  available_inputs: {
    nitrogen_fertilizer: boolean;
    phosphorus_fertilizer: boolean;
    potassium_fertilizer: boolean;
    herbicide: boolean;
    fungicide: boolean;
    insecticide: boolean;
    reseeding: boolean;
  };
  custom_inputs: CustomInput[];
  flight_plan: {
    drone_id: string | null;     // fleet drone.id; null = none selected yet
    tank_load_pct: number;       // 0-100, how full the tank is for this mission
    custom_specs: DroneSpec;     // active only when drone model is "Custom" / unknown
  };
};

export const DEFAULT_FARMER_SETTINGS: FarmerSettings = {
  crop_type: "",
  planting_date: "",
  harvest_date: "",
  area_acres_override: null,
  input_costs: {
    nitrogen_fertilizer: 45,
    phosphorus_fertilizer: 35,
    potassium_fertilizer: 30,
    herbicide: 25,
    fungicide: 30,
    insecticide: 20,
    reseeding: 35,
  },
  available_inputs: {
    nitrogen_fertilizer: true,
    phosphorus_fertilizer: true,
    potassium_fertilizer: true,
    herbicide: true,
    fungicide: true,
    insecticide: true,
    reseeding: true,
  },
  custom_inputs: [],
  flight_plan: {
    drone_id: null,
    tank_load_pct: 80,
    custom_specs: DRONE_SPECS["Custom"],
  },
};

export const INPUT_LABELS: Record<keyof FarmerSettings["input_costs"], string> = {
  nitrogen_fertilizer: "Nitrogen fertilizer",
  phosphorus_fertilizer: "Phosphorus fertilizer",
  potassium_fertilizer: "Potassium fertilizer",
  herbicide: "Herbicide",
  fungicide: "Fungicide",
  insecticide: "Insecticide",
  reseeding: "Reseeding / seed",
};

// Maps AI issue_type (canonical key) → farmer input cost key.
// `null` = no chemical fix.
export const COST_MAP: Record<string, keyof FarmerSettings["input_costs"] | null> = {
  bare_soil: "reseeding",
  nitrogen_deficiency: "nitrogen_fertilizer",
  phosphorus_deficiency: "phosphorus_fertilizer",
  potassium_deficiency: "potassium_fertilizer",
  weed_pressure: "herbicide",
  disease: "fungicide",
  pest_damage: "insecticide",
  waterlogging: null,
};

// Loose mapping from the AI's free-text `issue` / `recommendation.action` to
// the canonical COST_MAP key.
export function issueToCostKey(z: { issue?: string; recommendation?: { action?: string } | null }): string | null {
  const txt = `${z.issue ?? ""} ${z.recommendation?.action ?? ""}`.toLowerCase();
  if (/water|drain|saturat|pond/.test(txt)) return "waterlogging";
  if (/bare|reseed|gap|establish/.test(txt)) return "bare_soil";
  if (/nitrogen|\bn\s+def/.test(txt)) return "nitrogen_deficiency";
  if (/phosphor|\bp\s+def/.test(txt)) return "phosphorus_deficiency";
  if (/potass|\bk\s+def/.test(txt)) return "potassium_deficiency";
  if (/weed|herbicid/.test(txt)) return "weed_pressure";
  if (/disease|fung|blight|rust|mildew/.test(txt)) return "disease";
  if (/pest|insect|aphid|worm|beetle/.test(txt)) return "pest_damage";
  // Generic recommendation actions.
  if (/fertili/.test(txt)) return "nitrogen_deficiency";
  return null;
}

// Days since planting → coarse growth-stage hint for the AI prompt.
export function growthStage(crop: string, planting: string): string | null {
  if (!planting) return null;
  const days = Math.floor((Date.now() - new Date(planting).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  const wk = Math.round(days / 7);
  const c = crop.toLowerCase();
  // Very rough, just for AI context.
  if (c === "wheat" || c === "barley" || c === "oats" || c === "rye") {
    if (wk < 4) return `~${wk} weeks (emergence / tillering)`;
    if (wk < 10) return `~${wk} weeks (tillering / stem extension)`;
    if (wk < 16) return `~${wk} weeks (heading / flowering)`;
    return `~${wk} weeks (grain fill / ripening)`;
  }
  if (c === "corn") {
    if (wk < 4) return `~${wk} weeks (V1–V4)`;
    if (wk < 10) return `~${wk} weeks (V6–V12)`;
    if (wk < 14) return `~${wk} weeks (tasseling / silking)`;
    return `~${wk} weeks (grain fill / dent)`;
  }
  return `~${wk} weeks since planting`;
}

// Boundary may be stored as a single ring (legacy) or as an array of rings
// (multi-polygon fragmented fields). Always normalize to BoundaryRing[].
function normalizeBoundary(b: unknown): BoundaryRing[] | null {
  if (!b) return null;
  if (Array.isArray(b) && b.length > 0) {
    // Legacy: array of {lat,lng}
    if (typeof (b as any)[0]?.lat === "number") {
      return [b as BoundaryRing];
    }
    // Already array of rings
    if (Array.isArray((b as any)[0])) {
      return (b as any[]).filter(r => Array.isArray(r) && r.length >= 3) as BoundaryRing[];
    }
  }
  return null;
}

// --- helpers that run inside the MapContainer ---------------------------------
function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try { map.fitBounds(bounds as any, { padding: [40, 40] }); } catch { /* noop */ }
  }, [bounds, map]);
  return null;
}

function MouseReadout({ coordRef, zoomRef }: { coordRef: { current: HTMLDivElement | null }; zoomRef: { current: HTMLDivElement | null } }) {
  const map = useMap();
  const write = (lat: number, lng: number, z: number) => {
    if (coordRef.current) {
      coordRef.current.textContent = Number.isFinite(lat) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "—, —";
    }
    if (zoomRef.current) zoomRef.current.textContent = `Zoom ${Math.round(z)}`;
  };
  useMapEvents({
    mousemove: (e) => write(e.latlng.lat, e.latlng.lng, map.getZoom()),
    zoomend: () => write(NaN, NaN, map.getZoom()),
  });
  return null;
}

function MapControls({ fitTo }: { fitTo: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  const onFit = () => { if (fitTo) map.fitBounds(fitTo as any, { padding: [40, 40] }); };
  return (
    <div className="absolute bottom-12 right-4 z-[1000] flex flex-col gap-1.5">
      <button onClick={onFit} title="Zoom to fit"
        className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
        <Maximize2 className="h-4 w-4" />
      </button>
      <button onClick={() => map.zoomIn()} title="Zoom in"
        className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
        <Plus className="h-4 w-4" />
      </button>
      <button onClick={() => map.zoomOut()} title="Zoom out"
        className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
}

// --- Measure tool ------------------------------------------------------------
// Geodesic polygon area (spherical excess approximation, sufficient for fields).
function polygonAreaM2(latlngs: L.LatLng[]): number {
  const R = 6378137;
  const n = latlngs.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % n];
    area +=
      ((p2.lng - p1.lng) * Math.PI) / 180 *
      (2 + Math.sin((p1.lat * Math.PI) / 180) + Math.sin((p2.lat * Math.PI) / 180));
  }
  return Math.abs((area * R * R) / 2);
}

export type MeasureStats = {
  active: boolean;
  finished: boolean;
  count: number;
  distM: number;
  areaM2: number;
  liveDistM: number; // includes preview segment to cursor
};

function MeasureTool({
  active, visible, onStats,
}: { active: boolean; visible: boolean; onStats: (s: MeasureStats) => void }) {
  const map = useMap();
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const [cursor, setCursor] = useState<L.LatLng | null>(null);
  const [finished, setFinished] = useState(false);

  // Disable dblclick zoom while measuring so dblclick finishes the line
  useEffect(() => {
    if (active) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [active, map]);

  // Clear everything when tool toggles off
  useEffect(() => {
    if (!active) { setPoints([]); setCursor(null); setFinished(false); }
  }, [active]);

  useMapEvents({
    click(e) {
      if (!active) {
        // "Click anywhere else to clear" once a measurement is shown.
        if (points.length) { setPoints([]); setCursor(null); setFinished(false); }
        return;
      }
      if (finished) { setPoints([e.latlng]); setFinished(false); setCursor(null); return; }
      setPoints(p => [...p, e.latlng]);
    },
    mousemove(e) {
      if (active && !finished && points.length > 0) setCursor(e.latlng);
    },
    dblclick(e) {
      if (!active) return;
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e as any);
      setFinished(true);
      setCursor(null);
    },
  });

  // Draw the measurement layer
  useEffect(() => {
    if (!visible) return;
    const group = L.layerGroup().addTo(map);
    const live: L.LatLng[] = finished
      ? points
      : (cursor && points.length ? [...points, cursor] : points);

    if (finished && points.length >= 3) {
      L.polygon(points, {
        color: "#4CAF50", weight: 1, dashArray: "2 4",
        fillColor: "#4CAF50", fillOpacity: 0.08, interactive: false,
      }).addTo(group);
    }
    if (live.length >= 2) {
      L.polyline(live, {
        color: "#4CAF50", weight: 2, dashArray: "6 6",
        interactive: false, lineCap: "round",
      }).addTo(group);
    }
    points.forEach((p, i) => {
      L.circleMarker(p, {
        radius: 4, color: "#4CAF50", weight: 2,
        fillColor: i === 0 ? "#4CAF50" : "#0f0f0f", fillOpacity: 1,
        interactive: false,
      }).addTo(group);
    });
    return () => { group.remove(); };
  }, [points, cursor, finished, map, visible]);

  // Report stats up to parent
  useEffect(() => {
    const live = finished ? points : (cursor && points.length ? [...points, cursor] : points);
    let liveDist = 0;
    for (let i = 1; i < live.length; i++) liveDist += live[i - 1].distanceTo(live[i]);
    let finalDist = 0;
    for (let i = 1; i < points.length; i++) finalDist += points[i - 1].distanceTo(points[i]);
    onStats({
      active, finished,
      count: points.length,
      distM: finalDist,
      liveDistM: liveDist,
      areaM2: finished && points.length >= 3 ? polygonAreaM2(points) : 0,
    });
  }, [active, finished, points, cursor, onStats]);

  return null;
}

// --- Annotation tool ---------------------------------------------------------
// Pen strokes and text labels. Persisted in localStorage per-task. Hidden when
// the "Annotations" layer is toggled off.
export type Annotation =
  | {
      id: string;
      kind: "stroke";
      stroke: { lat: number; lng: number }[];
      color: string;
      width: number;
      createdAt: number;
    }
  | {
      id: string;
      kind: "text";
      at: { lat: number; lng: number };
      text: string;
      color: string;
      createdAt: number;
    };

function loadAnnotations(taskId: string): Annotation[] {
  try {
    const raw = localStorage.getItem(`annotations:${taskId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Back-compat: old strokes had no `kind` field.
    return arr.map((a: any) => (a.kind ? a : { ...a, kind: "stroke" }));
  } catch { return []; }
}
function saveAnnotations(taskId: string, list: Annotation[]) {
  try { localStorage.setItem(`annotations:${taskId}`, JSON.stringify(list)); } catch { /* noop */ }
}

function AnnotateTool({
  active, mode, color, width, visible, annotations, setAnnotations, taskId,
}: {
  active: boolean;
  mode: "pen" | "text" | "select";
  color: string;
  width: number;
  visible: boolean;
  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  taskId: string;
}) {
  const map = useMap();
  const drawingRef = useRef<{ pts: L.LatLng[]; line: L.Polyline | null; drawing: boolean }>({
    pts: [], line: null, drawing: false,
  });

  // While pen is active, hijack map dragging so dragging the mouse draws.
  useEffect(() => {
    if (!active) return;
    const container = map.getContainer();
    if (mode === "select") {
      // Select mode keeps map panning enabled; per-marker drag is wired in
      // the saved-strokes effect.
      container.style.cursor = "default";
      return () => { container.style.cursor = ""; };
    }
    map.dragging.disable();
    if (mode === "text") {
      // High-contrast "T" cursor so it's visible over satellite & ortho imagery.
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>
        <g stroke='black' stroke-width='3' fill='white' font-family='sans-serif' font-weight='800' font-size='18'>
          <text x='14' y='20' text-anchor='middle' paint-order='stroke'>T</text>
        </g>
        <circle cx='14' cy='14' r='1.5' fill='black'/>
      </svg>`;
      const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 14 14, text`;
      container.style.cursor = url;
    } else {
      container.style.cursor = "crosshair";
    }

    if (mode === "text") {
      const onClickText = (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        const text = window.prompt("Label text:");
        if (!text || !text.trim()) return;
        const ann: Annotation = {
          id: crypto.randomUUID(), kind: "text",
          at: { lat: e.latlng.lat, lng: e.latlng.lng },
          text: text.trim(), color, createdAt: Date.now(),
        };
        setAnnotations(prev => {
          const next = [...prev, ann];
          saveAnnotations(taskId, next);
          return next;
        });
      };
      map.on("click", onClickText);
      return () => {
        map.off("click", onClickText);
        map.dragging.enable();
        container.style.cursor = "";
      };
    }

    // Pen mode — use pointer events on the container so the line ONLY grows
    // while the button is held, even if the pointer leaves the map.
    const toLatLng = (ev: PointerEvent): L.LatLng => {
      const rect = container.getBoundingClientRect();
      const pt = L.point(ev.clientX - rect.left, ev.clientY - rect.top);
      return map.containerPointToLatLng(pt);
    };
    const commit = () => {
      const d = drawingRef.current;
      if (d.line) { try { d.line.remove(); } catch { /* noop */ } }
      if (d.pts.length >= 1) {
        // single-point click → tiny dot stroke
        if (d.pts.length === 1) d.pts.push(d.pts[0]);
        const ann: Annotation = {
          id: crypto.randomUUID(), kind: "stroke",
          stroke: d.pts.map(p => ({ lat: p.lat, lng: p.lng })),
          color, width, createdAt: Date.now(),
        };
        setAnnotations(prev => {
          const next = [...prev, ann];
          saveAnnotations(taskId, next);
          return next;
        });
      }
      drawingRef.current = { pts: [], line: null, drawing: false };
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      try { container.setPointerCapture(ev.pointerId); } catch { /* noop */ }
      const ll = toLatLng(ev);
      drawingRef.current = {
        pts: [ll], drawing: true,
        line: L.polyline([ll], {
          color, weight: width, opacity: 0.95,
          lineCap: "round", lineJoin: "round", interactive: false,
        }).addTo(map),
      };
    };
    const onMove = (ev: PointerEvent) => {
      const d = drawingRef.current;
      if (!d.drawing || !d.line) return;
      const ll = toLatLng(ev);
      const last = d.pts[d.pts.length - 1];
      if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(ll)) < 2) return;
      d.pts.push(ll);
      d.line.addLatLng(ll);
    };
    const onUp = (ev: PointerEvent) => {
      if (!drawingRef.current.drawing) return;
      try { container.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      commit();
    };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      map.dragging.enable();
      container.style.cursor = "";
      if (drawingRef.current.line) {
        try { drawingRef.current.line.remove(); } catch { /* noop */ }
      }
      drawingRef.current = { pts: [], line: null, drawing: false };
    };
  }, [active, mode, color, width, map, setAnnotations, taskId]);

  // Saved strokes + text labels layer. Text labels become draggable while the
  // Select tool is active.
  const editable = active && mode === "select";
  useEffect(() => {
    if (!visible) return;
    const group = L.layerGroup().addTo(map);
    annotations.forEach(a => {
      if (a.kind === "stroke") {
        const pts = (a.stroke ?? []).map(p => [p.lat, p.lng] as [number, number]);
        if (pts.length < 2) return;
        const line = L.polyline(pts, {
          color: a.color, weight: a.width || 3, opacity: 0.95,
          lineCap: "round", lineJoin: "round",
        });
        group.addLayer(line);
      } else if (a.kind === "text") {
        const icon = L.divIcon({
          className: "annotation-text-label",
          html: `<div style="background:rgba(20,20,20,0.85);border:1px solid ${a.color};color:${a.color};padding:3px 7px;border-radius:3px;font-size:11px;font-weight:500;white-space:nowrap;font-family:ui-sans-serif,system-ui;cursor:${editable ? "move" : "default"};box-shadow:${editable ? `0 0 0 1px ${a.color}66` : "none"};">${a.text.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]!))}</div>`,
          iconSize: undefined as any,
          iconAnchor: [0, 0],
        });
        const m = L.marker([a.at.lat, a.at.lng], {
          icon,
          interactive: editable,
          draggable: editable,
        }).addTo(group);
        if (editable) {
          m.on("dragend", () => {
            const ll = m.getLatLng();
            setAnnotations(prev => {
              const next = prev.map(x =>
                x.id === a.id && x.kind === "text"
                  ? { ...x, at: { lat: ll.lat, lng: ll.lng } }
                  : x
              );
              saveAnnotations(taskId, next);
              return next;
            });
          });
          m.on("dblclick", (e) => {
            L.DomEvent.stopPropagation(e);
            const next = window.prompt("Edit label:", a.text);
            if (next == null) return;
            const t = next.trim();
            setAnnotations(prev => {
              const out = t
                ? prev.map(x => x.id === a.id && x.kind === "text" ? { ...x, text: t } : x)
                : prev.filter(x => x.id !== a.id);
              saveAnnotations(taskId, out);
              return out;
            });
          });
        }
      }
    });
    return () => { group.remove(); };
  }, [annotations, visible, map, editable, setAnnotations, taskId]);

  return null;
}

function MeasurePanel({ stats }: { stats: MeasureStats }) {
  if (!stats.active && stats.count === 0) return null;
  const mToFt = (m: number) => m * 3.28084;
  const m2ToAcre = (a: number) => a / 4046.8564224;
  const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  const dist = stats.finished ? stats.distM : stats.liveDistM;
  return (
    <div
      className="absolute top-4 left-16 z-[1001] w-64 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
      style={{ background: "#161616" }}
    >
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
        <Ruler className="h-3.5 w-3.5 text-[#4CAF50]" />
        <div className="text-xs font-medium">Measure</div>
        <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">
          {stats.finished ? "Done" : stats.active ? (stats.count === 0 ? "Click to start" : "Dbl-click to finish") : "Click map to clear"}
        </div>
      </div>
      {stats.count === 0 ? (
        <div className="text-[11px] text-neutral-400 leading-relaxed">
          Click on the map to drop points. Distance updates live. Double-click to close the shape and reveal area.
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">
              {stats.finished ? "Perimeter" : "Distance"}
            </div>
            <div className="font-mono tabular-nums text-[#f0f0f0]">{fmt(dist)} m</div>
            <div className="font-mono tabular-nums text-neutral-500 text-[11px]">{fmt(mToFt(dist), 0)} ft</div>
          </div>
          {stats.finished && stats.areaM2 > 0 && (
            <div className="pt-2 border-t border-[#222]">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Area</div>
              <div className="font-mono tabular-nums text-[#4CAF50]">{fmt(stats.areaM2 / 10000, 3)} ha</div>
              <div className="font-mono tabular-nums text-neutral-500 text-[11px]">{fmt(m2ToAcre(stats.areaM2), 3)} ac · {fmt(stats.areaM2, 0)} m²</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- AI zones layer ----------------------------------------------------------
export type AiZone = {
  id: string;
  name: string;
  issue: string;
  severity: "low" | "medium" | "high";
  tier?: 1 | 2;
  coverage_pct: number;
  recommendation: { action: string; product?: string; dose?: string; rationale?: string } | null;
  ring: { lat: number; lng: number }[];
};

const sevColor = (s: AiZone["severity"]) =>
  s === "high" ? "#ef4444" : s === "medium" ? "#f59e0b" : "#eab308";

function AiZonesLayer({
  zones, selectedId, onSelect, onUpdate, onDelete, boundaryAreaHa, settings,
}: {
  zones: AiZone[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, ring: { lat: number; lng: number }[]) => void;
  onDelete: (id: string) => void;
  boundaryAreaHa: number | null;
  settings: FarmerSettings;
}) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const container = map.getContainer();
    const deletedIds = new Set<string>();
    const handlePopupDelete = (evt: Event) => {
      const btn = (evt.target as HTMLElement | null)?.closest?.("button[data-aiz-delete]") as HTMLButtonElement | null;
      const id = btn?.dataset.aizDelete;
      if (!id) return;
      evt.preventDefault();
      evt.stopPropagation();
      if ("stopImmediatePropagation" in evt) evt.stopImmediatePropagation();
      if (deletedIds.has(id)) return;
      deletedIds.add(id);
      map.closePopup();
      onDelete(id);
    };
    container.addEventListener("pointerdown", handlePopupDelete, true);
    container.addEventListener("click", handlePopupDelete, true);
    zones.forEach((z) => {
      const color = sevColor(z.severity);
      const poly = L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: selectedId === z.id ? 3 : 2,
        fillColor: color, fillOpacity: selectedId === z.id ? 0.35 : 0.25,
      });
      poly.bindTooltip(`${z.name}`, {
        permanent: false, sticky: true, opacity: 1, direction: "top",
        className: "ai-zone-label",
      });
      // Real geodesic area of the on-screen polygon — what the farmer actually
      // pays to treat. No severity multipliers, no AI coverage estimate.
      const m2 = polygonAreaM2(z.ring.map(p => L.latLng(p.lat, p.lng)));
      const acresNum = m2 / 4046.8564224;
      const acres = acresNum.toFixed(2);
      const ha = (m2 / 10000).toFixed(3);
      const rec = z.recommendation;
      // Cost = farmer's actual per-acre input price × real polygon acreage.
      // Map AI issue → canonical key → farmer setting key.
      const costKey = issueToCostKey(z);
      const inputKey = costKey ? COST_MAP[costKey] : null;
      const ratePerAc = inputKey ? Number(settings.input_costs[inputKey] ?? 0) : 0;
      const inputLabel = inputKey ? INPUT_LABELS[inputKey] : null;
      const noChem = costKey === "waterlogging";
      const inputAvailable = inputKey ? !!settings.available_inputs[inputKey] : true;
      const estCost = (acresNum * ratePerAc).toFixed(2);
      const acresStr = acresNum.toFixed(3);
      const sevBadge = `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;background:${color}33;color:${color};border:1px solid ${color}">${z.severity}</span>`;
      const html = `
        <div style="font-family:inherit;color:#f0f0f0;background:#161616;padding:10px 12px;min-width:240px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <div style="font-weight:600;font-size:13px">${escapeHtml(z.name)}</div>
            ${sevBadge}
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-bottom:8px">${escapeHtml(z.issue)}</div>
          <div style="font-size:11px;color:#9ca3af;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:8px">
            <div>Area</div><div style="text-align:right;color:#f0f0f0;font-family:ui-monospace,monospace">${acres} ac</div>
            <div></div><div style="text-align:right;color:#6b7280;font-family:ui-monospace,monospace">${ha} ha</div>
            ${noChem
              ? `<div style="grid-column:1/-1;color:#f59e0b;font-size:11px;border-top:1px solid #222;padding-top:6px;margin-top:2px">Drainage work required — consult agronomist (no chemical fix).</div>`
              : inputKey
                ? `<div>Est. cost</div><div style="text-align:right;color:#f0f0f0;font-family:ui-monospace,monospace">$${estCost}</div>
                   <div style="grid-column:1/-1;color:#6b7280;font-family:ui-monospace,monospace;font-size:10px;text-align:right">${acresStr} ac × $${ratePerAc.toFixed(2)}/ac ${inputLabel ? `(${escapeHtml(inputLabel)})` : ""} = $${estCost}</div>
                   ${!inputAvailable ? `<div style="grid-column:1/-1;color:#f59e0b;font-size:10px;text-align:right">⚠ ${escapeHtml(inputLabel ?? "")} marked unavailable in Settings</div>` : ""}`
                : `<div style="grid-column:1/-1;color:#6b7280;font-size:10px;text-align:right">No cost mapping for this issue type.</div>`
            }
          </div>
          ${rec ? `
            <div style="border-top:1px solid #222;padding-top:8px;font-size:11px">
              <div style="color:#4CAF50;font-weight:600;margin-bottom:3px">Recommended treatment</div>
              <div style="color:#f0f0f0;margin-bottom:2px">${escapeHtml(rec.action ?? "—")}</div>
              ${rec.product ? `<div style="color:#9ca3af">Product: <span style="color:#f0f0f0">${escapeHtml(rec.product)}</span></div>` : ""}
              ${rec.dose ? `<div style="color:#9ca3af">Rate: <span style="color:#f0f0f0">${escapeHtml(rec.dose)}</span></div>` : ""}
              ${rec.rationale ? `<div style="color:#6b7280;margin-top:4px;font-style:italic">${escapeHtml(rec.rationale)}</div>` : ""}
            </div>` : `
            <div style="border-top:1px solid #222;padding-top:8px;font-size:11px;color:#6b7280">
              No specific treatment — monitor and re-scan after weather change.
            </div>`}
          <button data-aiz-delete="${escapeHtml(z.id)}" style="margin-top:9px;font-size:11px;color:#ef4444;background:transparent;border:1px solid rgba(239,68,68,0.45);border-radius:3px;padding:3px 8px;cursor:pointer">Delete</button>
        </div>
      `;
      poly.bindPopup(html, {
        className: "ai-zone-popup",
        maxWidth: 320, closeButton: true, autoPan: true, autoClose: true, closeOnClick: true,
      });
      poly.on("click", (e) => { L.DomEvent.stopPropagation(e); onSelect(z.id); poly.openPopup(e.latlng); });
      group.addLayer(poly);
      if (selectedId === z.id) {
        poly.bringToFront();
        (poly as any).pm.enable({
          allowSelfIntersection: false, snappable: true, snapDistance: 15,
          draggable: true, hideMiddleMarkers: false,
        });
        poly.on("pm:markerdragend pm:dragend pm:vertexadded pm:vertexremoved", () => {
          const latlngs = (poly.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
          onUpdate(z.id, latlngs);
        });
      }
    });
    return () => {
      container.removeEventListener("pointerdown", handlePopupDelete, true);
      container.removeEventListener("click", handlePopupDelete, true);
      group.remove();
    };
  }, [map, zones, selectedId, onSelect, onUpdate, onDelete, boundaryAreaHa]);
  return null;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}

// ---- User polygon annotations ------------------------------------------------
export type UserPoly = {
  id: string;
  name: string;
  issue_type: string;
  color: string;
  notes: string | null;
  ring: { lat: number; lng: number }[];
  area_hectares: number;
  created_at?: string;
};

const USER_POLY_COLORS: Record<string, string> = {
  orange: "#fb923c", red: "#ef4444", yellow: "#facc15",
};
const USER_POLY_ISSUES = ["Bare soil", "Waterlogging", "Pest damage", "Weed pressure", "Other"] as const;

function UserPolyLayer({
  polys, onDelete,
}: { polys: UserPoly[]; onDelete: (id: string) => void }) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const container = map.getContainer();
    const deletedIds = new Set<string>();
    const handlePopupDelete = (evt: Event) => {
      const btn = (evt.target as HTMLElement | null)?.closest?.("button[data-uap-delete]") as HTMLButtonElement | null;
      const id = btn?.dataset.uapDelete;
      if (!id) return;
      evt.preventDefault();
      evt.stopPropagation();
      if ("stopImmediatePropagation" in evt) evt.stopImmediatePropagation();
      if (deletedIds.has(id)) return;
      deletedIds.add(id);
      map.closePopup();
      onDelete(id);
    };
    container.addEventListener("pointerdown", handlePopupDelete, true);
    container.addEventListener("click", handlePopupDelete, true);
    polys.forEach((p) => {
      const color = USER_POLY_COLORS[p.color] ?? "#fb923c";
      const poly = L.polygon(p.ring.map(pt => [pt.lat, pt.lng] as [number, number]), {
        color, weight: 2, fillColor: color, fillOpacity: 0.18, dashArray: "4 4",
      });
      poly.bindTooltip(p.name, { sticky: true, opacity: 1, className: "ai-zone-label", direction: "top" });
      const acres = (p.area_hectares * 2.4710538147).toFixed(2);
      const html = `
        <div style="font-family:inherit;color:#f0f0f0;background:#161616;padding:10px 12px;min-width:220px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <div style="height:10px;width:10px;border-radius:2px;background:${color}"></div>
            <div style="font-weight:600;font-size:13px">${escapeHtml(p.name)}</div>
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-bottom:6px">${escapeHtml(p.issue_type)}</div>
          <div style="font-size:11px;color:#9ca3af;margin-bottom:8px">Area: <span style="color:#f0f0f0;font-family:ui-monospace,monospace">${p.area_hectares.toFixed(3)} ha · ${acres} ac</span></div>
          ${p.notes ? `<div style="font-size:11px;color:#d1d5db;border-top:1px solid #222;padding-top:6px;margin-bottom:8px">${escapeHtml(p.notes)}</div>` : ""}
          <button data-uap-delete="${p.id}" style="font-size:11px;color:#ef4444;background:transparent;border:1px solid rgba(239,68,68,0.4);border-radius:3px;padding:3px 8px;cursor:pointer">Delete</button>
        </div>
      `;
      poly.bindPopup(html, { className: "ai-zone-popup", maxWidth: 300, autoClose: true, closeOnClick: true });
      poly.on("click", (e: any) => { L.DomEvent.stopPropagation(e); poly.openPopup(e.latlng); });
      group.addLayer(poly);
    });
    return () => {
      container.removeEventListener("pointerdown", handlePopupDelete, true);
      container.removeEventListener("click", handlePopupDelete, true);
      group.remove();
    };
  }, [map, polys, onDelete]);
  return null;
}

// --- Field boundary tool ----------------------------------------------------
// Lets the operator outline their actual farm field on top of the orthomosaic.
// The polygon persists on `fields.boundary` and drives the field's true area
// plus where AI analysis is allowed to run.
function BoundaryTool({
  mode, boundary, visible, onCreated, onEdited,
  onDeleteRing, activeIdx, setActiveIdx,
}: {
  mode: "off" | "draw" | "edit";
  boundary: BoundaryRing[] | null;
  visible: boolean;
  onCreated: (ring: BoundaryRing) => void;
  onEdited: (index: number, ring: BoundaryRing) => void;
  onDeleteRing: (index: number) => void;
  activeIdx: number | null;
  setActiveIdx: (i: number | null) => void;
}) {
  const map = useMap();

  // Draw mode: enable Geoman polygon draw. After each completed polygon we
  // append it as a new ring and keep draw mode active so fragmented fields can
  // be outlined in one pass. Map panning stays enabled the whole time.
  useEffect(() => {
    if (mode !== "draw") return;
    const pmAny = (map as any).pm;
    if (!pmAny) return;
    // Make absolutely sure interactions like pan/zoom are not blocked.
    try { map.dragging.enable(); map.scrollWheelZoom.enable(); } catch { /* noop */ }
    try {
      pmAny.enableDraw("Polygon", {
        snappable: true, snapDistance: 15, allowSelfIntersection: false,
        continueDrawing: true,
        templineStyle: { color: "#22d3ee", weight: 2, dashArray: "6 4" },
        hintlineStyle: { color: "#22d3ee", dashArray: "4 4" },
        pathOptions: { color: "#22d3ee", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.08 },
      });
    } catch { /* noop */ }
    const handle = (e: any) => {
      const layer = e.layer as L.Polygon;
      const ring = (layer.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
      try { layer.remove(); } catch { /* noop */ }
      onCreated(ring);
      // Re-arm draw so the user can immediately outline another fragment.
      try {
        pmAny.enableDraw("Polygon", {
          snappable: true, snapDistance: 15, allowSelfIntersection: false,
          continueDrawing: true,
          templineStyle: { color: "#22d3ee", weight: 2, dashArray: "6 4" },
          hintlineStyle: { color: "#22d3ee", dashArray: "4 4" },
          pathOptions: { color: "#22d3ee", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.08 },
        });
      } catch { /* noop */ }
    };
    map.on("pm:create", handle);
    return () => {
      map.off("pm:create", handle);
      try { pmAny.disableDraw(); } catch { /* noop */ }
    };
  }, [mode, map, onCreated]);

  // Render every boundary ring (with optional editing). Each ring is a
  // separate Leaflet polygon so a fragmented field can have multiple parts.
  useEffect(() => {
    if (!visible || !boundary || boundary.length === 0) return;
    const polys: L.Polygon[] = [];
    boundary.forEach((ring, idx) => {
      if (!ring || ring.length < 3) return;
      const isActive = idx === activeIdx;
      const editable = mode === "edit" || mode === "draw";
      const poly = L.polygon(ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: isActive ? "#fbbf24" : "#22d3ee",
        weight: isActive ? 3.5 : 2.5,
        dashArray: isActive ? undefined : "6 4",
        fillColor: isActive ? "#fbbf24" : "#22d3ee",
        fillOpacity: mode === "edit" ? (isActive ? 0.12 : 0.04) : 0.08,
        // When not editing the boundary, let clicks pass through to AI zones,
        // user annotations, and drawing tools underneath.
        interactive: editable,
      }).addTo(map);
      if (editable) {
        poly.bindTooltip(
          boundary.length > 1
            ? `Field boundary · part ${idx + 1}${isActive ? " (selected)" : " — click to select"}`
            : "Field boundary",
          { sticky: true, opacity: 1, className: "ai-zone-label" },
        );
        poly.on("click", (ev: any) => {
          L.DomEvent.stopPropagation(ev);
          setActiveIdx(idx);
        });
      }
      if (editable && isActive) {
        poly.bringToFront();
        try {
          (poly as any).pm.enable({
            allowSelfIntersection: false, snappable: true, snapDistance: 15,
            draggable: true, hideMiddleMarkers: false,
          });
        } catch { /* noop */ }
        const handle = () => {
          const updated = (poly.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
          onEdited(idx, updated);
        };
        poly.on("pm:markerdragend pm:dragend pm:vertexadded pm:vertexremoved pm:edit", handle);
      }
      polys.push(poly);
    });
    return () => { polys.forEach(p => { try { p.remove(); } catch { /* noop */ } }); };
  }, [boundary, visible, mode, map, onEdited, onDeleteRing, activeIdx, setActiveIdx]);

  return null;
}

// --- layer tree ---------------------------------------------------------------
type LayerState = {
  annotations: boolean;
  design: boolean;
  orthomosaic: boolean;
  ndvi: boolean;
  measurements: boolean;
  boundary: boolean;
  userAnnotations: boolean;
};

function LayerRow({
  label, icon: Icon, checked, onToggle, indent = 0,
}: { label: string; icon: any; checked: boolean; onToggle: () => void; indent?: number }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#222] text-sm text-[#f0f0f0] cursor-pointer"
      style={{ paddingLeft: 8 + indent * 14 }}
      onClick={onToggle}
    >
      <input type="checkbox" checked={checked} readOnly
        className="h-3.5 w-3.5 accent-[#4CAF50]" />
      <Icon className="h-3.5 w-3.5 text-neutral-500" />
      <span className="flex-1 truncate">{label}</span>
      {checked
        ? <Eye className="h-3.5 w-3.5 text-[#4CAF50]" />
        : <EyeOff className="h-3.5 w-3.5 text-neutral-600" />}
    </div>
  );
}

// -----------------------------------------------------------------------------
export default function OrthomosaicViewer() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [field, setField] = useState<FieldRow | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bounds, setBounds] = useState<L.LatLngBoundsExpression | null>(null);
  const [maxNative, setMaxNative] = useState<number>(20);
  const [tileTemplate, setTileTemplate] = useState<string | null>(null);
  const [baking, setBaking] = useState<{ completed: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ status: string; progress: number } | null>(null);
  const [extracting, setExtracting] = useState<{ stage: string; pct: number } | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    annotations: true, design: false, orthomosaic: true, ndvi: false, measurements: true, boundary: true, userAnnotations: true,
  });
  const [ndviInfo, setNdviInfo] = useState<{ bands: number; index: "ndvi" | "vari"; label: string } | null>(null);
  type TabKey = "field" | "weather" | "ai" | "planner" | "reports" | "history" | "settings";
  const [activeTab, setActiveTab] = useState<TabKey>("field");
  const [openTabs, setOpenTabs] = useState<TabKey[]>(["field"]);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    health_score: number; summary: string;
    issues: { label: string; severity: string; description: string }[];
    zones: AiZone[];
  } | null>(null);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [showAiZones, setShowAiZones] = useState(true);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Database-backed manual polygon annotations (farmer's anomalies).
  const [userPolys, setUserPolys] = useState<UserPoly[]>([]);
  // Draft polygon waiting for the metadata form modal.
  const [draftUserPoly, setDraftUserPoly] = useState<DraftPolygon | null>(null);
  const [userPolyToolActive, setUserPolyToolActive] = useState(false);
  const [boundary, setBoundary] = useState<BoundaryRing[] | null>(null);
  const [boundaryMode, setBoundaryMode] = useState<"off" | "draw" | "edit">("off");
  const [boundaryDirty, setBoundaryDirty] = useState(false);
  const [boundarySaving, setBoundarySaving] = useState(false);
  const [activeBoundaryIdx, setActiveBoundaryIdx] = useState<number | null>(null);
  const cursorCoordRef = useRef<HTMLDivElement | null>(null);
  const cursorZoomRef = useRef<HTMLDivElement | null>(null);

  // Farmer-defined settings (crop, dates, input costs, available inputs).
  // Lives in fields.settings (JSON) and gates AI recommendations + cost math.
  const [settings, setSettings] = useState<FarmerSettings>(DEFAULT_FARMER_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = useState<number | null>(null);

  // Lightweight copies of fleet + last-flight data for the Reports tab so it
  // doesn't depend on the PlannerTab being mounted.
  type ParentDrone = { id: string; name: string; model: string; battery: number };
  type ParentFlightLog = {
    id: string; date_flown: string;
    battery_start: number | null; battery_end: number | null;
    tank_refills: number; zones_completed: string[] | null;
    acres_treated: number | null; liters_applied: number | null;
    notes: string | null;
  };
  const [parentDrones, setParentDrones] = useState<ParentDrone[]>([]);
  const [parentLastLog, setParentLastLog] = useState<ParentFlightLog | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("drones")
        .select("id, name, model, battery").order("created_at");
      if (!cancelled) setParentDrones((data as ParentDrone[] | null) ?? []);
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("flight_logs")
        .select("id, date_flown, battery_start, battery_end, tank_refills, zones_completed, acres_treated, liters_applied, notes")
        .eq("scan_id", taskId)
        .order("date_flown", { ascending: false })
        .limit(1).maybeSingle();
      if (!cancelled) setParentLastLog((data as ParentFlightLog | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [taskId, activeTab]);
  const parentActiveDrone = parentDrones.find(d => d.id === settings.flight_plan.drone_id) ?? null;

  // Load saved annotations whenever the active scan changes.
  useEffect(() => {
    if (!taskId) return;
    setAnnotations(loadAnnotations(taskId));
  }, [taskId]);

  // Load DB-backed user annotations whenever the active scan changes.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_annotations")
        .select("id, name, issue_type, color, notes, ring, area_hectares, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) { console.warn("[user_annotations] load failed", error); return; }
      setUserPolys((data ?? []).map((r: any) => ({
        id: r.id, name: r.name, issue_type: r.issue_type, color: r.color,
        notes: r.notes, ring: r.ring as { lat: number; lng: number }[],
        area_hectares: Number(r.area_hectares ?? 0),
        created_at: r.created_at,
      })));
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const run = async () => {
      console.log("[OrthoViewer] taskId from route:", taskId);
      // Always start clean - never reuse cached bounds / tile template across opens.
      setTileTemplate(null);
      setBounds(null);
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setErr("Please sign in."); return; }
      setToken(s.session.access_token);

      const { data: t } = await supabase.from("odm_tasks")
        .select("odm_uuid, field_id, created_at, ai_analysis, ai_analysis_at").eq("id", taskId).maybeSingle();
      console.log("[OrthoViewer] task row:", t);
      if (!t?.odm_uuid) { setErr("Scan not found"); return; }
      setTask(t as TaskRow);

      // Rehydrate saved AI analysis so treatment zones survive page reloads.
      const saved = (t as any).ai_analysis;
      if (saved && typeof saved === "object" && Array.isArray(saved.zones)) {
        setAnalysis({
          health_score: Number(saved.health_score ?? 0),
          summary: String(saved.summary ?? ""),
          issues: Array.isArray(saved.issues) ? saved.issues : [],
          zones: saved.zones,
        });
      }

      const { data: f } = await supabase.from("fields")
        .select("id, name, boundary, boundary_area_hectares, settings").eq("id", t.field_id).maybeSingle();
      if (f) {
        setField(f as FieldRow);
        setBoundary(normalizeBoundary((f as any).boundary));
        const saved = (f as any).settings;
        if (saved && typeof saved === "object") {
          setSettings({
            ...DEFAULT_FARMER_SETTINGS,
            ...saved,
            input_costs: { ...DEFAULT_FARMER_SETTINGS.input_costs, ...(saved.input_costs ?? {}) },
            available_inputs: { ...DEFAULT_FARMER_SETTINGS.available_inputs, ...(saved.available_inputs ?? {}) },
            custom_inputs: Array.isArray(saved.custom_inputs) ? saved.custom_inputs.slice(0, 3) : [],
            flight_plan: {
              ...DEFAULT_FARMER_SETTINGS.flight_plan,
              ...(saved.flight_plan ?? {}),
              custom_specs: {
                ...DEFAULT_FARMER_SETTINGS.flight_plan.custom_specs,
                ...(saved.flight_plan?.custom_specs ?? {}),
              },
            },
          });
        }
      }

      // 1) Mint a signed URL to the orthophoto.tif sitting in Supabase Storage.
      // 2) Hand that URL to TiTiler to get bounds + tiles.
      try {
        // Cache-bust so neither the browser nor any intermediate CDN serves a
        // stale ortho-url response (which would contain an expired signed URL).
        const r = await fetch(`${FN_BASE}/ortho-url?task_id=${taskId}&_t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${s.session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (cancelled) return;
        if (r.status === 409) {
          // Still processing - show progress and retry in 5s.
          setPending({ status: j?.status ?? "processing", progress: j?.progress ?? 0 });
          setErr(null);
          timer = window.setTimeout(run, 5000);
          return;
        }
        if (r.status === 202 && j?.needsExtract) {
          // Backend can't produce the .tif directly (WebODM Lightning only serves
          // all.zip and extracting that on the edge OOMs). Stream-extract in the
          // browser, push the .tif straight to storage, then retry.
          setPending(null);
          setErr(null);
          try {
            await extractAndUpload(j.zipUrl, j.upload, (stage, pct) => {
              if (!cancelled) setExtracting({ stage, pct });
            });
            if (cancelled) return;
            setExtracting(null);
            timer = window.setTimeout(run, 200);
            return;
          } catch (e: any) {
            console.error("[OrthoViewer] client extraction failed", e);
            setExtracting(null);
            setErr(`Could not extract orthomosaic in browser: ${e?.message ?? e}`);
            return;
          }
        }
        if (!r.ok || !j?.url) {
          setPending(null);
          setErr(j?.error ?? "Orthomosaic not available yet.");
          return;
        }
        setPending(null);

        // Pull bounds from the tilejson the edge function returned (it called
        // TiTiler server-side to bypass browser CORS).
        const tj = j.tilejson;
        const b: any = tj?.bounds;
        if (Array.isArray(b) && b.length === 4) {
          // TiTiler returns bounds as [west, south, east, north] in WGS84.
          // Sanity-check: lat ∈ [-90,90], lng ∈ [-180,180]. If we see UTM-style
          // numbers we bail so the map doesn't fly off to a black void.
          const [w, s, e, n] = b as number[];
          console.log("[OrthoViewer] tilejson bounds (W,S,E,N):", w, s, e, n);
          if (Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) {
            setErr("Orthomosaic bounds are not in WGS84 (got projected coordinates). Re-process the scan.");
            return;
          }
          setBounds([[b[1], b[0]], [b[3], b[2]]] as L.LatLngBoundsExpression);
        } else {
          setErr("Could not load orthomosaic bounds.");
          return;
        }
        if (typeof tj?.maxzoom === "number") setMaxNative(Math.min(22, tj.maxzoom));

        // Drive the tile baker until it reports done, then point Leaflet at the
        // static pre-baked tiles served through the `tile` edge function.
        if (!t.odm_uuid) { setErr("Missing scan id"); return; }
        while (!cancelled) {
          const br = await fetch(`${FN_BASE}/bake-tiles?task_id=${taskId}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${s.session.access_token}` },
          });
          const bj = await br.json().catch(() => ({}));
          if (!br.ok) {
            setErr(bj?.error ?? "Tile baking failed.");
            return;
          }
          if (typeof bj.total === "number") {
            setBaking({ completed: bj.completed ?? 0, total: bj.total });
          }
          if (bj.done) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        if (cancelled) return;
        setBaking(null);
        setTileTemplate(`${TILE_BASE}/${t.odm_uuid}/{z}/{x}/{y}.png`);
      } catch (e) {
        console.error("[OrthoViewer] info failed", e);
        setErr("Could not load orthomosaic metadata.");
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [taskId]);

  const tileUrl = tileTemplate;
  const ndviUrl = task?.odm_uuid ? `${NDVI_BASE}/${taskId}/{z}/{x}/{y}.png` : null;

  const runAnalysis = async () => {
    if (!taskId || !token) return;
    const validRings = (boundary ?? []).filter(r => r.length >= 3);
    if (validRings.length === 0) {
      setAnalysisErr("Define the field boundary first so the AI only analyzes your farmland.");
      return;
    }
    setAnalyzing(true); setAnalysisErr(null);
    try {
      const r = await fetch(`${FN_BASE}/analyze-ortho`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          boundary: validRings,
          field_settings: {
            crop_type: settings.crop_type || null,
            planting_date: settings.planting_date || null,
            harvest_date: settings.harvest_date || null,
            growth_stage: growthStage(settings.crop_type, settings.planting_date),
            available_inputs: Object.entries(settings.available_inputs)
              .filter(([, on]) => on)
              .map(([k]) => INPUT_LABELS[k as keyof typeof INPUT_LABELS]),
            unavailable_inputs: Object.entries(settings.available_inputs)
              .filter(([, on]) => !on)
              .map(([k]) => INPUT_LABELS[k as keyof typeof INPUT_LABELS]),
            custom_inputs: settings.custom_inputs.filter(c => c.name.trim()),
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Analysis failed");
      const payload = {
        health_score: j.health_score,
        summary: j.summary,
        issues: j.issues ?? [],
        zones: j.zones ?? [],
        watch_list: j.watch_list ?? [],
        data_source: j.data_source ?? "RGB",
        band_count: j.band_count ?? 3,
        ndvi_cells: j.ndvi_cells ?? [],
        disclaimer: j.disclaimer ?? "These zones show anomalies detected from aerial imagery. Ground inspection is recommended to confirm issue type before treatment. AcreSpray AI does not replace professional agronomic advice.",
      };
      setAnalysis(payload);
      setSelectedZone(j.zones?.[0]?.id ?? null);
      // Persist so it survives reloads.
      try {
        await supabase.from("odm_tasks")
          .update({ ai_analysis: payload as any, ai_analysis_at: new Date().toISOString() } as any)
          .eq("id", taskId);
      } catch (e) { console.warn("ai_analysis persist failed", e); }
    } catch (e: any) {
      setAnalysisErr(e?.message ?? String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const clearAnalysis = async () => {
    if (!taskId) return;
    if (!window.confirm("Clear the saved AI analysis for this scan?")) return;
    setAnalysis(null);
    setSelectedZone(null);
    try {
      await supabase.from("odm_tasks")
        .update({ ai_analysis: null, ai_analysis_at: null } as any)
        .eq("id", taskId);
    } catch (e) { console.warn("ai_analysis clear failed", e); }
  };

  // Boundary persistence ------------------------------------------------------
  // Multi-polygon: each ring is one fragment of the field. Users can keep
  // drawing more rings after the first one is closed.
  const handleBoundaryCreated = useCallback((ring: BoundaryRing) => {
    setBoundary(prev => {
      const next = prev ? [...prev, ring] : [ring];
      setActiveBoundaryIdx(next.length - 1);
      return next;
    });
    setBoundaryDirty(true);
  }, []);
  const handleBoundaryEdited = useCallback((index: number, ring: BoundaryRing) => {
    setBoundary(prev => {
      if (!prev) return prev;
      const next = prev.slice();
      next[index] = ring;
      return next;
    });
    setBoundaryDirty(true);
  }, []);
  const handleBoundaryDeleteRing = useCallback((index: number) => {
    setBoundary(prev => {
      if (!prev) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : null;
    });
    setActiveBoundaryIdx(prev => {
      if (prev === null) return null;
      if (prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
    setBoundaryDirty(true);
  }, []);
  const saveBoundary = async () => {
    if (!field || !boundary || boundary.length === 0) return;
    setBoundarySaving(true);
    try {
      const areaM2 = boundary.reduce(
        (sum, ring) => sum + polygonAreaM2(ring.map(p => L.latLng(p.lat, p.lng))),
        0,
      );
      const ha = areaM2 / 10000;
      const { error } = await supabase.from("fields")
        .update({
          boundary: boundary as any,
          boundary_area_hectares: Number(ha.toFixed(4)),
        } as any)
        .eq("id", field.id);
      if (error) throw error;
      setBoundaryDirty(false);
      setBoundaryMode("off");
      setField(prev => prev ? { ...prev, boundary_area_hectares: Number(ha.toFixed(4)) } : prev);
    } catch (e) {
      console.error("save boundary failed", e);
    } finally {
      setBoundarySaving(false);
    }
  };
  const clearBoundary = async () => {
    if (!field) return;
    if (!window.confirm("Remove this field's saved boundary?")) return;
    setBoundarySaving(true);
    try {
      await supabase.from("fields")
        .update({ boundary: null, boundary_area_hectares: null } as any)
        .eq("id", field.id);
      setBoundary(null);
      setBoundaryDirty(false);
      setBoundaryMode("off");
      setField(prev => prev ? { ...prev, boundary_area_hectares: null } : prev);
    } finally {
      setBoundarySaving(false);
    }
  };

  const updateZoneRing = useCallback((id: string, ring: { lat: number; lng: number }[]) => {
    setAnalysis(a => a ? { ...a, zones: a.zones.map(z => z.id === id ? { ...z, ring } : z) } : a);
  }, []);

  const deleteZone = (id: string) => {
    setAnalysis(a => {
      const next = a ? { ...a, zones: a.zones.filter(z => z.id !== id) } : a;
      // Persist immediately so the deletion survives reload / tab switch.
      if (next && taskId) {
        supabase.from("odm_tasks")
          .update({ ai_analysis: next as any, ai_analysis_at: new Date().toISOString() } as any)
          .eq("id", taskId)
          .then(({ error }) => { if (error) console.warn("deleteZone persist failed", error); });
      }
      return next;
    });
    if (selectedZone === id) setSelectedZone(null);
  };

  const exportFlightPlan = () => {
    if (!analysis) return;
    const fc = {
      type: "FeatureCollection",
      features: analysis.zones.map(z => ({
        type: "Feature",
        properties: {
          name: z.name, issue: z.issue, severity: z.severity,
          coverage_pct: z.coverage_pct,
          action: z.recommendation?.action,
          product: z.recommendation?.product,
          dose: z.recommendation?.dose,
        },
        geometry: {
          type: "Polygon",
          coordinates: [[
            ...z.ring.map(p => [p.lng, p.lat]),
            [z.ring[0].lng, z.ring[0].lat],
          ]],
        },
      })),
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `flight-plan-${taskId}.geojson`; a.click();
    URL.revokeObjectURL(url);
  };

  // ---- User annotations CRUD (DB-backed) ------------------------------------
  const saveUserPolygon = async (form: { name: string; issue_type: string; color: string; notes: string }) => {
    if (!draftUserPoly || !taskId) return;
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return;
    const row = {
      user_id: s.session.user.id,
      task_id: taskId,
      field_id: field?.id ?? null,
      name: form.name.trim() || "Annotation",
      issue_type: form.issue_type,
      color: form.color,
      notes: form.notes.trim() || null,
      ring: draftUserPoly.ring as any,
      area_hectares: Number(draftUserPoly.areaHa.toFixed(4)),
    };
    const { data, error } = await supabase.from("user_annotations").insert(row).select("*").single();
    if (error) { console.error(error); return; }
    setUserPolys(prev => [...prev, {
      id: data.id, name: data.name, issue_type: data.issue_type, color: data.color,
      notes: data.notes, ring: data.ring as any, area_hectares: Number(data.area_hectares ?? 0),
      created_at: data.created_at,
    }]);
    setDraftUserPoly(null);
    setUserPolyToolActive(false);
  };
  const deleteUserPolygon = async (id: string) => {
    const existing = userPolys.find(p => p.id === id);
    setUserPolys(prev => prev.filter(p => p.id !== id));
    const { error } = await supabase.from("user_annotations").delete().eq("id", id);
    if (error) {
      console.error(error);
      if (existing) setUserPolys(prev => prev.some(p => p.id === id) ? prev : [...prev, existing]);
    }
  };

  // ---- Farmer settings save (debounced via explicit Save button) -----------
  const saveSettings = async (next: FarmerSettings) => {
    if (!field?.id) return;
    setSettings(next);
    setSettingsSaving(true);
    try {
      const { error } = await supabase.from("fields")
        .update({ settings: next as any } as any)
        .eq("id", field.id);
      if (error) throw error;
      setSettingsSavedAt(Date.now());
    } catch (e) {
      console.error("[settings] save failed", e);
    } finally {
      setSettingsSaving(false);
    }
  };

  // Probe the COG once to figure out NDVI vs VARI and band count for the legend.
  useEffect(() => {
    if (!taskId || !token || !tileTemplate) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${NDVI_BASE}/info?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (!cancelled && r.ok) setNdviInfo(j);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [taskId, token, tileTemplate]);

  // Ctrl/Cmd+T opens the new-tab menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setNewTabOpen(o => !o);
      }
      if (e.key === "Escape") { setNewTabOpen(false); setLayersOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (err) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <div className="text-red-400 max-w-md text-center px-6">{err}</div>
        <a href="/app/fields" className="text-[#4CAF50] underline">Back to fields</a>
      </div>
    );
  }
  if (extracting) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4CAF50]" />
        <div>{extracting.stage}</div>
        <div className="w-64 h-1 bg-[#1a1a1a] overflow-hidden">
          <div className="h-full bg-[#4CAF50] transition-all" style={{ width: `${Math.max(2, Math.min(100, extracting.pct))}%` }} />
        </div>
        <div className="text-xs text-neutral-500">Extracting orthomosaic on this device.</div>
      </div>
    );
  }
  if (baking) {
    const pct = baking.total ? Math.round((baking.completed / baking.total) * 100) : 0;
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4CAF50]" />
        <div>Pre-rendering map tiles… {baking.completed} / {baking.total}</div>
        <div className="w-64 h-1 bg-[#1a1a1a] overflow-hidden">
          <div className="h-full bg-[#4CAF50] transition-all" style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <div className="text-xs text-neutral-500">One-time bake. Future opens load instantly.</div>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4CAF50]" />
        <div>{pending.status === "queued" ? "Queued on processing node…" : `Processing… ${pending.progress}%`}</div>
        <div className="text-xs text-neutral-500">Auto-refreshing every 5s.</div>
        <a href="/app/fields" className="text-[#4CAF50] underline text-xs">Back to fields</a>
      </div>
    );
  }
  if (!task || !token || !tileUrl || !bounds) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center text-sm text-neutral-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading orthomosaic…
      </div>
    );
  }

  const taskName = field?.name ?? "Scan";
  const ts = new Date(task.created_at).toLocaleString();

  // Compute field center from bounds so OSM tiles around the ortho load first
  // (instead of starting at [0,0] and panning over).
  const b = bounds as unknown as [[number, number], [number, number]];
  const center: [number, number] = [
    (b[0][0] + b[1][0]) / 2,
    (b[0][1] + b[1][1]) / 2,
  ];

  const score = analysis?.health_score;
  const scoreTone =
    score == null ? { dot: "#666", text: "text-neutral-500", label: "Not scored" }
    : score >= 70 ? { dot: "#4CAF50", text: "text-[#4CAF50]", label: `${score}/100 · Healthy` }
    : score >= 40 ? { dot: "#facc15", text: "text-yellow-400", label: `${score}/100 · Watch` }
    : { dot: "#ef4444", text: "text-red-400", label: `${score}/100 · Stressed` };

  const TAB_DEFS: { key: TabKey; label: string; icon: any }[] = [
    { key: "field", label: "Field View", icon: MapIcon },
    { key: "weather", label: "Weather", icon: CloudSun },
    { key: "ai", label: "AI Analysis", icon: Bot },
    { key: "planner", label: "Flight Planner", icon: Plane },
    { key: "reports", label: "Reports", icon: FileBarChart },
    { key: "history", label: "History", icon: History },
    { key: "settings", label: "Settings", icon: Settings },
  ];
  const openTab = (k: TabKey) => {
    setOpenTabs(t => t.includes(k) ? t : [...t, k]);
    setActiveTab(k);
    setNewTabOpen(false);
  };
  const closeTab = (k: TabKey) => {
    if (k === "field") return; // field view is permanent
    setOpenTabs(t => {
      const next = t.filter(x => x !== k);
      if (activeTab === k) setActiveTab(next[next.length - 1] ?? "field");
      return next;
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden font-sans"
         style={{ background: "#0f0f0f", color: "#f0f0f0" }}>
      {/* Top status bar: back · field · weather · health */}
      <div className="h-12 shrink-0 flex items-center gap-4 px-4 border-b border-[#1f1f1f]"
           style={{ background: "#0f0f0f" }}>
        <button onClick={() => window.history.back()}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-[#f0f0f0] transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="h-4 w-px bg-[#222]" />
        <div className="flex items-baseline gap-3 min-w-0">
          <div className="text-sm font-semibold tracking-tight truncate">{taskName}</div>
          <div className="text-[11px] text-neutral-500 font-mono">{ts}</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <HeaderWeather center={center} onClick={() => {
            if (!openTabs.includes("weather")) setOpenTabs(t => [...t, "weather"]);
            setActiveTab("weather");
          }} />
          <div className="flex items-center gap-2 px-3 h-7 rounded-sm border border-[#222] bg-[#161616]">
            <span className="h-2 w-2 rounded-full" style={{ background: scoreTone.dot }} />
            <span className={`text-xs font-medium ${scoreTone.text}`}>{scoreTone.label}</span>
          </div>
        </div>
      </div>

      {/* Browser-style tab bar */}
      <div className="h-10 shrink-0 flex items-end pl-2 pr-3 gap-0.5 border-b border-[#1f1f1f] relative"
           style={{ background: "#141414" }}>
        {TAB_DEFS.filter(t => openTabs.includes(t.key)).map(t => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`group relative h-9 flex items-center gap-2 pl-3 pr-2 min-w-[140px] max-w-[200px] text-xs border-t border-l border-r rounded-t-md -mb-px transition-colors
                ${active
                  ? "border-[#1f1f1f] text-[#f0f0f0]"
                  : "border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-[#1a1a1a]"}`}
              style={active ? { background: "#0f0f0f" } : undefined}
            >
              {active && (
                <span className="absolute left-0 right-0 -top-px h-0.5 bg-[#4CAF50] rounded-t" />
              )}
              <Icon className={`h-3.5 w-3.5 ${active ? "text-[#4CAF50]" : ""}`} />
              <span className="truncate flex-1 text-left">{t.label}</span>
              {t.key !== "field" && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}
                  className="h-4 w-4 grid place-items-center rounded-sm text-neutral-500 hover:text-[#f0f0f0] hover:bg-[#262626]"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
        <div className="relative">
          <button
            onClick={() => setNewTabOpen(o => !o)}
            title="New tab (Ctrl+T)"
            className="h-7 w-7 ml-1 grid place-items-center rounded-sm text-neutral-500 hover:text-[#f0f0f0] hover:bg-[#1a1a1a]"
          >
            <Plus className="h-4 w-4" />
          </button>
          {newTabOpen && (
            <div className="absolute z-[2000] top-9 left-0 w-56 rounded-md border border-[#222] bg-[#161616] shadow-2xl p-1">
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">Open in new tab</div>
              {TAB_DEFS.filter(t => !openTabs.includes(t.key)).map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => openTab(t.key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-200 hover:bg-[#1f1f1f] rounded-sm">
                    <Icon className="h-3.5 w-3.5 text-[#4CAF50]" />
                    {t.label}
                  </button>
                );
              })}
              {TAB_DEFS.every(t => openTabs.includes(t.key)) && (
                <div className="px-2 py-2 text-[11px] text-neutral-500">All tabs are open.</div>
              )}
              <div className="border-t border-[#222] mt-1 pt-1 px-2 pb-1 text-[10px] text-neutral-600 font-mono">⌘/Ctrl + T</div>
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 relative">
        {/* Field View is permanently mounted to preserve the Leaflet map and
            its layers/geoman state across tab switches. We only hide it. */}
        <div
          id="field-view-capture"
          style={{
            position: "absolute", inset: 0,
            visibility: activeTab === "field" ? "visible" : "hidden",
            pointerEvents: activeTab === "field" ? "auto" : "none",
          }}
        >
          <FieldViewTab
            center={center}
            bounds={bounds}
            tileUrl={tileUrl}
            ndviUrl={ndviUrl}
            maxNative={maxNative}
            layers={layers}
            setLayers={setLayers}
            ndviInfo={ndviInfo}
            cursorCoordRef={cursorCoordRef}
            cursorZoomRef={cursorZoomRef}
            layersOpen={layersOpen}
            setLayersOpen={setLayersOpen}
            drawerOpen={drawerOpen}
            setDrawerOpen={setDrawerOpen}
            analysis={analysis}
            analyzing={analyzing}
            analysisErr={analysisErr}
            runAnalysis={runAnalysis}
            showAiZones={showAiZones}
            setShowAiZones={setShowAiZones}
            selectedZone={selectedZone}
            setSelectedZone={setSelectedZone}
            updateZoneRing={updateZoneRing}
            deleteZone={deleteZone}
            exportFlightPlan={exportFlightPlan}
            taskId={taskId!}
            annotations={annotations}
            setAnnotations={setAnnotations}
            boundary={boundary}
            boundaryMode={boundaryMode}
            setBoundaryMode={setBoundaryMode}
            boundaryDirty={boundaryDirty}
            boundarySaving={boundarySaving}
            saveBoundary={saveBoundary}
            clearBoundary={clearBoundary}
            handleBoundaryCreated={handleBoundaryCreated}
            handleBoundaryEdited={handleBoundaryEdited}
            handleBoundaryDeleteRing={handleBoundaryDeleteRing}
            fieldAreaHa={field?.boundary_area_hectares ?? null}
            activeBoundaryIdx={activeBoundaryIdx}
            setActiveBoundaryIdx={setActiveBoundaryIdx}
            userPolys={userPolys}
            userPolyToolActive={userPolyToolActive}
            setUserPolyToolActive={setUserPolyToolActive}
            draftUserPoly={draftUserPoly}
            setDraftUserPoly={setDraftUserPoly}
            saveUserPolygon={saveUserPolygon}
            deleteUserPolygon={deleteUserPolygon}
            clearAnalysis={clearAnalysis}
            settings={settings}
          />
        </div>
        {activeTab === "weather" && <WeatherTab center={center} fieldName={taskName} />}
        {activeTab === "ai" && (
          <AiTab analysis={analysis} analyzing={analyzing} analysisErr={analysisErr}
            runAnalysis={runAnalysis} exportFlightPlan={exportFlightPlan}
            clearAnalysis={clearAnalysis} deleteZone={deleteZone} settings={settings} />
        )}
        {activeTab === "planner" && (
          <PlannerTab
            analysis={analysis}
            boundary={boundary}
            tileUrl={tileUrl}
            bounds={bounds}
            maxNative={maxNative}
            taskId={taskId!}
            fieldId={field?.id ?? null}
            runAnalysis={runAnalysis}
            setActiveTab={setActiveTab}
            settings={settings}
            onSaveSettings={saveSettings}
            center={center}
            userPolys={userPolys}
          />
        )}
        {activeTab === "reports" && (
          <ReportsTab
            field={field ? { id: field.id, name: field.name, boundary_area_hectares: field.boundary_area_hectares ?? null } : null}
            task={{ id: taskId!, created_at: task.created_at }}
            analysis={analysis}
            settings={settings}
            activeDrone={parentActiveDrone}
            lastLog={parentLastLog}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === "history" && (
          <HistoryTab
            fieldId={field?.id ?? null}
            fieldName={field?.name ?? "Field"}
            boundary={boundary}
            currentTaskId={taskId!}
            openTask={(id) => window.open(`/app/orthomosaic/${id}`, "_blank")}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            settings={settings}
            onSave={saveSettings}
            saving={settingsSaving}
            savedAt={settingsSavedAt}
            fieldAreaHa={field?.boundary_area_hectares ?? null}
          />
        )}
      </div>

      {/* Bottom status bar */}
      <div className="h-7 shrink-0 px-3 flex items-center gap-4 text-[11px] text-neutral-500 border-t border-[#1f1f1f]"
           style={{ background: "#0f0f0f" }}>
        <div ref={cursorCoordRef} className="font-mono">—, —</div>
        <div ref={cursorZoomRef} className="font-mono">Zoom 15</div>
        <div className="ml-auto truncate font-mono text-neutral-600">{task.odm_uuid?.slice(0, 8)}</div>
      </div>

      <style>{`
        .ai-zone-label {
          background: #1a1a1a;
          color: #f0f0f0;
          border: 1px solid #2a2a2a;
          border-left: 2px solid #4CAF50;
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 2px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          white-space: nowrap;
          pointer-events: none;
          font-family: inherit;
        }
        .ai-zone-label::before { display: none; }
        .leaflet-container { background: #0a0a0a; }
      `}</style>
    </div>
  );
}

// ----------------------------- Field View tab -------------------------------
function FieldViewTab(props: {
  center: [number, number];
  bounds: L.LatLngBoundsExpression;
  tileUrl: string;
  ndviUrl: string | null;
  maxNative: number;
  layers: LayerState;
  setLayers: React.Dispatch<React.SetStateAction<LayerState>>;
  ndviInfo: { bands: number; index: "ndvi" | "vari"; label: string } | null;
  cursorCoordRef: React.MutableRefObject<HTMLDivElement | null>;
  cursorZoomRef: React.MutableRefObject<HTMLDivElement | null>;
  layersOpen: boolean;
  setLayersOpen: (v: boolean) => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  analysis: any;
  analyzing: boolean;
  analysisErr: string | null;
  runAnalysis: () => void;
  showAiZones: boolean;
  setShowAiZones: (v: boolean) => void;
  selectedZone: string | null;
  setSelectedZone: (id: string | null) => void;
  updateZoneRing: (id: string, ring: { lat: number; lng: number }[]) => void;
  deleteZone: (id: string) => void;
  exportFlightPlan: () => void;
  taskId: string;
  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  boundary: BoundaryRing[] | null;
  boundaryMode: "off" | "draw" | "edit";
  setBoundaryMode: React.Dispatch<React.SetStateAction<"off" | "draw" | "edit">>;
  boundaryDirty: boolean;
  boundarySaving: boolean;
  saveBoundary: () => void;
  clearBoundary: () => void;
  handleBoundaryCreated: (ring: BoundaryRing) => void;
  handleBoundaryEdited: (index: number, ring: BoundaryRing) => void;
  handleBoundaryDeleteRing: (index: number) => void;
  fieldAreaHa: number | null;
  activeBoundaryIdx: number | null;
  setActiveBoundaryIdx: React.Dispatch<React.SetStateAction<number | null>>;
  userPolys: UserPoly[];
  userPolyToolActive: boolean;
  setUserPolyToolActive: React.Dispatch<React.SetStateAction<boolean>>;
  draftUserPoly: DraftPolygon | null;
  setDraftUserPoly: React.Dispatch<React.SetStateAction<DraftPolygon | null>>;
  saveUserPolygon: (f: { name: string; issue_type: string; color: string; notes: string }) => Promise<void>;
  deleteUserPolygon: (id: string) => Promise<void>;
  clearAnalysis: () => Promise<void>;
  settings: FarmerSettings;
}) {
  const {
    bounds, tileUrl, ndviUrl, maxNative, layers, setLayers, ndviInfo,
    cursorCoordRef, cursorZoomRef, layersOpen, setLayersOpen,
    drawerOpen, setDrawerOpen,
    analysis, analyzing, analysisErr, runAnalysis,
    showAiZones, setShowAiZones, selectedZone, setSelectedZone,
    updateZoneRing, deleteZone, exportFlightPlan,
    taskId, annotations, setAnnotations,
    boundary, boundaryMode, setBoundaryMode, boundaryDirty, boundarySaving,
    saveBoundary, clearBoundary, handleBoundaryCreated, handleBoundaryEdited, handleBoundaryDeleteRing,
    fieldAreaHa, activeBoundaryIdx, setActiveBoundaryIdx,
    userPolys, userPolyToolActive, setUserPolyToolActive,
    draftUserPoly, setDraftUserPoly, saveUserPolygon, deleteUserPolygon, clearAnalysis,
    settings,
  } = props;

  const [measureActive, setMeasureActive] = useState(false);
  const [annotateActive, setAnnotateActive] = useState(false);
  const [annotateMode, setAnnotateMode] = useState<"pen" | "text" | "select">("pen");
  const [annotateColor, setAnnotateColor] = useState<string>("#facc15");
  const [annotateWidth, setAnnotateWidth] = useState<number>(3);
  const [measureStats, setMeasureStats] = useState<MeasureStats>({
    active: false, finished: false, count: 0, distM: 0, areaM2: 0, liveDistM: 0,
  });
  const handleStats = useCallback((s: MeasureStats) => setMeasureStats(s), []);

  const ToolButton = ({ icon: Icon, label, onClick, active }: any) => (
    <button
      onClick={onClick} title={label}
      className={`h-10 w-10 grid place-items-center rounded-sm border transition-colors
        ${active
          ? "bg-[#1a1a1a] border-[#4CAF50] text-[#4CAF50]"
          : "bg-[#141414]/90 border-[#222] text-neutral-300 hover:text-[#f0f0f0] hover:bg-[#1a1a1a]"}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="absolute inset-0 bg-[#0a0a0a]">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [40, 40] }}
        minZoom={1}
        maxZoom={22}
        preferCanvas
        zoomControl={false}
        attributionControl={false}
        style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          minZoom={1}
          maxNativeZoom={19}
          maxZoom={22}
          zIndex={1}
        />
        {layers.orthomosaic && tileUrl && (
          <TileLayer
            key={tileUrl}
            url={tileUrl}
            opacity={1.0}
            maxNativeZoom={Math.min(20, maxNative)}
            maxZoom={22}
            tileSize={256}
            keepBuffer={8}
            updateWhenIdle={false}
            updateWhenZooming={false}
            bounds={bounds}
            noWrap
            zIndex={10}
          />
        )}
        {layers.ndvi && ndviUrl && (
          <TileLayer
            key={`ndvi-${ndviUrl}`}
            url={ndviUrl}
            opacity={0.75}
            maxNativeZoom={Math.min(20, maxNative)}
            maxZoom={22}
            tileSize={256}
            keepBuffer={8}
            updateWhenIdle={false}
            updateWhenZooming={false}
            bounds={bounds}
            noWrap
            zIndex={20}
          />
        )}
        <FitBounds bounds={bounds} />
        <MouseReadout coordRef={cursorCoordRef} zoomRef={cursorZoomRef} />
        <MapControls fitTo={bounds} />
        {showAiZones && analysis?.zones && analysis.zones.length > 0 && (
          <AiZonesLayer
            zones={analysis.zones}
            selectedId={selectedZone}
            onSelect={setSelectedZone}
            onUpdate={updateZoneRing}
            onDelete={deleteZone}
            boundaryAreaHa={fieldAreaHa}
            settings={settings}
          />
        )}
        <MeasureTool active={measureActive} visible={layers.measurements} onStats={handleStats} />
        <AnnotateTool
          active={annotateActive}
          mode={annotateMode}
          color={annotateColor}
          width={annotateWidth}
          visible={layers.annotations}
          annotations={annotations}
          setAnnotations={setAnnotations}
          taskId={taskId}
        />
        <BoundaryTool
          mode={boundaryMode}
          boundary={boundary}
          visible={layers.boundary}
          onCreated={handleBoundaryCreated}
          onEdited={handleBoundaryEdited}
          onDeleteRing={handleBoundaryDeleteRing}
          activeIdx={activeBoundaryIdx}
          setActiveIdx={setActiveBoundaryIdx}
        />
        {layers.userAnnotations && userPolys.length > 0 && (
          <UserPolyLayer polys={userPolys} onDelete={deleteUserPolygon} />
        )}
        {userPolyToolActive && (
          <UserPolygonTool
            active={userPolyToolActive}
            onComplete={(p) => setDraftUserPoly(p)}
          />
        )}
      </MapContainer>

      {/* Floating icon toolbar */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-1.5">
        <ToolButton icon={Layers} label="Layers" active={layersOpen}
          onClick={() => { setLayersOpen(!layersOpen); }} />
        <ToolButton icon={Ruler} label="Measure" active={measureActive}
          onClick={() => {
            setMeasureActive(v => !v); setAnnotateActive(false); setLayersOpen(false);
          }} />
        <ToolButton icon={Pencil} label={annotateActive ? "Pen on — drag to draw" : "Pen marker"} active={annotateActive}
          onClick={() => {
            setAnnotateActive(v => !v); setMeasureActive(false); setLayersOpen(false);
          }} />
        <ToolButton
          icon={MapPin}
          label={boundary ? "Edit field boundary" : "Define field boundary"}
          active={boundaryMode !== "off"}
          onClick={() => {
            setBoundaryMode(m => m !== "off" ? "off" : (boundary ? "edit" : "draw"));
            setMeasureActive(false);
            setAnnotateActive(false);
            setLayersOpen(false);
            setUserPolyToolActive(false);
          }}
        />
        <ToolButton
          icon={Hexagon}
          label="Mark anomaly polygon"
          active={userPolyToolActive}
          onClick={() => {
            setUserPolyToolActive(v => !v);
            setMeasureActive(false);
            setAnnotateActive(false);
            setBoundaryMode("off");
            setLayersOpen(false);
          }}
        />
        <ToolButton icon={Settings} label="Settings" />
      </div>

      {/* Measure panel */}
      {(measureActive || measureStats.count > 0) && layers.measurements && !layersOpen && (
        <MeasurePanel stats={measureStats} />
      )}
      {annotateActive && !layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-72 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
             style={{ background: "#161616" }}>
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
            <Pencil className="h-3.5 w-3.5" style={{ color: annotateColor }} />
            <div className="text-xs font-medium">Annotate</div>
            <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">
              {annotateMode === "pen"
                ? "Drag to draw"
                : annotateMode === "text"
                  ? "Click to place"
                  : "Drag labels"}
            </div>
          </div>

          {/* mode tabs */}
          <div className="grid grid-cols-3 gap-1 mb-2">
            {(["pen", "text", "select"] as const).map(m => (
              <button
                key={m}
                onClick={() => setAnnotateMode(m)}
                className={`text-[11px] py-1.5 rounded border transition-colors ${
                  annotateMode === m
                    ? "bg-[#1a1a1a] border-[#4CAF50] text-[#4CAF50]"
                    : "bg-[#141414] border-[#222] text-neutral-400 hover:text-[#f0f0f0]"
                }`}
              >
                {m === "pen" ? "Pen" : m === "text" ? "Text" : "Select"}
              </button>
            ))}
          </div>

          {/* colors */}
          <div className="mb-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Color</div>
            <div className="flex items-center gap-1.5">
              {["#facc15", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f0f0f0"].map(c => (
                <button key={c} onClick={() => setAnnotateColor(c)}
                  className={`h-5 w-5 rounded-full border ${annotateColor === c ? "border-white scale-110" : "border-[#333]"}`}
                  style={{ background: c }} title={c} />
              ))}
              <input type="color" value={annotateColor}
                onChange={(e) => setAnnotateColor(e.target.value)}
                className="h-5 w-5 ml-1 bg-transparent border border-[#333] rounded cursor-pointer" />
            </div>
          </div>

          {/* width (pen only) */}
          {annotateMode === "pen" && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                <span>Stroke</span>
                <span className="font-mono">{annotateWidth}px</span>
              </div>
              <input type="range" min={1} max={10} step={1}
                value={annotateWidth}
                onChange={(e) => setAnnotateWidth(Number(e.target.value))}
                className="w-full accent-[#4CAF50]" />
            </div>
          )}

          {annotateMode === "select" && (
            <div className="mb-2 text-[10px] text-neutral-400 bg-[#1a1a1a] border border-[#222] rounded px-2 py-1.5 leading-relaxed">
              Drag a label to move it. Double-click to edit or clear its text.
            </div>
          )}

          {!layers.annotations && (
            <div className="mb-2 text-[10px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1">
              Annotations layer is hidden. Enable it in Layers to see your marks.
            </div>
          )}

          {/* list */}
          <div className="border-t border-[#222] pt-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                Marks ({annotations.length})
              </div>
              {annotations.length > 0 && (
                <button
                  onClick={() => { if (window.confirm("Clear all annotations on this scan?")) { setAnnotations([]); saveAnnotations(taskId, []); } }}
                  className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:underline">
                  <Trash2 className="h-3 w-3" /> Clear all
                </button>
              )}
            </div>
            {annotations.length === 0 ? (
              <div className="text-[11px] text-neutral-500 italic py-1">
                {annotateMode === "pen"
                  ? "Press and drag on the map to draw."
                  : annotateMode === "text"
                    ? "Click on the map to place a label."
                    : "No labels yet — place one with the Text tool."}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto -mr-1 pr-1 space-y-1">
                {annotations.slice().reverse().map(a => (
                  <div key={a.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#1a1a1a] group">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                    <span className="text-[11px] truncate flex-1">
                      {a.kind === "text" ? `"${a.text}"` : `Stroke · ${(a.stroke ?? []).length} pts`}
                    </span>
                    <button
                      onClick={() => {
                        setAnnotations(prev => {
                          const next = prev.filter(x => x.id !== a.id);
                          saveAnnotations(taskId, next);
                          return next;
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition-opacity"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Layers popover */}
      {layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-64 rounded-md border border-[#222] shadow-2xl p-2"
             style={{ background: "#161616" }}>
          <div className="flex items-center justify-between px-1.5 pb-2 border-b border-[#222] mb-1">
            <div className="text-xs font-medium text-[#f0f0f0]">Layers</div>
            <button onClick={() => setLayersOpen(false)} className="text-neutral-500 hover:text-[#f0f0f0]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <LayerRow label="Orthomosaic" icon={ImageIcon}
            checked={layers.orthomosaic}
            onToggle={() => setLayers(s => ({ ...s, orthomosaic: !s.orthomosaic }))} />
          <LayerRow
            label={ndviInfo?.index === "vari" ? "Vegetation index (VARI)" : "NDVI"}
            icon={Activity}
            checked={layers.ndvi}
            onToggle={() => setLayers(s => ({ ...s, ndvi: !s.ndvi }))}
          />
          <LayerRow label="Annotations" icon={MapPin}
            checked={layers.annotations}
            onToggle={() => setLayers(s => ({ ...s, annotations: !s.annotations }))} />
          <LayerRow label="Measurements" icon={Ruler}
            checked={layers.measurements}
            onToggle={() => setLayers(s => ({ ...s, measurements: !s.measurements }))} />
          <LayerRow label="Field boundary" icon={MapPin}
            checked={layers.boundary}
            onToggle={() => setLayers(s => ({ ...s, boundary: !s.boundary }))} />
          <LayerRow label="AI treatment zones" icon={Sparkles}
            checked={showAiZones}
            onToggle={() => setShowAiZones(!showAiZones)} />
          <LayerRow label={`Annotations · my polygons (${userPolys.length})`} icon={Hexagon}
            checked={layers.userAnnotations}
            onToggle={() => setLayers(s => ({ ...s, userAnnotations: !s.userAnnotations }))} />
        </div>
      )}

      {/* Boundary tool panel */}
      {boundaryMode !== "off" && !layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-72 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
             style={{ background: "#161616" }}>
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
            <MapPin className="h-3.5 w-3.5 text-cyan-400" />
            <div className="text-xs font-medium">Field boundary</div>
            <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">
              {boundaryMode === "draw" ? "Drawing" : boundaryDirty ? "Unsaved" : "Editing"}
            </div>
          </div>
          <div className="text-[11px] text-neutral-400 leading-relaxed mb-3">
            {boundaryMode === "draw"
              ? "Click to drop vertices, click the first point to close. Finish one shape and immediately start the next — perfect for fragmented fields."
              : "Click a part to select it, then drag vertices to adjust. Right-click a vertex to remove just that point. Use Delete part to remove only the selected fragment."}
          </div>
          {boundary && boundary.length > 0 && (
            <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
              Selected: {activeBoundaryIdx === null ? "none — click a part on the map" : `part ${activeBoundaryIdx + 1} of ${boundary.length}`}
            </div>
          )}
          {boundaryMode === "edit" && (
            <button
              onClick={() => setBoundaryMode("draw")}
              className="w-full mb-2 inline-flex items-center justify-center gap-1.5 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-900/20 rounded-sm px-3 py-1.5 text-[11px]"
            >
              + Add another part
            </button>
          )}
          {boundary && boundary.length > 0 && (() => {
            const m2 = boundary.reduce(
              (sum, ring) =>
                sum + (ring.length >= 3 ? polygonAreaM2(ring.map(p => L.latLng(p.lat, p.lng))) : 0),
              0,
            );
            const ha = m2 / 10000;
            const ac = m2 / 4046.8564224;
            return (
              <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="col-span-2 text-[10px] uppercase tracking-wider text-neutral-500">
                  {boundary.length} part{boundary.length === 1 ? "" : "s"} · total area
                </div>
                <div className="rounded border border-[#222] px-2 py-1.5" style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] uppercase text-neutral-500">Hectares</div>
                  <div className="font-mono text-cyan-400 tabular-nums">{ha.toFixed(3)} ha</div>
                </div>
                <div className="rounded border border-[#222] px-2 py-1.5" style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] uppercase text-neutral-500">Acres</div>
                  <div className="font-mono text-cyan-400 tabular-nums">{ac.toFixed(3)} ac</div>
                </div>
              </div>
            );
          })()}
          <div className="flex flex-wrap gap-1.5">
            <button
              disabled={!boundary || boundary.length === 0 || boundarySaving || !boundaryDirty}
              onClick={saveBoundary}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black rounded-sm px-3 py-1.5 text-[11px] font-semibold"
            >
              {boundarySaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save boundary
            </button>
            <button
              onClick={() => setBoundaryMode("off")}
              className="inline-flex items-center justify-center gap-1.5 border border-[#222] hover:bg-[#1a1a1a] text-neutral-300 rounded-sm px-3 py-1.5 text-[11px]"
            >
              Done
            </button>
          </div>
          {boundary && boundary.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <button
                disabled={activeBoundaryIdx === null}
                onClick={() => {
                  if (activeBoundaryIdx === null || !boundary) return;
                  if (window.confirm(`Remove boundary part ${activeBoundaryIdx + 1}? Other parts stay.`)) {
                    handleBoundaryDeleteRing(activeBoundaryIdx);
                  }
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 border border-red-900/50 text-red-400 hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-sm px-2 py-1.5 text-[11px]"
                title="Delete only the selected part"
              >
                <Trash2 className="h-3 w-3" /> Delete part
              </button>
              <button
                onClick={clearBoundary}
                className="text-[10px] text-neutral-500 hover:text-red-400 underline"
                title="Remove every boundary part"
              >
                Clear all
              </button>
            </div>
          )}
          {!layers.boundary && (
            <div className="mt-2 text-[10px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1">
              Boundary layer is hidden. Toggle it on in Layers to see your outline.
            </div>
          )}
        </div>
      )}

      {/* NDVI legend */}
      {layers.ndvi && (
        <div className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-[1000] rounded-sm border border-[#222] px-3 py-2 text-[11px] shadow-xl"
             style={{ background: "#161616", color: "#f0f0f0" }}>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-3.5 w-3.5 text-[#4CAF50]" />
            <span className="font-medium">
              {ndviInfo?.index === "vari" ? "Vegetation Index (VARI · RGB-derived)" : "NDVI"}
            </span>
            {ndviInfo && <span className="text-neutral-500 font-mono">{ndviInfo.bands}-band</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-red-400">Stressed</span>
            <div className="h-1.5 w-40"
              style={{ background: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee08b,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)" }} />
            <span className="text-[#4CAF50]">Healthy</span>
          </div>
        </div>
      )}

      {/* Slide-up AI drawer */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[1100] border-t border-[#222] transition-[max-height] duration-300 ease-out"
        style={{
          background: "#0f0f0f",
          maxHeight: drawerOpen ? "60vh" : 42,
        }}
      >
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="w-full h-[42px] px-4 flex items-center gap-3 text-left hover:bg-[#141414]"
        >
          <Sparkles className="h-4 w-4 text-[#4CAF50]" />
          <div className="text-xs font-medium">
            Field Health:{" "}
            <span className={
              analysis ? (analysis.health_score >= 70 ? "text-[#4CAF50]" : analysis.health_score >= 40 ? "text-yellow-400" : "text-red-400") : "text-neutral-500"
            }>
              {analysis ? `${analysis.health_score}/100` : "Not analyzed"}
            </span>
          </div>
          {analysis && (
            <div className="text-[11px] text-neutral-500 truncate hidden md:block">
              {analysis.zones.length} treatment zone{analysis.zones.length === 1 ? "" : "s"} · {analysis.issues.length} issue{analysis.issues.length === 1 ? "" : "s"}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 text-neutral-500">
            {drawerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </div>
        </button>

        {drawerOpen && (
          <div className="px-4 pb-4 overflow-auto" style={{ maxHeight: "calc(60vh - 42px)" }}>
            {!analysis && !analyzing && (
              <div className="flex items-center gap-3 py-3">
                <p className="text-xs text-neutral-400 leading-relaxed flex-1">
                  Run AI vision over this orthomosaic to detect bare patches, waterlogging,
                  discoloration and row gaps — and auto-draw treatment zones you can export.
                </p>
                <button onClick={runAnalysis}
                  className="inline-flex items-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 text-xs font-semibold whitespace-nowrap">
                  <Sparkles className="h-3.5 w-3.5" /> Analyze field
                </button>
              </div>
            )}
            {analysisErr && <div className="text-red-400 text-xs py-2">{analysisErr}</div>}
            {analyzing && (
              <div className="flex items-center gap-2 py-4 text-neutral-300 text-xs">
                <Loader2 className="h-4 w-4 animate-spin text-[#4CAF50]" />
                Analyzing imagery…
              </div>
            )}
            {analysis && <AnalysisGrid
              analysis={analysis} runAnalysis={runAnalysis}
              showAiZones={showAiZones} setShowAiZones={setShowAiZones}
              selectedZone={selectedZone} setSelectedZone={setSelectedZone}
              deleteZone={deleteZone} exportFlightPlan={exportFlightPlan}
              clearAnalysis={clearAnalysis}
            />}
          </div>
        )}
      </div>

      {/* User-polygon tool hint */}
      {userPolyToolActive && !draftUserPoly && !layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-72 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
             style={{ background: "#161616" }}>
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
            <Hexagon className="h-3.5 w-3.5 text-orange-400" />
            <div className="text-xs font-medium">Mark anomaly</div>
            <button onClick={() => setUserPolyToolActive(false)} className="ml-auto text-neutral-500 hover:text-[#f0f0f0]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-[11px] text-neutral-400 leading-relaxed">
            Click on the map to drop vertices around the area you want to flag.
            Click the first point to close the shape — a form will pop up to label it.
          </div>
        </div>
      )}

      {/* User polygon metadata form */}
      {draftUserPoly && (
        <UserPolyForm
          draft={draftUserPoly}
          onCancel={() => { setDraftUserPoly(null); setUserPolyToolActive(false); }}
          onSave={(form) => saveUserPolygon(form)}
        />
      )}
    </div>
  );
}

// ---- User polygon save dialog -----------------------------------------------
function UserPolyForm({
  draft, onCancel, onSave,
}: {
  draft: DraftPolygon;
  onCancel: () => void;
  onSave: (f: { name: string; issue_type: string; color: string; notes: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [issueType, setIssueType] = useState<string>("Bare soil");
  const [color, setColor] = useState<string>("orange");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave({ name, issue_type: issueType, color, notes }); }
    finally { setSaving(false); }
  };

  return (
    <div className="absolute inset-0 z-[2000] flex items-center justify-center p-6"
         style={{ background: "rgba(0,0,0,0.65)" }}
         onClick={onCancel}>
      <div className="w-full max-w-md rounded-md border border-[#222] shadow-2xl text-[#f0f0f0]"
           style={{ background: "#161616" }}
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-[#222] flex items-center gap-2">
          <Hexagon className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-semibold">New annotation</div>
          <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500 font-mono">
            {draft.areaHa.toFixed(3)} ha · {(draft.areaHa * 2.4710538147).toFixed(2)} ac
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Annotation name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NW bare patch"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="mt-1 w-full bg-[#0f0f0f] border border-[#222] focus:border-[#4CAF50] outline-none rounded-sm px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Issue type</label>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)}
              className="mt-1 w-full bg-[#0f0f0f] border border-[#222] focus:border-[#4CAF50] outline-none rounded-sm px-2.5 py-1.5 text-sm">
              {USER_POLY_ISSUES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Color</label>
            <div className="mt-1 flex items-center gap-2">
              {(["orange", "red", "yellow"] as const).map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border text-xs capitalize ${
                    color === c ? "border-[#4CAF50] text-[#f0f0f0]" : "border-[#222] text-neutral-400 hover:text-[#f0f0f0]"
                  }`}>
                  <span className="h-3 w-3 rounded-sm" style={{ background: USER_POLY_COLORS[c] }} />
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="mt-1 w-full bg-[#0f0f0f] border border-[#222] focus:border-[#4CAF50] outline-none rounded-sm px-2.5 py-1.5 text-sm resize-none" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[#222] flex items-center justify-end gap-2">
          <button onClick={onCancel}
            className="text-xs border border-[#222] hover:bg-[#1a1a1a] text-neutral-300 rounded-sm px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={!name.trim() || saving}
            className="inline-flex items-center gap-1.5 text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black rounded-sm px-3 py-1.5 font-semibold">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Save annotation
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysisGrid({
  analysis, runAnalysis, showAiZones, setShowAiZones,
  selectedZone, setSelectedZone, deleteZone, exportFlightPlan, clearAnalysis,
}: any) {
  const isNDVI = analysis?.data_source === "NDVI+RGB";
  return (
    <div className="pt-3">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border ${
            isNDVI
              ? "bg-[#0f2a16] text-[#4CAF50] border-[#4CAF50]/40"
              : "bg-[#1a1a1a] text-neutral-300 border-[#333]"
          }`}
          title={isNDVI
            ? `Multispectral data detected (${analysis.band_count} bands). NDVI cross-referenced with RGB.`
            : "RGB imagery only. Specific nutrient deficiencies cannot be diagnosed without multispectral data."}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isNDVI ? "bg-[#4CAF50]" : "bg-neutral-500"}`} />
          {isNDVI ? "NDVI + RGB Analysis" : "RGB Analysis Only"}
        </span>
        {isNDVI && analysis.ndvi_cells?.length > 0 && (
          <span className="text-[10px] text-neutral-500">
            {analysis.ndvi_cells.length} NDVI zones sampled
          </span>
        )}
      </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-sm p-3 border border-[#222]" style={{ background: "#1a1a1a" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Overall health</div>
          <div className="flex items-center gap-2">
            <button onClick={runAnalysis} className="text-[10px] text-[#4CAF50] hover:underline">Re-run</button>
            {clearAnalysis && (
              <button onClick={clearAnalysis} className="text-[10px] text-red-400 hover:underline">Clear analysis</button>
            )}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className={`text-4xl font-semibold tabular-nums ${analysis.health_score >= 70 ? "text-[#4CAF50]" : analysis.health_score >= 40 ? "text-yellow-400" : "text-red-400"}`}>
            {analysis.health_score}
          </div>
          <div className="text-neutral-500 text-xs mb-1.5">/ 100</div>
        </div>
        <div className="h-1 bg-[#0f0f0f] mt-2 overflow-hidden">
          <div className={`h-full ${analysis.health_score >= 70 ? "bg-[#4CAF50]" : analysis.health_score >= 40 ? "bg-yellow-400" : "bg-red-500"}`}
            style={{ width: `${analysis.health_score}%` }} />
        </div>
        {analysis.summary && <div className="text-neutral-300 text-xs mt-3 leading-relaxed">{analysis.summary}</div>}
        {analysis.zones.length > 0 && (
          <button onClick={exportFlightPlan}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 text-xs font-semibold">
            <Download className="h-3.5 w-3.5" /> Export flight plan
          </button>
        )}
      </div>

      <div className="rounded-sm p-3 border border-[#222] overflow-auto max-h-[42vh]" style={{ background: "#1a1a1a" }}>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Detected issues ({analysis.issues.length})</div>
        {analysis.issues.length === 0 ? (
          <div className="text-xs text-neutral-500 italic">No visible issues.</div>
        ) : (
          <div className="space-y-1.5">
            {analysis.issues.map((iss: any, i: number) => (
              <div key={i} className="border border-[#222] rounded-sm p-2" style={{ background: "#0f0f0f" }}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className={`h-3 w-3 ${iss.severity === "high" ? "text-red-400" : iss.severity === "medium" ? "text-yellow-400" : "text-neutral-400"}`} />
                  <div className="font-medium text-xs">{iss.label}</div>
                  <span className="ml-auto text-[10px] uppercase text-neutral-500">{iss.severity}</span>
                </div>
                {iss.description && <div className="text-neutral-400 text-[11px] mt-1 leading-relaxed">{iss.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-sm p-3 border border-[#222] overflow-auto max-h-[42vh]" style={{ background: "#1a1a1a" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Treatment zones ({analysis.zones.length})</div>
          <label className="flex items-center gap-1 text-[10px] text-neutral-400 cursor-pointer">
            <input type="checkbox" checked={showAiZones} onChange={e => setShowAiZones(e.target.checked)}
              className="h-3 w-3 accent-[#4CAF50]" />
            On map
          </label>
        </div>
        {analysis.zones.length === 0 ? (
          <div className="text-xs text-neutral-500 italic">No treatment zones — field looks healthy.</div>
        ) : (
          <div className="space-y-1.5">
            {analysis.zones.map((z: AiZone) => (
              <div key={z.id}
                onClick={() => setSelectedZone(z.id)}
                className={`border rounded-sm p-2 cursor-pointer transition-colors ${selectedZone === z.id ? "border-[#4CAF50]" : "border-[#222] hover:border-[#333]"}`}
                style={{ background: "#0f0f0f" }}>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: sevColor(z.severity) }} />
                  <div className="font-medium text-xs truncate">{z.name}</div>
                  <span className="ml-auto text-[10px] text-neutral-500 font-mono">{z.coverage_pct}%</span>
                </div>
                <div className="text-neutral-400 text-[11px] mt-0.5">{z.issue}</div>
                {z.recommendation && (
                  <div className="mt-1.5 pt-1.5 border-t border-[#222] text-[11px] text-neutral-300">
                    <span className="text-[#4CAF50] font-medium capitalize">{z.recommendation.action}</span>
                    {z.recommendation.product && <> · {z.recommendation.product}</>}
                    {z.recommendation.dose && <span className="text-neutral-500"> · {z.recommendation.dose}</span>}
                  </div>
                )}
                {selectedZone === z.id && (
                  <button onClick={(e) => { e.stopPropagation(); deleteZone(z.id); }}
                    className="mt-1.5 text-[10px] text-red-400 hover:underline">Delete zone</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {analysis?.disclaimer && (
      <div className="mt-3 rounded-sm border border-[#222] p-3 text-[11px] text-neutral-400 leading-relaxed" style={{ background: "#141414" }}>
        ⚠️ {analysis.disclaimer}
      </div>
    )}
    {analysis?.watch_list?.length > 0 && (
      <div className="mt-3 rounded-sm border border-[#222] p-3" style={{ background: "#141414" }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Watch list</div>
          <span className="text-[10px] text-neutral-600">monitor — no treatment zone drawn</span>
        </div>
        <ul className="space-y-1.5">
          {analysis.watch_list.map((w: any, i: number) => (
            <li key={i} className="text-[11px] text-neutral-400 leading-relaxed flex gap-2">
              <span className="text-neutral-600 mt-0.5">•</span>
              <span>
                <span className="text-neutral-200 font-medium">{w.name}</span>
                {w.issue ? <span className="text-neutral-500"> — {w.issue}</span> : null}
                {w.what_you_see ? <span className="text-neutral-500">. {w.what_you_see}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}
    </div>
  );
}

function AiTab({ analysis, analyzing, analysisErr, runAnalysis, exportFlightPlan, clearAnalysis, deleteZone }: any) {
  return (
    <div className="absolute inset-0 overflow-auto p-8" style={{ background: "#0f0f0f" }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Bot className="h-5 w-5 text-[#4CAF50]" />
          <h1 className="text-xl font-semibold tracking-tight">AI Field Analysis</h1>
        </div>
        {!analysis && !analyzing && (
          <div className="rounded-sm border border-[#222] p-6" style={{ background: "#1a1a1a" }}>
            <p className="text-sm text-neutral-400 mb-4 max-w-2xl leading-relaxed">
              Run conservative RGB vision over this orthomosaic. We only flag what we can confirm visually —
              bare soil, waterlogging, row gaps, visible discoloration and field boundary issues.
            </p>
            <button onClick={runAnalysis}
              className="inline-flex items-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-4 py-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> Analyze field
            </button>
            {analysisErr && <div className="text-red-400 text-xs mt-3">{analysisErr}</div>}
          </div>
        )}
        {analyzing && (
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin text-[#4CAF50]" /> Analyzing imagery…
          </div>
        )}
        {analysis && (
          <AnalysisGrid
            analysis={analysis} runAnalysis={runAnalysis}
            showAiZones={true} setShowAiZones={() => {}}
            selectedZone={null} setSelectedZone={() => {}}
            deleteZone={deleteZone} exportFlightPlan={exportFlightPlan}
            clearAnalysis={clearAnalysis}
          />
        )}
      </div>
    </div>
  );
}

// =========================== Flight Planner tab ==============================
// Generates a lawnmower (boustrophedon) spray path over each AI treatment zone
// that lies inside the field boundary. The boundary is treated as the hard
// no-fly constraint — every flight line is clipped to (boundary ∩ zone).

type LatLng2 = { lat: number; lng: number };

// --- geometry helpers --------------------------------------------------------
const M_PER_DEG_LAT = 111_320;
function mPerDegLng(lat: number) { return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180); }

function pointInRing(pt: LatLng2, ring: LatLng2[]): boolean {
  // Ray casting in lng/lat space — fine at these scales.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
      (pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInAnyRing(pt: LatLng2, rings: LatLng2[][]): boolean {
  for (const r of rings) if (pointInRing(pt, r)) return true;
  return false;
}

// Segment vs polygon ring intersections (returns t-values on the segment [0..1]).
function segRingIntersections(a: LatLng2, b: LatLng2, ring: LatLng2[]): number[] {
  const ts: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const t = segSegT(a, b, ring[j], ring[i]);
    if (t !== null && t > 1e-9 && t < 1 - 1e-9) ts.push(t);
  }
  return ts;
}
function segSegT(a: LatLng2, b: LatLng2, c: LatLng2, d: LatLng2): number | null {
  const x1 = a.lng, y1 = a.lat, x2 = b.lng, y2 = b.lat;
  const x3 = c.lng, y3 = c.lat, x4 = d.lng, y4 = d.lat;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-14) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

function lerp(a: LatLng2, b: LatLng2, t: number): LatLng2 {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}


function bboxOfRings(rings: LatLng2[][]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

// Field-wide lawnmower: a single boustrophedon pattern covers the entire
// field boundary (rotated to the field's own principal axis so rows run
// along the long edge). Each pass is then split into sub-segments — spray
// ON where the pass crosses an AI treatment zone, transit (sprayer OFF,
// transit altitude/speed) everywhere else inside the boundary. The drone
// enters from the home edge, runs straight transits across healthy ground,
// and only drops to spray altitude when it's over an anomaly.

// --- rotation / principal axis helpers --------------------------------------
function rotateLL(p: LatLng2, center: LatLng2, cosA: number, sinA: number): LatLng2 {
  const mLng = mPerDegLng(center.lat);
  const x = (p.lng - center.lng) * mLng;
  const y = (p.lat - center.lat) * M_PER_DEG_LAT;
  const xr = x * cosA - y * sinA;
  const yr = x * sinA + y * cosA;
  return { lng: center.lng + xr / mLng, lat: center.lat + yr / M_PER_DEG_LAT };
}
function principalAxisAngle(rings: LatLng2[][]): number {
  let cx = 0, cy = 0, n = 0;
  for (const r of rings) for (const p of r) { cx += p.lng; cy += p.lat; n++; }
  if (n === 0) return 0;
  cx /= n; cy /= n;
  const mLng = mPerDegLng(cy);
  let sxx = 0, syy = 0, sxy = 0;
  for (const r of rings) for (const p of r) {
    const x = (p.lng - cx) * mLng;
    const y = (p.lat - cy) * M_PER_DEG_LAT;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  // Angle of the largest-eigenvalue eigenvector (long axis direction).
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

type Pass = {
  segs: { a: LatLng2; b: LatLng2; spray: boolean; zoneId?: string }[];
};

// Per-zone parallel lawnmower: each anomaly zone gets its OWN compact set of
// parallel spray passes, all rotated to the FIELD's principal axis so every
// zone's rows are parallel to every other zone's. Passes are clipped to
// (boundary ∩ zone) so they only exist where the drone actually sprays —
// no full-width rows, no skipped rows, no diagonal jumps across the field.
// Adjacent passes inside a zone alternate direction (boustrophedon) for tight
// U-turns at the zone edge; buildMission then bridges zones with a single
// straight transit at altitude.
function buildFieldSweep(
  boundary: LatLng2[][],
  zones: { id: string; ring: LatLng2[] }[],
  spacingM: number,
  repeats: number = 1,
): Pass[][] {
  if (!boundary.length || !zones.length) return [];
  const fieldCenter = centroidOfRings(boundary);
  const theta = principalAxisAngle(boundary);
  const cF = Math.cos(-theta), sF = Math.sin(-theta);
  const cI = Math.cos(theta),  sI = Math.sin(theta);
  const rot   = (p: LatLng2) => rotateLL(p, fieldCenter, cF, sF);
  const unrot = (p: LatLng2) => rotateLL(p, fieldCenter, cI, sI);
  const rotBoundary = boundary.map(r => r.map(rot));
  const spacing = Math.max(2, spacingM);

  const fragments: Pass[][] = [];
  for (const zone of zones) {
    const rotRing = zone.ring.map(rot);
    const bb = bboxOfRings([rotRing]);
    const heightM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
    if (heightM < 0.5) continue;
    // Number of parallel rows fitting inside this zone at the given swath.
    // Multiplying by `repeats` interleaves extra rows BETWEEN the base rows,
    // producing visibly denser coverage (not duplicate lines on top of each
    // other). 2× = halved spacing, 3× = third spacing, etc.
    const r = Math.max(1, Math.floor(repeats));
    const basePasses = Math.max(1, Math.round(heightM / spacing));
    const passCount = basePasses * r;
    const step = heightM / passCount;
    const dLat = step / M_PER_DEG_LAT;
    const padLng = (bb.maxLng - bb.minLng) * 0.05 + 0.0002;

    const passes: Pass[] = [];
    let flip = false;
    for (let i = 0; i < passCount; i++) {
      const y = bb.minLat + dLat * (i + 0.5);
      const a = { lat: y, lng: bb.minLng - padLng };
      const b = { lat: y, lng: bb.maxLng + padLng };

      // Sweep line × zone ring → spray intervals inside the zone.
      const zts = [0, 1, ...segRingIntersections(a, b, rotRing)]
        .filter(t => t >= 0 && t <= 1).sort((x, y) => x - y);
      // Build spray sub-segments clipped to (zone ∩ boundary).
      const segs: Pass["segs"] = [];
      for (let k = 0; k < zts.length - 1; k++) {
        const t0 = zts[k], t1 = zts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const mid = lerp(a, b, (t0 + t1) / 2);
        if (!pointInRing(mid, rotRing)) continue;
        // Must also be inside the field boundary (drop slivers outside).
        if (!rotBoundary.some(r => pointInRing(mid, r))) continue;
        const pa = unrot(lerp(a, b, t0));
        const pb = unrot(lerp(a, b, t1));
        segs.push({ a: pa, b: pb, spray: true, zoneId: zone.id });
      }
      if (!segs.length) continue;
      if (flip) {
        segs.reverse();
        for (const s of segs) { const t = s.a; s.a = s.b; s.b = t; }
      }
      flip = !flip;
      passes.push({ segs });
    }
    if (passes.length) fragments.push(passes);
  }
  return fragments;
}

// =============================================================================
// Mission building: full autonomous spray mission with three waypoint phases:
//   TAKEOFF → TRANSIT (high, fast, sprayer off) → SPRAY (low, slow, sprayer on)
//   → TRANSIT → ... → RTH → LAND
// =============================================================================
export type MissionAction =
  | "TAKEOFF" | "TRANSIT" | "SPEED_CHANGE" | "ALTITUDE_CHANGE"
  | "SPRAY_ON" | "SPRAY_WP" | "SPRAY_OFF" | "RTH" | "LAND";

export type MissionWP = {
  lat: number; lng: number; alt: number; speed: number;
  action: MissionAction; zoneId?: string;
};

export type Mission = {
  waypoints: MissionWP[];
  transitDistM: number;
  sprayDistM: number;
  transitTimeS: number;
  sprayTimeS: number;
  sprayOnCount: number;
  transitSegments: LatLng2[][];   // yellow dashed polylines (between zones)
  spraySegments: LatLng2[][];     // cyan solid polylines (inside zones)
  home: LatLng2;
};

function distM(a: LatLng2, b: LatLng2): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * mPerDegLng((a.lat + b.lat) / 2);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export type MissionParams = {
  home: LatLng2;
  transitAltM: number;   // default 30
  sprayAltM: number;     // default 3
  transitSpeed: number;  // default 10 m/s
  spraySpeed: number;    // default 3 m/s
  spacingM: number;      // swath
  repeats?: number;      // how many times to re-cover each zone (1 = once)
};

function buildMission(
  boundary: LatLng2[][],
  zones: { id: string; ring: LatLng2[] }[],
  p: MissionParams,
): Mission {
  const wps: MissionWP[] = [];
  const transitSegments: LatLng2[][] = [];
  const spraySegments: LatLng2[][] = [];
  let transitDist = 0, sprayDist = 0, sprayOnCount = 0;

  // 1) Takeoff at home
  wps.push({ ...p.home, alt: p.transitAltM, speed: p.transitSpeed, action: "TAKEOFF" });

  // Build a single field-wide lawnmower whose passes are split into spray
  // (over anomaly zones) and transit (over healthy ground) sub-segments.
  // Disjoint boundary polygons each become one fragment so buildMission can
  // bridge them with a straight transit at altitude.
  const fragments = buildFieldSweep(boundary, zones, p.spacingM, p.repeats ?? 1);

  // Order fragments by nearest endpoint to the running exit point, and for
  // each fragment pick the orientation (forward/reverse pass order × flip
  // every pass) that minimises the inter-fragment hop. Result: drone enters
  // each fragment from the side closest to its previous position, never
  // cuts diagonally across the field, and the gap between separate field
  // sections is bridged by a single straight transit at altitude.
  const orderedPasses: Pass[] = [];
  const remaining = fragments.slice();
  let runningExit: LatLng2 = p.home;
  while (remaining.length) {
    let bestIdx = -1, bestDist = Infinity, bestRev = false, bestFlip = false;
    remaining.forEach((frag, idx) => {
      const first = frag[0], last = frag[frag.length - 1];
      if (!first.segs.length || !last.segs.length) return;
      const candidates: { rev: boolean; flip: boolean; pt: LatLng2 }[] = [
        { rev: false, flip: false, pt: first.segs[0].a },
        { rev: false, flip: true,  pt: first.segs[first.segs.length - 1].b },
        { rev: true,  flip: false, pt: last.segs[0].a },
        { rev: true,  flip: true,  pt: last.segs[last.segs.length - 1].b },
      ];
      for (const c of candidates) {
        const d = distM(runningExit, c.pt);
        if (d < bestDist) { bestDist = d; bestIdx = idx; bestRev = c.rev; bestFlip = c.flip; }
      }
    });
    if (bestIdx < 0) break;
    const frag = remaining.splice(bestIdx, 1)[0];
    if (bestRev) frag.reverse();
    if (bestFlip) {
      for (const pass of frag) {
        pass.segs.reverse();
        for (const s of pass.segs) { const t = s.a; s.a = s.b; s.b = t; }
      }
    }
    orderedPasses.push(...frag);
    const lastPass = frag[frag.length - 1];
    runningExit = lastPass.segs[lastPass.segs.length - 1].b;
  }

  let prev: LatLng2 | null = null;
  let sprayOn = false;

  for (const pass of orderedPasses) {
    for (const seg of pass.segs) {
      // Connector from previous pass end (or home/takeoff) to this segment's start.
      // The drone never makes sharp diagonal jumps — it transitions at transit
      // altitude between rows.
      const connectorFrom = prev ?? p.home;
      if (distM(connectorFrom, seg.a) > 0.5) {
        if (sprayOn) {
          wps.push({ ...connectorFrom, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_OFF" });
          sprayOn = false;
        }
        wps.push({ ...connectorFrom, alt: p.transitAltM, speed: p.transitSpeed, action: "ALTITUDE_CHANGE" });
        wps.push({ ...connectorFrom, alt: p.transitAltM, speed: p.transitSpeed, action: "SPEED_CHANGE" });
        wps.push({ ...seg.a, alt: p.transitAltM, speed: p.transitSpeed, action: "TRANSIT" });
        transitSegments.push([connectorFrom, seg.a]);
        transitDist += distM(connectorFrom, seg.a);
      }

      if (seg.spray) {
        // Enter spray: descend, slow, sprayer ON.
        if (!sprayOn) {
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "ALTITUDE_CHANGE", zoneId: seg.zoneId });
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPEED_CHANGE", zoneId: seg.zoneId });
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_ON", zoneId: seg.zoneId });
          sprayOn = true;
          sprayOnCount++;
        }
        wps.push({ ...seg.b, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_WP", zoneId: seg.zoneId });
        spraySegments.push([seg.a, seg.b]);
        sprayDist += distM(seg.a, seg.b);
      } else {
        // Transit through a healthy section of the same pass — sprayer OFF, speed up.
        if (sprayOn) {
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_OFF" });
          sprayOn = false;
        }
        wps.push({ ...seg.a, alt: p.transitAltM, speed: p.transitSpeed, action: "ALTITUDE_CHANGE" });
        wps.push({ ...seg.a, alt: p.transitAltM, speed: p.transitSpeed, action: "SPEED_CHANGE" });
        wps.push({ ...seg.b, alt: p.transitAltM, speed: p.transitSpeed, action: "TRANSIT" });
        transitSegments.push([seg.a, seg.b]);
        transitDist += distM(seg.a, seg.b);
      }
      prev = seg.b;
    }
  }

  // Close out sprayer + RTH + land
  if (prev && sprayOn) {
    wps.push({ ...prev, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_OFF" });
    sprayOn = false;
  }
  if (prev) {
    // Straight-line RTH at transit altitude — no obstacles up there.
    wps.push({ ...prev, alt: p.transitAltM, speed: p.transitSpeed, action: "ALTITUDE_CHANGE" });
    wps.push({ ...p.home, alt: p.transitAltM, speed: p.transitSpeed, action: "RTH" });
    const rth: LatLng2[] = [prev, p.home];
    transitSegments.push(rth);
    transitDist += distM(prev, p.home);
  }
  wps.push({ ...p.home, alt: 0, speed: 1, action: "LAND" });

  return {
    waypoints: wps,
    transitDistM: transitDist,
    sprayDistM: sprayDist,
    transitTimeS: transitDist / Math.max(0.1, p.transitSpeed),
    sprayTimeS: sprayDist / Math.max(0.1, p.spraySpeed),
    sprayOnCount,
    transitSegments,
    spraySegments,
    home: p.home,
  };
}

// QGC WPL 110 / Mission Planner format. Encodes action waypoints with
// MAVLink-equivalent commands so Mission Planner & DJI converters keep them.
//   cmd 22  NAV_TAKEOFF
//   cmd 16  NAV_WAYPOINT
//   cmd 178 DO_CHANGE_SPEED   (p2 = speed m/s)
//   cmd 183 DO_SET_SERVO      (p1 = servo #, p2 = PWM; 2000 ON / 1000 OFF)
//   cmd 20  NAV_RETURN_TO_LAUNCH
//   cmd 21  NAV_LAND
function exportMissionFile(m: Mission): Blob {
  const lines: string[] = ["QGC WPL 110"];
  const SPRAY_SERVO = 8;
  const row = (
    idx: number, current: 0 | 1, frame: number, cmd: number,
    p1: number, p2: number, p3: number, p4: number,
    lat: number, lng: number, alt: number,
  ) => lines.push(
    `${idx}\t${current}\t${frame}\t${cmd}\t${p1.toFixed(2)}\t${p2.toFixed(2)}\t${p3.toFixed(2)}\t${p4.toFixed(2)}\t${lat.toFixed(8)}\t${lng.toFixed(8)}\t${alt.toFixed(2)}\t1`,
  );
  // Home (index 0)
  row(0, 1, 0, 16, 0, 0, 0, 0, m.home.lat, m.home.lng, m.waypoints[0]?.alt ?? 0);
  let idx = 1;
  for (const w of m.waypoints) {
    if (w.action === "TAKEOFF")          row(idx++, 0, 3, 22,  0, 0, 0, 0, w.lat, w.lng, w.alt);
    else if (w.action === "SPEED_CHANGE") row(idx++, 0, 3, 178, 1, w.speed, -1, 0, 0, 0, 0);
    else if (w.action === "SPRAY_ON")     row(idx++, 0, 3, 183, SPRAY_SERVO, 2000, 0, 0, 0, 0, 0);
    else if (w.action === "SPRAY_OFF")    row(idx++, 0, 3, 183, SPRAY_SERVO, 1000, 0, 0, 0, 0, 0);
    else if (w.action === "RTH")          row(idx++, 0, 3, 20,  0, 0, 0, 0, w.lat, w.lng, w.alt);
    else if (w.action === "LAND")         row(idx++, 0, 3, 21,  0, 0, 0, 0, w.lat, w.lng, w.alt);
    else                                   row(idx++, 0, 3, 16, 0, 0, 0, 0, w.lat, w.lng, w.alt);
  }
  return new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
}

function centroidOfRings(rings: LatLng2[][]): LatLng2 {
  let lat = 0, lng = 0, n = 0;
  for (const r of rings) for (const p of r) { lat += p.lat; lng += p.lng; n++; }
  return n > 0 ? { lat: lat / n, lng: lng / n } : { lat: 0, lng: 0 };
}

// --- Transit routing: keep flight paths INSIDE the boundary ------------------
// If a straight segment from a→b would leave every boundary ring, insert
// intermediate waypoints via the centroid of the ring containing the endpoint
// (recursively). This is a simple but effective detour scheme for convex-ish
// fragmented fields.
function centroidOfRing(ring: LatLng2[]): LatLng2 {
  let lat = 0, lng = 0;
  for (const p of ring) { lat += p.lat; lng += p.lng; }
  return { lat: lat / ring.length, lng: lng / ring.length };
}
function segmentInsideRings(a: LatLng2, b: LatLng2, rings: LatLng2[][], samples = 12): boolean {
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    if (!pointInAnyRing(lerp(a, b, t), rings)) return false;
  }
  return true;
}
function ringContaining(p: LatLng2, rings: LatLng2[][]): LatLng2[] | null {
  for (const r of rings) if (pointInRing(p, r)) return r;
  return null;
}
function routeInsideBoundary(a: LatLng2, b: LatLng2, rings: LatLng2[][], depth = 0): LatLng2[] {
  if (depth > 4 || segmentInsideRings(a, b, rings)) return [a, b];
  // Pick a detour anchor that is guaranteed inside the boundary part containing b
  // (or a, or the overall centroid as a last resort).
  const anchor =
    centroidSafe(ringContaining(b, rings)) ||
    centroidSafe(ringContaining(a, rings)) ||
    centroidOfRings(rings);
  // Avoid infinite recursion if anchor equals an endpoint
  if (distM(a, anchor) < 1 || distM(b, anchor) < 1) return [a, b];
  const left = routeInsideBoundary(a, anchor, rings, depth + 1);
  const right = routeInsideBoundary(anchor, b, rings, depth + 1);
  return [...left, ...right.slice(1)];
}
function centroidSafe(ring: LatLng2[] | null): LatLng2 | null {
  return ring && ring.length >= 3 ? centroidOfRing(ring) : null;
}
function polylineLengthM(pts: LatLng2[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distM(pts[i - 1], pts[i]);
  return d;
}

function PlannerTab({
  analysis, boundary, tileUrl, bounds, maxNative, taskId, runAnalysis, setActiveTab,
  settings, onSaveSettings, center, userPolys, fieldId,
}: {
  analysis: any;
  boundary: BoundaryRing[] | null;
  tileUrl: string;
  bounds: L.LatLngBoundsExpression | null;
  maxNative: number;
  taskId: string;
  fieldId: string | null;
  runAnalysis: () => void;
  setActiveTab: (k: any) => void;
  settings: FarmerSettings;
  onSaveSettings: (s: FarmerSettings) => Promise<void> | void;
  center: [number, number];
  userPolys: UserPoly[];
}) {
  const [spacingM, setSpacingM] = useState<number>(15);
  const [transitAltM, setTransitAltM] = useState<number>(30);
  const [sprayAltM, setSprayAltM] = useState<number>(3);
  const [transitSpeed, setTransitSpeed] = useState<number>(10);
  const [spraySpeed, setSpraySpeed] = useState<number>(3);
  // How many times the drone re-covers each anomaly zone. 1 = single pass set,
  // 2 = double coverage (e.g. heavy infestation), 3 = triple. Linearly scales
  // spray distance, time, and tank/battery usage.
  const [repeats, setRepeats] = useState<number>(1);
  const [home, setHome] = useState<LatLng2 | null>(null);

  // Pre-flight battery — user can simulate "what if I launch at 60%?" without
  // leaving the planner. Defaults to the active drone's stored battery; if no
  // drone is registered, the slider is hidden and a placeholder is shown.
  const [preFlightBattery, setPreFlightBattery] = useState<number>(100);

  // ---- Simulation playback ---------------------------------------------
  // Animates a virtual drone along the planned mission. Spray pulse appears
  // when the current segment is sprayer-ON. Speed multiplier lets users
  // fast-forward through long missions.
  const [simPlaying, setSimPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState<number>(8);  // realtime * multiplier
  const [simT, setSimT] = useState(0);

  // ---- Drone fleet ------------------------------------------------------
  type FleetDrone = { id: string; name: string; model: string; battery: number; status: string };
  const [drones, setDrones] = useState<FleetDrone[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("drones")
        .select("id, name, model, battery, status").order("created_at", { ascending: false });
      if (!cancelled) setDrones((data as any) ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  // Local mirror of flight_plan so slider drags don't hit the DB on every tick.
  // We persist on a 600ms idle debounce.
  const [fp, setFp] = useState<FarmerSettings["flight_plan"]>(settings.flight_plan);
  useEffect(() => { setFp(settings.flight_plan); }, [settings.flight_plan]);
  useEffect(() => {
    if (JSON.stringify(fp) === JSON.stringify(settings.flight_plan)) return;
    const t = setTimeout(() => {
      onSaveSettings({ ...settings, flight_plan: fp });
    }, 600);
    return () => clearTimeout(t);
  }, [fp]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeDrone = drones.find(d => d.id === fp.drone_id) ?? null;
  useEffect(() => {
    if (activeDrone) setPreFlightBattery(activeDrone.battery);
  }, [activeDrone?.id, activeDrone?.battery]);

  // ---- Spray log / "Mark as Flown" -------------------------------------
  // Fetches the most recent flight_log for this scan so we can show the
  // compliance summary ("X acres treated · Y L applied · logged DATE")
  // directly under the export button, and so the modal opens pre-filled
  // for repeat flights.
  type FlightLogRow = {
    id: string; date_flown: string; battery_start: number | null;
    battery_end: number | null; tank_refills: number;
    zones_completed: string[]; acres_treated: number | null;
    liters_applied: number | null; notes: string | null;
  };
  const [logOpen, setLogOpen] = useState(false);
  const [lastLog, setLastLog] = useState<FlightLogRow | null>(null);
  const refreshLastLog = useCallback(async () => {
    if (!taskId) return;
    const { data } = await supabase.from("flight_logs")
      .select("id, date_flown, battery_start, battery_end, tank_refills, zones_completed, acres_treated, liters_applied, notes")
      .eq("scan_id", taskId)
      .order("date_flown", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastLog((data as FlightLogRow | null) ?? null);
  }, [taskId]);
  useEffect(() => { void refreshLastLog(); }, [refreshLastLog]);
  const droneModelKey = activeDrone?.model ?? "Custom";
  const baseSpec = DRONE_SPECS[droneModelKey] ?? fp.custom_specs;
  const isCustom = !DRONE_SPECS[droneModelKey] || droneModelKey === "Custom";
  // Merge defaults so older saved custom_specs (missing newer fields like
  // min_turn_radius_m / climb_rate_ms) still pass maneuverability checks.
  const SPEC_DEFAULTS = DRONE_SPECS["Custom"];
  const spec: DroneSpec = { ...SPEC_DEFAULTS, ...(isCustom ? fp.custom_specs : baseSpec) };

  const updateFlightPlan = (patch: Partial<FarmerSettings["flight_plan"]>) =>
    setFp(prev => ({ ...prev, ...patch }));

  // ---- Weather (read planner-side from the same 20-min localStorage cache
  // the Weather tab writes). Falls back to "no weather data".
  const wxCacheKey = `acrespray.weather.${center[0].toFixed(3)},${center[1].toFixed(3)}`;
  const wx = (() => {
    try {
      const raw = localStorage.getItem(wxCacheKey);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c?.data?.current) return null;
      const cur = c.data.current;
      return {
        wind_ms: (cur.wind_kmh ?? 0) / 3.6,
        wind_dir: cur.wind_dir ?? 0,    // meteorological "from" direction in degrees
        temp_c: cur.temp_c ?? 20,
        savedAt: c.savedAt as number,
      };
    } catch { return null; }
  })();

  // Combine AI treatment zones + farmer-drawn manual annotations into a single
  // list of polygons the planner will lawnmower over. Both are filtered to
  // those whose centroid lies inside the field boundary.
  type PlannerZone = { id: string; ring: LatLng2[]; severity: AiZone["severity"]; source: "ai" | "user" };
  const aiZonesRaw: PlannerZone[] = ((analysis?.zones ?? []) as AiZone[])
    .map(z => ({ id: z.id, ring: z.ring, severity: z.severity, source: "ai" as const }));
  const userZonesRaw: PlannerZone[] = (userPolys ?? [])
    .filter(u => u.ring && u.ring.length >= 3)
    .map(u => ({ id: `user:${u.id}`, ring: u.ring, severity: "medium" as const, source: "user" as const }));
  const allZonesRaw: PlannerZone[] = [...aiZonesRaw, ...userZonesRaw];
  const validZones = (() => {
    if (!boundary || boundary.length === 0) return [];
    return allZonesRaw.filter(z => {
      if (!z.ring || z.ring.length < 3) return false;
      const cx = z.ring.reduce((a, p) => a + p.lng, 0) / z.ring.length;
      const cy = z.ring.reduce((a, p) => a + p.lat, 0) / z.ring.length;
      return pointInAnyRing({ lat: cy, lng: cx }, boundary as LatLng2[][]);
    });
  })();

  // Default home = centroid of boundary, but only set once so user drags persist.
  const defaultHome = boundary && boundary.length > 0 ? centroidOfRings(boundary as LatLng2[][]) : null;
  const effectiveHome = home ?? defaultHome;

  // ---- Coverage-max spacing ----------------------------------------------
  // The largest row spacing that still guarantees at least one sweep line
  // passes through every anomaly zone. Computed in the same rotated frame
  // buildFieldSweep uses (field's principal axis), so it matches the actual
  // pattern that gets generated. If any zone is narrower than this, it can
  // be missed entirely.
  const coverageMaxM = (() => {
    if (!boundary || boundary.length === 0 || validZones.length === 0) return null;
    const fieldCenter = centroidOfRings(boundary as LatLng2[][]);
    const theta = principalAxisAngle(boundary as LatLng2[][]);
    const cF = Math.cos(-theta), sF = Math.sin(-theta);
    const rot = (p: LatLng2) => rotateLL(p, fieldCenter, cF, sF);
    let minHeightM = Infinity;
    for (const z of validZones) {
      const rr = z.ring.map(rot);
      let lo = Infinity, hi = -Infinity;
      for (const p of rr) { if (p.lat < lo) lo = p.lat; if (p.lat > hi) hi = p.lat; }
      const h = (hi - lo) * M_PER_DEG_LAT;
      if (h < minHeightM) minHeightM = h;
    }
    if (!isFinite(minHeightM) || minHeightM <= 0) return null;
    // Floor by 0.5 m so the slider always lands inside, not exactly on the edge.
    return Math.max(1, Math.floor(minHeightM * 2) / 2 - 0.5);
  })();

  // ---- Recommended spacing -----------------------------------------------
  // Home-aware: wider spacing = fewer passes = fewer long returns to/from
  // home, so the recommendation widens as the home pin moves away from the
  // field. Capped by both the coverage-max (every anomaly must still be hit)
  // and the active drone's physical spray swath.
  const recommendedSpacing = (() => {
    const base = 15;
    let rec = base;
    if (effectiveHome && boundary && boundary.length > 0) {
      const c = centroidOfRings(boundary as LatLng2[][]);
      const dHome = distM(effectiveHome, c);
      const adj = Math.round(Math.max(-5, Math.min(8, (dHome - 60) / 60)));
      rec = base + adj;
    }
    if (coverageMaxM && rec > coverageMaxM) rec = Math.floor(coverageMaxM);
    const droneSwath = spec?.spray_swath_m && spec.spray_swath_m > 0 ? spec.spray_swath_m : null;
    if (droneSwath && rec > droneSwath) rec = Math.floor(droneSwath);
    return Math.max(5, Math.min(22, rec));
  })();

  // Auto-snap spacing to the recommended value until the user manually moves
  // the slider. Re-applies whenever the recommendation changes (e.g. home pin
  // moves, drone changes, zones recomputed).
  const userTouchedSpacingRef = useRef(false);
  useEffect(() => {
    if (userTouchedSpacingRef.current) return;
    if (spacingM !== recommendedSpacing) setSpacingM(recommendedSpacing);
  }, [recommendedSpacing]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Maneuverability check ---------------------------------------------
  // Verifies the current pattern (spacing + speeds + altitude deltas) is
  // physically flyable by the active drone:
  //   1. U-turn radius at row ends must be ≥ drone's tightest physical
  //      turn radius (spec.min_turn_radius_m). Required radius = spacing / 2.
  //   2. Bank-limited turn radius at transit speed (r = v² / (g·tan 25°))
  //      must also fit inside spacing / 2 — otherwise the drone overshoots.
  //   3. The climb between spray and transit altitude must be sustainable
  //      at the spec'd climb rate within the row-end distance available.
  const G = 9.81;
  const BANK_RAD = (25 * Math.PI) / 180;
  const maneuver = (() => {
    const rUturnNeeded = spacingM / 2;
    const rBankTransit = (transitSpeed * transitSpeed) / (G * Math.tan(BANK_RAD));
    const altDelta = Math.abs(transitAltM - sprayAltM);
    const climbTimeS = altDelta / Math.max(0.5, spec.climb_rate_ms);
    const climbHorizM = climbTimeS * transitSpeed;
    const failPhysical = rUturnNeeded < spec.min_turn_radius_m;
    const failBank = rUturnNeeded < rBankTransit;
    const failClimb = climbHorizM > spacingM * 4;  // need a comfortable runway
    const issues: string[] = [];
    if (failPhysical) issues.push(
      `Spacing ${spacingM} m forces a ${rUturnNeeded.toFixed(1)} m U-turn — tighter than the ${spec.min_turn_radius_m} m physical minimum for this drone.`);
    if (failBank) issues.push(
      `Transit speed ${transitSpeed} m/s needs a ${rBankTransit.toFixed(1)} m banked turn radius — wider than the ${rUturnNeeded.toFixed(1)} m available between rows.`);
    if (failClimb) issues.push(
      `${altDelta.toFixed(0)} m climb at ${spec.climb_rate_ms} m/s needs ~${climbHorizM.toFixed(0)} m of horizontal runway — more than the row-end space allows.`);
    return { ok: issues.length === 0, issues, rUturnNeeded, rBankTransit, climbHorizM };
  })();

  // ---- Auto-fix ----------------------------------------------------------
  // When the pattern fails maneuverability, nudge parameters until it passes:
  //   • bank-limited fail → drop transit speed to v = sqrt(spacing/2 · g·tan25°)
  //   • physical-radius fail → widen spacing to 2 · min_turn_radius_m
  //   • climb fail → drop transit/spray altitude delta by raising spray alt
  // Records what changed so the UI can report the auto-adjustment.
  const [autoFixNote, setAutoFixNote] = useState<string | null>(null);
  const fixingRef = useRef(false);
  useEffect(() => {
    if (maneuver.ok) { setAutoFixNote(null); return; }
    if (fixingRef.current) return;
    fixingRef.current = true;
    const fixes: string[] = [];

    // 1) Widen spacing if drone physically can't U-turn at current spacing.
    let newSpacing = spacingM;
    const minSpacing = Math.ceil(spec.min_turn_radius_m * 2);
    if (spacingM / 2 < spec.min_turn_radius_m && newSpacing < minSpacing) {
      newSpacing = Math.min(25, minSpacing);
      fixes.push(`spacing → ${newSpacing} m`);
    }

    // 2) Cap transit speed by bank-limited radius for the (possibly new) spacing.
    let newTransit = transitSpeed;
    const vMax = Math.sqrt((newSpacing / 2) * G * Math.tan(BANK_RAD));
    if (vMax < transitSpeed) {
      newTransit = Math.max(3, Math.floor(vMax * 2) / 2);
      fixes.push(`transit speed → ${newTransit} m/s`);
    }

    // 3) Reduce climb runway by trimming the altitude delta.
    let newSprayAlt = sprayAltM;
    const altDelta = Math.abs(transitAltM - sprayAltM);
    const climbHoriz = (altDelta / Math.max(0.5, spec.climb_rate_ms)) * newTransit;
    if (climbHoriz > newSpacing * 4) {
      const allowedDelta = (newSpacing * 4) * spec.climb_rate_ms / Math.max(1, newTransit);
      newSprayAlt = Math.max(1, Math.round((transitAltM - allowedDelta) * 2) / 2);
      if (newSprayAlt !== sprayAltM) fixes.push(`spray altitude → ${newSprayAlt} m`);
    }

    if (fixes.length) {
      if (newSpacing !== spacingM) { userTouchedSpacingRef.current = true; setSpacingM(newSpacing); }
      if (newTransit !== transitSpeed) setTransitSpeed(newTransit);
      if (newSprayAlt !== sprayAltM) setSprayAltM(newSprayAlt);
      setAutoFixNote(`Auto-adjusted: ${fixes.join(" · ")}`);
    }
    // Release after a tick so subsequent renders re-check the fixed values.
    setTimeout(() => { fixingRef.current = false; }, 50);
  }, [maneuver.ok, spacingM, transitSpeed, sprayAltM, transitAltM, spec.min_turn_radius_m, spec.climb_rate_ms]);

  const mission = (() => {
    if (!boundary || validZones.length === 0 || !effectiveHome) return null;
    return buildMission(
      boundary as LatLng2[][],
      validZones.map(z => ({ id: z.id, ring: z.ring })),
      { home: effectiveHome, transitAltM, sprayAltM, transitSpeed, spraySpeed, spacingM, repeats },
    );
  })();

  // ---- Simulation timeline (rebuilt whenever the mission changes) -------
  const simTimeline = useMemo(() => buildSimTimeline(mission), [mission]);
  // Reset playhead when the mission changes shape.
  useEffect(() => { setSimT(0); setSimPlaying(false); }, [simTimeline.total]);
  // RAF loop — advances simT by (dt * simSpeed). Stops at the end.
  useEffect(() => {
    if (!simPlaying || simTimeline.total <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSimT(prev => {
        const next = prev + dt * simSpeed;
        if (next >= simTimeline.total) { setSimPlaying(false); return simTimeline.total; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [simPlaying, simSpeed, simTimeline.total]);
  const simState = simPosAt(simTimeline, simT);

  const downloadWaypoints = () => {
    if (!mission || mission.waypoints.length === 0) return;
    const blob = exportMissionFile(mission);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mission-${taskId}.waypoints`; a.click();
    URL.revokeObjectURL(url);
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60); const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ---- Battery / endurance estimation ------------------------------------
  // Formula per spec: base flight time × wind × altitude × payload × temp.
  // Wind only counts as a headwind when blowing into the dominant pass axis;
  // a crosswind gets half the penalty, a tailwind helps a little.
  const battery = (() => {
    if (!mission) return null;
    const totalDistM = mission.sprayDistM + mission.transitDistM;
    const totalTimeS = mission.sprayTimeS + mission.transitTimeS;
    if (totalDistM < 1 || totalTimeS < 1) return null;
    const cruiseMs = totalDistM / totalTimeS;        // weighted real cruise
    const baseFlightMin = totalTimeS / 60;

    // Pass axis bearing (deg from north, 0–180) — from first spray segment.
    let passBearing: number | null = null;
    const firstPass = mission.spraySegments?.[0];
    if (firstPass && firstPass.length >= 2) {
      const a = firstPass[0], b = firstPass[firstPass.length - 1];
      const dy = b.lat - a.lat, dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
      let deg = (Math.atan2(dx, dy) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      passBearing = deg % 180;
    }

    let windFactor = 1, windKind: "headwind" | "crosswind" | "tailwind" | "calm" = "calm";
    if (wx && wx.wind_ms > 0.3) {
      // wx.wind_dir is "from" direction. Wind vector heads to (dir+180).
      const windTo = (wx.wind_dir + 180) % 360;
      let rel = passBearing != null ? Math.abs(((windTo - passBearing + 540) % 360) - 180) : 90;
      // rel: 0 = perfectly aligned with pass direction (tailwind on outbound),
      // 180 = directly against. We don't know which way each pass flies, but
      // a boustrophedon spends ~half each direction, so the head- and tail-
      // wind components on alternating rows wash out. Net effect: only the
      // *cross* component truly disappears, the *along* component fights you
      // on every other row. Apply full penalty when aligned, half on cross.
      const alignment = Math.abs(Math.cos((rel * Math.PI) / 180)); // 0=cross, 1=along
      const penalty = wx.wind_ms * 0.02 * (0.5 + 0.5 * alignment);
      windFactor = 1 + penalty;
      windKind = alignment > 0.7 ? "headwind" : alignment > 0.3 ? "crosswind" : "tailwind";
    }

    // Weighted avg altitude (spray vs transit) — the formula is per-meter AGL.
    const avgAlt = (sprayAltM * mission.sprayTimeS + transitAltM * mission.transitTimeS) / totalTimeS;
    const altitudeFactor = 1 + avgAlt * 0.001;

    const tankLoad = Math.max(0, Math.min(100, fp.tank_load_pct)) / 100;
    const payloadFactor = 1 + tankLoad * 0.15;

    const tempC = wx?.temp_c ?? 20;
    const tempFactor = tempC < 15 ? 1 + (15 - tempC) * 0.01 : 1.0;

    const estimatedFlightMin = baseFlightMin * windFactor * altitudeFactor * payloadFactor * tempFactor;
    const batteryPercent = (estimatedFlightMin / Math.max(1, spec.max_flight_min)) * 100;
    const batteriesNeeded = Math.max(1, Math.ceil(batteryPercent / 80));

    const pct = (f: number) => `${f >= 1 ? "+" : ""}${((f - 1) * 100).toFixed(0)}%`;
    const recommendedTankL = spec.tank_l > 0 ? +(spec.tank_l * tankLoad).toFixed(1) : 0;

    return {
      baseFlightMin, estimatedFlightMin, batteryPercent, batteriesNeeded,
      windPctLabel: pct(windFactor), windKind, windMs: wx?.wind_ms ?? 0,
      altPctLabel: pct(altitudeFactor), avgAlt,
      payloadPctLabel: pct(payloadFactor),
      tempPctLabel: pct(tempFactor), tempC,
      cruiseMs, recommendedTankL,
    };
  })();

  // Midpoint along the mission path — surfaced as a yellow pin when a battery
  // swap is required, so the pilot can see where they'll be when the first
  // pack runs out.
  const swapPoint: LatLng2 | null = (() => {
    if (!mission || !battery || battery.batteriesNeeded <= 1) return null;
    // Walk waypoints in order; halt at fraction (battery 1 exhausts at ~80%
    // of estimated time of *that* battery).
    const wps = mission.waypoints;
    if (wps.length < 2) return null;
    const target = (mission.sprayDistM + mission.transitDistM) * (1 / battery.batteriesNeeded);
    let acc = 0;
    for (let i = 1; i < wps.length; i++) {
      const seg = distM(wps[i - 1], wps[i]);
      if (acc + seg >= target) {
        const t = (target - acc) / Math.max(0.01, seg);
        return {
          lat: wps[i - 1].lat + (wps[i].lat - wps[i - 1].lat) * t,
          lng: wps[i - 1].lng + (wps[i].lng - wps[i - 1].lng) * t,
        };
      }
      acc += seg;
    }
    return null;
  })();

  // ---- Live telemetry during playback ------------------------------------
  // Battery drains linearly over mission time (scaled to the estimated draw),
  // spray tank drains in proportion to spray distance covered, and distance
  // counters tick up segment-by-segment so the readout feels like real
  // telemetry instead of a static summary.
  const liveStats = useMemo(() => {
    if (!mission || simTimeline.total <= 0) return null;
    const totalDist = mission.sprayDistM + mission.transitDistM;
    const totalSprayDist = Math.max(0.01, mission.sprayDistM);
    let segIdx = -1;
    let distCovered = 0;
    let sprayCovered = 0;
    for (let i = 0; i < simTimeline.segs.length; i++) {
      const s = simTimeline.segs[i];
      if (simT >= s.tEnd) {
        distCovered += s.dist;
        if (s.spray) sprayCovered += s.dist;
      } else if (simT > s.tStart) {
        const f = (simT - s.tStart) / Math.max(0.0001, s.tEnd - s.tStart);
        distCovered += s.dist * f;
        if (s.spray) sprayCovered += s.dist * f;
        segIdx = i;
        break;
      } else { segIdx = i; break; }
    }
    if (segIdx === -1) segIdx = simTimeline.segs.length - 1;
    const cur = simTimeline.segs[segIdx];
    const lastIdx = simTimeline.segs.length - 1;
    const landed = simT >= simTimeline.total;
    const isRth = !landed && segIdx === lastIdx && cur && !cur.spray;
    const phase: "idle" | "spraying" | "transit" | "rth" | "landed" =
      landed ? "landed"
      : !simPlaying && simT === 0 ? "idle"
      : cur?.spray ? "spraying"
      : isRth ? "rth"
      : "transit";
    const drawPct = battery?.batteryPercent ?? 0;
    const elapsedFrac = Math.min(1, simT / simTimeline.total);
    const batteryRemaining = Math.max(0, 100 - elapsedFrac * drawPct);
    const tankStart = Math.max(0, Math.min(100, fp.tank_load_pct || 100));
    const tankRemaining = Math.max(0, tankStart * (1 - sprayCovered / totalSprayDist));
    return {
      phase, distCovered, totalDist, sprayCovered, totalSprayDist,
      batteryRemaining, batteryStart: 100, tankRemaining, tankStart,
    };
  }, [simT, simTimeline, mission, battery, fp.tank_load_pct, simPlaying]);

  // Empty states ------------------------------------------------------------
  if (!boundary || boundary.length === 0) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-8" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md">
          <Plane className="h-8 w-8 mx-auto mb-3 text-[#4CAF50]" />
          <h2 className="text-lg font-semibold mb-1">Flight Planner</h2>
          <p className="text-sm text-neutral-500 mb-4">Define your field boundary first — the planner needs a hard no-fly perimeter before it can lay down flight lines.</p>
          <button onClick={() => setActiveTab("field")} className="text-xs bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 font-semibold">
            Go to Field View
          </button>
        </div>
      </div>
    );
  }
  if (allZonesRaw.length === 0) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-8" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md">
          <Plane className="h-8 w-8 mx-auto mb-3 text-[#4CAF50]" />
          <h2 className="text-lg font-semibold mb-1">Flight Planner</h2>
          <p className="text-sm text-neutral-500 mb-4">Run AI analysis or draw a manual anomaly first — the planner generates lawnmower patterns over treatment zones.</p>
          <button onClick={runAnalysis} className="text-xs bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 font-semibold inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" /> Analyze field
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex" style={{ background: "#0f0f0f" }}>
      {/* Map preview */}
      <div className="flex-1 relative">
        <MapContainer
          bounds={bounds ?? undefined}
          boundsOptions={{ padding: [40, 40] }}
          minZoom={1} maxZoom={22} preferCanvas
          zoomControl={false} attributionControl={false}
          style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={19} maxZoom={22} zIndex={1}
          />
          {tileUrl && bounds && (
            <TileLayer
              key={tileUrl} url={tileUrl}
              maxNativeZoom={Math.min(20, maxNative)} maxZoom={22}
              tileSize={256} keepBuffer={4}
              bounds={bounds} noWrap zIndex={10}
            />
          )}
          <PlannerOverlay
            boundary={boundary} zones={validZones}
            mission={mission} home={effectiveHome}
            onHomeChange={(p) => setHome(p)}
            swapPoint={swapPoint}
          />
          <DroneSimMarker sim={simState} />
        </MapContainer>
        <div className="absolute top-3 left-3 z-[400] bg-black/70 text-[10px] uppercase tracking-wider px-2 py-1.5 rounded-sm border border-[#222] flex flex-col gap-1">
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Home (drag or click map)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 border-t-2 border-dashed border-yellow-400" /> Transit (sprayer off)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 border-t-2 border-cyan-400" /> Spray pattern</div>
          {swapPoint && (
            <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full bg-yellow-400 border border-black" /> Battery swap</div>
          )}
        </div>
      </div>

      {/* Right control panel */}
      <div className="w-80 shrink-0 border-l border-[#222] overflow-auto p-4" style={{ background: "#161616" }}>
        <div className="flex items-center gap-2 mb-4">
          <Plane className="h-4 w-4 text-[#4CAF50]" />
          <div className="text-sm font-semibold">Flight Planner</div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Pre-flight battery</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4" style={{ background: "#0f0f0f" }}>
          {drones.length === 0 ? (
            <div className="text-[11px] text-neutral-600 italic leading-relaxed">
              Register a drone in <span className="text-neutral-400">Fleet</span> to enable battery simulation
            </div>
          ) : !activeDrone ? (
            <div className="text-[11px] text-neutral-500 leading-relaxed">
              Select an active drone below to simulate pre-flight battery.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-neutral-500">Launch with</span>
                <span className={`font-mono text-sm ${preFlightBattery < 30 ? "text-red-400" : preFlightBattery < 60 ? "text-yellow-300" : "text-[#4CAF50]"}`}>
                  {preFlightBattery}%
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={1}
                value={preFlightBattery}
                onChange={(e) => setPreFlightBattery(Number(e.target.value))}
                className="w-full accent-[#4CAF50]"
              />
              <div className="text-[10px] text-neutral-600 mt-1">
                Stored: {activeDrone.battery}% — adjust to simulate a partial charge.
              </div>
            </>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Pattern</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 space-y-3" style={{ background: "#0f0f0f" }}>
          <button
            type="button"
            onClick={() => {
              userTouchedSpacingRef.current = false;
              setSpacingM(recommendedSpacing);
              setRepeats(1);
              setTransitAltM(30);
              setSprayAltM(3);
              setTransitSpeed(10);
              setSpraySpeed(3);
            }}
            className="w-full rounded-sm border border-[#4CAF50]/40 bg-[#4CAF50]/10 hover:bg-[#4CAF50]/20 text-[#4CAF50] text-[11px] font-medium py-2 transition"
          >
            ✨ Generate recommended flight plan
          </button>
          <div className="text-[10px] text-neutral-500 -mt-1">
            Auto-configures spacing, altitude, and speed to cover every anomaly with the shortest safe path for your home position.
          </div>
          {(() => {
            const recommended = recommendedSpacing;
            const atRec = spacingM === recommended;
            return (
              <>
                <Slider2
                  label={`Swath spacing  ·  recommended ${recommended} m${atRec ? "  ·  auto" : ""}`}
                  value={spacingM}
                  setValue={(n) => { userTouchedSpacingRef.current = true; setSpacingM(n); }}
                  min={3} max={25} step={1} unit="m"
                />
                {!atRec && (
                  <button
                    type="button"
                    onClick={() => { userTouchedSpacingRef.current = false; setSpacingM(recommended); }}
                    className="text-[10px] text-[#4CAF50] hover:underline -mt-1"
                  >
                    ↺ Reset to recommended ({recommended} m)
                  </button>
                )}
              </>
            );
          })()}
          <Slider2
            label={`Spray coverage  ·  ${repeats}× pass${repeats > 1 ? "es" : ""}`}
            value={repeats}
            setValue={setRepeats}
            min={1} max={4} step={1} unit="×"
          />
          <div className="text-[10px] text-neutral-500 -mt-1">
            Each anomaly zone gets its own lawnmower. Increase pass count for heavy infestation — multiplies tank, time, and battery usage.
          </div>
          <Slider2 label="Transit altitude (AGL)" value={transitAltM} setValue={setTransitAltM} min={10} max={120} step={1} unit="m" />
          <Slider2 label="Spray altitude (AGL)" value={sprayAltM} setValue={setSprayAltM} min={1} max={10} step={0.5} unit="m" />
          <Slider2 label="Transit speed" value={transitSpeed} setValue={setTransitSpeed} min={3} max={20} step={0.5} unit="m/s" />
          <Slider2 label="Spray speed" value={spraySpeed} setValue={setSpraySpeed} min={1} max={8} step={0.5} unit="m/s" />
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Maneuverability</div>
        <div className={`rounded-sm border p-3 mb-4 text-xs space-y-2 ${maneuver.ok ? "border-[#1f3a1f]" : "border-amber-900/60"}`}
             style={{ background: maneuver.ok ? "#0c1a0c" : "#1a140a" }}>
          <div className="flex items-center justify-between">
            <span className={`font-medium ${maneuver.ok ? "text-[#4CAF50]" : "text-amber-300"}`}>
              {maneuver.ok ? "✓ Flyable by " : "⚠ Adjusting for "} {droneModelKey}
            </span>
            <span className="font-mono text-[10px] text-neutral-500">
              U-turn need {maneuver.rUturnNeeded.toFixed(1)} m · bank {maneuver.rBankTransit.toFixed(1)} m
            </span>
          </div>
          {!maneuver.ok && maneuver.issues.map((m, i) => (
            <div key={i} className="text-[11px] text-amber-200/80 leading-relaxed">• {m}</div>
          ))}
          {autoFixNote && (
            <div className="text-[11px] text-[#4CAF50] leading-relaxed pt-1 border-t border-[#1f1f1f]">
              {autoFixNote}
            </div>
          )}
          <div className="text-[10px] text-neutral-500 leading-relaxed">
            Min turn radius {spec.min_turn_radius_m} m · climb {spec.climb_rate_ms} m/s. Spacing &amp; transit speed are auto-tuned so every U-turn fits within the drone's physical limits.
          </div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Drone</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-3" style={{ background: "#0f0f0f" }}>
          {drones.length === 0 ? (
            <div className="text-[11px] text-neutral-400 leading-relaxed">
              No drones in your fleet yet. Register one on the <span className="text-[#4CAF50]">Fleet</span> page to get accurate battery estimates.
            </div>
          ) : (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-500">Active drone</label>
              <select
                value={fp.drone_id ?? ""}
                onChange={(e) => updateFlightPlan({ drone_id: e.target.value || null })}
                className="mt-1 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]"
              >
                <option value="">— Select drone —</option>
                {drones.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.model}{d.status !== "idle" ? ` · ${d.status.replace("_", " ")}` : ""}
                  </option>
                ))}
              </select>
              {activeDrone && (
                <div className="mt-2 text-[10px] text-neutral-500 font-mono">
                  Battery now: <span className="text-neutral-300">{activeDrone.battery}%</span> · Spec: {spec.tank_l}L / {spec.max_flight_min} min / {spec.max_speed_ms} m/s
                </div>
              )}
            </div>
          )}
          {isCustom && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1f1f1f]">
              <div className="col-span-2 text-[10px] uppercase tracking-wider text-neutral-500">Custom specs</div>
              <label className="text-[10px] text-neutral-500">Tank (L)
                <input type="number" min={0} step={1} value={fp.custom_specs.tank_l}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, tank_l: Number(e.target.value) || 0 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
              <label className="text-[10px] text-neutral-500">Payload (kg)
                <input type="number" min={0} step={1} value={fp.custom_specs.payload_kg}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, payload_kg: Number(e.target.value) || 0 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
              <label className="text-[10px] text-neutral-500">Flight time (min)
                <input type="number" min={1} step={1} value={fp.custom_specs.max_flight_min}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, max_flight_min: Number(e.target.value) || 1 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
              <label className="text-[10px] text-neutral-500">Max speed (m/s)
                <input type="number" min={1} step={0.5} value={fp.custom_specs.max_speed_ms}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, max_speed_ms: Number(e.target.value) || 1 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
            </div>
          )}
          <div className="pt-2 border-t border-[#1f1f1f]">
            <Slider2 label="Tank load" value={fp.tank_load_pct}
              setValue={(n) => updateFlightPlan({ tank_load_pct: n })}
              min={0} max={100} step={5} unit="%" />
          </div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Home / Takeoff</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          <div className="flex justify-between"><span className="text-neutral-500">Latitude</span>
            <span className="font-mono">{effectiveHome?.lat.toFixed(6) ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Longitude</span>
            <span className="font-mono">{effectiveHome?.lng.toFixed(6) ?? "—"}</span></div>
          <button onClick={() => setHome(null)} className="text-[10px] text-[#4CAF50] hover:underline">Reset to field centroid</button>
        </div>

        {mission && simTimeline.total > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 flex items-center justify-between">
              <span>Simulation</span>
              <span className="font-mono text-neutral-400 normal-case tracking-normal">
                {fmtTime(simT)} / {fmtTime(simTimeline.total)}
              </span>
            </div>
            <div className="rounded-sm border border-[#222] p-3 space-y-3" style={{ background: "#0f0f0f" }}>
              {/* Progress scrubber */}
              <div className="relative">
                <input
                  type="range" min={0} max={simTimeline.total} step={0.1} value={simT}
                  onChange={(e) => { setSimT(parseFloat(e.target.value)); }}
                  className="w-full accent-[#4CAF50]"
                />
                {/* Spray-segment heatmap under the scrubber */}
                <div className="relative h-1.5 -mt-1 rounded-sm overflow-hidden bg-[#1a1a1a]">
                  {simTimeline.segs.filter(s => s.spray).map((s, i) => (
                    <div key={i}
                      className="absolute top-0 bottom-0 bg-cyan-400/70"
                      style={{
                        left: `${(s.tStart / simTimeline.total) * 100}%`,
                        width: `${Math.max(0.3, ((s.tEnd - s.tStart) / simTimeline.total) * 100)}%`,
                      }}
                    />
                  ))}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white"
                    style={{ left: `${(simT / Math.max(0.001, simTimeline.total)) * 100}%` }}
                  />
                </div>
              </div>
              {/* Transport controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (simT >= simTimeline.total) setSimT(0);
                    setSimPlaying(p => !p);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 text-xs font-semibold"
                >
                  {simPlaying
                    ? (<><Pause className="h-3.5 w-3.5" /> Pause</>)
                    : (<><Play className="h-3.5 w-3.5" /> {simT > 0 && simT < simTimeline.total ? "Resume" : "Play"}</>)}
                </button>
                <button
                  onClick={() => { setSimPlaying(false); setSimT(0); }}
                  className="inline-flex items-center justify-center gap-1 border border-[#222] hover:border-[#333] text-neutral-300 rounded-sm px-2.5 py-2 text-xs"
                  title="Reset"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Speed selector */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 flex items-center gap-1.5">
                  <FastForward className="h-3 w-3" /> Playback speed
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 2, 4, 8, 16, 32].map(m => (
                    <button key={m}
                      onClick={() => setSimSpeed(m)}
                      className={`text-[11px] font-mono py-1 rounded-sm border ${
                        simSpeed === m
                          ? "bg-[#4CAF50] text-black border-[#4CAF50]"
                          : "bg-[#1a1a1a] text-neutral-400 border-[#222] hover:border-[#333]"
                      }`}
                    >{m}×</button>
                  ))}
                </div>
              </div>
              {/* Status readout — phase-tinted dot for scan-at-a-glance */}
              {(() => {
                const phase = liveStats?.phase ?? "idle";
                const styleByPhase: Record<string, { text: string; dot: string; label: string; pulse: boolean }> = {
                  spraying: { text: "text-green-300",   dot: "bg-green-400",   label: "Spraying", pulse: true  },
                  transit:  { text: "text-yellow-300",  dot: "bg-yellow-400",  label: "Transit",  pulse: false },
                  rth:      { text: "text-red-400",     dot: "bg-red-500",     label: "RTH",      pulse: true  },
                  landed:   { text: "text-neutral-400", dot: "bg-neutral-500", label: "Landed",   pulse: false },
                  idle:     { text: "text-neutral-400", dot: "bg-neutral-500", label: "Idle",     pulse: false },
                };
                const s = styleByPhase[phase];
                return (
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#222]">
                    <span className="text-neutral-500">Status</span>
                    <span className={`font-mono inline-flex items-center gap-1.5 ${s.text}`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
                      {s.label}
                    </span>
                  </div>
                );
              })()}
              {/* Live telemetry — battery / tank / distance tick down as the
                  drone flies. Hidden until the user hits play so the panel
                  doesn't show 100% / 0 km when nothing's happening. */}
              {liveStats && (simT > 0 || simPlaying) && (
                <div className="space-y-2 pt-2 border-t border-[#222]">
                  {/* Battery */}
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-neutral-500 uppercase tracking-wider">Battery</span>
                      <span className={`font-mono ${liveStats.batteryRemaining < 20 ? "text-red-400" : liveStats.batteryRemaining < 40 ? "text-yellow-300" : "text-green-300"}`}>
                        {liveStats.batteryRemaining.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm overflow-hidden bg-[#1a1a1a]">
                      <div className={`h-full transition-[width] duration-150 ${
                        liveStats.batteryRemaining < 20 ? "bg-red-500"
                        : liveStats.batteryRemaining < 40 ? "bg-yellow-400"
                        : "bg-green-500"
                      }`} style={{ width: `${liveStats.batteryRemaining}%` }} />
                    </div>
                  </div>
                  {/* Spray tank */}
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-neutral-500 uppercase tracking-wider">Spray tank</span>
                      <span className="font-mono text-cyan-300">
                        {liveStats.tankRemaining.toFixed(1)}% <span className="text-neutral-600">of {liveStats.tankStart.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm overflow-hidden bg-[#1a1a1a]">
                      <div className="h-full bg-cyan-400 transition-[width] duration-150"
                        style={{ width: `${(liveStats.tankRemaining / Math.max(1, liveStats.tankStart)) * 100}%` }} />
                    </div>
                  </div>
                  {/* Distance */}
                  <div className="flex justify-between text-[11px] pt-0.5">
                    <span className="text-neutral-500">Distance flown</span>
                    <span className="font-mono text-neutral-300">
                      {(liveStats.distCovered / 1000).toFixed(2)} <span className="text-neutral-600">/ {(liveStats.totalDist / 1000).toFixed(2)} km</span>
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-neutral-500">Sprayed</span>
                    <span className="font-mono text-cyan-300">
                      {(liveStats.sprayCovered / 1000).toFixed(2)} <span className="text-neutral-600">/ {(liveStats.totalSprayDist / 1000).toFixed(2)} km</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Mission summary</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          <div className="flex justify-between"><span className="text-neutral-500">Zones</span>
            <span className="font-mono">{validZones.length} of {allZonesRaw.length} <span className="text-neutral-600">(AI {aiZonesRaw.length} · marks {userZonesRaw.length})</span></span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Total waypoints</span>
            <span className="font-mono">{mission?.waypoints.length ?? 0}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Spray distance</span>
            <span className="font-mono text-cyan-300">{mission ? (mission.sprayDistM / 1000).toFixed(2) : "0.00"} km</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Transit distance</span>
            <span className="font-mono text-yellow-300">{mission ? (mission.transitDistM / 1000).toFixed(2) : "0.00"} km</span></div>
          <div className="border-t border-[#222] my-1.5" />
          <div className="flex justify-between"><span className="text-neutral-500">Spray time</span>
            <span className="font-mono text-cyan-300">{mission ? fmtTime(mission.sprayTimeS) : "0:00"}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Transit time</span>
            <span className="font-mono text-yellow-300">{mission ? fmtTime(mission.transitTimeS) : "0:00"}</span></div>
          <div className="flex justify-between font-semibold"><span>Total time</span>
            <span className="font-mono">{mission ? fmtTime(mission.sprayTimeS + mission.transitTimeS) : "0:00"}</span></div>
          <div className="border-t border-[#222] my-1.5" />
          <div className="flex justify-between"><span className="text-neutral-500">Spray activations</span>
            <span className="font-mono">{mission?.sprayOnCount ?? 0}</span></div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 flex items-center justify-between">
          <span>Battery / endurance</span>
          {!wx && <span className="text-[10px] text-neutral-600 normal-case font-normal tracking-normal">No weather — open Weather tab</span>}
        </div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          {!battery ? (
            <div className="text-[11px] text-neutral-500">Generate a mission to see battery estimate.</div>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-neutral-500">Est. flight time</span>
                <span className="font-mono">{battery.estimatedFlightMin.toFixed(1)} min</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Battery used</span>
                <span className={`font-mono ${battery.batteryPercent > 80 ? "text-red-400" : battery.batteryPercent > 60 ? "text-yellow-300" : "text-[#4CAF50]"}`}>
                  {Math.round(battery.batteryPercent)}% of {spec.max_flight_min} min
                </span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Batteries needed</span>
                <span className={`font-mono ${battery.batteriesNeeded > 1 ? "text-red-400" : "text-[#4CAF50]"}`}>{battery.batteriesNeeded}</span></div>
              <div className="border-t border-[#222] my-1.5" />
              <div className="flex justify-between"><span className="text-neutral-500">Wind impact</span>
                <span className="font-mono">
                  {battery.windPctLabel}
                  <span className="text-neutral-500"> ({battery.windKind}{battery.windMs > 0 ? ` ${battery.windMs.toFixed(1)} m/s` : ""})</span>
                </span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Altitude impact</span>
                <span className="font-mono">{battery.altPctLabel} <span className="text-neutral-500">(avg {battery.avgAlt.toFixed(0)} m AGL)</span></span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Payload impact</span>
                <span className="font-mono">{battery.payloadPctLabel} <span className="text-neutral-500">({fp.tank_load_pct}% tank)</span></span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Temp impact</span>
                <span className="font-mono">{battery.tempPctLabel} <span className="text-neutral-500">({battery.tempC.toFixed(0)}°C)</span></span></div>
              {spec.tank_l > 0 && (
                <>
                  <div className="border-t border-[#222] my-1.5" />
                  <div className="flex justify-between"><span className="text-neutral-500">Tank capacity</span>
                    <span className="font-mono">{droneModelKey} — {spec.tank_l} L</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">Recommended load</span>
                    <span className="font-mono text-[#4CAF50]">{battery.recommendedTankL} L</span></div>
                </>
              )}
            </>
          )}
        </div>

        {battery && battery.batteriesNeeded > 1 && (
          <div className="mb-4 text-[11px] text-red-400 bg-red-950/40 border border-red-800/50 rounded px-2 py-2 leading-relaxed">
            <div className="font-semibold mb-0.5">Mission requires {battery.batteriesNeeded} batteries</div>
            Plan a landing zone near the yellow swap pin on the map between passes.
          </div>
        )}

        {battery && activeDrone && Math.round(battery.batteryPercent) > preFlightBattery && (
          <div className="mb-4 text-[11px] text-yellow-300 bg-yellow-950/40 border border-yellow-700/50 rounded px-2 py-2 leading-relaxed">
            ⚠️ Insufficient battery — mission requires ~{Math.round(battery.batteryPercent)}% but drone starts at {preFlightBattery}%. Consider splitting into 2 flights.
          </div>
        )}

        {validZones.length < allZonesRaw.length && (
          <div className="mb-4 text-[11px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1.5">
            {allZonesRaw.length - validZones.length} zone(s) excluded — centroid outside boundary.
          </div>
        )}

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Export</div>
        <button
          onClick={downloadWaypoints}
          disabled={!mission || mission.waypoints.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black rounded-sm px-3 py-2 text-xs font-semibold mb-2"
        >
          <Download className="h-3.5 w-3.5" /> Download .waypoints
        </button>
        <button
          onClick={() => setLogOpen(true)}
          disabled={!mission || mission.waypoints.length === 0 || !fieldId}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#1a1a1a] hover:bg-[#222] disabled:opacity-50 text-neutral-200 border border-[#2a2a2a] rounded-sm px-3 py-2 text-xs font-semibold mb-2"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-[#4CAF50]" /> Mark as Flown
        </button>

        {lastLog && (
          <div className="mb-3 text-[11px] bg-[#0f1a12] border border-[#1f3a25] rounded px-2 py-2 leading-relaxed">
            <div className="flex items-center gap-1.5 text-[#4CAF50] font-semibold mb-0.5">
              <CheckCircle2 className="h-3 w-3" /> Spray log
            </div>
            <div className="text-neutral-300 font-mono">
              {(lastLog.acres_treated ?? 0).toFixed(2)} ac treated
              {lastLog.liters_applied != null && <> · {lastLog.liters_applied.toFixed(1)} L applied (est.)</>}
            </div>
            <div className="text-neutral-500">
              logged {lastLog.date_flown}
              {lastLog.battery_end != null && lastLog.battery_start != null && (
                <> · battery {lastLog.battery_start}% → {lastLog.battery_end}%</>
              )}
            </div>
          </div>
        )}

        <p className="text-[10px] text-neutral-500 leading-relaxed">
          QGC WPL 110 with takeoff, transit (sprayer off), spray (servo ON/OFF on servo 8),
          RTH and land commands. Load in Mission Planner / QGroundControl, or convert for DJI Pilot 2.
        </p>
      </div>

      <LogFlightModal
        open={logOpen}
        onOpenChange={setLogOpen}
        fieldId={fieldId}
        scanId={taskId}
        droneId={fp.drone_id ?? null}
        droneName={activeDrone?.name ?? null}
        batteryStart={preFlightBattery}
        zones={validZones.map(z => {
          const ai = (analysis?.zones ?? []).find((a: AiZone) => a.id === z.id);
          const m2 = polygonAreaM2(z.ring.map(p => L.latLng(p.lat, p.lng)));
          const acres = (m2 / 4046.8564224);
          return {
            id: z.id,
            label: ai?.name ?? (z.source === "user" ? "Manual annotation" : "Zone"),
            issue: ai?.issue ?? null,
            acres,
          };
        })}
        totalAcres={
          // Sprayed acres = sprayed distance × effective swath
          mission ? (mission.sprayDistM * spacingM) / 4046.8564224 : 0
        }
        estLiters={
          // Single-tank estimate at the configured load. Modal multiplies by
          // (refills + 1) once the pilot reports how many times they refilled.
          spec.tank_l > 0
            ? +(spec.tank_l * (Math.max(0, Math.min(100, fp.tank_load_pct)) / 100)).toFixed(2)
            : null
        }
        onSaved={async () => {
          await refreshLastLog();
          // refresh drone roster so the planner picks up the new battery level
          const { data } = await supabase.from("drones")
            .select("id, name, model, battery, status").order("created_at", { ascending: false });
          setDrones((data as any) ?? []);
        }}
      />
    </div>
  );
}

function Slider2({ label, value, setValue, min, max, step, unit, maxSafe, warning }: {
  label: string; value: number; setValue: (n: number) => void;
  min: number; max: number; step: number; unit: string;
  // Optional "max-safe" threshold rendered as a green tick on the track.
  // Values above it are highlighted amber and `warning` is shown below.
  maxSafe?: number;
  warning?: string;
}) {
  const over = maxSafe != null && value > maxSafe;
  const tickPct = maxSafe != null
    ? Math.max(0, Math.min(100, ((maxSafe - min) / Math.max(0.0001, max - min)) * 100))
    : null;
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <div className="relative flex-1">
          <input type="range" min={min} max={max} step={step}
            value={value} onChange={(e) => setValue(Number(e.target.value))}
            className={`w-full ${over ? "accent-amber-400" : "accent-[#4CAF50]"}`} />
          {tickPct != null && (
            <div
              className="pointer-events-none absolute -top-0.5 h-3 w-px bg-[#4CAF50]"
              style={{ left: `${tickPct}%` }}
              title={`Max safe: ${maxSafe!.toFixed(step < 1 ? 1 : 0)} ${unit}`}
            />
          )}
        </div>
        <div className={`font-mono text-sm w-20 text-right ${over ? "text-amber-400" : ""}`}>
          {value.toFixed(step < 1 ? 1 : 0)} {unit}
        </div>
      </div>
      {over && warning && (
        <div className="mt-1 text-[10px] text-amber-400/80 leading-snug">{warning}</div>
      )}
    </div>
  );
}

function PlannerOverlay({ boundary, zones, mission, home, onHomeChange, swapPoint }: {
  boundary: BoundaryRing[];
  zones: { ring: { lat: number; lng: number }[]; severity?: AiZone["severity"] }[];
  mission: Mission | null;
  home: LatLng2 | null;
  onHomeChange: (p: LatLng2) => void;
  swapPoint: LatLng2 | null;
}) {
  // (moved below — DroneSimMarker + simulation helpers live just after this fn)
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);

    boundary.forEach(ring => {
      L.polygon(ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: "#22d3ee", weight: 2, dashArray: "6 4",
        fillColor: "#22d3ee", fillOpacity: 0.04, interactive: false,
      }).addTo(group);
    });
    zones.forEach(z => {
      const color = sevColor(z.severity ?? "medium");
      L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: 1, fillColor: color, fillOpacity: 0.12, interactive: false,
      }).addTo(group);
    });

    if (mission) {
      // Transit segments (sprayer OFF). First = home → start (RED),
      // last = end → home (GREEN), in-between row connectors = yellow dashed.
      const lastIdx = mission.transitSegments.length - 1;
      mission.transitSegments.forEach((seg, i) => {
        const isStart = i === 0;
        const isEnd = i === lastIdx && lastIdx > 0;
        const color = isStart ? "#ef4444" : isEnd ? "#22c55e" : "#facc15";
        const weight = isStart || isEnd ? 4 : 2;
        L.polyline(seg.map(p => [p.lat, p.lng] as [number, number]), {
          color, weight, dashArray: isStart || isEnd ? undefined : "8 6",
          opacity: 1, interactive: false,
        }).addTo(group);
        // Endpoint marker at the serpentine start / end
        if (isStart || isEnd) {
          const pt = isStart ? seg[seg.length - 1] : seg[0];
          L.circleMarker([pt.lat, pt.lng], {
            radius: 7, color: "#000", weight: 2,
            fillColor: color, fillOpacity: 1, interactive: false,
          }).addTo(group).bindTooltip(isStart ? "START" : "END", {
            permanent: true, direction: "top", offset: [0, -8], className: "mission-endpoint-label",
          });
        }
      });
      // Cyan solid spray pattern (sprayer ON)
      mission.spraySegments.forEach(path => {
        L.polyline(path.map(p => [p.lat, p.lng] as [number, number]), {
          color: "#22d3ee", weight: 3, opacity: 1, interactive: false,
        }).addTo(group);
      });
      // Markers at SPRAY_ON / SPRAY_OFF (chemical activations)
      mission.waypoints.forEach(w => {
        if (w.action === "SPRAY_ON" || w.action === "SPRAY_OFF") {
          L.circleMarker([w.lat, w.lng], {
            radius: 4, color: "#000", weight: 1,
            fillColor: w.action === "SPRAY_ON" ? "#22d3ee" : "#94a3b8",
            fillOpacity: 1, interactive: false,
          }).addTo(group);
        }
      });
    }

    // Draggable red home pin
    let homeMarker: L.Marker | null = null;
    if (home) {
      const icon = L.divIcon({
        className: "home-pin",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 1px #000,0 2px 8px rgba(0,0,0,.6);"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9],
      });
      homeMarker = L.marker([home.lat, home.lng], { icon, draggable: true, zIndexOffset: 1000 }).addTo(group);
      homeMarker.bindTooltip("Home / Takeoff", { permanent: false, direction: "top", offset: [0, -10] });
      homeMarker.on("dragend", (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        onHomeChange({ lat: ll.lat, lng: ll.lng });
      });
    }

    // Yellow battery-swap pin (only when mission needs >1 battery)
    if (swapPoint) {
      const icon = L.divIcon({
        className: "swap-pin",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#facc15;border:2px solid #000;box-shadow:0 0 0 1px #fff,0 2px 6px rgba(0,0,0,.6);"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      L.marker([swapPoint.lat, swapPoint.lng], { icon, interactive: true, zIndexOffset: 900 })
        .addTo(group)
        .bindTooltip("Battery swap", { permanent: true, direction: "top", offset: [0, -10], className: "mission-endpoint-label" });
    }

    // Click on map sets new home
    const onClick = (e: L.LeafletMouseEvent) => onHomeChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on("click", onClick);

    return () => { map.off("click", onClick); group.remove(); };
  }, [map, boundary, zones, mission, home, onHomeChange, swapPoint]);
  return null;
}

// ---------------------------------------------------------------------------
// Mission playback: build a flat timeline of positional segments with the
// sprayer-state at each moment, then drive a draggable map marker.
// ---------------------------------------------------------------------------
type SimSeg = {
  from: LatLng2; to: LatLng2; dist: number; speed: number;
  spray: boolean; tStart: number; tEnd: number;
};
export type SimTimeline = { segs: SimSeg[]; total: number };

function buildSimTimeline(m: Mission | null): SimTimeline {
  if (!m) return { segs: [], total: 0 };
  const segs: SimSeg[] = [];
  let t = 0;
  let sprayOn = false;
  let prev: MissionWP | null = null;
  for (const wp of m.waypoints) {
    if (wp.action === "SPRAY_ON") { sprayOn = true; continue; }
    if (wp.action === "SPRAY_OFF") { sprayOn = false; continue; }
    if (wp.action === "SPEED_CHANGE" || wp.action === "ALTITUDE_CHANGE") continue;
    if (!prev) { prev = wp; continue; }
    const d = distM(prev, wp);
    if (d < 0.1) { prev = wp; continue; }
    const speed = Math.max(0.5, wp.speed || prev.speed || 5);
    const dur = d / speed;
    segs.push({ from: prev, to: wp, dist: d, speed, spray: sprayOn, tStart: t, tEnd: t + dur });
    t += dur;
    prev = wp;
  }
  return { segs, total: t };
}

function simPosAt(tl: SimTimeline, t: number): { pos: LatLng2; spraying: boolean } | null {
  if (!tl.segs.length) return null;
  if (t <= 0) {
    const s = tl.segs[0];
    return { pos: s.from, spraying: s.spray };
  }
  if (t >= tl.total) {
    const s = tl.segs[tl.segs.length - 1];
    return { pos: s.to, spraying: false };
  }
  // Linear scan — N is small (hundreds of segments at most).
  for (const s of tl.segs) {
    if (t <= s.tEnd) {
      const f = (t - s.tStart) / Math.max(0.0001, s.tEnd - s.tStart);
      return {
        pos: {
          lat: s.from.lat + (s.to.lat - s.from.lat) * f,
          lng: s.from.lng + (s.to.lng - s.from.lng) * f,
        },
        spraying: s.spray,
      };
    }
  }
  return null;
}

function DroneSimMarker({ sim }: { sim: { pos: LatLng2; spraying: boolean } | null }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  // Inject the spray pulse keyframe once per page.
  useEffect(() => {
    if (document.getElementById("sim-spray-style")) return;
    const s = document.createElement("style");
    s.id = "sim-spray-style";
    s.textContent = `
      @keyframes simSprayPulse { 0% { transform: scale(.5); opacity: .75 } 100% { transform: scale(2.6); opacity: 0 } }
      .sim-drone-icon { pointer-events: none; }
    `;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!sim) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const pulse = sim.spraying
      ? `<span style="position:absolute;inset:-10px;border-radius:50%;background:#22d3ee;opacity:.5;animation:simSprayPulse 1s ease-out infinite;"></span>
         <span style="position:absolute;inset:-10px;border-radius:50%;background:#22d3ee;opacity:.5;animation:simSprayPulse 1s ease-out .5s infinite;"></span>`
      : "";
    const ring = sim.spraying
      ? "0 0 0 2px #22d3ee, 0 0 14px 2px rgba(34,211,238,.6)"
      : "0 0 0 2px #4CAF50";
    const html = `
      <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
        ${pulse}
        <div style="position:relative;width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid #000;box-shadow:${ring},0 2px 8px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
        </div>
      </div>`;
    const icon = L.divIcon({
      className: "sim-drone-icon", html,
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    if (!markerRef.current) {
      markerRef.current = L.marker([sim.pos.lat, sim.pos.lng], {
        icon, interactive: false, zIndexOffset: 2000, keyboard: false,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([sim.pos.lat, sim.pos.lng]);
      markerRef.current.setIcon(icon);
    }
  }, [map, sim]);

  useEffect(() => () => { markerRef.current?.remove(); markerRef.current = null; }, []);
  return null;
}

function PlaceholderTab({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
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
function HeaderWeather({ center, onClick }: { center: [number, number]; onClick: () => void }) {
  const [lat, lng] = center;
  const cacheKey = `acrespray.weather.${lat.toFixed(3)},${lng.toFixed(3)}`;
  const TTL_MS = 20 * 60 * 1000;
  const [cur, setCur] = useState<{ temp_c: number; desc: string; code: number; icon: string } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const c = JSON.parse(raw);
          if (c?.savedAt && Date.now() - c.savedAt < TTL_MS && c?.data?.current) {
            if (!cancelled) setCur(c.data.current);
            return;
          }
        }
        const { data: s } = await supabase.auth.getSession();
        const r = await fetch(`${FN_BASE}/weather?lat=${lat}&lon=${lng}`, {
          headers: s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {},
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? "weather error");
        try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data: j })); } catch {}
        if (!cancelled) setCur(j.current);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [cacheKey, lat, lng]);

  const tempF = cur ? Math.round((cur.temp_c * 9) / 5 + 32) : null;
  return (
    <button
      onClick={onClick}
      title="Open Weather tab"
      className="hidden sm:flex items-center gap-2 px-3 h-7 rounded-sm border border-[#222] bg-[#161616] hover:bg-[#1c1c1c] text-xs transition-colors"
    >
      {cur ? <OwGlyph code={cur.code} icon={cur.icon} className="h-3.5 w-3.5 text-neutral-400" />
           : <Cloud className="h-3.5 w-3.5 text-neutral-400" />}
      <span className="text-neutral-200 tabular-nums">{tempF != null ? `${tempF}°F` : err ? "—" : "…"}</span>
      <span className="text-neutral-500">{cur?.desc ?? (err ? "Weather unavailable" : "Live weather")}</span>
    </button>
  );
}

type OwHour = {
  time: number; temp_c: number; humidity: number; wind_kmh: number; gust_kmh: number;
  wind_dir: number; precip_mm: number; precip_prob: number; clouds: number;
  code: number; icon: string; desc: string;
};
type OwDay = {
  time: number; tmin_c: number; tmax_c: number; humidity: number;
  wind_kmh: number; gust_kmh: number; precip_mm: number; precip_prob: number;
  code: number; icon: string; desc: string;
};

const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (k: number) => k * 0.621371;
const compass = (deg: number) => {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
};

function OwGlyph({ icon, code, className }: { icon: string; code: number; className?: string }) {
  // OpenWeather group ranges: 2xx thunder, 3xx drizzle, 5xx rain, 6xx snow, 7xx atmosphere, 800 clear, 80x clouds
  if (code >= 200 && code < 300) return <CloudRain className={className} />;
  if (code >= 300 && code < 600) return <CloudRain className={className} />;
  if (code >= 600 && code < 700) return <CloudSnow className={className} />;
  if (code >= 700 && code < 800) return <CloudFog className={className} />;
  if (code === 800) return <Sun className={className} />;
  if (icon?.endsWith("d") && code === 801) return <CloudSun className={className} />;
  return <Cloud className={className} />;
}

// Spray suitability — matches user-specified thresholds.
// GREEN: wind < 10 mph (16 km/h), no rain next 6h, humidity 40–70%, temp > 50°F (10°C)
// YELLOW: marginal (one of the soft thresholds borderline)
// RED: hard limits blown.
type Verdict = "green" | "yellow" | "red";
function sprayVerdict(h: OwHour, rainNext6h: number): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  let verdict: Verdict = "green";
  const windMph = kmhToMph(h.wind_kmh);
  const gustMph = kmhToMph(h.gust_kmh);
  const tempF = cToF(h.temp_c);
  // Hard limits → RED
  if (windMph > 10) { reasons.push(`Wind too high: ${windMph.toFixed(0)} mph (limit 10)`); verdict = "red"; }
  if (gustMph > 15) { reasons.push(`Gusts too high: ${gustMph.toFixed(0)} mph`); verdict = "red"; }
  if (rainNext6h > 0.5) { reasons.push(`Rain expected in next 6h: ${rainNext6h.toFixed(1)} mm`); verdict = "red"; }
  if (tempF < 50) { reasons.push(`Temp too cold: ${tempF.toFixed(0)}°F (min 50)`); verdict = "red"; }
  // Soft → YELLOW
  if (verdict !== "red") {
    if (windMph > 8) { reasons.push(`Wind marginal: ${windMph.toFixed(0)} mph`); verdict = "yellow"; }
    if (h.humidity < 40) { reasons.push(`Humidity low: ${h.humidity}% (target 40–70)`); verdict = "yellow"; }
    if (h.humidity > 70) { reasons.push(`Humidity high: ${h.humidity}% (target 40–70)`); verdict = "yellow"; }
    if (tempF > 85) { reasons.push(`Temp warm: ${tempF.toFixed(0)}°F — drift risk`); verdict = "yellow"; }
  }
  return { verdict, reasons };
}

function WeatherTab({ center, fieldName }: { center: [number, number]; fieldName: string }) {
  const [lat, lng] = center;
  // Cache weather per coarse location for 20 min in localStorage so switching
  // tabs (or revisiting the field) doesn't re-hit OpenWeather every time.
  const cacheKey = `acrespray.weather.${lat.toFixed(3)},${lng.toFixed(3)}`;
  const TTL_MS = 20 * 60 * 1000;
  const readCache = () => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c?.savedAt || Date.now() - c.savedAt > TTL_MS) return null;
      return c as { savedAt: number; data: { current: any; hourly: OwHour[]; daily: OwDay[] } };
    } catch { return null; }
  };
  const initial = readCache();
  const [data, setData] = useState<{ current: any; hourly: OwHour[]; daily: OwDay[] } | null>(initial?.data ?? null);
  const [savedAt, setSavedAt] = useState<number | null>(initial?.savedAt ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!force) {
      const c = readCache();
      if (c) { setData(c.data); setSavedAt(c.savedAt); return; }
    }
    setErr(null); setRefreshing(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch(`${FN_BASE}/weather?lat=${lat}&lon=${lng}`, {
        headers: s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {},
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Weather unavailable");
      setData(j);
      const ts = Date.now();
      setSavedAt(ts);
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: ts, data: j })); } catch {}
    } catch (e: any) {
      setErr(e?.message ?? "Weather unavailable");
    } finally {
      setRefreshing(false);
    }
  }, [lat, lng, cacheKey]);

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
  const rainNext6 = hourly.slice(0, 6).reduce((a, h) => a + (h.precip_mm || 0), 0);

  // Verdict for "right now" uses current + next-6h rain.
  const nowHour: OwHour = {
    time: cur.time, temp_c: cur.temp_c, humidity: cur.humidity,
    wind_kmh: cur.wind_kmh, gust_kmh: cur.gust_kmh, wind_dir: cur.wind_dir,
    precip_mm: cur.precip_mm, precip_prob: 0, clouds: cur.clouds,
    code: cur.code, icon: cur.icon, desc: cur.desc,
  };
  const now = sprayVerdict(nowHour, rainNext6);

  // Find best spray windows in the next 72 hours, grouped per day.
  // A "window" is ≥ 2 consecutive GREEN hours.
  const windows: { startTs: number; endTs: number; dayLabel: string }[] = [];
  {
    let runStart = -1;
    for (let i = 0; i < Math.min(72, hourly.length); i++) {
      const fwdRain = hourly.slice(i, i + 6).reduce((a, h) => a + (h.precip_mm || 0), 0);
      const v = sprayVerdict(hourly[i], fwdRain);
      const ok = v.verdict === "green";
      if (ok && runStart < 0) runStart = i;
      if ((!ok || i === Math.min(72, hourly.length) - 1) && runStart >= 0) {
        const end = ok ? i : i - 1;
        if (end - runStart + 1 >= 2) {
          windows.push({
            startTs: hourly[runStart].time,
            endTs: hourly[end].time,
            dayLabel: new Date(hourly[runStart].time * 1000).toLocaleDateString([], { weekday: "long" }),
          });
        }
        runStart = -1;
      }
    }
  }
  const bestWindows = windows.slice(0, 3);

  const fmtHour = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric" });
  const fmtDay = (ts: number) => new Date(ts * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const verdictColor = now.verdict === "green" ? "#4CAF50" : now.verdict === "yellow" ? "#facc15" : "#ef4444";
  const verdictBorder = now.verdict === "green" ? "border-[#4CAF50]/40" : now.verdict === "yellow" ? "border-yellow-400/40" : "border-red-500/40";
  const verdictLabel =
    now.verdict === "green" ? "Good to spray right now" :
    now.verdict === "yellow" ? "Marginal — proceed with caution" : "Do not spray right now";

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
              <div className="text-[11px] text-neutral-500">Wind ≤ 10 mph · No rain 6h · 40–70% RH · Temp ≥ 50°F</div>
            </div>
          </div>
          {now.reasons.length > 0 && (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-400">
              {now.reasons.map((r, i) => <li key={i}>• {r}</li>)}
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
                <div className="text-4xl font-semibold tabular-nums">{Math.round(cToF(cur.temp_c))}°F</div>
                <div className="text-xs text-neutral-400">{Math.round(cur.temp_c)}°C · {cur.desc}</div>
                <div className="text-[11px] text-neutral-500">Feels {Math.round(cToF(cur.feels_c))}°F</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Wind className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Wind</div>
                <div className="font-mono">{kmhToMph(cur.wind_kmh).toFixed(0)} mph {compass(cur.wind_dir)}</div>
                <div className="font-mono text-neutral-500 text-[10px]">{cur.wind_kmh.toFixed(0)} km/h</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Droplets className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Humidity</div>
                <div className="font-mono">{cur.humidity}%</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <ThermometerSun className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Gust</div>
                <div className="font-mono">{kmhToMph(cur.gust_kmh).toFixed(0)} mph</div>
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
                      <div className="text-sm">{w.dayLabel} <span className="text-[#4CAF50] font-mono">{fmtHour(w.startTs)} – {fmtHour(w.endTs)}</span></div>
                      <div className="text-[11px] text-neutral-500">Ideal: wind/humidity/temp all in range, no rain</div>
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
              const fwd = hourly.slice(i, i + 6).reduce((a, x) => a + (x.precip_mm || 0), 0);
              const v = sprayVerdict(h, fwd).verdict;
              const dot = v === "green" ? "bg-[#4CAF50]" : v === "yellow" ? "bg-yellow-400" : "bg-red-500";
              return (
                <div key={i} className="min-w-[88px] rounded-sm border border-[#222] p-2 text-center" style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] text-neutral-500">{fmtHour(h.time)}</div>
                  <OwGlyph code={h.code} icon={h.icon} className="h-5 w-5 mx-auto my-1 text-neutral-300" />
                  <div className="text-sm font-mono tabular-nums">{Math.round(cToF(h.temp_c))}°F</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">{kmhToMph(h.wind_kmh).toFixed(0)} mph</div>
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
                    <span className="text-[#f0f0f0]">{Math.round(cToF(d.tmax_c))}°</span>
                    <span className="text-neutral-500"> / {Math.round(cToF(d.tmin_c))}°</span>
                  </div>
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mt-1">{d.precip_prob}% · {kmhToMph(d.wind_kmh).toFixed(0)} mph</div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-neutral-800/60 last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-200 font-mono">{value}</span>
    </div>
  );
}

// =============================== Settings tab ===============================
const CROP_OPTIONS = [
  "Wheat", "Corn", "Soybeans", "Cotton", "Rice", "Barley", "Oats", "Sorghum", "Other",
];

function SettingsTab({
  settings, onSave, saving, savedAt, fieldAreaHa,
}: {
  settings: FarmerSettings;
  onSave: (s: FarmerSettings) => Promise<void> | void;
  saving: boolean;
  savedAt: number | null;
  fieldAreaHa: number | null;
}) {
  const [local, setLocal] = useState<FarmerSettings>(settings);
  useEffect(() => { setLocal(settings); }, [settings]);

  const update = (patch: Partial<FarmerSettings>) => setLocal(s => ({ ...s, ...patch }));
  const updateCost = (k: keyof FarmerSettings["input_costs"], v: number) =>
    setLocal(s => ({ ...s, input_costs: { ...s.input_costs, [k]: v } }));
  const updateAvail = (k: keyof FarmerSettings["available_inputs"], v: boolean) =>
    setLocal(s => ({ ...s, available_inputs: { ...s.available_inputs, [k]: v } }));
  const updateCustom = (i: number, patch: Partial<CustomInput>) =>
    setLocal(s => {
      const next = s.custom_inputs.slice();
      next[i] = { ...next[i], ...patch };
      return { ...s, custom_inputs: next };
    });
  const addCustom = () =>
    setLocal(s => s.custom_inputs.length >= 3 ? s
      : { ...s, custom_inputs: [...s.custom_inputs, { name: "", cost: 0 }] });
  const removeCustom = (i: number) =>
    setLocal(s => ({ ...s, custom_inputs: s.custom_inputs.filter((_, idx) => idx !== i) }));

  const acresFromBoundary = fieldAreaHa ? fieldAreaHa * 2.4710538 : null;
  const dirty = JSON.stringify(local) !== JSON.stringify(settings);
  const gs = growthStage(local.crop_type, local.planting_date);

  const inputCls = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2.5 py-1.5 text-sm text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]";
  const labelCls = "text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block";

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ background: "#0f0f0f" }}>
      <div className="max-w-4xl mx-auto p-6 pb-24 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Field Settings</h1>
            <p className="text-xs text-neutral-500 mt-1">Drives cost calculations and AI recommendations for this field.</p>
          </div>
          <div className="flex items-center gap-2">
            {savedAt && !dirty && !saving && (
              <span className="text-[11px] text-[#4CAF50]">Saved {new Date(savedAt).toLocaleTimeString()}</span>
            )}
            <button
              disabled={!dirty || saving}
              onClick={() => onSave(local)}
              className="text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed text-black rounded-sm px-4 py-2 font-semibold inline-flex items-center gap-2"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>

        {/* Crop info */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-1">1. Crop Information</h2>
          <p className="text-[11px] text-neutral-500 mb-4">Used to estimate growth stage and tune AI recommendations.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Crop type</label>
              <select className={inputCls} value={local.crop_type}
                onChange={e => update({ crop_type: e.target.value })}>
                <option value="">— Select crop —</option>
                {CROP_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Field size (acres)</label>
              <input
                type="number" min={0} step="0.01"
                className={inputCls}
                placeholder={acresFromBoundary ? acresFromBoundary.toFixed(2) : "Not defined yet"}
                value={local.area_acres_override ?? ""}
                onChange={e => update({ area_acres_override: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <div className="text-[10px] text-neutral-500 mt-1">
                {acresFromBoundary
                  ? `Boundary calc: ${acresFromBoundary.toFixed(2)} ac · leave blank to use this.`
                  : "Define a boundary on the Field View to auto-fill."}
              </div>
            </div>
            <div>
              <label className={labelCls}>Planting date</label>
              <input type="date" className={inputCls} value={local.planting_date}
                onChange={e => update({ planting_date: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Expected harvest date</label>
              <input type="date" className={inputCls} value={local.harvest_date}
                onChange={e => update({ harvest_date: e.target.value })} />
            </div>
          </div>
          {gs && (
            <div className="mt-3 text-[11px] text-neutral-400">
              Growth stage estimate: <span className="text-[#4CAF50]">{gs}</span>
            </div>
          )}
        </section>

        {/* Input costs */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-1">2. Input Costs <span className="text-neutral-500 font-normal">(per acre)</span></h2>
          <p className="text-[11px] text-neutral-500 mb-4">Uncheck inputs you don't carry — the AI will avoid recommending them.</p>
          <div className="space-y-2">
            {(Object.keys(local.input_costs) as (keyof FarmerSettings["input_costs"])[]).map(k => (
              <div key={k} className="grid grid-cols-[24px_1fr_140px] gap-3 items-center">
                <input type="checkbox" checked={local.available_inputs[k]}
                  onChange={e => updateAvail(k, e.target.checked)}
                  className="h-4 w-4 accent-[#4CAF50]" />
                <div className={`text-sm ${local.available_inputs[k] ? "text-[#f0f0f0]" : "text-neutral-600 line-through"}`}>
                  {INPUT_LABELS[k]}
                </div>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
                  <input type="number" min={0} step="0.01"
                    className={`${inputCls} pl-5 text-right font-mono`}
                    value={local.input_costs[k]}
                    onChange={e => updateCost(k, Number(e.target.value) || 0)}
                    disabled={!local.available_inputs[k]}
                  />
                </div>
              </div>
            ))}

            <div className="pt-3 mt-3 border-t border-[#222]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-neutral-500">Custom inputs ({local.custom_inputs.length}/3)</div>
                <button onClick={addCustom} disabled={local.custom_inputs.length >= 3}
                  className="text-[11px] text-[#4CAF50] hover:underline disabled:text-neutral-600 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add custom
                </button>
              </div>
              {local.custom_inputs.length === 0 && (
                <div className="text-[11px] text-neutral-600">No custom inputs.</div>
              )}
              {local.custom_inputs.map((c, i) => (
                <div key={i} className="grid grid-cols-[24px_1fr_140px_28px] gap-3 items-center mb-2">
                  <span />
                  <input className={inputCls} placeholder="Custom input name"
                    value={c.name} onChange={e => updateCustom(i, { name: e.target.value })} />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
                    <input type="number" min={0} step="0.01"
                      className={`${inputCls} pl-5 text-right font-mono`}
                      value={c.cost} onChange={e => updateCustom(i, { cost: Number(e.target.value) || 0 })} />
                  </div>
                  <button onClick={() => removeCustom(i)}
                    className="h-7 w-7 grid place-items-center rounded-sm text-neutral-500 hover:text-red-400 hover:bg-[#1f1f1f]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it's used */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-3">3. How these settings are used</h2>
          <ul className="text-[12px] text-neutral-400 space-y-1.5 list-disc pl-5">
            <li>Treatment zones detected by AI Analysis are priced as <span className="font-mono text-neutral-200">acres × your per-acre cost</span>.</li>
            <li>Issues map to inputs via a fixed table (e.g. <span className="text-neutral-300">bare soil → reseeding</span>, <span className="text-neutral-300">nitrogen deficiency → nitrogen fertilizer</span>).</li>
            <li>The AI is told which inputs you carry — it won't recommend a product you don't have available.</li>
            <li>Waterlogged zones show "Drainage work required — consult agronomist" instead of a cost.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

// ============= Log Flight (Spray Log) modal ==============================
// Captures the audit-trail record after a real mission is flown. Writes a
// row to public.flight_logs and updates the drone's stored battery so the
// planner pre-fills "Pre-flight battery" with the last known landed value.
function LogFlightModal({
  open, onOpenChange, fieldId, scanId, droneId, droneName,
  batteryStart, zones, totalAcres, estLiters, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fieldId: string | null;
  scanId: string;
  droneId: string | null;
  droneName: string | null;
  batteryStart: number;
  zones: { id: string; label: string; issue: string | null; acres: number }[];
  totalAcres: number;
  estLiters: number | null;
  onSaved: () => void | Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFlown, setDateFlown] = useState(today);
  const [batteryEnd, setBatteryEnd] = useState<number>(25);
  const [refills, setRefills] = useState<number>(0);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set(zones.map(z => z.id)));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset whenever the modal is reopened so the zone list / starting battery
  // reflect the current mission.
  useEffect(() => {
    if (!open) return;
    setDateFlown(today);
    setBatteryEnd(Math.max(0, Math.min(batteryStart, 25)));
    setRefills(0);
    setCompleted(new Set(zones.map(z => z.id)));
    setNotes("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleZone = (id: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const acresDone = zones
    .filter(z => completed.has(z.id))
    .reduce((a, z) => a + z.acres, 0);
  const coverageRatio = totalAcres > 0 ? Math.min(1, acresDone / totalAcres) : 1;
  const litersDone = estLiters != null ? estLiters * (refills + 1) * coverageRatio : null;

  const save = async () => {
    if (!fieldId || saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not signed in", { description: "Please log in to save flight logs." });
        setSaving(false);
        return;
      }
      const row = {
        user_id: user.id,
        field_id: fieldId,
        scan_id: scanId,
        drone_id: droneId,
        date_flown: dateFlown,
        battery_start: batteryStart,
        battery_end: batteryEnd,
        tank_refills: refills,
        zones_completed: Array.from(completed),
        acres_treated: +acresDone.toFixed(2),
        liters_applied: litersDone != null ? +litersDone.toFixed(2) : null,
        notes: notes.trim() || null,
      };
      const { error } = await supabase.from("flight_logs").insert(row);
      if (error) throw error;

      // Update drone battery so next planner session pre-fills with landed %.
      if (droneId) {
        await supabase.from("drones").update({ battery: batteryEnd }).eq("id", droneId);
      }
      toast.success("Flight logged", { description: `${acresDone.toFixed(2)} ac recorded for ${dateFlown}.` });
      await onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Couldn't save flight log", { description: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0f0f0f] border-[#1f1f1f] text-neutral-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-[#4CAF50]" />
            Mission Complete — Log Flight
          </DialogTitle>
          <p className="text-[11px] text-neutral-500 mt-1">
            This becomes part of the spray log — a timestamped record for compliance and audit.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Date flown</div>
            <input
              type="date"
              value={dateFlown}
              max={today}
              onChange={e => setDateFlown(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200"
            />
          </div>

          {/* Battery */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Battery used</div>
              <div className="text-[11px] font-mono text-neutral-400">
                Started {batteryStart}% → Landed <span className="text-neutral-100">{batteryEnd}%</span>
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={batteryEnd}
              onChange={e => setBatteryEnd(Number(e.target.value))}
              className={`w-full ${batteryEnd < 20 ? "accent-red-500" : "accent-[#4CAF50]"}`}
            />
            {batteryEnd < 20 && (
              <div className="mt-1 text-[10px] text-red-400">Landed below 20% — pushing the battery limit.</div>
            )}
          </div>

          {/* Tank refills */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Tank refills</div>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(n => (
                <button
                  key={n}
                  onClick={() => setRefills(n)}
                  className={`flex-1 py-1.5 text-xs font-mono rounded-sm border transition-colors ${
                    refills === n
                      ? "bg-[#4CAF50] text-black border-[#4CAF50]"
                      : "bg-[#0a0a0a] border-[#222] text-neutral-400 hover:border-[#333]"
                  }`}
                >
                  {n === 3 ? "3+" : n}
                </button>
              ))}
            </div>
          </div>

          {/* Zones completed */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Zones completed</div>
            {zones.length === 0 ? (
              <div className="text-[11px] text-neutral-500 italic">No zones in this mission.</div>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {zones.map((z, i) => {
                  const done = completed.has(z.id);
                  return (
                    <label
                      key={z.id}
                      className="flex items-center gap-2 text-[12px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm px-2 py-1.5 cursor-pointer hover:border-[#2a2a2a]"
                    >
                      <input
                        type="checkbox" checked={done}
                        onChange={() => toggleZone(z.id)}
                        className="accent-[#4CAF50]"
                      />
                      <span className="flex-1 truncate">
                        Zone {i + 1} — {z.issue ?? z.label}
                      </span>
                      <span className="font-mono text-neutral-500">{z.acres.toFixed(2)} ac</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-2 text-[11px] text-neutral-500 flex justify-between">
              <span>Treated</span>
              <span className="font-mono text-neutral-300">
                {acresDone.toFixed(2)} ac
                {litersDone != null && <> · {litersDone.toFixed(1)} L (est.)</>}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Pilot notes (optional)</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Wind picked up over zone 2, skipped the back corner…"
              className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-[12px] text-neutral-200 placeholder:text-neutral-600 resize-none"
            />
          </div>

          {droneName && (
            <div className="text-[10px] text-neutral-500">
              Will update <span className="text-neutral-400">{droneName}</span>'s stored battery to {batteryEnd}%.
            </div>
          )}
          {!fieldId && (
            <div className="text-[10px] text-amber-400">
              Field reference missing — cannot save without a field.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-sm border border-[#222] text-neutral-400 hover:bg-[#1a1a1a]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !fieldId}
            className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#4CAF50] hover:bg-[#43a047] text-black disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Flight Log"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}