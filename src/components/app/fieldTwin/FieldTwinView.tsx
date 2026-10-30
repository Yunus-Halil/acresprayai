// The Field Twin viewer: the map, the detail dial (Simple, Standard, Full), the Explore Findings control, a
// compact layer panel (Standard and Full), a status strip with the pressure legend, the docked inspector or results
// panel, and an expandable diagnostics section (Full only: technical layers, draw timing, the developer-only
// reference imagery). The twin itself comes from the shell (account, files, or the dev server).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { NO_OPERATIONAL_BOUNDARY, type OperationalBoundaryState, operationalBoundary, validRing } from "@/lib/fieldTwin/boundary";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea } from "@/lib/units";
import { FindingsEngine, type FindingsQuery, type FindingsResult } from "@/lib/fieldTwin/findings";
import { HEAT_STOPS, heatScaleFor } from "@/lib/fieldTwin/heatmap";
import { fieldIntelligence } from "@/lib/fieldTwin/intelligence";
import { type Detail, buildScene, zoomForSize } from "@/lib/fieldTwin/scene";
import { DEFAULT_LAYERS, DETAIL_LABEL, DETAIL_PRESETS, DETAIL_STOPS, TWIN_COLOURS, type TwinDetail, type TwinDetailStop, type TwinLayers, detailOf } from "@/lib/fieldTwin/style";
import type { LatLngPair, TwinBundle } from "@/lib/fieldTwin/types";
import { FindingsControl, FindingsPanel } from "./FindingsPanel";
import type { DrawStats, TwinPick } from "./TwinCanvasLayer";
import TwinInspector from "./TwinInspector";
import TwinMap, { type ReferenceImagery, type TwinMapHandle } from "./TwinMap";

export type ReferenceOption = { id: string; label: string; url: string; maxNativeZoom: number; note: string };

export type DevApi = {
  map: L.Map; setView: (lat: number, lng: number, zoom: number) => void; setLayers: (patch: Partial<TwinLayers>) => void; setDetail: (stop: TwinDetailStop) => void; select: (p: TwinPick) => void;
  stats: () => DrawStats; detail: () => Detail | null; scene: ReturnType<typeof buildScene>; ready: true;
  /** What a click at this place would pick at the current zoom (the screenshot script checks the pick order). */
  pick: (lat: number, lng: number) => TwinPick;
  /** Run a findings query (null returns to the overview); answers with the counts for the benchmark. */
  setFindings: (q: FindingsQuery | null) => { qualifying: number; emphasized: number; rule: string };
  /** The boundaries as the page holds them: the bundle's inferred record, the operator's correction and acceptance, the block in use. */
  boundary: () => { inferred: TwinBundle["boundary"]; corrected: LatLngPair[] | null; operational: OperationalBoundaryState; blockSource: string | null; blockHa: number | null };
};
declare global { interface Window { __fieldTwin?: DevApi } }

type Props = {
  twin: TwinBundle;
  atlasUrl: (index: number) => Promise<string>;
  /** Scans the account holds whose tiles can be shown as reference imagery (developer diagnostics only). */
  referenceOptions?: ReferenceOption[];
  /** Expose the map to window.__fieldTwin (development builds, for the screenshot and benchmark script). */
  expose?: boolean;
  /** The detail stop to open at, instead of the remembered one (the dev preview's ?detail=). */
  detail?: TwinDetailStop;
};

const DETAIL_KEY = "swathwise:twin-detail";
const BOUNDARY_KEY = (id: string) => `swathwise:twin-boundary:${id}`;
const KEY_OPEN_KEY = "swathwise:twin-key";

/** The operator's boundary state for a twin: a corrected ring and whether it (or the inferred one) was accepted for operations. */
type BoundaryState = { corrected: LatLngPair[] | null; operational: OperationalBoundaryState };
const NO_BOUNDARY_STATE: BoundaryState = { corrected: null, operational: NO_OPERATIONAL_BOUNDARY };
function rememberedBoundary(id: string): BoundaryState {
  try {
    const raw = localStorage.getItem(BOUNDARY_KEY(id));
    if (!raw) return NO_BOUNDARY_STATE;
    const v = JSON.parse(raw) as Partial<BoundaryState>;
    const corrected = validRing(v.corrected) ? v.corrected : null;
    const op = v.operational;
    const operational: OperationalBoundaryState = op && validRing(op.ring) && (op.source === "accepted" || op.source === "corrected") ? { ring: op.ring, source: op.source, at: typeof op.at === "string" ? op.at : null } : NO_OPERATIONAL_BOUNDARY;
    return { corrected, operational };
  } catch { return NO_BOUNDARY_STATE; }
}
const DETAIL_HINT: Record<TwinDetail, string> = {
  simple: "Where the problems are: pressure, the regions and findings that stand apart, every outline up close.",
  standard: "Plus the crop structure and where candidates stand together.",
  full: "Everything measured, a marker for every finding, diagnostics.",
  custom: "Layers set by hand. Pick a stop to reset them.",
};

function rememberedDetail(): TwinDetailStop {
  try { const v = localStorage.getItem(DETAIL_KEY); if (v && (DETAIL_STOPS as string[]).includes(v)) return v as TwinDetailStop; } catch { /* private window, blocked storage */ }
  return "simple";
}

const LEVEL_TEXT: Record<Detail["level"], string> = {
  field: "Weed pressure over the observable ground, the regions that matter most, the rows. Zoom in for trees and weed patches.",
  row: "Trees at their measured crowns and patches where candidates stand together. Zoom in for every outline.",
  plant: "Every weed candidate and crown as measured in the photographs. Click one to inspect it.",
};
const LEVEL_NAME: Record<Detail["level"], string> = { field: "Field", row: "Rows", plant: "Plants" };

const panel = "rounded-md border border-[#343834] bg-[#171a17]";
const OVERVIEW: FindingsQuery = { mode: "overview" };

/** Runs fn and records its duration as a performance measure (read by the open-a-twin benchmark). */
function measured<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  const v = fn();
  try { performance.measure(name, { start: t0, end: performance.now() }); } catch { /* older browsers */ }
  return v;
}

export default function FieldTwinView({ twin, atlasUrl, referenceOptions = [], expose = false, detail: detailProp }: Props) {
  const units = useUnitSystem();
  const [boundary, setBoundaryState] = useState<BoundaryState>(() => rememberedBoundary(twin.id));
  const [editing, setEditing] = useState<LatLngPair[] | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const setBoundary = useCallback((next: BoundaryState) => { setBoundaryState(next); try { localStorage.setItem(BOUNDARY_KEY(twin.id), JSON.stringify(next)); } catch { /* storage blocked */ } }, [twin.id]);
  const intel = useMemo(() => measured("twin:intelligence", () => fieldIntelligence(twin, 4, boundary.corrected)), [twin, boundary.corrected]);
  const scene = useMemo(() => measured("twin:scene", () => buildScene(twin, intel)), [twin, intel]);
  const engine = useMemo(() => new FindingsEngine(twin, intel), [twin, intel]);
  const [layers, setLayers] = useState<TwinLayers>(() => DETAIL_PRESETS[detailProp ?? rememberedDetail()] ?? DEFAULT_LAYERS);
  const detailStop = detailOf(layers);
  /** A stop on the dial: the preset's layers, remembered for next time. */
  const chooseDetail = useCallback((stop: TwinDetailStop) => { setLayers(DETAIL_PRESETS[stop]); setPanelOpen(stop === "full"); try { localStorage.setItem(DETAIL_KEY, stop); } catch { /* storage blocked */ } }, []);
  const [selection, setSelection] = useState<TwinPick>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [stats, setStats] = useState<DrawStats | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(true);
  // The key (status strip and legend) can be closed; the choice is remembered in the browser.
  const [keyOpen, setKeyOpenState] = useState<boolean>(() => { try { return localStorage.getItem(KEY_OPEN_KEY) !== "closed"; } catch { return true; } });
  const setKeyOpen = (open: boolean) => { setKeyOpenState(open); try { localStorage.setItem(KEY_OPEN_KEY, open ? "open" : "closed"); } catch { /* storage blocked */ } };
  const [query, setQuery] = useState<FindingsQuery>(OVERVIEW);
  const [refId, setRefId] = useState<string>("");
  const [refOpacity, setRefOpacity] = useState(0.7);
  const [refSwipe, setRefSwipe] = useState<number | null>(null);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);
  const handle = useRef<TwinMapHandle | null>(null);

  // The findings for the current query: computed once per query, cached by the engine where it can.
  const result = useMemo<FindingsResult>(() => engine.run(query), [engine, query]);
  const findings = layers.zones ? result : null;
  const resultsOpen = query.mode !== "overview";

  const refOption = referenceOptions.find(o => o.id === refId) ?? null;
  const reference = useMemo<ReferenceImagery | null>(() => (refOption ? { url: refOption.url, maxNativeZoom: refOption.maxNativeZoom, opacity: refOpacity, swipe: refSwipe } : null), [refOption, refOpacity, refSwipe]);
  const effectiveLayers = useMemo<TwinLayers>(() => ({ ...layers, ground: !reference }), [layers, reference]);
  const offEarth = twin.source.placement === "matched";

  const zoomTo = useCallback((lat: number, lng: number, metresAcross: number) => {
    const h = handle.current;
    if (!h) return;
    const px = Math.min(h.map.getSize().x, h.map.getSize().y) * 0.8;
    h.map.flyTo([lat, lng], Math.min(26, zoomForSize(metresAcross, px, twin.origin.lat)), { duration: 0.6 });
  }, [twin.origin.lat]);

  /** A result chosen in the panel: zoom to the real object and highlight it. */
  const selectFinding = useCallback((index: number) => {
    const f = result.findings[index];
    if (!f) return;
    setSelection(f.kind === "weed" ? { kind: "weed", id: f.id } : { kind: "finding", index });
    zoomTo(f.lat, f.lng, f.kind === "weed" ? Math.max(2, f.reachM * 8) : f.kind === "patch" ? Math.max(3, f.reachM * 2.6) : Math.sqrt(f.affectedM2 ?? 100) * 1.6);
  }, [result, zoomTo]);

  const selectedIndex = useMemo(() => {
    if (!selection) return -1;
    if (selection.kind === "finding") return selection.index;
    if (selection.kind === "weed") return result.findings.findIndex(f => f.kind === "weed" && f.id === selection.id);
    return -1;
  }, [selection, result]);

  useEffect(() => {
    if (!expose) return;
    const h = handle.current;
    if (!h) return;
    window.__fieldTwin = {
      map: h.map, setView: (lat, lng, zoom) => { h.map.setView([lat, lng], zoom, { animate: false }); }, setLayers: patch => setLayers(l => ({ ...l, ...patch })), setDetail: chooseDetail,
      select: p => setSelection(p), stats: () => h.layer.stats, detail: () => h.layer.detailNow(), scene, ready: true,
      pick: (lat, lng) => h.layer.pickAt(h.map.latLngToLayerPoint([lat, lng])),
      setFindings: q => { const nq = q ?? OVERVIEW; const r = engine.run(nq); setQuery(nq); return { qualifying: r.findings.length, emphasized: r.prominence.count, rule: r.prominence.rule }; },
      boundary: () => ({ inferred: twin.boundary ?? null, corrected: boundary.corrected, operational: boundary.operational, blockSource: intel.blockSource, blockHa: intel.summary.blockHa }),
    };
    return () => { delete window.__fieldTwin; };
  }, [expose, scene, stats, engine, chooseDetail, twin, boundary, intel]);

  // The boundary in use as latitude/longitude: the correction, else the inferred ring, else the rows' block.
  const currentRing = useMemo<LatLngPair[] | null>(() => {
    if (boundary.corrected) return boundary.corrected;
    if (twin.boundary?.cultivated.ring) return twin.boundary.cultivated.ring;
    return intel.block ? intel.block.map(([e, n]) => intel.frame.toLatLng(e, n)) : null;
  }, [boundary.corrected, twin.boundary, intel]);
  const operationalRing = operationalBoundary(boundary.operational);
  const startEditing = () => { setSelection(null); setEditing(currentRing); };
  const finishEditing = () => { if (editing) setBoundary({ corrected: editing, operational: boundary.operational.ring ? { ...boundary.operational, ring: editing, source: "corrected", at: new Date().toISOString() } : boundary.operational }); setEditing(null); };
  const resetBoundary = () => { setEditing(null); setBoundary({ corrected: null, operational: NO_OPERATIONAL_BOUNDARY }); };
  const acceptBoundary = () => { if (currentRing) setBoundary({ ...boundary, operational: { ring: currentRing, source: boundary.corrected ? "corrected" : "accepted", at: new Date().toISOString() } }); };
  const withdrawBoundary = () => setBoundary({ ...boundary, operational: NO_OPERATIONAL_BOUNDARY });
  const inferred = twin.boundary?.cultivated ?? null;

  type BoolLayer = { [K in keyof TwinLayers]: TwinLayers[K] extends boolean ? K : never }[keyof TwinLayers];
  const toggle = (k: BoolLayer, label: string, swatch: string, hint?: string) => (
    <label key={k} className="flex items-start gap-2 py-1 text-xs text-neutral-200 cursor-pointer">
      <input type="checkbox" className="mt-0.5 accent-[#f0a63a]" checked={layers[k]} onChange={e => setLayers(l => ({ ...l, [k]: e.target.checked }))} />
      <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: swatch }} />
      <span>{label}{hint ? <span className="block text-[10px] leading-snug text-neutral-500">{hint}</span> : null}</span>
    </label>
  );
  const s = intel.summary;
  // Counted once per twin: a render happens on every move end, and a million candidates are not re-walked for it.
  const counts = useMemo(() => ({ verified: twin.weeds.filter(w => w.status === "verified").length, single: twin.weeds.filter(w => w.status === "single view").length, onTree: twin.weeds.filter(w => w.status === "on a tree").length, rows: twin.rows.filter(r => r.kept).length }), [twin]);
  const canopyCells = useMemo(() => intel.grid.cells.filter(c => c.canopy).length, [intel]);
  const heatScale = useMemo(() => heatScaleFor(intel, layers.heatScale), [intel, layers.heatScale]);
  const pctText = (v: number) => (v === 0 ? "0" : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const dockOpen = !!selection || resultsOpen;
  const full = detailStop === "full" || detailStop === "custom", simple = detailStop === "simple";
  const swatch = (rgb: [number, number, number], a: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(1, a + 0.15)})`;

  return (
    <div className="twin-root relative h-full w-full min-h-0 overflow-hidden" style={{ background: TWIN_COLOURS.outside, ["--twin-right" as string]: dockOpen ? "368px" : "0px" }}>
      <style>{`.twin-root .leaflet-top.leaflet-right, .twin-root .leaflet-bottom.leaflet-right { right: var(--twin-right, 0); transition: right .15s ease; } .twin-root .leaflet-control-scale-line { background: rgba(24,26,24,.85); color: #d9ddd6; border-color: #8a8f88; } .twin-root .leaflet-control-attribution { background: rgba(24,26,24,.85); color: #9aa09a; }`}</style>
      <TwinMap scene={scene} layers={effectiveLayers} selection={selection} units={units} onPick={setSelection} onDetail={setDetail} onStats={setStats}
        onMove={c => setCentre(c)} onReady={h => { handle.current = h; setStats(h.layer.stats); }} reference={reference} onSwipe={setRefSwipe} findings={findings}
        operational={operationalRing} editing={editing} onBoundaryEdit={setEditing} offEarth={offEarth} />
      {offEarth && (
        <div className={`absolute left-1/2 top-3 z-[700] max-w-[420px] -translate-x-1/2 px-3 py-1.5 text-[11px] leading-snug text-amber-200 ${panel}`} role="note">
          Test twin, no GPS: the photographs were placed by matching them to each other and scaled from the row spacing. It is not on the map: north and the place are unknown.
        </div>
      )}

      {/* Left column: the detail dial, Explore Findings, then the layers (Standard and Full). */}
      <div className="absolute left-3 top-3 z-[700] flex max-h-[calc(100%-120px)] flex-col gap-2 overflow-y-auto">
        <div className={`w-[272px] px-3 py-2 ${panel}`} role="group" aria-label="Detail">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-100">Detail</span>
            {detailStop === "custom" && <span className="text-[10px] text-neutral-400">{DETAIL_LABEL.custom}</span>}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-0.5 rounded-sm border border-[#3a3f3a] bg-[#111311] p-0.5">
            {DETAIL_STOPS.map(stop => (
              <button key={stop} type="button" onClick={() => chooseDetail(stop)} aria-pressed={detailStop === stop}
                className={`rounded-[2px] px-1 py-1 text-[11px] ${detailStop === stop ? "bg-[#f0a63a] font-semibold text-[#171a18]" : "text-neutral-300 hover:bg-[#262a26] hover:text-neutral-100"}`}>{DETAIL_LABEL[stop]}</button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-neutral-500">{DETAIL_HINT[detailStop]}</p>
        </div>
        <FindingsControl query={query} onChange={q => { setQuery(q); setSelection(null); }} result={result} open={findOpen} onToggle={() => setFindOpen(o => !o)} compact={simple} />
        {/* The field boundary: inferred from the rows and the photographs, correctable, never an operational limit until accepted. */}
        <div className={`w-[272px] px-3 py-2 text-xs ${panel}`} role="group" aria-label="Field boundary">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-100">Field boundary</span>
            {s.blockHa != null && <span className="text-[11px] text-neutral-300 tabular-nums">{fmtArea(s.blockHa * 10_000, units).text}</span>}
          </div>
          {editing ? (
            <>
              <p className="mt-1 text-[10px] leading-snug text-neutral-400">Drag a corner to move it. Drag an edge's small handle to add a corner. Double-click a corner to remove it.</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button type="button" className="rounded-sm bg-[#f0a63a] px-2 py-1 text-[11px] font-semibold text-[#171a18]" onClick={finishEditing}>Done</button>
                <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                {boundary.corrected ? "Corrected by you. " : ""}
                {inferred ? `Inferred from ${inferred.rowsUsed.length} rows and the photographs${inferred.uncertaintyM2 ? `, plausible range ${fmtArea(Math.max(0, inferred.areaM2 - inferred.uncertaintyM2), units).text} to ${fmtArea(inferred.areaM2 + inferred.uncertaintyM2, units).text}` : ""}. Edges: ${Math.round(100 * inferred.stats.support.photographs)} % seen in the photographs${inferred.stats.support.bridged ? `, ${Math.round(100 * inferred.stats.support.bridged)} % bridged between seen pieces` : ""}${inferred.stats.support.cap ? `, ${Math.round(100 * inferred.stats.support.cap)} % at the cap` : ""}${inferred.stats.support.coverage ? `, ${Math.round(100 * inferred.stats.support.coverage)} % at the end of the photographs` : ""}.`
                  : intel.blockSource === "rows" ? "From the rows' own geometry, half a spacing beyond them. No photographs were read for the edges." : "No boundary: the twin has no reliable row."}
              </p>
              {inferred?.confidence && !boundary.corrected && (
                <p className={`mt-1 text-[10px] leading-snug ${inferred.confidence.level === "high" ? "text-neutral-400" : "text-amber-300/90"}`}>
                  {inferred.confidence.level === "high"
                    ? `Confidence ${Math.round(100 * inferred.confidence.overall)} %: inferred.`
                    : inferred.confidence.level === "medium"
                      ? `Confidence ${Math.round(100 * inferred.confidence.overall)} %: review the boundary. The dashed and dotted edges are the ones to check; Adjust moves a corner.`
                      : `Confidence ${Math.round(100 * inferred.confidence.overall)} %: low. Check the edges against the photographs before relying on this block; Adjust moves a corner.`}
                </p>
              )}
              {inferred && inferred.failures.length > 0 && (
                <button type="button" className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-200" onClick={() => setNotesOpen(o => !o)} aria-expanded={notesOpen}>
                  {notesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{inferred.failures.length} note{inferred.failures.length > 1 ? "s" : ""} on what could not be settled
                </button>
              )}
              {inferred && notesOpen && <ul className="mt-1 space-y-1 border-l border-[#2e322e] pl-2 text-[10px] leading-snug text-neutral-400">{inferred.failures.map(f => <li key={f}>{f}</li>)}</ul>}
              {operationalRing ? (
                <p className="mt-1 text-[10px] leading-snug text-emerald-300/90">{boundary.operational.source === "corrected" ? "Corrected and accepted" : "Accepted"} by you{boundary.operational.at ? ` on ${new Date(boundary.operational.at).toLocaleDateString()}` : ""} as the operational boundary.</p>
              ) : (
                <p className="mt-1 text-[10px] leading-snug text-neutral-500">Not an operational limit: an inferred boundary is never used to limit an operation until you accept it.</p>
              )}
              {currentRing && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={startEditing}>Adjust</button>
                  {operationalRing ? <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={withdrawBoundary}>Withdraw acceptance</button>
                    : <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={acceptBoundary}>Accept for operations</button>}
                  {(boundary.corrected || operationalRing) && <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-400 hover:bg-[#262a26]" onClick={resetBoundary}>Reset to inferred</button>}
                </div>
              )}
            </>
          )}
        </div>
        {!simple && <div className={`w-[272px] text-sm ${panel}`}>
          <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-neutral-100" onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen}>
            <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" />Layers</span>{panelOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {panelOpen && (
            <div className="border-t border-[#2e322e] px-3 py-2">
              {toggle("pressure", "Weed pressure", swatch(HEAT_STOPS[2].rgb, HEAT_STOPS[2].alpha), `verified cover, % of observable ground, per ${intel.grid.cellM} m`)}
              <label className="mb-1 block text-[11px] text-neutral-400">Pressure colours
                <select value={layers.heatScale} onChange={e => setLayers(l => ({ ...l, heatScale: e.target.value as TwinLayers["heatScale"] }))} className="mt-0.5 w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-1.5 py-1 text-xs text-neutral-100" aria-label="Pressure colours">
                  <option value="field">Spread over this field (its worst spots red)</option>
                  <option value="fixed">Fixed bands, the same on every field</option>
                </select>
              </label>
              {toggle("boundary", "Field boundary", TWIN_COLOURS.boundaryPhotographs, intel.blockSource === "inferred" ? "solid where the photographs showed the edge, dashed where bridged, dotted at a cap or the end of the photographs" : intel.blockSource === "corrected" ? "as you corrected it" : "the rows' own geometry")}
              {toggle("beyondBoundary", "Pressure beyond the boundary", "#4a5a4a", `${s.verifiedOutsideBlock.toLocaleString()} verified candidates outside the block are kept as observations`)}
              {toggle("zones", "Findings", TWIN_COLOURS.region, `${intel.zones.length} regions at 1.5 % cover or more inside the block; patches and weeds by filter`)}
              {toggle("structure", "Crop rows", TWIN_COLOURS.row, `${counts.rows} rows`)}
              {toggle("crowns", "Tree crowns", TWIN_COLOURS.tree, `${twin.trees.length.toLocaleString()} trees; always drawn at the plant level`)}
              {toggle("weeds", "Weed candidates", TWIN_COLOURS.weed, `${counts.verified.toLocaleString()} seen in 2+ photographs, every outline at the plant level`)}
              {toggle("clusters", "Weed groups", TWIN_COLOURS.weed, "soft discs where candidates stand together, at the row level")}
              <label className="mt-1 block text-[11px] text-neutral-400">Finding markers
                <select value={layers.markers} onChange={e => setLayers(l => ({ ...l, markers: e.target.value as TwinLayers["markers"] }))} className="mt-0.5 w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-1.5 py-1 text-xs text-neutral-100" aria-label="Finding markers">
                  <option value="emphasised">Emphasised findings only</option>
                  <option value="summary">Plus counts where they are not drawn as themselves</option>
                  <option value="all">Every qualifying finding, counts everywhere</option>
                </select>
              </label>
              {toggle("vegetation", "Other vegetation", TWIN_COLOURS.vegetation, `${twin.vegetation.length} patches, unclassed`)}
              {toggle("uncertainty", "Uncertainty", "#8c949f", `${s.cellsSingleCoverage} cells one photograph saw`)}
              {toggle("coverage", "Photo coverage", TWIN_COLOURS.imageryEdge, "the ground the photographs looked at")}
              {!offEarth && toggle("surroundings", "Surroundings", "#4a4f4a", "roads and places, OpenStreetMap data")}
              {full && <button type="button" className="mt-2 flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setDiagOpen(o => !o)} aria-expanded={diagOpen}>
                {diagOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Diagnostics
              </button>}
              {full && diagOpen && (
                <div className="mt-1 border-l border-[#2e322e] pl-2">
                  {toggle("singleView", "Single-sighting candidates", TWIN_COLOURS.weedSingle, `${counts.single.toLocaleString()}, dashed`)}
                  {toggle("onTree", "Detections on tree crowns", TWIN_COLOURS.weedOnTree, `${counts.onTree.toLocaleString()}, kept apart from weeds`)}
                  {toggle("inferred", "Inferred tree positions", TWIN_COLOURS.tree, `${twin.inferredTrees.length}, dashed, from the planting pattern`)}
                  {toggle("droppedRows", "Row candidates not kept", TWIN_COLOURS.rowDropped, `${twin.rows.length - counts.rows}`)}
                  {toggle("footprints", "Photo footprints", TWIN_COLOURS.footprint, `${twin.footprints.length}`)}
                  {scene.evidence && toggle("evidence", "Boundary evidence", TWIN_COLOURS.evidence.cover, `what the photographs showed per ${scene.evidence.cellM} m: soil brown, canopy green, cover yellow, road grey, trees off the rows purple`)}
                  {referenceOptions.length > 0 && (
                    <div className="mt-2 text-xs text-neutral-200">
                      <label className="block text-[11px] text-neutral-400" htmlFor="twin-ref">Reference Orthomosaic</label>
                      <select id="twin-ref" value={refId} onChange={e => setRefId(e.target.value)} className="mt-0.5 w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-1.5 py-1 text-xs text-neutral-100">
                        <option value="">Off</option>
                        {referenceOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      {refOption && (
                        <div className="mt-1.5 space-y-1.5">
                          <label className="flex items-center gap-2 text-[11px] text-neutral-400">Opacity<input type="range" min={0} max={100} value={Math.round(refOpacity * 100)} onChange={e => setRefOpacity(Number(e.target.value) / 100)} className="flex-1" aria-label="Reference imagery opacity" /><span className="w-8 text-right">{Math.round(refOpacity * 100)} %</span></label>
                          <label className="flex items-center gap-2 text-[11px] text-neutral-400"><input type="checkbox" checked={refSwipe != null} onChange={e => setRefSwipe(e.target.checked ? 0.5 : null)} />Swipe comparison (imagery left of the divider)</label>
                          <p className="text-[10px] leading-snug text-amber-300/90">{refOption.note}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {stats && (
                    <p className="mt-2 text-[10px] text-neutral-500">Last draw {stats.lastDrawMs.toFixed(1)} ms: {Object.entries(stats.drawn).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"}. {detail ? `Weed ${detail.px.weed.toFixed(1)} px, crown ${detail.px.crown.toFixed(0)} px, cell ${detail.px.cell.toFixed(0)} px.` : ""} {stats.labels.binLevel != null ? `Marker bins at zoom ${stats.labels.binLevel}.` : ""}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>}
      </div>

      {/* Status strip and legend, bottom left: what this zoom shows, what the colours mean. Closable; a small "Key" pill brings it back. */}
      {!keyOpen && (
        <button type="button" className={`absolute bottom-3 left-3 z-[700] px-2.5 py-1 text-[11px] text-neutral-300 hover:text-neutral-100 ${panel}`} onClick={() => setKeyOpen(true)} aria-label="Show the key">
          <span className="font-semibold">{detail ? LEVEL_NAME[detail.level] : "Field Twin"}</span><span className="text-neutral-500"> · key</span>
        </button>
      )}
      {keyOpen && <div className={`absolute bottom-3 left-3 z-[700] max-w-[420px] px-3 py-2 text-[11px] text-neutral-300 ${panel}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs"><span className="font-semibold text-neutral-100">{detail ? LEVEL_NAME[detail.level] : "Field Twin"}</span><span className="text-neutral-500"> · {twin.name}</span></p>
          <button type="button" className="-mr-1 -mt-0.5 rounded-sm px-1 text-[13px] leading-none text-neutral-500 hover:bg-[#262a26] hover:text-neutral-200" onClick={() => setKeyOpen(false)} aria-label="Close the key" title="Close the key">×</button>
        </div>
        <p className="mt-0.5 text-neutral-400">{detail ? LEVEL_TEXT[detail.level] : "Built from the original photographs, no orthomosaic."}</p>
        {twin.stats.weedTier === "colour" && <p className="mt-0.5 text-amber-300/90">Weeds by colour rules, not a model: green against the soil around it, crowns left out, strips split at their plants. Yellowing plants and plants under 4 cm are missed; a green shoot at a crown's edge can be counted.</p>}
        {twin.stats.weedTier === "none" && <p className="mt-0.5 text-neutral-500">No weed pass ran on this twin.</p>}
        {layers.pressure && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400" aria-label="Weed pressure legend">
            <span className="text-neutral-500">Cover of observable ground:</span>
            {HEAT_STOPS.map((st, i) => <span key={st.pct} className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: swatch(st.rgb, st.alpha) }} />{pctText(heatScale.stops[i])} %{i === HEAT_STOPS.length - 1 ? "+" : ""}</span>)}
            {heatScale.stretched && <span className="text-neutral-500" title="This field's cover runs above the fixed bands, so the colours are spread over its own range: the median of the block's observed ground is the first raised stop, its worst 1 % the last. The numbers are real cover.">bands set by this field</span>}
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: "rgba(96,122,98,0.6)" }} />under canopy{canopyCells ? ` (${canopyCells} cells)` : ""}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-sm border border-[#3a3f3a]" style={{ background: `repeating-linear-gradient(135deg, ${TWIN_COLOURS.hatch} 0 1px, ${TWIN_COLOURS.imagery} 1px 4px)` }} />not observed</span>
          </div>
        )}
        {detail?.level === "field" && !simple && <p className="mt-0.5 text-neutral-500">{s.blockHa != null ? `Cultivated block ${fmtArea(s.blockHa * 10_000, units).text} (${intel.blockSource === "corrected" ? "corrected by you" : intel.blockSource === "inferred" ? "inferred from the photographs" : "from the rows"}); ` : ""}{intel.zones.length} regions at 1.5 % cover or more, {result.query.mode === "overview" ? `${result.prominence.count} emphasised` : `${result.findings.length} findings listed`}.</p>}
        {full && <p className="mt-0.5 text-neutral-500 tabular-nums">Centre {(centre ?? twin.origin).lat.toFixed(6)}, {(centre ?? twin.origin).lng.toFixed(6)} · north up</p>}
        {reference && <p className="mt-0.5 text-amber-300/90">Reference imagery on (diagnostics): display only, it never moves the twin's objects.</p>}
      </div>}

      {/* Right dock: the inspector for a selected object, else the results panel for an active filter. */}
      {selection ? (
        <aside className={`absolute right-3 top-3 bottom-3 z-[700] w-[356px] overflow-y-auto p-3.5 text-sm ${panel}`} aria-label="Inspector">
          {resultsOpen && <button type="button" className="mb-2 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setSelection(null)}>← Back to the {result.findings.length.toLocaleString()} results</button>}
          <TwinInspector twin={twin} scene={scene} selection={selection} atlasUrl={atlasUrl} onClose={() => setSelection(null)} onZoomTo={zoomTo} findings={result} onSelectWeed={id => { const w = twin.weeds.find(x => x.id === id); if (w) { setSelection({ kind: "weed", id }); zoomTo(w.lat, w.lng, Math.max(2, w.diameterM * 8)); } }} />
        </aside>
      ) : resultsOpen ? (
        <aside className={`absolute right-3 top-3 bottom-3 z-[700] w-[356px] p-3.5 text-sm ${panel}`} aria-label="Findings results">
          <FindingsPanel result={result} units={units} selectedIndex={selectedIndex} onSelect={selectFinding} onClose={() => setQuery(OVERVIEW)} labels={stats ? { placed: stats.labels.placed, emphasized: stats.labels.emphasized } : null} />
        </aside>
      ) : null}
    </div>
  );
}
