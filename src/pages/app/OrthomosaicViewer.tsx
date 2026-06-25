import { useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import UserPolygonTool, { type DraftPolygon } from "@/components/app/UserPolygonTool";

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
};

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
  coverage_pct: number;
  recommendation: { action: string; product?: string; dose?: string; rationale?: string } | null;
  ring: { lat: number; lng: number }[];
};

const sevColor = (s: AiZone["severity"]) =>
  s === "high" ? "#ef4444" : s === "medium" ? "#f59e0b" : "#eab308";

function AiZonesLayer({
  zones, selectedId, onSelect, onUpdate, onDelete, boundaryAreaHa,
}: {
  zones: AiZone[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, ring: { lat: number; lng: number }[]) => void;
  onDelete: (id: string) => void;
  boundaryAreaHa: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
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
      // Compute area: prefer coverage_pct × boundary area, else geodesic of ring.
      const ringAreaM2 = polygonAreaM2(z.ring.map(p => L.latLng(p.lat, p.lng)));
      const m2 = boundaryAreaHa && z.coverage_pct
        ? (boundaryAreaHa * 10000) * (z.coverage_pct / 100)
        : ringAreaM2;
      const acres = (m2 / 4046.8564224).toFixed(2);
      const ha = (m2 / 10000).toFixed(3);
      // Rough cost: $25/acre baseline, scaled by severity multiplier.
      const sevMul = z.severity === "high" ? 1.5 : z.severity === "medium" ? 1.2 : 1.0;
      const estCost = ((m2 / 4046.8564224) * 25 * sevMul).toFixed(0);
      const rec = z.recommendation;
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
            <div>Est. cost</div><div style="text-align:right;color:#f0f0f0;font-family:ui-monospace,monospace">$${estCost}</div>
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
      const popupEl = document.createElement("div");
      popupEl.innerHTML = html;
      const deleteBtn = popupEl.querySelector("button[data-aiz-delete]") as HTMLButtonElement | null;
      if (deleteBtn) {
        L.DomEvent.disableClickPropagation(deleteBtn);
        L.DomEvent.on(deleteBtn, "click", (evt: Event) => {
          L.DomEvent.stop(evt);
          poly.closePopup();
          onDelete(z.id);
        });
      }
      poly.bindPopup(popupEl, {
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
    return () => { group.remove(); };
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
      const popupEl = document.createElement("div");
      popupEl.innerHTML = html;
      const deleteBtn = popupEl.querySelector("button[data-uap-delete]") as HTMLButtonElement | null;
      if (deleteBtn) {
        L.DomEvent.disableClickPropagation(deleteBtn);
        L.DomEvent.on(deleteBtn, "click", (evt: Event) => {
          L.DomEvent.stop(evt);
          poly.closePopup();
          onDelete(p.id);
        });
      }
      poly.bindPopup(popupEl, { className: "ai-zone-popup", maxWidth: 300, autoClose: true, closeOnClick: true });
      poly.on("click", (e: any) => { L.DomEvent.stopPropagation(e); poly.openPopup(e.latlng); });
      group.addLayer(poly);
    });
    return () => { group.remove(); };
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
      const poly = L.polygon(ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: isActive ? "#fbbf24" : "#22d3ee",
        weight: isActive ? 3.5 : 2.5,
        dashArray: isActive ? undefined : "6 4",
        fillColor: isActive ? "#fbbf24" : "#22d3ee",
        fillOpacity: mode === "edit" ? (isActive ? 0.12 : 0.04) : 0.08,
      }).addTo(map);
      poly.bindTooltip(
        boundary.length > 1
          ? `Field boundary · part ${idx + 1}${isActive ? " (selected)" : " — click to select"}`
          : "Field boundary",
        { sticky: true, opacity: 1, className: "ai-zone-label" },
      );
      // Clicking a ring selects it as the active part for editing/deletion.
      poly.on("click", (ev: any) => {
        L.DomEvent.stopPropagation(ev);
        setActiveIdx(idx);
      });
      if ((mode === "edit" || mode === "draw") && isActive) {
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
  type TabKey = "field" | "weather" | "ai" | "planner" | "reports";
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
        .select("id, name, boundary, boundary_area_hectares").eq("id", t.field_id).maybeSingle();
      if (f) {
        setField(f as FieldRow);
        setBoundary(normalizeBoundary((f as any).boundary));
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
        body: JSON.stringify({ task_id: taskId, boundary: validRings }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Analysis failed");
      const payload = {
        health_score: j.health_score,
        summary: j.summary,
        issues: j.issues ?? [],
        zones: j.zones ?? [],
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
    if (!window.confirm("Delete this annotation?")) return;
    const { error } = await supabase.from("user_annotations").delete().eq("id", id);
    if (error) { console.error(error); return; }
    setUserPolys(prev => prev.filter(p => p.id !== id));
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
          <div className="hidden sm:flex items-center gap-2 px-3 h-7 rounded-sm border border-[#222] bg-[#161616] text-xs">
            <Cloud className="h-3.5 w-3.5 text-neutral-400" />
            <span className="text-neutral-300">—°C</span>
            <span className="text-neutral-500">Live weather</span>
          </div>
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
        {activeTab === "field" && (
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
          />
        )}
        {activeTab === "weather" && <WeatherTab center={center} fieldName={taskName} />}
        {activeTab === "ai" && (
          <AiTab analysis={analysis} analyzing={analyzing} analysisErr={analysisErr}
            runAnalysis={runAnalysis} exportFlightPlan={exportFlightPlan}
            clearAnalysis={clearAnalysis} deleteZone={deleteZone} />
        )}
        {activeTab === "planner" && (
          <PlannerTab
            analysis={analysis}
            boundary={boundary}
            tileUrl={tileUrl}
            bounds={bounds}
            maxNative={maxNative}
            taskId={taskId!}
            runAnalysis={runAnalysis}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === "reports" && <PlaceholderTab icon={FileBarChart} title="Reports" body="Yield, treatment, and scan history reports for this field." />}
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
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
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

// Clip a straight east-west scan line (a → b) against (boundary ∩ zone) and
// return a list of contiguous segments that lie inside BOTH.
function clipLineToBoundaryAndZone(a: LatLng2, b: LatLng2, boundaryRings: LatLng2[][], zoneRing: LatLng2[]): [LatLng2, LatLng2][] {
  // Collect intersection t-values with every ring (boundary parts + zone).
  const ts = new Set<number>();
  ts.add(0); ts.add(1);
  for (const r of boundaryRings) for (const t of segRingIntersections(a, b, r)) ts.add(t);
  for (const t of segRingIntersections(a, b, zoneRing)) ts.add(t);
  const sorted = Array.from(ts).sort((x, y) => x - y);
  const out: [LatLng2, LatLng2][] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const tm = (sorted[i] + sorted[i + 1]) / 2;
    const mid = lerp(a, b, tm);
    if (pointInAnyRing(mid, boundaryRings) && pointInRing(mid, zoneRing)) {
      out.push([lerp(a, b, sorted[i]), lerp(a, b, sorted[i + 1])]);
    }
  }
  return out;
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

// Generate the full waypoint list (lawnmower) for a list of zones, clipped to
// the boundary. Each zone contributes a contiguous sub-path; we connect
// sub-paths in input order.
function generateFlightPath(
  boundary: LatLng2[][],
  zones: { id: string; ring: LatLng2[] }[],
  spacingM: number,
): { perZone: { id: string; path: LatLng2[] }[]; total: LatLng2[]; lengthM: number } {
  const perZone: { id: string; path: LatLng2[] }[] = [];
  for (const z of zones) {
    if (z.ring.length < 3) continue;
    const bb = bboxOfRings([z.ring]);
    const midLat = (bb.minLat + bb.maxLat) / 2;
    const dLat = spacingM / M_PER_DEG_LAT;
    const leftLng = bb.minLng - 0.0002;
    const rightLng = bb.maxLng + 0.0002;
    const path: LatLng2[] = [];
    let flip = false;
    for (let lat = bb.minLat + dLat / 2; lat <= bb.maxLat; lat += dLat) {
      const a = { lat, lng: leftLng };
      const b = { lat, lng: rightLng };
      const segs = clipLineToBoundaryAndZone(a, b, boundary, z.ring);
      if (segs.length === 0) { flip = !flip; continue; }
      // Sort segments left→right (or right→left on alternate passes).
      segs.sort((s1, s2) => s1[0].lng - s2[0].lng);
      const ordered = flip ? segs.slice().reverse().map(s => [s[1], s[0]] as [LatLng2, LatLng2]) : segs;
      for (const [p1, p2] of ordered) { path.push(p1); path.push(p2); }
      flip = !flip;
      void midLat;
    }
    if (path.length >= 2) perZone.push({ id: z.id, path });
  }
  const total: LatLng2[] = [];
  for (const z of perZone) total.push(...z.path);
  // Approximate length (meters).
  let lengthM = 0;
  for (let i = 1; i < total.length; i++) {
    const dLat = (total[i].lat - total[i - 1].lat) * M_PER_DEG_LAT;
    const dLng = (total[i].lng - total[i - 1].lng) * mPerDegLng(total[i].lat);
    lengthM += Math.sqrt(dLat * dLat + dLng * dLng);
  }
  return { perZone, total, lengthM };
}

// Mission Planner / QGC ".waypoints" format. Compatible with DJI Pilot 2 via
// QGC conversion. Each row:
//   <idx>\t<current>\t<frame>\t<cmd>\t<p1>\t<p2>\t<p3>\t<p4>\t<lat>\t<lng>\t<alt>\t<autocontinue>
function exportWaypointsFile(points: LatLng2[], altitudeM: number): Blob {
  const lines: string[] = ["QGC WPL 110"];
  // Home waypoint (first point as reference)
  if (points.length === 0) return new Blob([lines.join("\n")], { type: "text/plain" });
  const home = points[0];
  lines.push(`0\t1\t0\t16\t0\t0\t0\t0\t${home.lat.toFixed(8)}\t${home.lng.toFixed(8)}\t${altitudeM.toFixed(2)}\t1`);
  points.forEach((p, i) => {
    // Cmd 16 = MAV_CMD_NAV_WAYPOINT, frame 3 = MAV_FRAME_GLOBAL_RELATIVE_ALT
    lines.push(`${i + 1}\t0\t3\t16\t0\t0\t0\t0\t${p.lat.toFixed(8)}\t${p.lng.toFixed(8)}\t${altitudeM.toFixed(2)}\t1`);
  });
  return new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
}

function PlannerTab({
  analysis, boundary, tileUrl, bounds, maxNative, taskId, runAnalysis, setActiveTab,
}: {
  analysis: any;
  boundary: BoundaryRing[] | null;
  tileUrl: string;
  bounds: L.LatLngBoundsExpression | null;
  maxNative: number;
  taskId: string;
  runAnalysis: () => void;
  setActiveTab: (k: any) => void;
}) {
  const [spacingM, setSpacingM] = useState<number>(5);
  const [altitudeM, setAltitudeM] = useState<number>(15);

  // Filter AI zones to those whose centroid lies inside the boundary.
  const validZones = (() => {
    if (!analysis?.zones || !boundary || boundary.length === 0) return [];
    return (analysis.zones as AiZone[]).filter(z => {
      if (!z.ring || z.ring.length < 3) return false;
      const cx = z.ring.reduce((a, p) => a + p.lng, 0) / z.ring.length;
      const cy = z.ring.reduce((a, p) => a + p.lat, 0) / z.ring.length;
      return pointInAnyRing({ lat: cy, lng: cx }, boundary as LatLng2[][]);
    });
  })();

  const plan = (() => {
    if (validZones.length === 0 || !boundary) return null;
    return generateFlightPath(boundary as LatLng2[][], validZones.map(z => ({ id: z.id, ring: z.ring })), spacingM);
  })();

  const downloadWaypoints = () => {
    if (!plan || plan.total.length === 0) return;
    const blob = exportWaypointsFile(plan.total, altitudeM);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `flight-${taskId}.waypoints`; a.click();
    URL.revokeObjectURL(url);
  };

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
  if (!analysis || analysis.zones.length === 0) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-8" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md">
          <Plane className="h-8 w-8 mx-auto mb-3 text-[#4CAF50]" />
          <h2 className="text-lg font-semibold mb-1">Flight Planner</h2>
          <p className="text-sm text-neutral-500 mb-4">Run AI analysis first — the planner generates lawnmower patterns over the detected treatment zones.</p>
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
          <PlannerOverlay boundary={boundary} zones={validZones} plan={plan} />
        </MapContainer>
      </div>

      {/* Right control panel */}
      <div className="w-80 shrink-0 border-l border-[#222] overflow-auto p-4" style={{ background: "#161616" }}>
        <div className="flex items-center gap-2 mb-4">
          <Plane className="h-4 w-4 text-[#4CAF50]" />
          <div className="text-sm font-semibold">Flight Planner</div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Pattern</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4" style={{ background: "#0f0f0f" }}>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">Line spacing (swath)</label>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={2} max={20} step={0.5}
              value={spacingM} onChange={(e) => setSpacingM(Number(e.target.value))}
              className="flex-1 accent-[#4CAF50]" />
            <div className="font-mono text-sm w-16 text-right">{spacingM.toFixed(1)} m</div>
          </div>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500 mt-3 block">Altitude AGL</label>
          <div className="flex items-center gap-2 mt-1">
            <input type="range" min={5} max={120} step={1}
              value={altitudeM} onChange={(e) => setAltitudeM(Number(e.target.value))}
              className="flex-1 accent-[#4CAF50]" />
            <div className="font-mono text-sm w-16 text-right">{altitudeM.toFixed(0)} m</div>
          </div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Plan summary</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          <div className="flex justify-between"><span className="text-neutral-500">Zones</span>
            <span className="font-mono">{validZones.length} of {analysis.zones.length}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Waypoints</span>
            <span className="font-mono">{plan?.total.length ?? 0}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Path length</span>
            <span className="font-mono">{plan ? (plan.lengthM / 1000).toFixed(2) : "0.00"} km</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Est. flight time</span>
            <span className="font-mono">{plan ? Math.ceil(plan.lengthM / 5 / 60) : 0} min @ 5 m/s</span></div>
        </div>

        {validZones.length < analysis.zones.length && (
          <div className="mb-4 text-[11px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1.5">
            {analysis.zones.length - validZones.length} zone(s) excluded — centroid outside boundary.
          </div>
        )}

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Export</div>
        <button
          onClick={downloadWaypoints}
          disabled={!plan || plan.total.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black rounded-sm px-3 py-2 text-xs font-semibold mb-2"
        >
          <Download className="h-3.5 w-3.5" /> Download .waypoints
        </button>
        <p className="text-[10px] text-neutral-500 leading-relaxed">
          QGC WPL 110 format — load directly in Mission Planner, QGroundControl, or convert
          for DJI Pilot 2 with the standard waypoint importer.
        </p>
      </div>
    </div>
  );
}

function PlannerOverlay({ boundary, zones, plan }: {
  boundary: BoundaryRing[];
  zones: AiZone[];
  plan: { perZone: { id: string; path: LatLng2[] }[] } | null;
}) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    boundary.forEach(ring => {
      L.polygon(ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: "#22d3ee", weight: 2, dashArray: "6 4",
        fillColor: "#22d3ee", fillOpacity: 0.04,
      }).addTo(group);
    });
    zones.forEach(z => {
      const color = sevColor(z.severity);
      L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: 1, fillColor: color, fillOpacity: 0.12,
      }).addTo(group);
    });
    plan?.perZone.forEach(({ path }) => {
      // Render the lawnmower as a single polyline; each pair-of-points draws a
      // pass, and the connector to the next pass is a thin dashed segment.
      const latlngs = path.map(p => [p.lat, p.lng] as [number, number]);
      L.polyline(latlngs, { color: "#4CAF50", weight: 2, opacity: 0.95 }).addTo(group);
      // Mark every waypoint with a small dot.
      path.forEach((p, idx) => {
        const isTurn = idx === 0 || idx === path.length - 1 || idx % 2 === 0;
        L.circleMarker([p.lat, p.lng], {
          radius: isTurn ? 3 : 1.5, color: "#4CAF50", weight: 1, fillColor: "#4CAF50", fillOpacity: 1,
        }).addTo(group);
      });
    });
    return () => { group.remove(); };
  }, [map, boundary, zones, plan]);
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