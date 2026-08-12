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
import HistoryTab from "@/components/app/HistoryTab";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  type DroneSpec, DRONE_SPECS, resolveDroneSpec,
} from "@/lib/droneSpecs";
import {
  type AiZone, type CustomInput, type FarmerSettings, type LastFlownMission,
  COST_MAP, DEFAULT_FARMER_SETTINGS, INPUT_LABELS, formatMoney,
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

// --- helpers that run inside the MapContainer ---------------------------------
export function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try { map.fitBounds(bounds as any, { padding: [40, 40] }); } catch { /* noop */ }
  }, [bounds, map]);
  return null;
}

export function MouseReadout({ coordRef, zoomRef }: { coordRef: { current: HTMLDivElement | null }; zoomRef: { current: HTMLDivElement | null } }) {
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

export function MapControls({ fitTo }: { fitTo: L.LatLngBoundsExpression | null }) {
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
export type MeasureStats = {
  active: boolean;
  finished: boolean;
  count: number;
  distM: number;
  areaM2: number;
  liveDistM: number; // includes preview segment to cursor
};

export function MeasureTool({
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

export function loadAnnotations(taskId: string): Annotation[] {
  try {
    const raw = localStorage.getItem(`annotations:${taskId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Back-compat: old strokes had no `kind` field.
    return arr.map((a: any) => (a.kind ? a : { ...a, kind: "stroke" }));
  } catch { return []; }
}
export function saveAnnotations(taskId: string, list: Annotation[]) {
  try { localStorage.setItem(`annotations:${taskId}`, JSON.stringify(list)); } catch { /* noop */ }
}

export function AnnotateTool({
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

export function MeasurePanel({ stats }: { stats: MeasureStats }) {
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
export const sevColor = (s: AiZone["severity"]) =>
  s === "high" ? "#ef4444" : s === "medium" ? "#f59e0b" : "#eab308";

export function AiZonesLayer({
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
      // Money renders in the field's own currency. Intl handles symbol
      // placement, which is not always a prefix.
      const cur = settings.currency ?? "USD";
      const estCost = formatMoney(acresNum * ratePerAc, cur);
      const ratePerAcStr = formatMoney(ratePerAc, cur);
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
                ? `<div>Est. cost</div><div style="text-align:right;color:#f0f0f0;font-family:ui-monospace,monospace">${escapeHtml(estCost)}</div>
                   <div style="grid-column:1/-1;color:#6b7280;font-family:ui-monospace,monospace;font-size:10px;text-align:right">${acresStr} ac × ${escapeHtml(ratePerAcStr)}/ac ${inputLabel ? `(${escapeHtml(inputLabel)})` : ""} = ${escapeHtml(estCost)}</div>
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

export function escapeHtml(s: string): string {
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

export const USER_POLY_COLORS: Record<string, string> = {
  orange: "#fb923c", red: "#ef4444", yellow: "#facc15",
};
export const USER_POLY_ISSUES = ["Bare soil", "Waterlogging", "Pest damage", "Weed pressure", "Other"] as const;

export function UserPolyLayer({
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
export function BoundaryTool({
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
export type LayerState = {
  annotations: boolean;
  design: boolean;
  orthomosaic: boolean;
  ndvi: boolean;
  measurements: boolean;
  boundary: boolean;
  userAnnotations: boolean;
};

export function LayerRow({
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

