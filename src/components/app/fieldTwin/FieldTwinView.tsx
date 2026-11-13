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
import { CornFieldPanel } from "./CornPanels";
import { isLocalTwin } from "@/lib/fieldTwin/cornView";
import TwinMap, { type ReferenceImagery, type TwinMapHandle } from "./TwinMap";
import ReviewBar, { reviewTargetOf } from "./ReviewBar";
import { type ReviewFocus, locateReviewed } from "./reviewFocus";
import { reviewKey, useTwinReviews } from "@/lib/fieldTwin/reviews";
import { FeedbackButton } from "@/components/pilot/FeedbackDialog";
import { type RowEdits, NO_ROW_EDITS, loadRowEdits, moveRowEnd, newUid, plantIndex, rowEndsNow, rowLineNow, rowModel, saveRowEdits, snapRow } from "@/lib/fieldTwin/rowEdits";
import { RowActionCard, RowEditPanel, RowUndoBar } from "./RowEditor";

const NARROW_PX = 820;
const narrowNow = () => typeof window !== "undefined" && window.innerWidth < NARROW_PX;
/** True below about a landscape tablet's width: the panels fold away and the inspector becomes a bottom sheet. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => {
    const on = () => setNarrow(narrowNow());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

/** Where the twin sits on the map, in words, from the placement the build recorded. */
export function placementText(twin: TwinBundle): string {
  const p = twin.source.placement;
  if (p?.kind === "local") return "A test flight placed by estimate: positions are relative to each other, not a place on the map.";
  if (p && /RTK fixed/i.test(p.note) && !/without RTK/i.test(p.note)) return "Positions from RTK: the twin should sit within a few centimetres of its true place.";
  return "Positions from the drone's GPS, without RTK: the whole twin may sit a metre or a few off satellite imagery. Distances within the field are much closer.";
}

const BOUNDARY_REVIEW = { kind: "boundary" as const, id: "cultivated" };

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
  /** The reference imagery to open with, by id, once it is among the options (the dev preview's local photographs). The viewer's own control switches it off. */
  initialReference?: string | null;
  /** Expose the map to window.__fieldTwin (development builds, for the screenshot and benchmark script). */
  expose?: boolean;
  /** The detail stop to open at, instead of the remembered one (the dev preview's ?detail=). */
  detail?: TwinDetailStop;
  /**
   * Who is looking. A pilot participant gets the Simple and Standard views without the diagnostics, the reference
   * imagery or the boundary's technical notes; the founder gets everything. Defaults to the founder so the dev
   * preview and the benchmark scripts see the full viewer.
   */
  audience?: "founder" | "participant";
  /**
   * Reviews: the twin's record id in the account (its findings can then be marked correct, not sure or wrong, and
   * the boundary decision is kept with them on the server), or null with the reason reviews are not possible yet.
   * Absent: no reviews (the founder's workbench and the dev preview), and the boundary stays in this browser.
   */
  review?: { twinId: string | null; disabledReason?: string | null };
  /**
   * A finding to open on: selected and brought into view once, when the map is ready (the founder's viewer, opened
   * from a review). Only a finding the saved twin holds under exactly this kind and id is selected (reviewFocus.ts);
   * otherwise nothing is, and `onFocus` is told so.
   */
  focus?: ReviewFocus | null;
  onFocus?: (found: { status: string } | null) => void;
  /** Corn twins: plants the photographs located, drawn up close and snapped to by the row editor. Defaults to the twin's own (twin.corn.plants); the dev preview passes its plants.json. */
  plants?: { points: LatLngPair[]; note: string; certainty?: number[] | null } | null;
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

function rememberedDetail(stops: TwinDetailStop[]): TwinDetailStop {
  try { const v = localStorage.getItem(DETAIL_KEY); if (v && (stops as string[]).includes(v)) return v as TwinDetailStop; } catch { /* private window, blocked storage */ }
  return "simple";
}
const PARTICIPANT_STOPS: TwinDetailStop[] = ["simple", "standard"];

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

export default function FieldTwinView({ twin, atlasUrl, referenceOptions: referenceProp = [], initialReference = null, expose = false, detail: detailProp, audience = "founder", review, focus = null, onFocus, plants: plantsOverride = null }: Props) {
  const units = useUnitSystem();
  // A corn twin built with the plants first carries its plants; the dev preview can lay its own plants.json over them.
  const plants = useMemo(() => plantsOverride ?? (twin.corn?.plants ? { points: twin.corn.plants.points, note: twin.corn.plants.note, certainty: twin.corn.plants.certainty } : null), [plantsOverride, twin.corn?.plants]);
  const founderView = audience === "founder";
  const stops = founderView ? DETAIL_STOPS : PARTICIPANT_STOPS;
  const referenceOptions = founderView ? referenceProp : [];
  const [boundary, setBoundaryState] = useState<BoundaryState>(() => rememberedBoundary(twin.id));
  const [editing, setEditing] = useState<LatLngPair[] | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const reviewing = !!review;
  const { reviews, save: saveReview, clear: clearReview, canSay } = useTwinReviews(review?.twinId ?? null);
  const boundaryReview = reviews?.get(reviewKey(BOUNDARY_REVIEW.kind, BOUNDARY_REVIEW.id)) ?? null;
  // With reviews, the operator's boundary correction lives on the server with the review (it follows them to
  // another device); without, in this browser as before.
  useEffect(() => {
    if (!reviewing || !reviews) return;
    const ring = (boundaryReview?.payload as { ring?: unknown } | null)?.ring;
    setBoundaryState({ corrected: validRing(ring) ? (ring as LatLngPair[]) : null, operational: NO_OPERATIONAL_BOUNDARY });
  }, [reviewing, reviews, boundaryReview]);
  const setBoundary = useCallback((next: BoundaryState) => {
    setBoundaryState(next);
    if (reviewing) return;
    try { localStorage.setItem(BOUNDARY_KEY(twin.id), JSON.stringify(next)); } catch { /* storage blocked */ }
  }, [twin.id, reviewing]);
  const intel = useMemo(() => measured("twin:intelligence", () => fieldIntelligence(twin, 4, boundary.corrected)), [twin, boundary.corrected]);
  const scene = useMemo(() => measured("twin:scene", () => buildScene(twin, intel)), [twin, intel]);
  const engine = useMemo(() => new FindingsEngine(twin, intel), [twin, intel]);
  const [layers, setLayers] = useState<TwinLayers>(() => DETAIL_PRESETS[detailProp && stops.includes(detailProp) ? detailProp : rememberedDetail(stops)] ?? DEFAULT_LAYERS);
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
  // Opened with a reference once, when it arrives; after that the choice is the viewer's.
  const openedWith = useRef(false);
  useEffect(() => { if (!openedWith.current && founderView && initialReference && referenceProp.some(o => o.id === initialReference)) { openedWith.current = true; setRefId(initialReference); } }, [initialReference, referenceProp, founderView]);
  const [refOpacity, setRefOpacity] = useState(0.7);
  const [refSwipe, setRefSwipe] = useState<number | null>(null);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);
  const handle = useRef<TwinMapHandle | null>(null);

  // The row editor (corn twins, founder for now): the operator's corrections, folded over the saved twin, on this device.
  const [rowEdits, setRowEditsState] = useState<RowEdits>(() => loadRowEdits(twin.id));
  useEffect(() => { setRowEditsState(loadRowEdits(twin.id)); }, [twin.id]);
  const [rowEditing, setRowEditing] = useState(false);
  const [hideRows, setHideRows] = useState(false);
  const [showPlants, setShowPlants] = useState(true);
  const [rowUndo, setRowUndo] = useState<{ edits: RowEdits; label: string }[]>([]);
  const [rowLast, setRowLast] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<string | null>(null);
  const commitRows = useCallback((next: RowEdits, label: string) => {
    setRowUndo(st => [...st, { edits: rowEdits, label }].slice(-100));
    setRowEditsState(next); setRowLast(label);
    setRowNote(saveRowEdits(twin.id, next) ? null : "Not saved: this browser blocks storage. The correction is on screen only.");
  }, [rowEdits, twin.id]);
  const undoRows = useCallback(() => {
    const top = rowUndo[rowUndo.length - 1];
    if (!top) return;
    setRowUndo(st => st.slice(0, -1)); setRowEditsState(top.edits); saveRowEdits(twin.id, top.edits);
    setRowLast(`Undone: ${top.label.toLowerCase()}`); setRowNote(null); setSelection(null);
  }, [rowUndo, twin.id]);
  const rowModelNow = useMemo(() => rowModel(twin, rowEdits), [twin, rowEdits]);
  const plantIdx = useMemo(() => (rowModelNow && plants ? plantIndex(rowModelNow, plants.points) : null), [rowModelNow, plants]);
  const rowHover = useMemo(() => (rowModelNow ? (lat: number, lng: number) => { const sn = snapRow(rowModelNow, lat, lng, plantIdx); return sn.kind === "new" ? sn.line : null; } : null), [rowModelNow, plantIdx]);
  // Twin rows whose ends the operator moved, drawn along their new course; the selected row's two end handles.
  const rowOverrides = useMemo(() => (rowModelNow ? Object.keys(rowEdits.ends).map(Number).filter(id => rowEdits.verdicts[String(id)] !== "remove").flatMap(id => { const line = rowLineNow(rowModelNow, id); return line ? [{ id, line }] : []; }) : []), [rowModelNow, rowEdits]);
  const selectedRowKey = selection?.kind === "cornRow" ? selection.id : selection?.kind === "addedRow" ? selection.uid : null;
  const rowHandles = useMemo(() => (rowEditing && rowModelNow && selectedRowKey != null ? rowEndsNow(rowModelNow, selectedRowKey) : null), [rowEditing, rowModelNow, selectedRowKey]);
  const rowEditsProp = useMemo(() => (twin.corn ? { edits: rowEdits, active: rowEditing, hideRows, hover: rowEditing ? rowHover : null, overrides: rowOverrides, handles: rowHandles } : null), [twin.corn, rowEdits, rowEditing, hideRows, rowHover, rowOverrides, rowHandles]);
  const plantsProp = useMemo(() => (plants ? { points: plants.points, show: showPlants, certainty: plants.certainty ?? null } : null), [plants, showPlants]);

  // The findings for the current query: computed once per query, cached by the engine where it can.
  const result = useMemo<FindingsResult>(() => engine.run(query), [engine, query]);
  const findings = layers.zones ? result : null;
  const resultsOpen = query.mode !== "overview";

  const refOption = referenceOptions.find(o => o.id === refId) ?? null;
  const reference = useMemo<ReferenceImagery | null>(() => (refOption ? { url: refOption.url, maxNativeZoom: refOption.maxNativeZoom, opacity: refOpacity, swipe: refSwipe } : null), [refOption, refOpacity, refSwipe]);
  const local = isLocalTwin(twin);
  const corn = !!twin.corn;
  // A corn twin has no orchard weed pass: no pressure heatmap or findings regions (they would read 0 % everywhere).
  const effectiveLayers = useMemo<TwinLayers>(() => ({ ...layers, ground: !reference, surroundings: layers.surroundings && !local, ...(corn ? { pressure: false, zones: false, beyondBoundary: false } : {}) }), [layers, reference, local, corn]);

  const onMapPick = (p: TwinPick, pointer: string) => {
    if (!rowEditing) { setSelection(p); return; }
    setRowNote(null);
    if (p?.kind !== "ground") { setSelection(p); return; }
    if (!rowModelNow) { setRowNote("This twin has no row direction to snap to."); return; }
    const sn = snapRow(rowModelNow, p.lat, p.lng, plantIdx);
    if (sn.kind === "row") { setSelection(typeof sn.key === "number" ? { kind: "cornRow", id: sn.key } : { kind: "addedRow", uid: sn.key }); return; }
    if (sn.kind === "none") { setRowNote(sn.why); setSelection(null); return; }
    const uid = newUid();
    const onScreen = [reference ? "photographs" : null, plants && showPlants ? "located plants" : null, hideRows ? null : "rows"].filter(Boolean).join(", ") || "nothing";
    commitRows({ ...rowEdits, added: [...rowEdits.added, { uid, line: sn.line, at: new Date().toISOString(), snap: sn.snap, onScreen, pointer }] }, "Row added");
    setSelection(null);
  };
  const setVerdict = (id: number, v: "keep" | "remove" | null) => {
    const verdicts = { ...rowEdits.verdicts };
    if (v) verdicts[String(id)] = v; else delete verdicts[String(id)];
    const ends = { ...rowEdits.ends }; if (!v) delete ends[String(id)];
    commitRows({ ...rowEdits, verdicts, ends }, v === "keep" ? `Row ${id} kept` : v === "remove" ? `Row ${id} removed` : `Answer on row ${id} taken back`);
    setSelection(null);
  };
  /** An end handle let go: the selected row cut or carried on to there. */
  const onRowEnd = (which: 0 | 1, lat: number, lng: number) => {
    if (!rowModelNow || selectedRowKey == null) return;
    const moved = moveRowEnd(rowModelNow, selectedRowKey, which, lat, lng);
    if (!moved) { setRowNote("A row can't be shorter than a metre. To take it away, choose No row here."); return; }
    if (typeof selectedRowKey === "string") commitRows({ ...rowEdits, added: rowEdits.added.map(a => (a.uid === selectedRowKey ? { ...a, line: moved.line } : a)) }, "Row end moved");
    else commitRows({ ...rowEdits, ends: { ...rowEdits.ends, [String(selectedRowKey)]: moved.ends } }, `Row ${selectedRowKey}: end moved`);
  };
  const deleteAdded = (uid: string) => { commitRows({ ...rowEdits, added: rowEdits.added.filter(a => a.uid !== uid) }, "Added row deleted"); setSelection(null); };
  const startRowEditing = () => { setEditing(null); setSelection(null); setRowEditing(true); setRowLast(null); setRowNote(null); };
  const finishRowEditing = () => { setRowEditing(false); setSelection(null); setHideRows(false); setRowLast(null); setRowNote(null); };

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

  // Opened on a finding: select it and show it, once per finding. Never a neighbour, never a guess.
  const focusedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || !handle.current) return;
    const key = `${twin.id}|${focus.kind}:${focus.id}`;
    if (focusedOn.current === key) return;
    focusedOn.current = key;
    const at = locateReviewed(focus, twin);
    onFocus?.(at ? { status: at.status } : null);
    if (!at) return;
    setSelection(at.pick);
    zoomTo(at.lat, at.lng, at.metresAcross);
  }, [focus, twin, zoomTo, onFocus]);

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
  const [boundaryNote, setBoundaryNote] = useState<string | null>(null);
  const finishEditing = () => {
    if (editing) {
      setBoundary({ corrected: editing, operational: boundary.operational.ring ? { ...boundary.operational, ring: editing, source: "corrected", at: new Date().toISOString() } : boundary.operational });
      if (reviewing) saveReview({ ...BOUNDARY_REVIEW, verdict: "wrong", algorithmStatus: twin.boundary?.cultivated.confidence?.level ?? "rows", payload: { ring: editing } }).then(() => setBoundaryNote(null), e => setBoundaryNote(`Your correction was not saved: ${(e as Error).message}`));
    }
    setEditing(null);
  };
  const resetBoundary = () => {
    setEditing(null); setBoundary({ corrected: null, operational: NO_OPERATIONAL_BOUNDARY });
    if (reviewing) clearReview(BOUNDARY_REVIEW.kind, BOUNDARY_REVIEW.id).catch(e => setBoundaryNote(`Not reset: ${(e as Error).message}`));
  };
  const boundaryLooksRight = () => {
    saveReview({ ...BOUNDARY_REVIEW, verdict: "correct", algorithmStatus: twin.boundary?.cultivated.confidence?.level ?? "rows" }).then(() => setBoundaryNote(null), e => setBoundaryNote(`Not saved: ${(e as Error).message}`));
  };
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
  const dockOpen = (!!selection && !rowEditing) || resultsOpen;
  // Narrow screens (a tablet held upright, a phone): the panels fold away behind a button and the inspector rises
  // from the bottom, so the map stays visible. Wide screens keep both columns open.
  const narrow = useNarrow();
  const [panelsOpen, setPanelsOpen] = useState(() => !narrowNow());
  useEffect(() => { if (narrow && selection) setPanelsOpen(false); }, [narrow, selection]);
  const full = founderView && (detailStop === "full" || detailStop === "custom"), simple = detailStop === "simple";
  const swatch = (rgb: [number, number, number], a: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(1, a + 0.15)})`;

  return (
    <div className="twin-root relative h-full w-full min-h-0 overflow-hidden" style={{ background: TWIN_COLOURS.outside, ["--twin-right" as string]: dockOpen && !narrow ? "368px" : "0px" }}>
      <style>{`.twin-root .leaflet-top.leaflet-right, .twin-root .leaflet-bottom.leaflet-right { right: var(--twin-right, 0); transition: right .15s ease; } .twin-root .leaflet-control-scale-line { background: rgba(24,26,24,.85); color: #d9ddd6; border-color: #8a8f88; } .twin-root .leaflet-control-attribution { background: rgba(24,26,24,.85); color: #9aa09a; }`}</style>
      <TwinMap scene={scene} layers={effectiveLayers} selection={selection} units={units} onPick={onMapPick} onDetail={setDetail} onStats={setStats}
        onMove={c => setCentre(c)} onReady={h => { handle.current = h; setStats(h.layer.stats); }} reference={reference} onSwipe={setRefSwipe} findings={findings}
        operational={operationalRing} editing={editing} onBoundaryEdit={setEditing} rowEdits={rowEditsProp} plants={plantsProp} onRowEnd={onRowEnd} />

      {/* The row editor's card for a tapped row and its Undo bar, bottom centre over the map. */}
      {rowEditing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[730] flex flex-col items-center gap-2 px-3">
          <div className="pointer-events-auto w-full max-w-[420px]"><RowActionCard selection={selection} twin={twin} edits={rowEdits} onKeep={id => setVerdict(id, "keep")} onRemove={id => setVerdict(id, "remove")} onClear={id => setVerdict(id, null)} onDeleteAdded={deleteAdded} onClose={() => setSelection(null)} /></div>
          <div className="pointer-events-auto"><RowUndoBar last={rowLast} canUndo={rowUndo.length > 0} onUndo={undoRows} note={rowNote} /></div>
        </div>
      )}

      {narrow && (
        <button type="button" onClick={() => setPanelsOpen(o => !o)} aria-expanded={panelsOpen}
          className={`absolute left-3 top-3 z-[710] flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-100 ${panel}`}>
          <Layers className="h-3.5 w-3.5" />{panelsOpen ? "Hide panels" : "Findings and layers"}
        </button>
      )}
      {/* Left column: the detail dial, Explore Findings, then the layers (Standard and Full). */}
      <div className={`absolute left-3 z-[700] flex flex-col gap-2 overflow-y-auto ${narrow ? "top-14 max-h-[calc(100%-72px)]" : "top-3 max-h-[calc(100%-120px)]"} ${narrow && !panelsOpen ? "hidden" : ""}`}>
        <div className={`w-[272px] px-3 py-2 ${panel}`} role="group" aria-label="Detail">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-100">Detail</span>
            {detailStop === "custom" && <span className="text-[10px] text-neutral-400">{DETAIL_LABEL.custom}</span>}
          </div>
          <div className={`mt-1.5 grid ${stops.length === 3 ? "grid-cols-3" : "grid-cols-2"} gap-0.5 rounded-sm border border-[#3a3f3a] bg-[#111311] p-0.5`}>
            {stops.map(stop => (
              <button key={stop} type="button" onClick={() => chooseDetail(stop)} aria-pressed={detailStop === stop}
                className={`rounded-[2px] px-1 py-1 text-[11px] ${detailStop === stop ? "bg-[#f0a63a] font-semibold text-[#171a18]" : "text-neutral-300 hover:bg-[#262a26] hover:text-neutral-100"}`}>{DETAIL_LABEL[stop]}</button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-neutral-500">{DETAIL_HINT[detailStop]}</p>
        </div>
        {twin.corn && <CornFieldPanel twin={twin} corn={twin.corn} layers={layers} setLayers={setLayers} units={units} onSelect={(p, lat, lng, across) => { setSelection(p); zoomTo(lat, lng, across); }} />}
        {twin.corn && founderView && <RowEditPanel edits={rowEdits} editing={rowEditing} onStart={startRowEditing} onDone={finishRowEditing}
          onClearAll={() => { commitRows(NO_ROW_EDITS, "All corrections cleared"); }} hideRows={hideRows} setHideRows={setHideRows}
          plants={plants ? { count: plants.points.length, note: plants.note } : null} showPlants={showPlants} setShowPlants={setShowPlants} photographsOn={!!reference} />}
        {!twin.corn && <FindingsControl query={query} onChange={q => { setQuery(q); setSelection(null); }} result={result} open={findOpen} onToggle={() => setFindOpen(o => !o)} compact={simple} />}
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
              {!founderView ? (
                <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                  {boundary.corrected ? "Corrected by you. " : ""}
                  {inferred ? `Drawn from the crop rows and the photographs; about ${Math.round(100 * inferred.stats.support.photographs)} % of its edge was seen in a photograph.`
                    : intel.blockSource === "rows" ? "Drawn from the crop rows alone." : "No boundary could be drawn for this field."}
                </p>
              ) : <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                {boundary.corrected ? "Corrected by you. " : ""}
                {inferred ? `Inferred from ${inferred.rowsUsed.length} rows and the photographs${inferred.uncertaintyM2 ? `, plausible range ${fmtArea(Math.max(0, inferred.areaM2 - inferred.uncertaintyM2), units).text} to ${fmtArea(inferred.areaM2 + inferred.uncertaintyM2, units).text}` : ""}. Edges: ${Math.round(100 * inferred.stats.support.photographs)} % seen in the photographs${inferred.stats.support.bridged ? `, ${Math.round(100 * inferred.stats.support.bridged)} % bridged between seen pieces` : ""}${inferred.stats.support.cap ? `, ${Math.round(100 * inferred.stats.support.cap)} % at the cap` : ""}${inferred.stats.support.coverage ? `, ${Math.round(100 * inferred.stats.support.coverage)} % at the end of the photographs` : ""}.`
                  : intel.blockSource === "rows" ? "From the rows' own geometry, half a spacing beyond them. No photographs were read for the edges." : "No boundary: the twin has no reliable row."}
              </p>}
              {inferred?.confidence && !boundary.corrected && (
                <p className={`mt-1 text-[10px] leading-snug ${inferred.confidence.level === "high" ? "text-neutral-400" : "text-amber-300/90"}`}>
                  {inferred.confidence.level === "high"
                    ? `Confidence ${Math.round(100 * inferred.confidence.overall)} %: inferred.`
                    : inferred.confidence.level === "medium"
                      ? `Confidence ${Math.round(100 * inferred.confidence.overall)} %: review the boundary. The dashed and dotted edges are the ones to check; Adjust moves a corner.`
                      : `Confidence ${Math.round(100 * inferred.confidence.overall)} %: low. Check the edges against the photographs before relying on this block; Adjust moves a corner.`}
                </p>
              )}
              {founderView && inferred && inferred.failures.length > 0 && (
                <button type="button" className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-200" onClick={() => setNotesOpen(o => !o)} aria-expanded={notesOpen}>
                  {notesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{inferred.failures.length} note{inferred.failures.length > 1 ? "s" : ""} on what could not be settled
                </button>
              )}
              {inferred && notesOpen && <ul className="mt-1 space-y-1 border-l border-[#2e322e] pl-2 text-[10px] leading-snug text-neutral-400">{inferred.failures.map(f => <li key={f}>{f}</li>)}</ul>}
              {local ? (
                <p className="mt-1 text-[10px] leading-snug text-amber-300/90">A locally aligned test flight: its boundary is in a made-up frame and cannot be accepted for operations.</p>
              ) : reviewing ? (
                <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                  {boundaryReview?.verdict === "correct" ? "You said this boundary looks right." : boundaryReview?.verdict === "wrong" ? `You corrected this boundary${boundaryReview.updated_at ? ` on ${new Date(boundaryReview.updated_at).toLocaleDateString()}` : ""}.` : "Does this boundary match the field? Say so, or adjust its corners."}
                </p>
              ) : !founderView ? null : operationalRing ? (
                <p className="mt-1 text-[10px] leading-snug text-emerald-300/90">{boundary.operational.source === "corrected" ? "Corrected and accepted" : "Accepted"} by you{boundary.operational.at ? ` on ${new Date(boundary.operational.at).toLocaleDateString()}` : ""} as the operational boundary.</p>
              ) : (
                <p className="mt-1 text-[10px] leading-snug text-neutral-500">Not an operational limit: an inferred boundary is never used to limit an operation until you accept it.</p>
              )}
              {currentRing && !local && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={startEditing}>Adjust</button>
                  {reviewing && !boundary.corrected && boundaryReview?.verdict !== "correct" && <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26] disabled:opacity-50" onClick={boundaryLooksRight} disabled={!review?.twinId || !reviews}>Looks right</button>}
                  {!reviewing && founderView && (operationalRing ? <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={withdrawBoundary}>Withdraw acceptance</button>
                    : <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={acceptBoundary}>Accept for operations</button>)}
                  {(boundary.corrected || operationalRing || boundaryReview) && <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-400 hover:bg-[#262a26]" onClick={resetBoundary}>{reviewing ? "Undo my answer" : "Reset to inferred"}</button>}
                </div>
              )}
              {boundaryNote && <p role="alert" className="mt-1 text-[10px] text-red-300">{boundaryNote}</p>}
            </>
          )}
        </div>
        {!simple && <div className={`w-[272px] text-sm ${panel}`}>
          <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-neutral-100" onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen}>
            <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" />Layers</span>{panelOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {panelOpen && (
            <div className="border-t border-[#2e322e] px-3 py-2">
              {!corn && <>
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
              </>}
              {toggle("vegetation", "Other vegetation", TWIN_COLOURS.vegetation, `${twin.vegetation.length} patches, unclassed`)}
              {toggle("uncertainty", "Uncertainty", "#8c949f", `${s.cellsSingleCoverage} cells one photograph saw`)}
              {toggle("coverage", "Photo coverage", TWIN_COLOURS.imageryEdge, "the ground the photographs looked at")}
              {!local && toggle("surroundings", "Surroundings", "#4a4f4a", "roads and places, OpenStreetMap data")}
              {full && <button type="button" className="mt-2 flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setDiagOpen(o => !o)} aria-expanded={diagOpen}>
                {diagOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Diagnostics
              </button>}
              {full && diagOpen && (
                <div className="mt-1 border-l border-[#2e322e] pl-2">
                  {!corn && <>
                  {toggle("singleView", "Single-sighting candidates", TWIN_COLOURS.weedSingle, `${counts.single.toLocaleString()}, dashed`)}
                  {toggle("onTree", "Detections on tree crowns", TWIN_COLOURS.weedOnTree, `${counts.onTree.toLocaleString()}, kept apart from weeds`)}
                  {toggle("inferred", "Inferred tree positions", TWIN_COLOURS.tree, `${twin.inferredTrees.length}, dashed, from the planting pattern`)}
                  {toggle("droppedRows", "Row candidates not kept", TWIN_COLOURS.rowDropped, `${twin.rows.length - counts.rows}`)}
                  </>}
                  {toggle("footprints", "Photo footprints", TWIN_COLOURS.footprint, `${twin.footprints.length}`)}
                  {scene.evidence && toggle("evidence", "Boundary evidence", TWIN_COLOURS.evidence.cover, `what the photographs showed per ${scene.evidence.cellM} m: soil brown, canopy green, cover yellow, road grey, trees off the rows purple`)}
                  {referenceOptions.length > 0 && (
                    <div className="mt-2 text-xs text-neutral-200">
                      <label className="block text-[11px] text-neutral-400" htmlFor="twin-ref">Reference imagery</label>
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
      {keyOpen && !rowEditing && !(narrow && (dockOpen || panelsOpen)) && <div className={`absolute bottom-3 left-3 right-3 z-[700] max-w-[420px] px-3 py-2 text-[11px] text-neutral-300 sm:right-auto ${panel}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs"><span className="font-semibold text-neutral-100">{detail ? LEVEL_NAME[detail.level] : "Field Twin"}</span><span className="text-neutral-500"> · {twin.name}</span></p>
          <button type="button" className="-mr-1 -mt-0.5 rounded-sm px-1 text-[13px] leading-none text-neutral-500 hover:bg-[#262a26] hover:text-neutral-200" onClick={() => setKeyOpen(false)} aria-label="Close the key" title="Close the key">×</button>
        </div>
        <p className="mt-0.5 text-neutral-300">Review-only: these are observations for you to check, not treatment decisions.</p>
        {!local && <p className="mt-0.5 text-neutral-400">{placementText(twin)}</p>}
        <p className="mt-0.5 text-neutral-400">{twin.corn ? "Corn rows cyan, rows not confirmed amber dashes; weed candidates red, not confirmed grey, contested violet; stand gaps orange, withheld grey. Click one to inspect it." : detail ? LEVEL_TEXT[detail.level] : "Built from the original photographs, no orthomosaic."}</p>
        {local && <p className="mt-0.5 text-amber-300/90">Locally aligned test flight: positions relative to each other, scale estimated from the corn rows. Not on the map.</p>}
        {twin.stats.weedTier === "colour" && <p className="mt-0.5 text-amber-300/90">Weeds by colour rules, not a model: green against the soil around it, crowns left out, strips split at their plants. Yellowing plants and plants under 4 cm are missed; a green shoot at a crown's edge can be counted.</p>}
        {twin.stats.weedTier === "none" && !twin.corn && <p className="mt-0.5 text-neutral-500">No weed pass ran on this twin.</p>}
        {layers.pressure && !corn && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400" aria-label="Weed pressure legend">
            <span className="text-neutral-500">Cover of observable ground:</span>
            {HEAT_STOPS.map((st, i) => <span key={st.pct} className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: swatch(st.rgb, st.alpha) }} />{pctText(heatScale.stops[i])} %{i === HEAT_STOPS.length - 1 ? "+" : ""}</span>)}
            {heatScale.stretched && <span className="text-neutral-500" title="This field's cover runs above the fixed bands, so the colours are spread over its own range: the median of the block's observed ground is the first raised stop, its worst 1 % the last. The numbers are real cover.">bands set by this field</span>}
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: "rgba(96,122,98,0.6)" }} />under canopy{canopyCells ? ` (${canopyCells} cells)` : ""}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-sm border border-[#3a3f3a]" style={{ background: `repeating-linear-gradient(135deg, ${TWIN_COLOURS.hatch} 0 1px, ${TWIN_COLOURS.imagery} 1px 4px)` }} />not observed</span>
          </div>
        )}
        {detail?.level === "field" && !simple && !corn && <p className="mt-0.5 text-neutral-500">{s.blockHa != null ? `Cultivated block ${fmtArea(s.blockHa * 10_000, units).text} (${intel.blockSource === "corrected" ? "corrected by you" : intel.blockSource === "inferred" ? "inferred from the photographs" : "from the rows"}); ` : ""}{intel.zones.length} regions at 1.5 % cover or more, {result.query.mode === "overview" ? `${result.prominence.count} emphasised` : `${result.findings.length} findings listed`}.</p>}
        {full && !local && <p className="mt-0.5 text-neutral-500 tabular-nums">Centre {(centre ?? twin.origin).lat.toFixed(6)}, {(centre ?? twin.origin).lng.toFixed(6)} · north up</p>}
        {reference && <p className="mt-0.5 text-amber-300/90">Reference imagery on (diagnostics): display only, it never moves the twin's objects.</p>}
      </div>}

      {/* Right dock: the inspector for a selected object, else the results panel for an active filter. */}
      {selection && !rowEditing ? (
        <aside className={`absolute z-[720] overflow-y-auto p-3.5 text-sm ${narrow ? "inset-x-2 bottom-2 max-h-[62%]" : "right-3 top-3 bottom-3 w-[356px]"} ${panel}`} aria-label="Inspector">
          {resultsOpen && <button type="button" className="mb-2 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setSelection(null)}>← Back to the {result.findings.length.toLocaleString()} results</button>}
          {reviewing && (() => {
            const target = reviewTargetOf(selection, twin, result);
            return target ? <ReviewBar target={target} reviews={reviews} canSay={canSay} disabledReason={review?.disabledReason ?? (review?.twinId ? null : "Reviews open once the twin is saved to your account.")}
              onSave={r => saveReview({ kind: r.kind, id: r.id, verdict: r.verdict, note: r.note, algorithmStatus: r.algorithmStatus, says: r.says })} onClear={(k, id) => clearReview(k, id)} /> : null;
          })()}
          <TwinInspector technical={founderView} twin={twin} scene={scene} selection={selection} atlasUrl={atlasUrl} onClose={() => setSelection(null)} onZoomTo={zoomTo} findings={result} onSelectWeed={id => { const w = twin.weeds.find(x => x.id === id); if (w) { setSelection({ kind: "weed", id }); zoomTo(w.lat, w.lng, Math.max(2, w.diameterM * 8)); } }} />
          {reviewing && <div className="mt-4 border-t border-[#2e322e] pt-3"><FeedbackButton kind="finding" twinId={review?.twinId ?? null} context={{ selection: selection.kind, ...("id" in selection ? { id: selection.id } : {}) }} label="Tell us more about this" variant="ghost" /></div>}
        </aside>
      ) : resultsOpen ? (
        <aside className={`absolute z-[720] p-3.5 text-sm ${narrow ? "inset-x-2 bottom-2 max-h-[62%] overflow-y-auto" : "right-3 top-3 bottom-3 w-[356px]"} ${panel}`} aria-label="Findings results">
          <FindingsPanel result={result} units={units} selectedIndex={selectedIndex} onSelect={selectFinding} onClose={() => setQuery(OVERVIEW)} labels={stats ? { placed: stats.labels.placed, emphasized: stats.labels.emphasized } : null} />
        </aside>
      ) : null}
    </div>
  );
}
