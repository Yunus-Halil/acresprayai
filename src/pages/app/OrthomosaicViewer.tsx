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
  CheckCircle2, XCircle, Trash2,
} from "lucide-react";

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
type FieldRow = {
  id: string;
  name: string;
  boundary: { lat: number; lng: number }[] | null;
  boundary_area_hectares: number | null;
};

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
  zones, selectedId, onSelect, onUpdate,
}: {
  zones: AiZone[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, ring: { lat: number; lng: number }[]) => void;
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
      poly.bindTooltip(`${z.name} · ${z.issue}`, {
        permanent: false,
        sticky: true,
        opacity: 1,
        direction: "top",
        className: "ai-zone-label",
      });
      poly.on("click", (e) => { L.DomEvent.stopPropagation(e); onSelect(z.id); });
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
  }, [map, zones, selectedId, onSelect, onUpdate]);
  return null;
}

// --- Field boundary tool ----------------------------------------------------
// Lets the operator outline their actual farm field on top of the orthomosaic.
// The polygon persists on `fields.boundary` and drives the field's true area
// plus where AI analysis is allowed to run.
function BoundaryTool({
  mode, boundary, visible, onCreated, onEdited,
}: {
  mode: "off" | "draw" | "edit";
  boundary: { lat: number; lng: number }[] | null;
  visible: boolean;
  onCreated: (ring: { lat: number; lng: number }[]) => void;
  onEdited: (ring: { lat: number; lng: number }[]) => void;
}) {
  const map = useMap();

  // Draw mode: enable Geoman polygon draw. On create, capture ring + remove temp layer.
  useEffect(() => {
    if (mode !== "draw") return;
    const pmAny = (map as any).pm;
    if (!pmAny) return;
    try {
      pmAny.enableDraw("Polygon", {
        snappable: true, snapDistance: 15, allowSelfIntersection: false,
        templineStyle: { color: "#22d3ee", weight: 2, dashArray: "6 4" },
        hintlineStyle: { color: "#22d3ee", dashArray: "4 4" },
        pathOptions: { color: "#22d3ee", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.08 },
      });
    } catch { /* noop */ }
    const handle = (e: any) => {
      const layer = e.layer as L.Polygon;
      const ring = (layer.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
      try { layer.remove(); } catch { /* noop */ }
      try { pmAny.disableDraw(); } catch { /* noop */ }
      onCreated(ring);
    };
    map.on("pm:create", handle);
    return () => {
      map.off("pm:create", handle);
      try { pmAny.disableDraw(); } catch { /* noop */ }
    };
  }, [mode, map, onCreated]);

  // Render boundary polygon (with optional editing).
  useEffect(() => {
    if (!visible || !boundary || boundary.length < 3) return;
    const poly = L.polygon(boundary.map(p => [p.lat, p.lng] as [number, number]), {
      color: "#22d3ee", weight: 2.5, dashArray: "6 4",
      fillColor: "#22d3ee", fillOpacity: mode === "edit" ? 0.05 : 0.08,
    }).addTo(map);
    poly.bindTooltip("Field boundary", { sticky: true, opacity: 1, className: "ai-zone-label" });
    if (mode === "edit") {
      poly.bringToFront();
      try {
        (poly as any).pm.enable({
          allowSelfIntersection: false, snappable: true, snapDistance: 15,
          draggable: true, hideMiddleMarkers: false,
        });
      } catch { /* noop */ }
      const handle = () => {
        const ring = (poly.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
        onEdited(ring);
      };
      poly.on("pm:markerdragend pm:dragend pm:vertexadded pm:vertexremoved pm:edit", handle);
    }
    return () => { try { poly.remove(); } catch { /* noop */ } };
  }, [boundary, visible, mode, map, onEdited]);

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
    annotations: true, design: false, orthomosaic: true, ndvi: false, measurements: true, boundary: true,
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
  const [boundary, setBoundary] = useState<{ lat: number; lng: number }[] | null>(null);
  const [boundaryMode, setBoundaryMode] = useState<"off" | "draw" | "edit">("off");
  const [boundaryDirty, setBoundaryDirty] = useState(false);
  const [boundarySaving, setBoundarySaving] = useState(false);
  const cursorCoordRef = useRef<HTMLDivElement | null>(null);
  const cursorZoomRef = useRef<HTMLDivElement | null>(null);

  // Load saved annotations whenever the active scan changes.
  useEffect(() => {
    if (!taskId) return;
    setAnnotations(loadAnnotations(taskId));
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
        .select("odm_uuid, field_id, created_at").eq("id", taskId).maybeSingle();
      console.log("[OrthoViewer] task row:", t);
      if (!t?.odm_uuid) { setErr("Scan not found"); return; }
      setTask(t as TaskRow);

      const { data: f } = await supabase.from("fields")
        .select("id, name, boundary, boundary_area_hectares").eq("id", t.field_id).maybeSingle();
      if (f) {
        setField(f as FieldRow);
        const b = (f as any).boundary;
        if (Array.isArray(b) && b.length >= 3 && typeof b[0]?.lat === "number") {
          setBoundary(b as { lat: number; lng: number }[]);
        } else {
          setBoundary(null);
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
    setAnalyzing(true); setAnalysisErr(null);
    try {
      const r = await fetch(`${FN_BASE}/analyze-ortho`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Analysis failed");
      setAnalysis({
        health_score: j.health_score,
        summary: j.summary,
        issues: j.issues ?? [],
        zones: j.zones ?? [],
      });
      setSelectedZone(j.zones?.[0]?.id ?? null);
    } catch (e: any) {
      setAnalysisErr(e?.message ?? String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const updateZoneRing = useCallback((id: string, ring: { lat: number; lng: number }[]) => {
    setAnalysis(a => a ? { ...a, zones: a.zones.map(z => z.id === id ? { ...z, ring } : z) } : a);
  }, []);

  const deleteZone = (id: string) => {
    setAnalysis(a => a ? { ...a, zones: a.zones.filter(z => z.id !== id) } : a);
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
          />
        )}
        {activeTab === "weather" && <WeatherTab center={center} fieldName={taskName} />}
        {activeTab === "ai" && (
          <AiTab analysis={analysis} analyzing={analyzing} analysisErr={analysisErr} runAnalysis={runAnalysis} exportFlightPlan={exportFlightPlan} />
        )}
        {activeTab === "planner" && <PlaceholderTab icon={Plane} title="Flight Planner" body="Generate autonomous flight paths over your treatment zones." />}
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
}) {
  const {
    bounds, tileUrl, ndviUrl, maxNative, layers, setLayers, ndviInfo,
    cursorCoordRef, cursorZoomRef, layersOpen, setLayersOpen,
    drawerOpen, setDrawerOpen,
    analysis, analyzing, analysisErr, runAnalysis,
    showAiZones, setShowAiZones, selectedZone, setSelectedZone,
    updateZoneRing, deleteZone, exportFlightPlan,
    taskId, annotations, setAnnotations,
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
          <LayerRow label="AI treatment zones" icon={Sparkles}
            checked={showAiZones}
            onToggle={() => setShowAiZones(!showAiZones)} />
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
            />}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisGrid({
  analysis, runAnalysis, showAiZones, setShowAiZones,
  selectedZone, setSelectedZone, deleteZone, exportFlightPlan,
}: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
      <div className="rounded-sm p-3 border border-[#222]" style={{ background: "#1a1a1a" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Overall health</div>
          <button onClick={runAnalysis} className="text-[10px] text-[#4CAF50] hover:underline">Re-run</button>
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

function AiTab({ analysis, analyzing, analysisErr, runAnalysis, exportFlightPlan }: any) {
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
            deleteZone={() => {}} exportFlightPlan={exportFlightPlan}
          />
        )}
      </div>
    </div>
  );
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
const WMO_LABEL: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Showers", 81: "Showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ hail",
};
function WeatherGlyph({ code, className }: { code: number; className?: string }) {
  if (code === 0 || code === 1) return <Sun className={className} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={className} />;
  if (code === 45 || code === 48) return <CloudFog className={className} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return <CloudRain className={className} />;
  return <Cloud className={className} />;
}

type Hour = {
  time: string; temp: number; wind: number; gust: number; humidity: number;
  precip: number; precipProb: number; code: number;
};

// Spray suitability rules — informed by FAA/AAAA pesticide-application guidance.
function sprayCheck(h: { wind: number; gust: number; humidity: number; precip: number; precipProb: number; temp: number }) {
  const reasons: string[] = [];
  if (h.wind > 15) reasons.push(`Wind ${h.wind.toFixed(0)} km/h above 15 limit`);
  else if (h.wind < 3) reasons.push(`Wind ${h.wind.toFixed(0)} km/h too calm — inversion risk`);
  if (h.gust > 20) reasons.push(`Gusts ${h.gust.toFixed(0)} km/h`);
  if (h.humidity < 40) reasons.push(`Humidity ${h.humidity.toFixed(0)}% — high evaporation`);
  if (h.precip > 0.2 || h.precipProb > 40) reasons.push(`Rain risk ${h.precipProb}%`);
  if (h.temp > 30) reasons.push(`Temp ${h.temp.toFixed(0)}°C — drift risk`);
  if (h.temp < 5) reasons.push(`Temp ${h.temp.toFixed(0)}°C too cold`);
  return { good: reasons.length === 0, reasons };
}

function WeatherTab({ center, fieldName }: { center: [number, number]; fieldName: string }) {
  const [lat, lng] = center;
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,precipitation` +
          `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability,weather_code` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
          `&forecast_days=5&timezone=auto&wind_speed_unit=kmh`;
        const r = await fetch(url);
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Weather unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  if (err) return (
    <div className="absolute inset-0 grid place-items-center text-sm text-red-400" style={{ background: "#0f0f0f" }}>{err}</div>
  );
  if (!data) return (
    <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400 gap-2" style={{ background: "#0f0f0f" }}>
      <Loader2 className="h-4 w-4 animate-spin" /> Loading weather…
    </div>
  );

  const cur = data.current;
  const now = sprayCheck({
    wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m,
    humidity: cur.relative_humidity_2m, precip: cur.precipitation,
    precipProb: 0, temp: cur.temperature_2m,
  });

  // Build next-24h hourly slice
  const hourly: Hour[] = [];
  const nowIdx = data.hourly.time.findIndex((t: string) => new Date(t).getTime() >= Date.now() - 3600_000);
  for (let i = Math.max(0, nowIdx); i < Math.min(data.hourly.time.length, nowIdx + 24); i++) {
    hourly.push({
      time: data.hourly.time[i],
      temp: data.hourly.temperature_2m[i],
      wind: data.hourly.wind_speed_10m[i],
      gust: data.hourly.wind_gusts_10m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      precip: data.hourly.precipitation[i],
      precipProb: data.hourly.precipitation_probability?.[i] ?? 0,
      code: data.hourly.weather_code[i],
    });
  }

  // Find the next good spray window (>= 2 consecutive hours)
  let nextWindow: { start: Hour; end: Hour } | null = null;
  {
    let runStart = -1;
    for (let i = 0; i < hourly.length; i++) {
      const ok = sprayCheck(hourly[i]).good;
      if (ok && runStart < 0) runStart = i;
      if ((!ok || i === hourly.length - 1) && runStart >= 0) {
        const end = ok ? i : i - 1;
        if (end - runStart + 1 >= 2) { nextWindow = { start: hourly[runStart], end: hourly[end] }; break; }
        runStart = -1;
      }
    }
  }

  const days = data.daily.time.map((t: string, i: number) => ({
    date: t,
    code: data.daily.weather_code[i],
    tmax: data.daily.temperature_2m_max[i],
    tmin: data.daily.temperature_2m_min[i],
    precip: data.daily.precipitation_sum[i],
    wind: data.daily.wind_speed_10m_max[i],
  }));

  const fmtHour = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric" });
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="absolute inset-0 overflow-auto p-8" style={{ background: "#0f0f0f" }}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <CloudSun className="h-5 w-5 text-[#4CAF50]" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Weather · {fieldName}</h1>
            <div className="text-xs text-neutral-500 font-mono">{lat.toFixed(4)}, {lng.toFixed(4)}</div>
          </div>
        </div>

        {/* Current conditions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-sm border border-[#222] p-5 md:col-span-1" style={{ background: "#1a1a1a" }}>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Current</div>
            <div className="flex items-center gap-4">
              <WeatherGlyph code={cur.weather_code} className="h-12 w-12 text-[#4CAF50]" />
              <div>
                <div className="text-5xl font-semibold tabular-nums">{Math.round(cur.temperature_2m)}°C</div>
                <div className="text-xs text-neutral-400">{WMO_LABEL[cur.weather_code] ?? "—"}</div>
                <div className="text-[11px] text-neutral-500">Feels {Math.round(cur.apparent_temperature)}°</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Wind className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Wind</div>
                <div className="font-mono">{Math.round(cur.wind_speed_10m)} km/h</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <Droplets className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Humidity</div>
                <div className="font-mono">{Math.round(cur.relative_humidity_2m)}%</div>
              </div>
              <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
                <ThermometerSun className="h-3 w-3 text-neutral-500 mb-1" />
                <div className="text-neutral-500 text-[10px]">Gust</div>
                <div className="font-mono">{Math.round(cur.wind_gusts_10m)} km/h</div>
              </div>
            </div>
          </div>

          {/* Spray window verdict */}
          <div className={`rounded-sm border p-5 md:col-span-2 ${now.good ? "border-[#4CAF50]/40" : "border-red-500/40"}`}
               style={{ background: "#1a1a1a" }}>
            <div className="flex items-center gap-2 mb-3">
              {now.good
                ? <CheckCircle2 className="h-5 w-5 text-[#4CAF50]" />
                : <XCircle className="h-5 w-5 text-red-400" />}
              <div className="text-base font-semibold">
                {now.good ? "Good to spray right now" : "Not safe to spray right now"}
              </div>
            </div>
            {now.reasons.length > 0 && (
              <ul className="space-y-1 text-xs text-neutral-400 mb-3">
                {now.reasons.map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
            )}
            <div className="text-[11px] text-neutral-500 leading-relaxed mb-3">
              Targets: wind 3–15 km/h, gusts &lt; 20 km/h, humidity ≥ 40%, no rain within the hour, temperature 5–30°C.
            </div>
            {nextWindow ? (
              <div className="rounded-sm border border-[#4CAF50]/30 p-3" style={{ background: "#0f0f0f" }}>
                <div className="text-[10px] uppercase tracking-wider text-[#4CAF50]">Next spray window</div>
                <div className="text-sm font-mono mt-1">
                  {fmtHour(nextWindow.start.time)} – {fmtHour(nextWindow.end.time)}
                  <span className="text-neutral-500"> · {new Date(nextWindow.start.time).toLocaleDateString([], { weekday: "short" })}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-neutral-500">No suitable 2-hour window in the next 24 hours.</div>
            )}
          </div>
        </div>

        {/* Hourly strip */}
        <div className="rounded-sm border border-[#222] p-4" style={{ background: "#1a1a1a" }}>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Next 24 hours</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {hourly.map((h, i) => {
              const ok = sprayCheck(h).good;
              return (
                <div key={i} className={`min-w-[88px] rounded-sm border p-2 text-center ${ok ? "border-[#4CAF50]/30" : "border-[#222]"}`}
                     style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] text-neutral-500">{fmtHour(h.time)}</div>
                  <WeatherGlyph code={h.code} className="h-5 w-5 mx-auto my-1 text-neutral-300" />
                  <div className="text-sm font-mono tabular-nums">{Math.round(h.temp)}°</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">{Math.round(h.wind)} km/h</div>
                  <div className="text-[10px] text-neutral-500 font-mono">{h.precipProb}%</div>
                  <div className={`mt-1 h-1 rounded-full ${ok ? "bg-[#4CAF50]" : "bg-red-500/60"}`} />
                </div>
              );
            })}
          </div>
        </div>

        {/* 5-day */}
        <div className="rounded-sm border border-[#222] p-4" style={{ background: "#1a1a1a" }}>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">5-day forecast</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {days.map((d: any, i: number) => (
              <div key={i} className="rounded-sm border border-[#222] p-3" style={{ background: "#0f0f0f" }}>
                <div className="text-[11px] text-neutral-400">{fmtDay(d.date)}</div>
                <div className="flex items-center gap-2 mt-1">
                  <WeatherGlyph code={d.code} className="h-5 w-5 text-neutral-300" />
                  <div className="text-sm font-mono">
                    <span className="text-[#f0f0f0]">{Math.round(d.tmax)}°</span>
                    <span className="text-neutral-500"> / {Math.round(d.tmin)}°</span>
                  </div>
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mt-1">{d.precip.toFixed(1)} mm · {Math.round(d.wind)} km/h</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[10px] text-neutral-600">Data: Open-Meteo · Updated {new Date().toLocaleTimeString()}</div>
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