// The model's plants on the map: every weed (and, when asked, every crop
// plant) an algorithm found in the scan's photographs, carried to the ground
// through the camera pose and drawn where the map says that ground is.
//
// A scan can hold ten thousand plants. Drawing each as its own map object is
// what made the map lag, so the layer works at two scales: zoomed out, every
// plant is a dot on one canvas (a click on a dot zooms the map in on it);
// from POLYGON_ZOOM in, only the plants inside the view are drawn as their
// outlines, with a card each. Yellow is a weed, cyan a crop plant, white the
// selected one. A card shows what the model said, how sure it was, how big it
// is, and a button that marks it on the field as an ordinary annotation. It
// changes no verdict and no treatment by itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { CircleMarker, Polygon, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtAreaCm2, fmtLengthCm } from "@/lib/units";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { patchFrameRun, useFrameRun, visiblePlants } from "@/lib/weedVision/frameRunStore";
import { isOnRow } from "@/lib/weedVision/rowFilter";
import { isMapFrame } from "@/lib/weedVision/mapRun";
import type { Snap } from "@/lib/weedVision/snap";
import { requestSnaps, snapKey, snapOf, snapped, useSnapVersion } from "@/lib/weedVision/snapStore";

export const PLANT_COLOUR = { weed: "#ffe600", crop: "#40e0ff" } as const;
export const SELECTED_PLANT_COLOUR = "#ffffff";
/** From this zoom in, plants in view are drawn as outlines; below it, as dots on one canvas. */
export const POLYGON_ZOOM = 18;
/** At most this many outlines at once, the surest first, so a dense view stays usable. */
export const MAX_POLYGONS = 1500;

/** Every plant as a dot on one canvas in the overlay pane; a click within DOT_HIT px of a dot zooms in on it. */
function PlantDots({ plants, onPick }: { plants: GroundPlant[]; onPick: (p: GroundPlant) => void }) {
  const map = useMap();
  useEffect(() => {
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("data-testid", "plant-dots");
    map.getPanes().overlayPane.appendChild(canvas);
    const draw = () => {
      const size = map.getSize();
      canvas.width = size.x; canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);
      const r = map.getZoom() >= 16 ? 3 : 2;
      for (const p of plants) {
        if (!p.centre) continue;
        const q = map.latLngToContainerPoint([p.centre.lat, p.centre.lng]);
        if (q.x < -r || q.y < -r || q.x > size.x + r || q.y > size.y + r) continue;
        ctx.fillStyle = PLANT_COLOUR[p.klass];
        ctx.globalAlpha = p.klass === "weed" ? 0.9 : 0.6;
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const DOT_HIT = 10;
    const click = (e: L.LeafletMouseEvent) => {
      let best: GroundPlant | null = null, d2 = DOT_HIT * DOT_HIT;
      for (const p of plants) {
        if (!p.centre) continue;
        const q = map.latLngToContainerPoint([p.centre.lat, p.centre.lng]);
        const dd = (q.x - e.containerPoint.x) ** 2 + (q.y - e.containerPoint.y) ** 2;
        if (dd < d2) { d2 = dd; best = p; }
      }
      if (best) onPick(best);
    };
    draw();
    map.on("moveend zoomend viewreset resize", draw);
    map.on("click", click);
    return () => {
      map.off("moveend zoomend viewreset resize", draw);
      map.off("click", click);
      canvas.remove();
    };
  }, [map, plants, onPick]);
  return null;
}

export function ModelDetectionLayer({ taskId, onMark, showLabels = false }: { taskId: string; /** Mark a weed on the field; resolves to the annotation id, or null. */ onMark?: (plant: GroundPlant) => Promise<string | null>; showLabels?: boolean }) {
  const units = useUnitSystem();
  const run = useFrameRun(taskId);
  const [view, setView] = useState<{ zoom: number; bounds: L.LatLngBounds } | null>(null);
  const map = useMapEvents({
    zoomend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
    moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
  });
  const zoom = view?.zoom ?? map.getZoom();
  const bounds = view?.bounds ?? map.getBounds();
  // Every outline is snapped onto its weed on the map in the background (snapStore.ts); a plant keeps its
  // object until its snap changes, so the outlines that did not move are not redrawn.
  const snapVersion = useSnapVersion(taskId);
  const placedCache = useRef(new Map<string, { src: GroundPlant; snap: Snap | null | undefined; out: GroundPlant }>());
  const snapOfPlaced = useRef(new WeakMap<GroundPlant, Snap>());
  const place = useCallback((p: GroundPlant): GroundPlant => {
    const k = snapKey(p), sn = snapOf(taskId, p), c = placedCache.current.get(k);
    if (c && c.src === p && c.snap === sn) return c.out;
    const out = sn ? snapped(taskId, p) : p;
    if (sn) snapOfPlaced.current.set(out, sn);
    placedCache.current.set(k, { src: p, snap: sn, out });
    return out;
  }, [taskId]);
  const positionsOf = useRef(new WeakMap<GroundPlant, [number, number][]>());
  const positions = (p: GroundPlant): [number, number][] => {
    let v = positionsOf.current.get(p);
    if (!v) { v = (p.ring ?? []).map(q => [q.lat, q.lng] as [number, number]); positionsOf.current.set(p, v); }
    return v;
  };
  // Detections mode: every plant. Priority mode: only the selected area's plants, close in (level 3 behind level 2). Heatmap: none.
  // Keyed on the fields it reads, not the whole session: a run's progress ticks change the session several times a
  // second, and re-filtering every plant (and redrawing every dot) on each of them is what made the map lag.
  const { viewMode, plants, showCrops, showWeeds, showOnRow, selectedHotspotId, hotspots } = run;
  const shownRaw = useMemo(() => {
    if (viewMode === "detections") return visiblePlants({ plants, showCrops, showWeeds, showOnRow });
    if (viewMode === "priority" && selectedHotspotId && hotspots) {
      const h = hotspots.hotspots.find(x => x.id === selectedHotspotId);
      if (!h) return [];
      const ids = new Set(h.plantIds);
      return plants.filter(p => ids.has(p.id) && (p.klass === "weed" || showCrops));
    }
    return [];
  }, [viewMode, plants, showCrops, showWeeds, showOnRow, selectedHotspotId, hotspots]);
  const pickDot = useCallback((p: GroundPlant) => {
    if (p.centre) { patchFrameRun(taskId, { selectedId: p.id }); map.setView([p.centre.lat, p.centre.lng], POLYGON_ZOOM + 1); }
  }, [taskId, map]);
  // Snap the outlines in view first, then every other one shown.
  useEffect(() => { if (shownRaw.length) requestSnaps(taskId, shownRaw); }, [taskId, shownRaw]);
  useEffect(() => {
    if (zoom < POLYGON_ZOOM || !shownRaw.length) return;
    const padded = bounds.pad(0.15);
    requestSnaps(taskId, shownRaw.filter(p => p.centre && padded.contains([p.centre.lat, p.centre.lng])), true);
  }, [taskId, shownRaw, zoom, bounds]);
  const shown = useMemo(() => shownRaw.map(place), [shownRaw, place, snapVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const inView = useMemo(() => {
    if (zoom < POLYGON_ZOOM) return [];
    const padded = bounds.pad(0.15);
    const list = shown.filter(p => p.centre && padded.contains([p.centre.lat, p.centre.lng]));
    if (list.length <= MAX_POLYGONS) return list;
    return [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, MAX_POLYGONS);
  }, [shown, zoom, bounds]);
  if (!shown.length) return null;
  if (zoom < POLYGON_ZOOM) {
    if (run.viewMode !== "detections") return null; // an area's plants are for close zoom only; the area outline says where
    return <PlantDots plants={shown} onPick={pickDot} />;
  }
  return (
    <>
      {inView.map(p => {
        const active = p.id === run.selectedId;
        const colour = PLANT_COLOUR[p.klass];
        const markedId = run.marked[p.id];
        const label = `${p.klass}${p.score != null ? ` ${p.score.toFixed(2)}` : ""}`;
        const popup = (
          <Popup closeOnClick={false} maxWidth={320} minWidth={240} eventHandlers={{ remove: () => patchFrameRun(taskId, s => (s.selectedId === p.id ? { selectedId: null } : {})) }}>
            <div className="text-[11px] text-[#f0f0f0] space-y-1" data-testid="plant-popup">
              <div className="font-semibold">
                <span style={{ color: colour }}>{p.klass === "weed" ? "Weed" : "Crop plant"}</span>
                {p.score != null && <span className="text-neutral-400 font-normal"> · confidence {p.score.toFixed(2)}</span>}
                <span className="text-neutral-500 font-normal"> · {run.algorithmLabel ?? "model"}</span>
              </div>
              <div className="text-neutral-400">
                {p.diameterM != null ? <>About {fmtLengthCm(p.diameterM * 100, units).text} across{p.areaM2 != null ? `, ${fmtAreaCm2(p.areaM2 * 1e4, units).text} of canopy` : ""}</> : <>Size unknown: the plant could not be placed on the ground plane</>}
              </div>
              {isMapFrame(p.frame) ? (
                <div className="text-neutral-400">Found on the field map itself{p.fusedFromTiles > 1 ? ` · stitched from ${p.fusedFromTiles} tiles` : ""}</div>
              ) : <div className="text-neutral-400">
                Seen in <span className="font-mono text-neutral-200">{p.frame}</span>{p.seenIn.length > 1 ? ` and ${p.seenIn.length - 1} other photo${p.seenIn.length > 2 ? "s" : ""}` : ""}
                {p.viewAngleDeg != null ? ` · ${p.viewAngleDeg.toFixed(0)}° off nadir` : ""}{p.fusedFromTiles > 1 ? ` · stitched from ${p.fusedFromTiles} tiles` : ""}
              </div>}
              {p.klass === "weed" && p.rowStatus && (
                <div className={isOnRow(p.rowStatus) ? "text-amber-400" : "text-neutral-400"}>
                  {p.rowStatus === "on-crop" ? "On a plant the pattern placed on a row: most likely the crop." : p.rowStatus === "on-row" ? "On a row line: most likely the crop." : p.rowStatus === "off-row" ? "Off the rows." : "This photo has no row read."}
                </div>
              )}
              {p.flags.length > 0 && <div className="text-amber-400">{p.flags.join("; ")}</div>}
              {snapOfPlaced.current.get(p) && <div className="text-neutral-500">Snapped {fmtLengthCm(snapOfPlaced.current.get(p)!.shiftM * 100, units).text} onto its weed on the map</div>}
              {p.centre && <div className="text-neutral-600">Ground {p.centre.lat.toFixed(6)}, {p.centre.lng.toFixed(6)} · {isMapFrame(p.frame) ? "placed by the map's own pixels" : "flat ground assumed"}</div>}
              {p.klass === "weed" && onMark && (
                markedId
                  ? <div className="text-[#4CAF50]">Marked on the field.</div>
                  : <button type="button" data-testid="mark-plant" className="rounded-sm border border-[#4CAF50] text-[#4CAF50] px-2 py-0.5 hover:bg-[#4CAF50]/10"
                      onClick={async () => { const id = await onMark(p); if (id) patchFrameRun(taskId, s => ({ marked: { ...s.marked, [p.id]: id } })); }}>
                      Mark on the field
                    </button>
              )}
            </div>
          </Popup>
        );
        const tooltip = showLabels ? <Tooltip direction="top" opacity={0.95} className="scout-label">{label}</Tooltip> : null;
        const select = () => patchFrameRun(taskId, { selectedId: p.id });
        if (p.ring) {
          return (
            <Polygon key={p.id} positions={positions(p)} eventHandlers={{ click: select }}
              pathOptions={{ color: active ? SELECTED_PLANT_COLOUR : colour, weight: active ? 3 : markedId ? 2.5 : 1.5, fillColor: colour, fillOpacity: markedId ? 0.45 : isOnRow(p.rowStatus) ? 0.08 : p.klass === "weed" ? 0.3 : 0.15, dashArray: p.klass === "crop" || isOnRow(p.rowStatus) ? "3 3" : undefined }}>
              {tooltip}{popup}
            </Polygon>
          );
        }
        if (p.centre) {
          return (
            <CircleMarker key={p.id} center={[p.centre.lat, p.centre.lng]} radius={active ? 8 : 5} eventHandlers={{ click: select }}
              pathOptions={{ color: active ? SELECTED_PLANT_COLOUR : colour, weight: 2, fillColor: colour, fillOpacity: 0.5 }}>
              {tooltip}{popup}
            </CircleMarker>
          );
        }
        return null;
      })}
    </>
  );
}
