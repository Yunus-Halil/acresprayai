// The Field Twin map: a Leaflet map with one canvas layer for the whole scene (TwinCanvasLayer), the field's
// surroundings from OpenStreetMap data underneath while the field is seen whole, a locate-field control, a
// mini-map, a scale bar in the account's units and a north mark. Optionally, a developer-only reference
// orthomosaic in a pane BELOW the canvas, with its own opacity and a swipe divider. Neither underlay is ever read:
// the scene's coordinates come from the photographs alone.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CachedTileLayer } from "@/components/app/workspace/OrthoTileLayer";
import type { FindingsResult } from "@/lib/fieldTwin/findings";
import { type Detail, type Scene, zoomForSize } from "@/lib/fieldTwin/scene";
import { TWIN_COLOURS, type TwinLayers } from "@/lib/fieldTwin/style";
import type { LatLngPair } from "@/lib/fieldTwin/types";
import type { UnitSystem } from "@/lib/units";
import { type DrawStats, TwinCanvasLayer, type TwinPick } from "./TwinCanvasLayer";

export type ReferenceImagery = {
  /** XYZ tile URL template, from the account's own scan tiles. */
  url: string;
  maxNativeZoom: number;
  /** 0 to 1. */
  opacity: number;
  /** Swipe divider position, 0 to 1 of the map width, or null for a plain overlay. */
  swipe: number | null;
};

export type TwinMapHandle = { map: L.Map; layer: TwinCanvasLayer; locate: () => void };

/**
 * The surroundings: OpenStreetMap's own tiles (roads, water, buildings, names; no photography), shown dim over the
 * charcoal ground. Dimmed by opacity alone: a CSS filter on the tile pane re-rasterised during every zoom and drag.
 */
export const SURROUNDINGS_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const SURROUNDINGS_ATTRIBUTION = 'Surroundings: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const SURROUNDINGS_OPACITY = 0.22;
const SURROUNDINGS_MAX_NATIVE = 19;

type Props = {
  scene: Scene;
  layers: TwinLayers;
  selection: TwinPick;
  units: UnitSystem;
  onPick: (p: TwinPick) => void;
  onDetail?: (d: Detail) => void;
  onStats?: (s: DrawStats) => void;
  onMove?: (centre: { lat: number; lng: number }, zoom: number) => void;
  onReady?: (h: TwinMapHandle) => void;
  reference?: ReferenceImagery | null;
  onSwipe?: (pct: number) => void;
  /** The active findings (markers, boundaries, labels); null draws none. */
  findings?: FindingsResult | null;
  /** The operator's accepted or corrected boundary, drawn apart from the inferred one. */
  operational?: LatLngPair[] | null;
  /** The ring being corrected (handles on the map), or null. */
  editing?: LatLngPair[] | null;
  /** The ring after each handle move, add or removal. */
  onBoundaryEdit?: (ring: LatLngPair[]) => void;
};

const bar = "background:rgba(20,22,20,.86);border:1px solid #333;color:#d9ddd6;";

const NorthControl = L.Control.extend({
  onAdd() {
    const div = L.DomUtil.create("div", "leaflet-bar");
    div.style.cssText = `${bar}width:30px;height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 10px system-ui,sans-serif;`;
    div.title = "North is up";
    div.innerHTML = '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><path d="M7 1 L12 15 L7 11 L2 15 Z" fill="#d9ddd6"/></svg><span>N</span>';
    return div;
  },
});

const LocateControl = L.Control.extend({
  onAdd(this: L.Control & { options: { locate: () => void } }) {
    const div = L.DomUtil.create("div", "leaflet-bar");
    const a = L.DomUtil.create("a", "", div) as HTMLAnchorElement;
    a.href = "#"; a.role = "button"; a.title = "Locate the field"; a.setAttribute("aria-label", "Locate the field");
    a.style.cssText = `${bar}font:600 11px system-ui,sans-serif;width:auto;padding:0 8px;line-height:30px;`;
    a.textContent = "⌖ Field";
    L.DomEvent.on(a, "click", e => { L.DomEvent.stop(e); this.options.locate(); });
    return div;
  },
});

export default function TwinMap({ scene, layers, selection, units, onPick, onDetail, onStats, onMove, onReady, reference, onSwipe, findings = null, operational = null, editing = null, onBoundaryEdit }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const miniEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<TwinCanvasLayer | null>(null);
  const scaleRef = useRef<L.Control.Scale | null>(null);
  const refLayerRef = useRef<L.TileLayer | null>(null);
  const contextRef = useRef<L.TileLayer | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const onDetailRef = useRef(onDetail); onDetailRef.current = onDetail;
  const onStatsRef = useRef(onStats); onStatsRef.current = onStats;
  const onMoveRef = useRef(onMove); onMoveRef.current = onMove;
  const onSwipeRef = useRef(onSwipe); onSwipeRef.current = onSwipe;
  const onBoundaryEditRef = useRef(onBoundaryEdit); onBoundaryEditRef.current = onBoundaryEdit;
  const layersRef = useRef(layers); layersRef.current = layers;
  const detailRef = useRef<Detail | null>(null);

  /** The surroundings tiles fade with the detail and are removed outright when invisible (no tile requests then). */
  const updateContext = () => {
    const map = mapRef.current;
    if (!map) return;
    const want = layersRef.current.surroundings && layersRef.current.ground ? (detailRef.current?.surroundings ?? 1) * SURROUNDINGS_OPACITY : 0;
    let tl = contextRef.current;
    if (want <= 0.02) { if (tl && map.hasLayer(tl)) map.removeLayer(tl); return; }
    if (!tl) { tl = L.tileLayer(SURROUNDINGS_URL, { pane: "twinContext", maxNativeZoom: SURROUNDINGS_MAX_NATIVE, maxZoom: 26, minZoom: 10, attribution: SURROUNDINGS_ATTRIBUTION, opacity: want }); contextRef.current = tl; }
    if (!map.hasLayer(tl)) tl.addTo(map);
    tl.setOpacity(want);
  };

  // The map and the canvas layer, once per scene.
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { attributionControl: false, zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 80, minZoom: 12, maxZoom: 26, zoomAnimation: true });
    mapRef.current = map;
    map.createPane("twinContext").style.zIndex = "200";
    map.createPane("twinReference").style.zIndex = "250";
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    const layer = new TwinCanvasLayer(layersRef.current);
    layerRef.current = layer;
    layer.setScene(scene);
    layer.addTo(map);
    const [x0, y0, x1, y1] = scene.bbox;
    const fieldBounds = L.latLngBounds(map.unproject(L.point(x0, y1), 0), map.unproject(L.point(x1, y0), 0));
    const locate = () => map.fitBounds(fieldBounds, { padding: [24, 24] });
    layer.on("twinclick", (e: L.LeafletEvent & { pick?: TwinPick }) => {
      const p = e.pick ?? null;
      if (p && p.kind === "cluster") {
        // A cluster is a stand-in: open it up to the measured outlines it stands for.
        map.flyTo([p.lat, p.lng], Math.min(26, zoomForSize(scene.intel.summary.medianWeedDiameterM, 9, scene.twin.origin.lat)), { duration: 0.6 });
        return;
      }
      if (p && p.kind === "group") {
        // Several findings in one marker: two zoom levels closer, where they come apart.
        map.flyTo([p.lat, p.lng], Math.min(26, map.getZoom() + 2), { duration: 0.5 });
        return;
      }
      onPickRef.current(p);
    });
    layer.watchDetail(d => { detailRef.current = d; updateContext(); onDetailRef.current?.(d); });
    map.on("moveend zoomend", () => { const c = map.getCenter(); onMoveRef.current?.({ lat: c.lat, lng: c.lng }, map.getZoom()); });
    // Draws happen on move end, zoom end and state changes, not per dragged frame, so one state update each is cheap.
    layer.on("twindraw", () => onStatsRef.current?.(layer.stats));
    layer.on("boundaryedit", (e: L.LeafletEvent & { ring?: LatLngPair[] | null }) => { if (e.ring) onBoundaryEditRef.current?.(e.ring); });
    new LocateControl({ position: "topright", locate } as L.ControlOptions).addTo(map);
    new NorthControl({ position: "bottomright" }).addTo(map);
    locate();

    // The mini-map: the field in its surroundings at a fixed scale, with the main view drawn as a rectangle.
    let mini: L.Map | null = null;
    if (miniEl.current) {
      mini = L.map(miniEl.current, { preferCanvas: true, attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomAnimation: false });
      L.tileLayer(SURROUNDINGS_URL, { maxNativeZoom: SURROUNDINGS_MAX_NATIVE, maxZoom: 20, opacity: 0.3 }).addTo(mini);
      const hull: [number, number][] = [];
      for (let i = 0; i < scene.imagery.length; i += 2) { const ll = map.unproject(L.point(scene.imagery[i], scene.imagery[i + 1]), 0); hull.push([ll.lat, ll.lng]); }
      L.polygon(hull, { color: TWIN_COLOURS.blockEdge, weight: 1, fillColor: TWIN_COLOURS.soil, fillOpacity: 0.7, interactive: false }).addTo(mini);
      const view = L.rectangle(map.getBounds(), { color: "#ffffff", weight: 1, fill: false, interactive: false }).addTo(mini);
      mini.fitBounds(fieldBounds.pad(1.2));
      const miniZoom = mini.getZoom();
      // The rectangle follows every move (cheap); the mini-map itself re-centres only when a move ends.
      const rect = () => view.setBounds(map.getBounds());
      const sync = () => { rect(); mini!.setView(map.getCenter(), Math.min(miniZoom, Math.max(11, map.getZoom() - 5)), { animate: false }); };
      map.on("move", rect);
      map.on("moveend zoomend", sync);
      mini.on("click", (e: L.LeafletMouseEvent) => map.panTo(e.latlng));
      sync();
    }
    layer.setFindings(findings);
    onReady?.({ map, layer, locate });
    return () => { mini?.remove(); map.remove(); mapRef.current = null; layerRef.current = null; refLayerRef.current = null; scaleRef.current = null; contextRef.current = null; };
    // The scene is the identity of the map; everything else is pushed through the refs and effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => { layerRef.current?.setLayers(layers); updateContext(); }, [layers]);
  useEffect(() => { layerRef.current?.setSelection(selection); }, [selection]);
  useEffect(() => { layerRef.current?.setFindings(findings); }, [findings, scene]);
  useEffect(() => { layerRef.current?.setOperational(operational); }, [operational, scene]);
  useEffect(() => { layerRef.current?.setEditing(editing); }, [editing, scene]);

  // The scale bar follows the account's units.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    scaleRef.current?.remove();
    scaleRef.current = L.control.scale({ position: "bottomright", metric: units === "metric", imperial: units === "imperial", maxWidth: 140 }).addTo(map);
  }, [units, scene]);

  // Reference imagery under the canvas: the account's own scan tiles, with opacity and an optional swipe clip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pane = map.getPane("twinReference");
    if (!reference) { refLayerRef.current?.remove(); refLayerRef.current = null; if (pane) pane.style.clipPath = ""; return; }
    let tl = refLayerRef.current;
    if (!tl || (tl as unknown as { _url: string })._url !== reference.url) {
      tl?.remove();
      tl = new CachedTileLayer(reference.url, { pane: "twinReference", maxNativeZoom: reference.maxNativeZoom, maxZoom: 26, minZoom: 13, tileSize: 256, opacity: reference.opacity, crossOrigin: false });
      tl.addTo(map);
      refLayerRef.current = tl;
    }
    tl.setOpacity(reference.opacity);
    if (pane) pane.style.clipPath = reference.swipe == null ? "" : `inset(0 ${Math.round((1 - reference.swipe) * 1000) / 10}% 0 0)`;
  }, [reference, scene]);

  // The swipe divider: a handle the user drags; the pane's clip follows.
  useEffect(() => {
    const d = dividerRef.current, host = el.current;
    if (!d || !host || !reference || reference.swipe == null) return;
    let dragging = false;
    const move = (ev: PointerEvent) => { if (!dragging) return; const r = host.getBoundingClientRect(); onSwipeRef.current?.(Math.max(0.02, Math.min(0.98, (ev.clientX - r.left) / r.width))); };
    const down = (ev: PointerEvent) => { dragging = true; d.setPointerCapture(ev.pointerId); ev.preventDefault(); ev.stopPropagation(); };
    const up = () => { dragging = false; };
    d.addEventListener("pointerdown", down); d.addEventListener("pointermove", move); d.addEventListener("pointerup", up);
    return () => { d.removeEventListener("pointerdown", down); d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); };
  }, [reference]);

  return (
    <div className="relative h-full w-full" style={{ background: TWIN_COLOURS.outside }}>
      <div ref={el} className="h-full w-full" style={{ background: TWIN_COLOURS.outside }} aria-label="Field Twin map" role="application" />
      <div ref={miniEl} className="absolute bottom-[92px] z-[650] h-[110px] w-[170px] overflow-hidden rounded-sm border border-[#343834] bg-[#191d1a]" style={{ right: "calc(var(--twin-right, 0px) + 12px)", transition: "right .15s ease" }} aria-label="Mini-map: the field in its surroundings" role="img" />
      {reference && reference.swipe != null && (
        <div ref={dividerRef} role="separator" aria-label="Reference imagery swipe divider" aria-valuenow={Math.round(reference.swipe * 100)}
          className="absolute top-0 bottom-0 z-[600] w-5 -ml-2.5 cursor-col-resize touch-none" style={{ left: `${reference.swipe * 100}%` }}>
          <div className="mx-auto h-full w-0.5 bg-white/80" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[#1a1c1a]/90 px-1.5 py-0.5 text-[10px] text-neutral-200">⇔</div>
        </div>
      )}
    </div>
  );
}
