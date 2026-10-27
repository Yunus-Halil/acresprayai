// The Field Twin viewer: the map, a compact layer panel, a status strip that says what the view shows, the docked
// inspector, and an expandable diagnostics section (technical layers, draw timing, the developer-only reference
// imagery). The twin itself comes from the shell (account, files, or the dev server).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea } from "@/lib/units";
import { fieldIntelligence } from "@/lib/fieldTwin/intelligence";
import { type Detail, buildScene, zoomForSize } from "@/lib/fieldTwin/scene";
import { DEFAULT_LAYERS, TWIN_COLOURS, type TwinLayers } from "@/lib/fieldTwin/style";
import type { TwinBundle } from "@/lib/fieldTwin/types";
import type { DrawStats, TwinPick } from "./TwinCanvasLayer";
import TwinInspector from "./TwinInspector";
import TwinMap, { type ReferenceImagery, type TwinMapHandle } from "./TwinMap";

export type ReferenceOption = { id: string; label: string; url: string; maxNativeZoom: number; note: string };

export type DevApi = {
  map: L.Map; setView: (lat: number, lng: number, zoom: number) => void; setLayers: (patch: Partial<TwinLayers>) => void; select: (p: TwinPick) => void;
  stats: () => DrawStats; detail: () => Detail | null; scene: ReturnType<typeof buildScene>; ready: true;
};
declare global { interface Window { __fieldTwin?: DevApi } }

type Props = {
  twin: TwinBundle;
  atlasUrl: (index: number) => Promise<string>;
  /** Scans the account holds whose tiles can be shown as reference imagery (developer diagnostics only). */
  referenceOptions?: ReferenceOption[];
  /** Expose the map to window.__fieldTwin (development builds, for the screenshot and benchmark script). */
  expose?: boolean;
};

const LEVEL_TEXT: Record<Detail["level"], string> = {
  field: "Rows, the orchard block, weed pressure and the scouting zones. Zoom in for trees and weed patches.",
  row: "Trees at their measured crowns and patches where candidates stand together. Zoom in for every outline.",
  plant: "Every weed candidate and crown as measured in the photographs. Click one to inspect it.",
};
const LEVEL_NAME: Record<Detail["level"], string> = { field: "Field", row: "Rows", plant: "Plants" };

const panel = "rounded-md border border-[#343834] bg-[#171a17]";

export default function FieldTwinView({ twin, atlasUrl, referenceOptions = [], expose = false }: Props) {
  const units = useUnitSystem();
  const intel = useMemo(() => fieldIntelligence(twin), [twin]);
  const scene = useMemo(() => buildScene(twin, intel), [twin, intel]);
  const [layers, setLayers] = useState<TwinLayers>(DEFAULT_LAYERS);
  const [selection, setSelection] = useState<TwinPick>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [stats, setStats] = useState<DrawStats | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [refId, setRefId] = useState<string>("");
  const [refOpacity, setRefOpacity] = useState(0.7);
  const [refSwipe, setRefSwipe] = useState<number | null>(null);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);
  const handle = useRef<TwinMapHandle | null>(null);

  const refOption = referenceOptions.find(o => o.id === refId) ?? null;
  const reference = useMemo<ReferenceImagery | null>(() => (refOption ? { url: refOption.url, maxNativeZoom: refOption.maxNativeZoom, opacity: refOpacity, swipe: refSwipe } : null), [refOption, refOpacity, refSwipe]);
  const effectiveLayers = useMemo<TwinLayers>(() => ({ ...layers, ground: !reference }), [layers, reference]);

  const zoomTo = useCallback((lat: number, lng: number, metresAcross: number) => {
    const h = handle.current;
    if (!h) return;
    const px = Math.min(h.map.getSize().x, h.map.getSize().y) * 0.8;
    h.map.flyTo([lat, lng], Math.min(26, zoomForSize(metresAcross, px, twin.origin.lat)), { duration: 0.6 });
  }, [twin.origin.lat]);

  useEffect(() => {
    if (!expose) return;
    const h = handle.current;
    if (!h) return;
    window.__fieldTwin = {
      map: h.map, setView: (lat, lng, zoom) => h.map.setView([lat, lng], zoom, { animate: false }), setLayers: patch => setLayers(l => ({ ...l, ...patch })),
      select: p => setSelection(p), stats: () => h.layer.stats, detail: () => h.layer.detailNow(), scene, ready: true,
    };
    return () => { delete window.__fieldTwin; };
  }, [expose, scene, stats]);

  const toggle = (k: keyof TwinLayers, label: string, swatch: string, hint?: string) => (
    <label key={k} className="flex items-start gap-2 py-1 text-xs text-neutral-200 cursor-pointer">
      <input type="checkbox" className="mt-0.5 accent-[#c9a53a]" checked={layers[k]} onChange={e => setLayers(l => ({ ...l, [k]: e.target.checked }))} />
      <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: swatch }} />
      <span>{label}{hint ? <span className="block text-[10px] leading-snug text-neutral-500">{hint}</span> : null}</span>
    </label>
  );
  const s = intel.summary;
  const counts = { verified: twin.weeds.filter(w => w.status === "verified").length, single: twin.weeds.filter(w => w.status === "single view").length, onTree: twin.weeds.filter(w => w.status === "on a tree").length, rows: twin.rows.filter(r => r.kept).length };
  const priorityZones = intel.zones.filter(z => z.priority === 1).length;

  return (
    <div className="twin-root relative h-full w-full min-h-0 overflow-hidden" style={{ background: TWIN_COLOURS.outside, ["--twin-right" as string]: selection ? "368px" : "0px" }}>
      <style>{`.twin-root .leaflet-top.leaflet-right { right: var(--twin-right, 0); transition: right .15s ease; } .twin-root .leaflet-control-scale-line { background: rgba(24,26,24,.85); color: #d9ddd6; border-color: #8a8f88; } .twin-root .leaflet-control-attribution { background: rgba(24,26,24,.85); color: #9aa09a; }`}</style>
      <TwinMap scene={scene} layers={effectiveLayers} selection={selection} units={units} onPick={setSelection} onDetail={setDetail} onStats={setStats}
        onMove={c => setCentre(c)} onReady={h => { handle.current = h; setStats(h.layer.stats); }} reference={reference} onSwipe={setRefSwipe} />

      {/* Layer panel, top left. */}
      <div className={`absolute left-3 top-3 z-[700] w-[272px] text-sm ${panel}`}>
        <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-neutral-100" onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen}>
          <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" />Layers</span>{panelOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {panelOpen && (
          <div className="border-t border-[#2e322e] px-3 py-2">
            {toggle("structure", "Crop structure", TWIN_COLOURS.row, `${counts.rows} rows, ${twin.trees.length.toLocaleString()} trees`)}
            {toggle("weeds", "Weed candidates", TWIN_COLOURS.weed, `${counts.verified.toLocaleString()} seen in 2+ photographs`)}
            {toggle("pressure", "Weed pressure", TWIN_COLOURS.pressureWash, `% of ground covered, per ${intel.grid.cellM} m`)}
            {toggle("zones", "Scouting zones", TWIN_COLOURS.zoneFill[1], `${intel.zones.length} areas at 1.5 % cover or more, ${priorityZones} first priority`)}
            {toggle("vegetation", "Other vegetation", TWIN_COLOURS.vegetation, `${twin.vegetation.length} patches, unclassed`)}
            {toggle("uncertainty", "Uncertainty", "#8c949f", `${s.cellsSingleCoverage} cells one photograph saw`)}
            {toggle("coverage", "Photo coverage", TWIN_COLOURS.imageryEdge, "the ground the photographs looked at")}
            {toggle("surroundings", "Surroundings", "#4a4f4a", "roads and places, OpenStreetMap data")}
            <button type="button" className="mt-2 flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setDiagOpen(o => !o)} aria-expanded={diagOpen}>
              {diagOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Diagnostics
            </button>
            {diagOpen && (
              <div className="mt-1 border-l border-[#2e322e] pl-2">
                {toggle("singleView", "Single-sighting candidates", TWIN_COLOURS.weedSingle, `${counts.single.toLocaleString()}, dashed`)}
                {toggle("onTree", "Detections on tree crowns", TWIN_COLOURS.weedOnTree, `${counts.onTree.toLocaleString()}, kept apart from weeds`)}
                {toggle("inferred", "Inferred tree positions", TWIN_COLOURS.tree, `${twin.inferredTrees.length}, dashed, from the planting pattern`)}
                {toggle("droppedRows", "Row candidates not kept", TWIN_COLOURS.rowDropped, `${twin.rows.length - counts.rows}`)}
                {toggle("footprints", "Photo footprints", TWIN_COLOURS.footprint, `${twin.footprints.length}`)}
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
                  <p className="mt-2 text-[10px] text-neutral-500">Last draw {stats.lastDrawMs.toFixed(1)} ms: {Object.entries(stats.drawn).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing"}. {detail ? `Weed ${detail.px.weed.toFixed(1)} px, crown ${detail.px.crown.toFixed(0)} px, cell ${detail.px.cell.toFixed(0)} px.` : ""}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status strip, bottom left: what this zoom shows. */}
      <div className={`absolute bottom-3 left-3 z-[700] max-w-[400px] px-3 py-2 text-[11px] text-neutral-300 ${panel}`}>
        <p className="text-xs"><span className="font-semibold text-neutral-100">{detail ? LEVEL_NAME[detail.level] : "Field Twin"}</span><span className="text-neutral-500"> · {twin.name}</span></p>
        <p className="mt-0.5 text-neutral-400">{detail ? LEVEL_TEXT[detail.level] : "Built from the original photographs, no orthomosaic."}</p>
        {detail?.level === "field" && <p className="mt-0.5 text-neutral-500">{s.blockHa != null ? `Orchard block ${fmtArea(s.blockHa * 10_000, units).text}; ` : ""}{intel.zones.length} scouting zones, {priorityZones} first priority.</p>}
        <p className="mt-0.5 text-neutral-500 tabular-nums">Centre {(centre ?? twin.origin).lat.toFixed(6)}, {(centre ?? twin.origin).lng.toFixed(6)} · north up</p>
        {reference && <p className="mt-0.5 text-amber-300/90">Reference imagery on (diagnostics): display only, it never moves the twin's objects.</p>}
      </div>

      {/* Inspector, docked right. */}
      {selection && (
        <aside className={`absolute right-3 top-3 bottom-3 z-[700] w-[356px] overflow-y-auto p-3.5 text-sm ${panel}`} aria-label="Inspector">
          <TwinInspector twin={twin} scene={scene} selection={selection} atlasUrl={atlasUrl} onClose={() => setSelection(null)} onZoomTo={zoomTo} />
        </aside>
      )}
    </div>
  );
}
