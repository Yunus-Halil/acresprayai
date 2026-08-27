// Two scans on ONE map, split by a draggable divider.
//
// ONE MAP INSTANCE, STRUCTURALLY. Both orthomosaics are tile layers on the
// same Leaflet map, each in its own pane, and the divider is a CSS clip on
// those panes. There is no second map and no view syncing — misalignment
// between the two sides is not a bug this design can have, because there is
// only one view for them to share. (The previous compare ran two maps locked
// together by event listeners; this replaces it.) A Leaflet map is always
// north-up, so a vertical screen-space clip IS a line of constant longitude:
// the divider is geographically exact, not an approximation.
//
// WHAT THE SIDES MAY CLAIM. Side A (the older flight) is clipped to the left
// of the divider, side B to the right — A never bleeds through B's nodata,
// so ground only one flight covered shows the basemap, not a lie. On top of
// that, everything outside the geometric intersection of the two footprints
// is dimmed: change numbers exist only where both flights actually looked,
// and the dimming shows the person exactly where that is.
import { useEffect, useMemo, useRef, useState } from "react";
import { Polygon, Rectangle, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { ChevronsLeftRight, Layers, X } from "lucide-react";
import { FN_BASE } from "./constants";
import {
  type ScanBounds, type ScanIndexInfo, type VegetationIndex,
  INDEX_RANGE, INDEX_SHORT_LABEL,
  boundsFromTileJson, indexDetail, indexOptions, indexRampCss, indexTileUrl,
  isCalibratedIndex, legendEnds, rgbLayerLabel, rgbTileUrl,
} from "@/lib/scanLayers";
import {
  type CompareStats, type GroundPoint, offsetDescription,
} from "@/lib/compareGround";
import type { FieldScan } from "./ScanTimeline";

export type SideLayerState = {
  imagery: "rgb" | "index";
  index: VegetationIndex | null;
  zones: boolean;
};

export const DEFAULT_SIDE: SideLayerState = { imagery: "rgb", index: null, zones: true };

type ZoneLike = { id?: string; ring?: GroundPoint[]; severity?: string };

const sevColor = (sev?: string) =>
  sev === "high" ? "#ef4444" : sev === "medium" ? "#f59e0b" : "#facc15";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const shortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// ---------------------------------------------------------------------------
// Per-scan geometry from the tile service, cached for the session
// ---------------------------------------------------------------------------

export type ScanRenderMeta = {
  bounds: ScanBounds | null;
  maxZoom: number;
  error: string | null;
};

const metaCache = new Map<string, ScanRenderMeta>();

export function useScanRenderMeta(taskId: string | null, token: string | null): ScanRenderMeta | null {
  const [meta, setMeta] = useState<ScanRenderMeta | null>(
    taskId ? metaCache.get(taskId) ?? null : null,
  );
  useEffect(() => {
    if (!taskId || !token) { setMeta(null); return; }
    const hit = metaCache.get(taskId);
    if (hit) { setMeta(hit); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${FN_BASE}/ortho-url?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        const m: ScanRenderMeta = r.ok
          ? {
              bounds: boundsFromTileJson(j?.tilejson?.bounds),
              maxZoom: typeof j?.tilejson?.maxzoom === "number" ? j.tilejson.maxzoom : 20,
              error: null,
            }
          : { bounds: null, maxZoom: 20, error: j?.error ?? "Scan extent unavailable" };
        if (m.bounds || m.error) metaCache.set(taskId, m);
        if (!cancelled) setMeta(m);
      } catch (e) {
        if (!cancelled) setMeta({ bounds: null, maxZoom: 20, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, [taskId, token]);
  return meta;
}

// ---------------------------------------------------------------------------
// The clipped panes, inside the one MapContainer
// ---------------------------------------------------------------------------

const PANES = {
  aTiles: { name: "cmp-a", z: 210 },
  bTiles: { name: "cmp-b", z: 220 },
  aVec: { name: "cmp-a-vec", z: 380 },
  bVec: { name: "cmp-b-vec", z: 381 },
  mask: { name: "cmp-mask", z: 390 },
} as const;

export function ComparePanes({
  a, b, token, rev, sideA, sideB, aInfo, bInfo, aMeta, bMeta,
  aZones, bZones, overlap, swipePct,
}: {
  a: FieldScan;
  b: FieldScan;
  token: string | null;
  /** Bumped after a rebake so re-rendered tiles bypass the browser cache. */
  rev: number;
  sideA: SideLayerState;
  sideB: SideLayerState;
  aInfo: ScanIndexInfo | null;
  bInfo: ScanIndexInfo | null;
  aMeta: ScanRenderMeta | null;
  bMeta: ScanRenderMeta | null;
  /** Null = that scan has no completed analysis; [] = analyzed and clean. */
  aZones: ZoneLike[] | null;
  bZones: ZoneLike[] | null;
  overlap: ScanBounds | null;
  swipePct: number;
}) {
  const map = useMap();

  // Fit the view to the compared ground when compare opens for this pair.
  // Without this the operator can enter compare zoomed into a corner with
  // side B entirely off-screen and no cue that anything is there.
  const fitted = useRef(false);
  useEffect(() => { fitted.current = false; }, [a.id, b.id]);
  useEffect(() => {
    if (fitted.current) return;
    const boxes = [aMeta?.bounds, bMeta?.bounds].filter(Boolean) as ScanBounds[];
    const box = boxes.length
      ? boxes.reduce((u, x) => ({
          north: Math.max(u.north, x.north), south: Math.min(u.south, x.south),
          east: Math.max(u.east, x.east), west: Math.min(u.west, x.west),
        }))
      : overlap;
    if (!box) return;
    fitted.current = true;
    map.fitBounds([[box.south, box.west], [box.north, box.east]], { padding: [40, 40] });
  }, [map, aMeta, bMeta, overlap, a.id, b.id]);

  // Panes must exist before any child layer mounts into them, and child
  // effects run before this component's own — so the layers render one commit
  // after the panes are created.
  const [panesReady, setPanesReady] = useState(false);
  useEffect(() => {
    for (const { name, z } of Object.values(PANES)) {
      if (!map.getPane(name)) {
        const p = map.createPane(name);
        p.style.zIndex = String(z);
        p.style.pointerEvents = "none";
      }
    }
    setPanesReady(true);
    return () => {
      // Leave the panes in place (Leaflet has no removePane), but clear the
      // clips so nothing outside compare mode inherits them.
      for (const { name } of Object.values(PANES)) {
        const p = map.getPane(name);
        if (p) p.style.clipPath = "";
      }
    };
  }, [map]);

  // The divider: A's panes clipped to its left, B's to its right. Re-applied
  // on resize; panning needs nothing, the clip is anchored to the screen.
  useEffect(() => {
    if (!panesReady) return;
    const apply = () => {
      // The live DOM width, not Leaflet's cached size — the clip must track
      // the container as it actually is, even mid-resize.
      const w = map.getContainer().clientWidth;
      const x = Math.round((swipePct / 100) * w);
      const right = Math.max(0, w - x);
      const clip = (name: string, value: string) => {
        const p = map.getPane(name);
        if (p) p.style.clipPath = value;
      };
      clip(PANES.aTiles.name, `inset(0 ${right}px 0 0)`);
      clip(PANES.aVec.name, `inset(0 ${right}px 0 0)`);
      clip(PANES.bTiles.name, `inset(0 0 0 ${x}px)`);
      clip(PANES.bVec.name, `inset(0 0 0 ${x}px)`);
    };
    apply();
    map.on("resize", apply);
    return () => { map.off("resize", apply); };
  }, [map, panesReady, swipePct]);

  // One SVG renderer per side pane, so each side's polygons live under that
  // side's clip — the entire mechanism of the divider. Constructed with
  // `new L.SVG(...)`, NOT the `L.svg()` factory: the factory returns null
  // wherever `Browser.svg` probes false (jsdom included), and a null renderer
  // crashes Leaflet's Path pipeline.
  const aRenderer = useMemo(() => new L.SVG({ pane: PANES.aVec.name }), []);
  const bRenderer = useMemo(() => new L.SVG({ pane: PANES.bVec.name }), []);
  const maskRenderer = useMemo(() => new L.SVG({ pane: PANES.mask.name }), []);

  if (!panesReady || !token) return null;

  const urlFor = (scan: FieldScan, side: SideLayerState, info: ScanIndexInfo | null) => {
    if (side.imagery === "index" && side.index) {
      return indexTileUrl(scan, token, side.index, info);
    }
    // `info` carries the render plan, which versions the URL past any cached
    // tiles from an older bake.
    const u = rgbTileUrl(scan, token, info);
    return u ? `${u}&rev=${rev}` : null;
  };
  const aUrl = urlFor(a, sideA, aInfo);
  const bUrl = urlFor(b, sideB, bInfo);

  // Dim everything outside the shared footprint. The outer ring is the union
  // of both extents padded generously; the hole is the intersection.
  const maskPositions: [number, number][][] | null = (() => {
    if (!overlap || !aMeta?.bounds || !bMeta?.bounds) return null;
    const u = {
      west: Math.min(aMeta.bounds.west, bMeta.bounds.west) - 0.5,
      east: Math.max(aMeta.bounds.east, bMeta.bounds.east) + 0.5,
      south: Math.max(-89, Math.min(aMeta.bounds.south, bMeta.bounds.south) - 0.5),
      north: Math.min(89, Math.max(aMeta.bounds.north, bMeta.bounds.north) + 0.5),
    };
    return [
      [[u.south, u.west], [u.north, u.west], [u.north, u.east], [u.south, u.east]],
      [
        [overlap.south, overlap.west], [overlap.north, overlap.west],
        [overlap.north, overlap.east], [overlap.south, overlap.east],
      ],
    ];
  })();

  const zoneLayer = (
    zones: ZoneLike[] | null,
    show: boolean,
    pane: string,
    renderer: L.Renderer,
    keyPrefix: string,
  ) => {
    if (!show || !zones) return null;
    return zones
      .filter(z => (z.ring?.length ?? 0) >= 3)
      .map((z, i) => (
        <Polygon
          key={`${keyPrefix}-${z.id ?? i}`}
          positions={(z.ring as GroundPoint[]).map(p => [p.lat, p.lng] as [number, number])}
          pane={pane}
          renderer={renderer}
          interactive={false}
          pathOptions={{ color: sevColor(z.severity), weight: 1.5, fillOpacity: 0.3 }}
        />
      ));
  };

  return (
    <>
      {aUrl && (
        <TileLayer
          key={`cmp-a-${aUrl}`}
          url={aUrl}
          pane={PANES.aTiles.name}
          maxNativeZoom={Math.min(20, aMeta?.maxZoom ?? 20)}
          maxZoom={22}
          tileSize={256}
          keepBuffer={4}
          updateWhenZooming={false}
          noWrap
        />
      )}
      {bUrl && (
        <TileLayer
          key={`cmp-b-${bUrl}`}
          url={bUrl}
          pane={PANES.bTiles.name}
          maxNativeZoom={Math.min(20, bMeta?.maxZoom ?? 20)}
          maxZoom={22}
          tileSize={256}
          keepBuffer={4}
          updateWhenZooming={false}
          noWrap
        />
      )}
      {zoneLayer(aZones, sideA.zones, PANES.aVec.name, aRenderer, "a")}
      {zoneLayer(bZones, sideB.zones, PANES.bVec.name, bRenderer, "b")}
      {maskPositions && (
        <>
          <Polygon
            positions={maskPositions}
            pane={PANES.mask.name}
            renderer={maskRenderer}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: "#0a0a0a", fillOpacity: 0.3 }}
          />
          <Rectangle
            bounds={[[overlap!.south, overlap!.west], [overlap!.north, overlap!.east]]}
            pane={PANES.mask.name}
            renderer={maskRenderer}
            interactive={false}
            pathOptions={{ color: "#22d3ee", weight: 1, dashArray: "4 4", fill: false, opacity: 0.7 }}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The divider handle (screen-space, over the map)
// ---------------------------------------------------------------------------

export function SwipeHandle({
  pct, onPct, containerRef,
}: {
  pct: number;
  onPct: (pct: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    const wrap = containerRef.current;
    if (!wrap) return;
    const move = (clientX: number) => {
      const r = wrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, clientX - r.left));
      onPct((x / r.width) * 100);
    };
    const onMouse = (ev: MouseEvent) => move(ev.clientX);
    const onTouch = (ev: TouchEvent) => move(ev.touches[0].clientX);
    const stop = () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", stop);
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", onTouch);
    window.addEventListener("touchend", stop);
    if ("touches" in e) move(e.touches[0].clientX);
    else move((e as React.MouseEvent).clientX);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Compare divider"
      data-testid="swipe-handle"
      onMouseDown={startDrag}
      onTouchStart={startDrag}
      className="absolute bottom-0 top-0 z-[1002] w-0.5 -translate-x-1/2 cursor-ew-resize bg-cyan-400/90"
      style={{ left: `${pct}%` }}
    >
      <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-400/60 bg-[#111] shadow-lg">
        <ChevronsLeftRight className="h-3.5 w-3.5 text-cyan-300" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-side layer selector
// ---------------------------------------------------------------------------

function SideLayerMenu({
  label, scan, info, state, onState,
}: {
  label: "A" | "B";
  scan: FieldScan | null;
  info: ScanIndexInfo | null;
  state: SideLayerState;
  onState: (next: SideLayerState) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!scan) return null;
  const options = indexOptions(info);
  const imagery = rgbLayerLabel(info);
  const current = state.imagery === "index" && state.index
    ? INDEX_SHORT_LABEL[state.index]
    : imagery.label.startsWith("RGB") ? "RGB" : imagery.label;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-sm border border-[#1f1f1f] bg-black/80 px-2 py-1.5 text-[11px] text-neutral-200 backdrop-blur transition-colors hover:border-[#333] hover:text-white"
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-cyan-500 text-[10px] font-semibold text-black">{label}</span>
        <Layers className="h-3 w-3 text-cyan-400" />
        <span className="max-w-[9rem] truncate">{current}</span>
      </button>
      {open && (
        <div className="absolute left-0 z-[1003] mt-1 w-64 rounded-sm border border-[#1f1f1f] bg-[#111] p-1.5 shadow-2xl">
          <button
            type="button"
            onClick={() => { onState({ ...state, imagery: "rgb" }); setOpen(false); }}
            className={`w-full rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors ${
              state.imagery === "rgb" ? "bg-cyan-500/15 text-cyan-300" : "text-neutral-300 hover:bg-white/5"
            }`}
          >
            <div className="font-medium">{imagery.label}</div>
            <div className="text-[10px] leading-snug text-neutral-500">
              {imagery.caveat ?? "The photograph, as flown."}
            </div>
          </button>
          <div className="my-1 border-t border-[#1f1f1f]" />
          {options.map(o => (
            <button
              key={o.index}
              type="button"
              disabled={!o.enabled}
              title={o.enabled ? o.detail : o.reason}
              onClick={() => {
                if (!o.enabled) return;
                onState({ ...state, imagery: "index", index: o.index });
                setOpen(false);
              }}
              className={`w-full rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors ${
                !o.enabled
                  ? "cursor-not-allowed text-neutral-600"
                  : state.imagery === "index" && state.index === o.index
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-neutral-300 hover:bg-white/5"
              }`}
            >
              <div className="font-medium">{o.label}</div>
              <div className="text-[10px] leading-snug text-neutral-500">{o.enabled ? o.detail : o.reason}</div>
            </button>
          ))}
          <div className="my-1 border-t border-[#1f1f1f]" />
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] text-neutral-300 hover:bg-white/5">
            <input
              type="checkbox"
              checked={state.zones}
              onChange={(e) => onState({ ...state, zones: e.target.checked })}
              className="accent-cyan-500"
            />
            Treatment zones
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The strip: chips + side controls + exit
// ---------------------------------------------------------------------------

export function ScanStrip({
  scans, picked, aId, bId, onPick, notPickable, onExit,
  aInfo, bInfo, sideA, sideB, onSideA, onSideB,
}: {
  scans: FieldScan[];
  picked: string[];
  aId: string | null;
  bId: string | null;
  onPick: (id: string) => void;
  notPickable: (s: FieldScan) => string | null;
  onExit: () => void;
  aInfo: ScanIndexInfo | null;
  bInfo: ScanIndexInfo | null;
  sideA: SideLayerState;
  sideB: SideLayerState;
  onSideA: (s: SideLayerState) => void;
  onSideB: (s: SideLayerState) => void;
}) {
  const aScan = scans.find(s => s.id === aId) ?? null;
  const bScan = scans.find(s => s.id === bId) ?? null;
  return (
    <div
      data-testid="scan-strip"
      className="absolute left-1/2 top-3 z-[1001] flex max-w-[calc(100%-8rem)] -translate-x-1/2 items-center gap-2 rounded-sm border border-[#1f1f1f] bg-[#0f0f0f]/90 p-1.5 backdrop-blur"
    >
      <SideLayerMenu label="A" scan={aScan} info={aInfo} state={sideA} onState={onSideA} />
      <div className="flex max-w-[40vw] items-center gap-1 overflow-x-auto">
        {scans.map(s => {
          const blocked = notPickable(s);
          const badge = s.id === aId ? "A" : s.id === bId ? "B" : null;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!!blocked}
              title={blocked ?? `${shortDate(s.created_at)} · ${shortTime(s.created_at)}`}
              onClick={() => onPick(s.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                blocked
                  ? "cursor-not-allowed border-[#1f1f1f] text-neutral-600"
                  : badge
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                    : "border-[#222] text-neutral-300 hover:border-[#333] hover:text-white"
              }`}
            >
              {badge && (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-cyan-500 text-[10px] font-semibold text-black">
                  {badge}
                </span>
              )}
              <span className="whitespace-nowrap">
                {shortDate(s.created_at)}
                <span className={badge ? "text-cyan-300/70" : "text-neutral-600"}> {shortTime(s.created_at)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <SideLayerMenu label="B" scan={bScan} info={bInfo} state={sideB} onState={onSideB} />
      <button
        type="button"
        onClick={onExit}
        title="Exit compare"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-neutral-500 transition-colors hover:bg-[#1a1a1a] hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend + stats
// ---------------------------------------------------------------------------

export function SideLegend({ side, index }: { side: "A" | "B"; index: VegetationIndex }) {
  const ends = legendEnds(index);
  return (
    <div className="pointer-events-none w-64 rounded-sm border border-[#1f1f1f] bg-black/80 px-2.5 py-2 backdrop-blur">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-cyan-500 text-[10px] font-semibold text-black">{side}</span>
        <span className="text-[11px] font-medium text-neutral-100">{INDEX_SHORT_LABEL[index]}</span>
        <span className="truncate text-[9px] text-neutral-500">{indexDetail(index)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] tabular-nums text-neutral-500">{INDEX_RANGE[0]}</span>
        <div className="h-1.5 flex-1 rounded-sm" style={{ background: indexRampCss() }} />
        <span className="text-[9px] tabular-nums text-neutral-500">+{INDEX_RANGE[1]}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[9px] text-neutral-400">
        <span>{ends.low}</span>
        <span>{ends.high}</span>
      </div>
      {!isCalibratedIndex(index) && (
        <div className="mt-1 border-t border-[#1f1f1f] pt-1 text-[9px] leading-snug text-amber-500/80">
          Visible-light proxy from ordinary RGB imagery. Approximate, not calibrated, and not NDVI,
          which needs a near-infrared band this camera did not record.
        </div>
      )}
    </div>
  );
}

export function CompareStatsBar({
  a, b, stats, aAnalyzed, bAnalyzed, aBounds, bBounds, aSource, bSource,
  currentTaskId, onOpenGrid, onOpenScan,
}: {
  a: FieldScan;
  b: FieldScan;
  stats: CompareStats;
  aAnalyzed: boolean;
  bAnalyzed: boolean;
  aBounds: ScanBounds | null;
  bBounds: ScanBounds | null;
  /** Which system produced each side's zones — legacy results are labelled. */
  aSource: "grid" | "legacy" | null;
  bSource: "grid" | "legacy" | null;
  /** The scan whose workspace this is — its grid opens in place. */
  currentTaskId?: string | null;
  onOpenGrid?: () => void;
  onOpenScan?: (taskId: string) => void;
}) {
  // The un-assessed side is the named next step; give it a button, not just
  // a sentence — a stats bar that names a destination with no way to go
  // there is a soft dead end.
  const target = !aAnalyzed ? a : !bAnalyzed ? b : null;
  const offset = aBounds && bBounds ? offsetDescription(aBounds, bBounds) : null;
  const legacySides = [
    ...(aSource === "legacy" ? [`A (${shortDate(a.created_at)})`] : []),
    ...(bSource === "legacy" ? [`B (${shortDate(b.created_at)})`] : []),
  ];
  return (
    <div
      data-testid="compare-stats"
      className="absolute bottom-14 left-1/2 z-[1001] w-[30rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-sm border border-[#1f1f1f] bg-black/85 px-3 py-2 backdrop-blur"
    >
      {!stats.overlap ? (
        <div className="text-[11px] leading-snug text-amber-400">
          These two flights share no ground: their footprints do not intersect, so there is
          nothing to compare between them.
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="text-neutral-400">
              Shared coverage <span className="font-medium text-neutral-100">{stats.overlapAcres.toFixed(1)} ac</span>
            </span>
            {aAnalyzed && bAnalyzed ? (
              <span className="text-neutral-300">
                Stressed within it:{" "}
                <span className="font-medium text-neutral-100">{stats.aStressedAc!.toFixed(2)}</span>
                <span className="text-neutral-600"> → </span>
                <span className="font-medium text-neutral-100">{stats.bStressedAc!.toFixed(2)} ac</span>
                {stats.deltaPct !== null && (
                  <span className={`ml-1 font-semibold ${stats.deltaPct < 0 ? "text-emerald-400" : "text-amber-400"}`}>
                    ({stats.deltaPct > 0 ? "+" : ""}{stats.deltaPct.toFixed(0)}%)
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-neutral-500">
                <span>
                  {aAnalyzed ? `Assess the ${shortDate(b.created_at)} scan` :
                   bAnalyzed ? `Assess the ${shortDate(a.created_at)} scan` :
                   "Assess both scans"} in the Treatment Grid to measure change.
                </span>
                {target && (onOpenGrid || onOpenScan) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (target.id === currentTaskId && onOpenGrid) onOpenGrid();
                      else if (onOpenScan) onOpenScan(target.id);
                    }}
                    className="shrink-0 rounded-sm border border-[#2b4a2e] bg-[#4CAF50]/15 px-2 py-0.5 text-[10px] font-semibold text-[#9ccc9f] hover:bg-[#4CAF50]/25"
                  >
                    {target.id === currentTaskId ? "Open Treatment Grid" : `Open the ${shortDate(target.created_at)} scan`}
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] leading-snug text-neutral-600">
            Change is measured only inside the ground both flights covered; the dimmed area was
            not covered by both.
          </div>
          {legacySides.length > 0 && (
            <div className="mt-1 text-[10px] leading-snug text-amber-500/80">
              Side {legacySides.join(" and side ")} shows a result from an older automatic analysis (no longer part of SwathWise), not a
              treatment-grid assessment. Re-assess it before relying on this change figure.
            </div>
          )}
          {aAnalyzed && bAnalyzed && stats.deltaPct === null && stats.aStressedAc === 0 && (
            <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">
              The older scan has no stressed area inside the shared coverage, so there is no
              baseline to express a percentage against.
            </div>
          )}
          {offset && (
            <div className="mt-1 border-t border-[#1f1f1f] pt-1 text-[10px] leading-snug text-amber-500/80">
              {offset}
            </div>
          )}
        </>
      )}
    </div>
  );
}
