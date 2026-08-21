// Two scans of the same field, side by side, locked to the same ground.
//
// ONE RENDERER, INSTANTIATED TWICE. `ComparePane` below is the only map in this
// file; the split and swipe layouts are two arrangements of the same two
// instances, not two implementations. It is built the way the Field View builds
// its orthomosaic — the same pre-baked tile source, the same basemap layer, the
// same index endpoint — so imagery that looks one way there looks the same way
// here.
//
// READ-ONLY, STRUCTURALLY. Nothing in this file writes: there is no repository,
// no supabase mutation, no save. It reads two scans, their extents, and their
// band analysis, and it draws them. Comparing scans is a way of looking at a
// field, and looking at a field must not be able to change what gets sprayed on
// it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ChevronsLeftRight, Columns2, Info, Layers, Loader2, X,
} from "lucide-react";
import { FN_BASE, NDVI_BASE } from "@/components/app/workspace/constants";
import {
  type BasemapId, BasemapLayer, BasemapToggle, loadBasemap, saveBasemap,
} from "@/components/app/workspace/layers";
import {
  type ComparableScan, type ScanBounds, type ScanIndexInfo, type ScanLayerId,
  type VegetationIndex,
  boundsFromTileJson, coverageOf, defaultIndexFor, indexDetail, indexOptions,
  indexRampCss, indexTileUrl, isCalibratedIndex, legendEnds, rgbTileUrl,
  INDEX_RANGE, INDEX_SHORT_LABEL,
} from "@/lib/scanLayers";
import { type MapView, type ViewSync, createViewSync } from "@/lib/compareSync";

type Ring = { lat: number; lng: number }[];

/** Everything the panes need about one scan, gathered once when compare opens. */
type ScanMeta = {
  bounds: ScanBounds | null;
  maxZoom: number;
  /** Set when the extent could not be read; the pane then makes no coverage claim. */
  error: string | null;
};

const scanDate = (scan: ComparableScan) =>
  new Date(scan.created_at).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });

const scanTime = (scan: ComparableScan) =>
  new Date(scan.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function ringsToBounds(rings: Ring[] | null): L.LatLngBoundsExpression | null {
  if (!rings?.length) return null;
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  for (const r of rings) for (const p of r) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  if (minLat > maxLat) return null;
  return [[minLat, minLng], [maxLat, maxLng]];
}

/** Union of both scans' extents, so the opening view frames whatever either flew. */
function unionBounds(a: ScanBounds | null, b: ScanBounds | null): L.LatLngBoundsExpression | null {
  const parts = [a, b].filter(Boolean) as ScanBounds[];
  if (!parts.length) return null;
  return [
    [Math.min(...parts.map(p => p.south)), Math.min(...parts.map(p => p.west))],
    [Math.max(...parts.map(p => p.north)), Math.max(...parts.map(p => p.east))],
  ];
}

// ---------------------------------------------------------------------------
// The bridge between one Leaflet map and the shared view
// ---------------------------------------------------------------------------

function SyncBinding({
  paneId, sync, onViewBounds, resizeKey,
}: {
  paneId: string;
  sync: ViewSync;
  onViewBounds: (b: ScanBounds) => void;
  /** Changes when the pane's box changes shape, so Leaflet can re-measure. */
  resizeKey: string;
}) {
  const map = useMap();
  const boundsCb = useRef(onViewBounds);
  boundsCb.current = onViewBounds;

  useEffect(() => {
    const emitBounds = () => {
      const b = map.getBounds();
      boundsCb.current({
        north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(),
      });
    };
    const report = () => {
      const c = map.getCenter();
      sync.report(paneId, { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };

    const detach = sync.attach(paneId, (v: MapView) => {
      // `animate: false` is load-bearing, not a preference. An animated move
      // finishes on a later frame, which would put this pane's echo outside the
      // sync's guard window and let it bounce back. Un-animated, Leaflet emits
      // the move synchronously and the echo is swallowed where it should be.
      map.setView([v.lat, v.lng], v.zoom, { animate: false });
      emitBounds();
    });

    // Whichever pane mounts second adopts the view the group is already on,
    // rather than starting on its own framing and yanking the other one to it.
    const current = sync.current();
    if (current) map.setView([current.lat, current.lng], current.zoom, { animate: false });
    else report();
    emitBounds();

    // Reported continuously rather than debounced: the panes are meant to move
    // together, and a debounce is precisely the thing that would make the
    // second one lag behind the first. Each event is cheap — a setView on an
    // already-loaded map — and the loop guard makes the echoes free.
    map.on("move", report);
    map.on("zoom", report);
    map.on("moveend", emitBounds);
    map.on("zoomend", emitBounds);
    return () => {
      map.off("move", report);
      map.off("zoom", report);
      map.off("moveend", emitBounds);
      map.off("zoomend", emitBounds);
      detach();
    };
  }, [map, paneId, sync]);

  // Switching layout changes the container's size under Leaflet, which caches
  // it. Without this the map keeps projecting into the old box and the two
  // panes quietly stop showing the same ground.
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(t);
  }, [map, resizeKey]);

  return null;
}

// ---------------------------------------------------------------------------
// One pane
// ---------------------------------------------------------------------------

type PaneLayer = { layer: ScanLayerId; index: VegetationIndex | null };

function ComparePane({
  paneId, scan, token, info, infoLoaded, meta, sync, state, onState,
  initialBounds, basemap, resizeKey, side, interactive,
}: {
  paneId: string;
  scan: ComparableScan;
  token: string | null;
  info: ScanIndexInfo | null;
  infoLoaded: boolean;
  meta: ScanMeta | null;
  sync: ViewSync;
  state: PaneLayer;
  onState: (next: PaneLayer) => void;
  initialBounds: L.LatLngBoundsExpression | null;
  basemap: BasemapId;
  resizeKey: string;
  side: "left" | "right";
  /**
   * False for the clipped pane in swipe mode: the two maps overlap there, and
   * the hidden one would otherwise swallow every gesture aimed at the visible
   * one. It still follows, through the sync.
   */
  interactive: boolean;
}) {
  const [viewBounds, setViewBounds] = useState<ScanBounds | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const options = useMemo(() => indexOptions(info), [info]);
  const usable = options.filter(o => o.enabled);
  const rgbUrl = rgbTileUrl(scan, token);
  const activeIndex = state.index;
  const indexUrl = activeIndex ? indexTileUrl(scan, token, activeIndex, info) : null;
  const showingIndex = state.layer === "index" && !!indexUrl;

  const coverage = coverageOf(viewBounds, meta?.bounds);
  const maxNativeZoom = Math.min(22, meta?.maxZoom ?? 20);

  const pick = (layer: ScanLayerId, index: VegetationIndex | null) => {
    onState({ layer, index: index ?? state.index });
    setMenuOpen(false);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0a0a]">
      <MapContainer
        bounds={initialBounds ?? undefined}
        center={initialBounds ? undefined : [0, 0]}
        zoom={initialBounds ? undefined : 2}
        minZoom={1}
        maxZoom={22}
        preferCanvas
        zoomControl={false}
        attributionControl={false}
        dragging={interactive}
        scrollWheelZoom={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
      >
        <SyncBinding
          paneId={paneId} sync={sync} onViewBounds={setViewBounds} resizeKey={resizeKey}
        />
        <BasemapLayer id={basemap} />
        {/* Exactly one imagery source at a time. Stacking the index over the
            RGB would look tidier and read as a lie: index tiles are transparent
            wherever the expression has no data, so the photograph underneath
            would show through as if it were part of the index. Over the
            basemap, a gap looks like a gap. */}
        {!showingIndex && rgbUrl && (
          <TileLayer
            key={`rgb-${rgbUrl}`}
            url={rgbUrl}
            maxNativeZoom={maxNativeZoom}
            maxZoom={22}
            tileSize={256}
            keepBuffer={4}
            updateWhenZooming={false}
            noWrap
            zIndex={10}
          />
        )}
        {showingIndex && indexUrl && (
          <TileLayer
            key={`idx-${indexUrl}`}
            url={indexUrl}
            maxNativeZoom={maxNativeZoom}
            maxZoom={22}
            tileSize={256}
            keepBuffer={4}
            updateWhenZooming={false}
            noWrap
            zIndex={20}
          />
        )}
      </MapContainer>

      {/* Which scan this is. The one thing that must never be ambiguous in a
          comparison is which side you are looking at. */}
      <div className="pointer-events-none absolute top-3 left-3 z-[500]">
        <div className="rounded-sm border border-[#1f1f1f] bg-black/80 px-2.5 py-1.5 backdrop-blur">
          <div className="text-[9px] uppercase tracking-wider text-neutral-500">
            {side === "left" ? "Left" : "Right"} · {scanTime(scan)}
          </div>
          <div className="text-[12px] font-medium text-neutral-100">{scanDate(scan)}</div>
        </div>
      </div>

      {/* Layer control */}
      <div className="absolute top-3 right-3 z-[500]">
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          className="flex items-center gap-1.5 rounded-sm border border-[#1f1f1f] bg-black/80 px-2.5 py-1.5 text-[11px] text-neutral-200 backdrop-blur transition-colors hover:border-[#333] hover:text-white"
        >
          <Layers className="h-3.5 w-3.5 text-cyan-400" />
          {showingIndex && activeIndex ? INDEX_SHORT_LABEL[activeIndex] : "RGB"}
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-64 rounded-sm border border-[#1f1f1f] bg-[#111] p-1.5 shadow-2xl">
            <button
              type="button"
              onClick={() => pick("rgb", null)}
              className={`w-full rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors ${
                !showingIndex ? "bg-cyan-500/15 text-cyan-300" : "text-neutral-300 hover:bg-white/5"
              }`}
            >
              <div className="font-medium">RGB orthomosaic</div>
              <div className="text-[10px] text-neutral-500">The photograph, as flown.</div>
            </button>
            <div className="my-1 border-t border-[#1f1f1f]" />
            {!infoLoaded && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-neutral-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading this scan's bands…
              </div>
            )}
            {infoLoaded && options.map(o => (
              <button
                key={o.index}
                type="button"
                disabled={!o.enabled}
                onClick={() => o.enabled && pick("index", o.index)}
                title={o.enabled ? o.detail : o.reason}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors ${
                  !o.enabled
                    ? "cursor-not-allowed text-neutral-600"
                    : showingIndex && activeIndex === o.index
                      ? "bg-cyan-500/15 text-cyan-300"
                      : "text-neutral-300 hover:bg-white/5"
                }`}
              >
                <div className="font-medium">{o.label}</div>
                <div className="text-[10px] leading-snug text-neutral-500">
                  {o.enabled ? o.detail : o.reason}
                </div>
              </button>
            ))}
            {infoLoaded && !usable.length && (
              <div className="px-2 py-1.5 text-[10px] leading-snug text-amber-500/90">
                No vegetation index can be computed from this scan's imagery.
              </div>
            )}
            {info?.reason && (
              <div className="mt-1 border-t border-[#1f1f1f] px-2 pt-1.5 text-[10px] leading-snug text-neutral-600">
                {info.reason}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend, only while an index is being shown. */}
      {showingIndex && activeIndex && (
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[500]">
          <div className="rounded-sm border border-[#1f1f1f] bg-black/80 px-2.5 py-2 backdrop-blur">
            <div className="mb-1 flex items-baseline gap-1.5">
              <span className="text-[11px] font-medium text-neutral-100">
                {INDEX_SHORT_LABEL[activeIndex]}
              </span>
              <span className="truncate text-[9px] text-neutral-500">{indexDetail(activeIndex)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tabular-nums text-neutral-500">{INDEX_RANGE[0]}</span>
              <div className="h-1.5 flex-1 rounded-sm" style={{ background: indexRampCss() }} />
              <span className="text-[9px] tabular-nums text-neutral-500">+{INDEX_RANGE[1]}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[9px] text-neutral-400">
              <span>{legendEnds(activeIndex).low}</span>
              <span>{legendEnds(activeIndex).high}</span>
            </div>
            {/* The caveat travels with the picture, not with a help page. */}
            {!isCalibratedIndex(activeIndex) && (
              <div className="mt-1 border-t border-[#1f1f1f] pt-1 text-[9px] leading-snug text-amber-500/80">
                Visible-light proxy from ordinary RGB imagery. Approximate, not calibrated,
                and not NDVI, which needs a near-infrared band this camera did not record.
              </div>
            )}
          </div>
        </div>
      )}

      {/* No imagery here, said plainly. An empty pane otherwise reads as
          "nothing is growing here" when it means "the drone never flew here". */}
      {coverage === "none" && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center p-6">
          <div className="max-w-[15rem] rounded-sm border border-[#1f1f1f] bg-black/85 px-3 py-2 text-center backdrop-blur">
            <div className="text-[11px] font-medium text-neutral-200">No imagery here</div>
            <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">
              The {scanDate(scan)} flight did not cover this part of the field.
            </div>
          </div>
        </div>
      )}
      {coverage === "partial" && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[400] -translate-x-1/2">
          <div className="whitespace-nowrap rounded-sm border border-amber-900/50 bg-black/85 px-2 py-1 text-[10px] text-amber-400/90 backdrop-blur">
            This flight covered only part of this view
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The compare view
// ---------------------------------------------------------------------------

export default function ScanCompare({
  left, right, boundary, token, onExit,
}: {
  left: ComparableScan;
  right: ComparableScan;
  boundary: Ring[] | null;
  token: string | null;
  onExit: () => void;
}) {
  const [mode, setMode] = useState<"split" | "swipe">("split");
  const [swipePct, setSwipePct] = useState(50);
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // One shared view for both panes, rebuilt only when the pair changes.
  // Derived during render rather than in an effect: the panes read it on their
  // first render, and a sync created one commit later would let them mount
  // unlinked and jump into alignment afterwards.
  const pairKey = `${left.id}:${right.id}`;
  const syncRef = useRef<{ key: string; sync: ViewSync }>({ key: pairKey, sync: createViewSync() });
  if (syncRef.current.key !== pairKey) {
    syncRef.current = { key: pairKey, sync: createViewSync() };
  }
  const sync = syncRef.current.sync;

  const leftId = left.id, rightId = right.id;
  const [info, setInfo] = useState<Record<string, ScanIndexInfo | null>>({});
  const [infoLoaded, setInfoLoaded] = useState(false);
  const [meta, setMeta] = useState<Record<string, ScanMeta>>({});
  const [metaLoading, setMetaLoading] = useState(true);

  // Which index each scan's bands actually support. Asked of the endpoint that
  // renders the tiles, so the menu cannot offer something the tiles would
  // refuse — or worse, silently substitute.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setInfoLoaded(false);
    (async () => {
      const entries = await Promise.all([leftId, rightId].map(async id => {
        try {
          const r = await fetch(`${NDVI_BASE}/info?task_id=${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          return [id, r.ok ? ((await r.json()) as ScanIndexInfo) : null] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      if (cancelled) return;
      setInfo(Object.fromEntries(entries));
      setInfoLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [leftId, rightId, token]);

  // Each scan's real extent, which is what lets a pane say "this flight did not
  // cover here" rather than showing an ambiguous empty frame.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setMetaLoading(true);
    (async () => {
      const entries = await Promise.all([leftId, rightId].map(async id => {
        try {
          const r = await fetch(`${FN_BASE}/ortho-url?task_id=${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            return [id, { bounds: null, maxZoom: 20, error: j?.error ?? "Extent unavailable" }] as const;
          }
          const bounds = boundsFromTileJson(j?.tilejson?.bounds);
          const maxZoom = typeof j?.tilejson?.maxzoom === "number" ? j.tilejson.maxzoom : 20;
          return [id, { bounds, maxZoom, error: bounds ? null : "Extent unavailable" }] as const;
        } catch (e) {
          return [id, { bounds: null, maxZoom: 20, error: String((e as Error)?.message ?? e) }] as const;
        }
      }));
      if (cancelled) return;
      setMeta(Object.fromEntries(entries));
      setMetaLoading(false);
    })();
    return () => { cancelled = true; };
  }, [leftId, rightId, token]);

  // Per-pane layer choice, independent by design: the common reading is the
  // photograph on one side and the index on the other.
  const [layers, setLayers] = useState<Record<string, PaneLayer>>({
    left: { layer: "rgb", index: null },
    right: { layer: "rgb", index: null },
  });

  // Seed each pane's index with whatever its own scan actually supports, once
  // its bands are known. Never overrides a choice the operator has made.
  const seeded = useRef(false);
  useEffect(() => {
    if (!infoLoaded || seeded.current) return;
    seeded.current = true;
    setLayers(prev => ({
      left: { ...prev.left, index: prev.left.index ?? defaultIndexFor(info[left.id]) },
      right: { ...prev.right, index: prev.right.index ?? defaultIndexFor(info[right.id]) },
    }));
  }, [infoLoaded, info, left.id, right.id]);
  useEffect(() => { seeded.current = false; }, [left.id, right.id]);

  const initialBounds = useMemo(
    () => unionBounds(meta[left.id]?.bounds ?? null, meta[right.id]?.bounds ?? null)
      ?? ringsToBounds(boundary),
    [meta, left.id, right.id, boundary],
  );

  const startSwipeDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const move = (clientX: number) => {
      const r = wrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, clientX - r.left));
      setSwipePct((x / r.width) * 100);
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
  }, []);

  // Both panes are mounted in both layouts; only their boxes change. Remounting
  // per layout would reload every tile and lose the view on each toggle.
  const pane = (side: "left" | "right", scan: ComparableScan, interactive: boolean) => (
    <ComparePane
      paneId={side}
      side={side}
      scan={scan}
      token={token}
      info={info[scan.id] ?? null}
      infoLoaded={infoLoaded}
      meta={meta[scan.id] ?? null}
      sync={sync}
      state={layers[side]}
      onState={next => setLayers(p => ({ ...p, [side]: next }))}
      initialBounds={initialBounds}
      basemap={basemap}
      resizeKey={mode}
      interactive={interactive}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#1f1f1f] bg-[#111] px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Comparing</div>
          <div className="truncate text-sm text-neutral-100">
            {scanDate(left)} <span className="text-neutral-600">→</span> {scanDate(right)}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-sm border border-[#1f1f1f]">
            {([
              { id: "split", label: "Split", icon: Columns2 },
              { id: "swipe", label: "Swipe", icon: ChevronsLeftRight },
            ] as const).map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] transition-colors ${
                  mode === m.id
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                }`}
              >
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-sm border border-[#1f1f1f] px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-[#333] hover:text-white"
          >
            <X className="h-3.5 w-3.5" /> Back to history
          </button>
        </div>
      </div>

      {/* Panes */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {metaLoading && (
          <div className="absolute inset-0 z-[900] grid place-items-center bg-[#0a0a0a]/70">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading both scans…
            </div>
          </div>
        )}

        {mode === "split" ? (
          <div className="absolute inset-0 grid grid-cols-1 gap-px bg-[#1f1f1f] md:grid-cols-2">
            <div className="relative min-h-0">{pane("left", left, true)}</div>
            <div className="relative min-h-0">{pane("right", right, true)}</div>
          </div>
        ) : (
          // Swipe is the same two panes stacked, with the right one clipped.
          // They are already locked to the same ground, so the divider reveals
          // the same coordinates on both sides of itself — which is the only
          // reason a swipe means anything.
          <div className="absolute inset-0">
            <div className="absolute inset-0">{pane("left", left, true)}</div>
            <div
              className="absolute inset-0"
              style={{ clipPath: `inset(0 0 0 ${swipePct}%)`, pointerEvents: "none" }}
            >
              {pane("right", right, false)}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Compare divider"
              onMouseDown={startSwipeDrag}
              onTouchStart={startSwipeDrag}
              className="absolute bottom-0 top-0 z-[600] w-0.5 -translate-x-1/2 cursor-ew-resize bg-cyan-400/90"
              style={{ left: `${swipePct}%` }}
            >
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-400/60 bg-[#111] shadow-lg">
                <ChevronsLeftRight className="h-3.5 w-3.5 text-cyan-300" />
              </div>
            </div>
          </div>
        )}

        <BasemapToggle
          value={basemap}
          onChange={(id) => { setBasemap(id); saveBasemap(id); }}
          className="absolute bottom-3 right-3 z-[700]"
        />
      </div>

      {/* Footer note */}
      <div className="flex shrink-0 items-center gap-1.5 border-t border-[#1f1f1f] bg-[#111] px-4 py-1.5 text-[10px] text-neutral-600">
        <Info className="h-3 w-3 shrink-0" />
        Both panes are locked to the same coordinates, so panning or zooming either moves both.
        Comparing is read-only, nothing here changes a scan, a prescription or a plan.
      </div>
    </div>
  );
}
