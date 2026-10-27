// The Field Twin's map: vectors only, no satellite and no orthomosaic underneath.
//
// Detail follows the zoom (lib/fieldTwin/view.ts): the overview shows the photographs' coverage, the rows and a
// weed density grid; closer, trees and weeds are points; closest, every crown and weed is drawn as measured.
// Everything is drawn on one canvas renderer (thousands of objects stay smooth), and every object can be clicked.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { type DetailLevel, detailAt, weedDensity } from "@/lib/fieldTwin/view";
import type { TwinBundle, TwinWeed } from "@/lib/fieldTwin/types";
import { ROW_COLOUR, TREE_COLOUR, type TwinLayers, WEED_COLOUR, weedColour } from "@/lib/fieldTwin/style";

export type TwinSelection = { kind: "tree"; id: number } | { kind: "weed"; id: number } | null;

/** Convex hull of points (lat/lng), for the photographs' coverage outline. */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Which layer groups are on, from the toggles and the zoom; returns the detail level it applied. */
function applyLayers(map: L.Map, G: Record<string, L.LayerGroup>, l: TwinLayers, ensure: (key: string) => void): DetailLevel {
  const d = detailAt(map.getZoom());
  const want: Record<string, boolean> = {
    coverage: l.coverage, rows: l.rows, droppedRows: l.droppedRows,
    density: l.verified && d === "overview",
    treePoints: l.trees && d === "points", treeCrowns: l.trees && (d === "outlines" || d === "overview"),
    inferred: l.inferred && d !== "overview",
    verifiedPoints: l.verified && d === "points", verifiedOutlines: l.verified && d === "outlines",
    singlePoints: l.singleView && d === "points", singleOutlines: l.singleView && d === "outlines",
    onTreePoints: l.onTree && d === "points", onTreeOutlines: l.onTree && d === "outlines",
    vegetation: l.vegetation && d !== "overview",
  };
  for (const [k, grp] of Object.entries(G)) {
    const on = want[k];
    if (on) ensure(k);
    if (on && !map.hasLayer(grp)) grp.addTo(map);
    if (!on && map.hasLayer(grp)) map.removeLayer(grp);
  }
  return d;
}

type Props = {
  twin: TwinBundle;
  layers: TwinLayers;
  selection: TwinSelection;
  onSelect: (s: TwinSelection) => void;
  onDetail?: (d: DetailLevel, zoom: number) => void;
};

export default function TwinMap({ twin, layers, selection, onSelect, onDetail }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groups = useRef<Record<string, L.LayerGroup>>({});
  const selRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const builders = useRef<Record<string, (g: L.LayerGroup) => void>>({});
  const built = useRef<Set<string>>(new Set());
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDetailRef = useRef(onDetail);
  onDetailRef.current = onDetail;

  const ensure = (key: string) => {
    if (built.current.has(key)) return;
    built.current.add(key);
    builders.current[key]?.(groups.current[key]);
  };

  // Build the map once per twin; the layer groups are filled on first use (ensure).
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { preferCanvas: true, maxZoom: 25, zoomSnap: 0.5, attributionControl: false, zoomControl: true });
    mapRef.current = map;
    const renderer = L.canvas({ padding: 0.3, tolerance: 4 });
    rendererRef.current = renderer;
    const pick = (s: TwinSelection) => (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onSelectRef.current(s); };
    const weedsOf = (status: TwinWeed["status"]) => twin.weeds.filter(w => w.status === status);
    const plant = twin.field.plantSpacingM;
    const typicalCrown = twin.trees.length ? [...twin.trees].map(t => t.crownRadiusM).sort((a, b) => a - b)[Math.floor(twin.trees.length / 2)] : plant / 4;
    const weedPoint = (w: TwinWeed) => { const c = weedColour(w); return L.circleMarker([w.lat, w.lng], { renderer, radius: w.status === "verified" ? 3 : 2.5, color: c, weight: 1, fillColor: c, fillOpacity: w.status === "single view" ? 0 : 0.9 }).on("click", pick({ kind: "weed", id: w.id })); };
    const weedOutline = (w: TwinWeed) => {
      const c = weedColour(w);
      return (w.ring.length >= 3 ? L.polygon(w.ring, { renderer, color: c, weight: 1.5, fillColor: c, fillOpacity: w.status === "single view" ? 0.05 : 0.3, dashArray: w.status === "single view" ? "3 3" : undefined }) : L.circle([w.lat, w.lng], { renderer, radius: w.diameterM / 2, color: c, weight: 1.5, fillOpacity: 0.3 })).on("click", pick({ kind: "weed", id: w.id }));
    };
    // Each group is built the first time the zoom or a toggle asks for it: zoomed out, the thousands of weed outlines
    // are never made at all.
    const build: Record<string, (g: L.LayerGroup) => void> = {
      coverage: g => { g.addLayer(L.polygon(hull(twin.footprints.flatMap(f => f.ring)), { renderer, color: "#6b7280", weight: 1, dashArray: "4 4", fillColor: "#2a241f", fillOpacity: 0.35, interactive: false })); },
      rows: g => { for (const r of twin.rows) if (r.kept) g.addLayer(L.polyline(r.line, { renderer, color: ROW_COLOUR, weight: 2, opacity: 0.9 }).bindTooltip(`Row ${r.id}: ${r.trees} trees, seen in ${r.photos} photographs`, { sticky: true })); },
      droppedRows: g => { for (const r of twin.rows) if (!r.kept) g.addLayer(L.polyline(r.line, { renderer, color: "#6b7280", weight: 1.5, dashArray: "6 6", opacity: 0.9 }).bindTooltip(`Not kept as a row: ${r.reason}`, { sticky: true })); },
      density: g => {
        const cells = weedDensity(twin, 5, w => w.status === "verified");
        const maxCount = Math.max(1, ...cells.map(c => c.count));
        for (const c of cells) g.addLayer(L.rectangle([[c.south, c.west], [c.north, c.east]], { renderer, stroke: false, fillColor: WEED_COLOUR.betweenRows, fillOpacity: 0.12 + 0.6 * (c.count / maxCount), interactive: false }));
      },
      treePoints: g => { for (const t of twin.trees) g.addLayer(L.circleMarker([t.lat, t.lng], { renderer, radius: 3, color: TREE_COLOUR, weight: 1, fillColor: TREE_COLOUR, fillOpacity: 0.8 }).on("click", pick({ kind: "tree", id: t.id }))); },
      treeCrowns: g => { for (const t of twin.trees) g.addLayer(L.circle([t.lat, t.lng], { renderer, radius: t.crownRadiusM, color: TREE_COLOUR, weight: 1.5, fillColor: TREE_COLOUR, fillOpacity: 0.08 }).on("click", pick({ kind: "tree", id: t.id }))); },
      inferred: g => { for (const p of twin.inferredTrees) g.addLayer(L.circle([p.lat, p.lng], { renderer, radius: typicalCrown, color: TREE_COLOUR, weight: 1, dashArray: "3 4", fill: false, interactive: false })); },
      verifiedPoints: g => { for (const w of weedsOf("verified")) g.addLayer(weedPoint(w)); },
      verifiedOutlines: g => { for (const w of weedsOf("verified")) g.addLayer(weedOutline(w)); },
      singlePoints: g => { for (const w of weedsOf("single view")) g.addLayer(weedPoint(w)); },
      singleOutlines: g => { for (const w of weedsOf("single view")) g.addLayer(weedOutline(w)); },
      onTreePoints: g => { for (const w of weedsOf("on a tree")) g.addLayer(weedPoint(w)); },
      onTreeOutlines: g => { for (const w of weedsOf("on a tree")) g.addLayer(weedOutline(w)); },
      vegetation: g => { for (const v of twin.vegetation) if (v.ring.length >= 3) g.addLayer(L.polygon(v.ring, { renderer, color: "#86efac", weight: 1, fillColor: "#86efac", fillOpacity: 0.12, interactive: false })); },
    };
    const G: Record<string, L.LayerGroup> = {};
    for (const k of Object.keys(build)) G[k] = L.layerGroup();
    groups.current = G;
    builders.current = build;
    built.current = new Set();

    map.fitBounds(L.latLngBounds(twin.bounds[0], twin.bounds[1]), { padding: [20, 20] });
    map.on("click", () => onSelectRef.current(null));
    const sync = () => onDetailRef.current?.(applyLayers(map, groups.current, layersRef.current, ensure), map.getZoom());
    map.on("zoomend", sync);
    sync();
    selRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, [twin]);

  useEffect(() => { const map = mapRef.current; if (map) onDetailRef.current?.(applyLayers(map, groups.current, layers, ensure), map.getZoom()); }, [layers]);

  // The selected object: a ring around it, and the map brought to it if it is off screen.
  useEffect(() => {
    const map = mapRef.current, grp = selRef.current;
    if (!map || !grp) return;
    grp.clearLayers();
    if (!selection) return;
    const o = selection.kind === "tree" ? twin.trees.find(t => t.id === selection.id) : twin.weeds.find(w => w.id === selection.id);
    if (!o) return;
    const r = selection.kind === "tree" ? (o as { crownRadiusM: number }).crownRadiusM + 0.3 : Math.max(0.25, (o as TwinWeed).diameterM / 2 + 0.15);
    // On the SAME canvas as the objects. Without a renderer Leaflet made a second canvas above this one for the
    // ring, and that canvas kept catching every later click: after one selection nothing could be selected again.
    grp.addLayer(L.circle([o.lat, o.lng], { renderer: rendererRef.current ?? undefined, radius: r, color: "#ffffff", weight: 2.5, fill: false, interactive: false }));
    if (!map.getBounds().contains([o.lat, o.lng])) map.panTo([o.lat, o.lng]);
  }, [selection, twin]);

  return <div ref={el} className="h-full w-full" style={{ background: "#1c1916" }} aria-label="Field Twin map" role="application" />;
}
