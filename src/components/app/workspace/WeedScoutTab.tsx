// Weed Scout: the experimental, developer-mode replacement for the Treatment
// Grid tab.
//
// The flow, in the operator's order: scan the field, click a spot on the map
// to see what was found, keep it as a weed or remove it (or leave it unsure),
// identify it if you can, then save everything in one go. Saving puts the
// kept weed spots on the field (Field View and the Flight Planner) and takes
// removed ones off; there is no separate apply step. The run and the review
// live in runStore.ts, so leaving the tab stops neither. Every spot carries a
// stable id (lib/weedScout/spotId.ts), so the archive row and the applied
// annotation for it are found again on the next run.
//
// Everything on this screen is a candidate until the operator says otherwise.
// The only place the word "weed" is applied to a plant is the verdict button
// the operator presses, and the only name ever suggested for a spot comes
// from their own past verdicts (lib/weedCatalog/suggest.ts). Nothing here
// calls anything outside the tile server and the operator's own archive.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, CheckCircle2, ExternalLink, FlaskConical, Loader2, MapPin, Play, Save, Square, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { type FarmerSettings, growthStage } from "@/lib/farmerSettings";
import type { LatLng2 } from "@/lib/geo";
import { storageKey } from "@/lib/storage";
import { fmtArea, fmtAreaCm2, fmtDistance, fmtLengthCm } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { describeCandidate } from "@/lib/weedScout/candidates";
import { type AppliedAnnotation, annotationFromCandidate } from "@/lib/weedScout/applyToField";
import { type EventContext, describeEvent, fetchEventContext } from "@/lib/weedScout/context";
import { describeFeedback } from "@/lib/weedScout/feedback";
import {
  type ObservationRow, type Verdict, VERDICTS, identificationColumns, isDismissal, listObservations, loadFeedback,
  saveObservation,
} from "@/lib/weedScout/observations";
import { patchSession, startRun, stopRun, useScoutSession } from "@/lib/weedScout/runStore";
import {
  type Candidate, type FeedbackRow, type RegionClass, type ScoutParams, type ScoutProgress, type ScoutResult,
  DEFAULT_SCOUT_PARAMS,
} from "@/lib/weedScout/types";
import {
  type Identification, REJECTED, UNIDENTIFIED, identificationFromEntry, identificationFromText, isStatedFinding,
  sourceTextFor,
} from "@/lib/weedCatalog/identification";
import { cropContextFor, fieldRegion } from "@/lib/weedCatalog/region";
import { loadCatalog } from "@/lib/weedCatalog/repo";
import {
  type Suggestion, evidenceLabel, narrowCatalog, presenceNote, regulatoryNote, searchRanked, suggestionsFor,
} from "@/lib/weedCatalog/suggest";
import type { CatalogEntry } from "@/lib/weedCatalog/types";
import { type BasemapId, BasemapLayer, BasemapToggle, FitBounds, loadBasemap, saveBasemap } from "./layers";
import type { BoundaryRing } from "./types";

const PARAMS_KEY = storageKey("weedScout", "params");

function loadParams(): ScoutParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (!raw) return DEFAULT_SCOUT_PARAMS;
    const p = JSON.parse(raw) as Partial<ScoutParams>;
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
    return {
      tileM: num(p.tileM, DEFAULT_SCOUT_PARAMS.tileM),
      rowSpacingM: num(p.rowSpacingM, DEFAULT_SCOUT_PARAMS.rowSpacingM),
      headlandM: typeof p.headlandM === "number" && p.headlandM >= 0 ? p.headlandM : DEFAULT_SCOUT_PARAMS.headlandM,
      anomalyZ: num(p.anomalyZ, DEFAULT_SCOUT_PARAMS.anomalyZ),
      bandFrac: num(p.bandFrac, DEFAULT_SCOUT_PARAMS.bandFrac),
      minBlobCm2: num(p.minBlobCm2, DEFAULT_SCOUT_PARAMS.minBlobCm2),
      blobZ: num(p.blobZ, DEFAULT_SCOUT_PARAMS.blobZ),
      minRegionTiles: Math.round(num(p.minRegionTiles, DEFAULT_SCOUT_PARAMS.minRegionTiles)),
      autoTile: p.autoTile !== false,
      rowMode: p.rowMode === "rows" || p.rowMode === "none" ? p.rowMode : "auto",
      sweep: p.sweep !== false,
      maxSweepWindows: Math.round(num(p.maxSweepWindows, DEFAULT_SCOUT_PARAMS.maxSweepWindows)),
      maxChips: Math.round(num(p.maxChips, DEFAULT_SCOUT_PARAMS.maxChips)),
    };
  } catch {
    return DEFAULT_SCOUT_PARAMS;
  }
}

const STAGE_LABEL: Record<ScoutProgress["stage"], string> = {
  stitching: "Reading the mosaic",
  tiling: "Cutting the field into tiles",
  masking: "Separating plants from soil",
  baseline: "Measuring the field average",
  regions: "Merging not-average tiles into regions",
  rows: "Fitting the crop rows",
  blobs: "Finding vegetation",
  sweeping: "Sweeping the field at full depth",
  ranking: "Ranking candidates",
  chips: "Rendering chips",
  done: "Done",
};

const KIND_COLOUR: Record<Candidate["kind"], string> = {
  "not-average region": "#38bdf8",
  "field outlier": "#38bdf8",
  "off-row vegetation": "#f59e0b",
  "vegetation outlier": "#a78bfa",
  "off-row and outlier": "#f43f5e",
};

const CLASS_COLOUR: Record<RegionClass, string> = {
  "bare or dry ground": "#f97316",
  "dark ground (wet, shadow or residue)": "#60a5fa",
  "thin stand": "#fbbf24",
  "dense vegetation": "#22c55e",
  "pale vegetation": "#facc15",
  "greener than the field": "#4ade80",
  "different from the field": "#38bdf8",
};

/** Region classes that read as ground, not plants: never a weed by default. */
const GROUND_CLASSES = new Set<RegionClass>(["bare or dry ground", "dark ground (wet, shadow or residue)", "thin stand"]);

/**
 * The verdict a spot starts with, before the operator touches it.
 *
 * The archive speaks first: when the archived spots most like this one were
 * mostly dismissed by the operator (feedback.ts, factor below 1), it starts
 * removed; when they were mostly confirmed, it starts as a weed. That is the
 * one place the scout's learning changes what is proposed rather than only
 * the order. Otherwise the scout flags "possible weed spots", so a plant
 * candidate or a vegetation region starts as a weed and the operator removes
 * the wrong ones; ground that is bare, dark or thin is not a plant and starts
 * as unsure. The default is shown on every row and flipped with one click.
 */
export function defaultVerdict(c: Candidate): Verdict {
  if (c.feedback && c.feedback.factor < 1) return "not_weed";
  if (c.feedback && c.feedback.factor > 1) return "weed";
  if (c.region) return GROUND_CLASSES.has(c.region.klass) ? "unsure" : "weed";
  if (c.kind === "field outlier") return "unsure";
  return "weed";
}

const VERDICT_LABEL: Record<Verdict, string> = {
  weed: "Weed", not_weed: "Not a weed", unsure: "Unsure", crop: "Not a weed (crop)", not_vegetation: "Not a weed (not vegetation)",
};

/** What the archive row says the operator decided, restored for this run. */
function identificationFromRow(row: ObservationRow | undefined, catalog: CatalogEntry[], suggestion: Suggestion | null): Identification {
  if (!row) return UNIDENTIFIED;
  const status = row.identification_status;
  if (status === "rejected") return REJECTED;
  if ((status === "confirmed" || status === "edited") && row.species) {
    const entry = row.catalog_id ? catalog.find(e => e.catalog_id === row.catalog_id) : undefined;
    if (entry) {
      // A confirmation whose suggestion is no longer the one on screen is the
      // operator's own pick now; the database only accepts "confirmed" for
      // the id that was suggested.
      const stillSuggested = status === "confirmed" && suggestion?.entry.catalog_id === entry.catalog_id;
      return identificationFromEntry(entry, stillSuggested ? "confirmed" : "edited", row.identification_basis ?? "Picked by the operator from the reference list.");
    }
    return identificationFromText(row.species);
  }
  // Legacy rows: species text typed before identifications existed is the operator's own label.
  return row.species ? identificationFromText(row.species) : UNIDENTIFIED;
}

const inputCls = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]";
const labelCls = "text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block";
const btnPrimary = "inline-flex items-center gap-1.5 text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 text-black rounded-sm px-3 py-1.5 font-semibold";
const btnQuiet = "inline-flex items-center gap-1.5 text-xs border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 rounded-sm px-3 py-1.5";

type Bulk = { phase: "idle" | "saving"; done: number; total: number; error: string | null; failed: number };

export function WeedScoutTab({
  boundary, tileUrl, bounds, maxNative, fieldId, taskId, scanCreatedAt, settings, center, setActiveTab,
  applyAnnotation, removeAnnotation, appliedSpots,
}: {
  boundary: BoundaryRing[] | null;
  tileUrl: string;
  bounds: L.LatLngBoundsExpression | null;
  maxNative: number;
  fieldId: string | null;
  taskId: string;
  scanCreatedAt: string | null;
  settings: FarmerSettings;
  center: [number, number];
  setActiveTab: (k: "field" | "planner") => void;
  /**
   * Writes an ordinary `user_annotations` row, the same shape a hand-drawn
   * polygon produces, plus the spot id and the operator's identification if
   * they made one. Resolves to the new row's id, or null on failure.
   */
  applyAnnotation: (input: AppliedAnnotation & { spot_id?: string | null; weed_observation_id?: string | null }) => Promise<string | null>;
  removeAnnotation: (id: string) => Promise<void>;
  /** Spot id to annotation id, for spots already on Field View. */
  appliedSpots: Record<string, string>;
}) {
  const units = useUnitSystem();
  const { user } = useAuth();
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const [params, setParams] = useState<ScoutParams>(() => {
    const p = loadParams();
    return { ...p, headlandM: settings.flight_plan?.boundary_buffer_m ?? p.headlandM };
  });
  // The run and the review live in lib/weedScout/runStore.ts, per scan, so
  // switching tabs neither stops the scan nor loses a keep / remove decision.
  const session = useScoutSession(taskId);
  const { running, progress, result, error: runError, selectedId, verdicts, identifications, notes: notesById, localApplied } = session;
  const setSelectedId = useCallback((id: string | null) => patchSession(taskId, { selectedId: id }), [taskId]);
  const setVerdicts = useCallback((f: (m: Record<string, Verdict>) => Record<string, Verdict>) => patchSession(taskId, s => ({ verdicts: f(s.verdicts) })), [taskId]);
  const setIdentifications = useCallback((f: (m: Record<string, Identification>) => Record<string, Identification>) => patchSession(taskId, s => ({ identifications: f(s.identifications) })), [taskId]);
  const setNotesById = useCallback((f: (m: Record<string, string>) => Record<string, string>) => patchSession(taskId, s => ({ notes: f(s.notes) })), [taskId]);
  const setLocalApplied = useCallback((f: (m: Record<string, string>) => Record<string, string>) => patchSession(taskId, s => ({ localApplied: f(s.localApplied) })), [taskId]);
  const [context, setContext] = useState<EventContext | null>(null);
  const [saved, setSaved] = useState<Record<string, ObservationRow>>({});
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [freeText, setFreeText] = useState("");
  const [bulk, setBulk] = useState<Bulk>({ phase: "idle", done: 0, total: 0, error: null, failed: 0 });
  const [singleBusy, setSingleBusy] = useState<"save" | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  const rings = useMemo(() => (boundary ?? []) as unknown as LatLng2[][], [boundary]);
  const capturedAt = scanCreatedAt ?? new Date().toISOString();
  const crop = settings.crop_type ?? "";
  const stage = growthStage(crop, settings.planting_date);
  const region = fieldRegion();
  const cropContext = cropContextFor(crop);
  const applied = useMemo(() => ({ ...appliedSpots, ...localApplied }), [appliedSpots, localApplied]);

  useEffect(() => { try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* private mode */ } }, [params]);

  useEffect(() => {
    let cancelled = false;
    fetchEventContext(center[0], center[1], capturedAt).then(ctx => { if (!cancelled) setContext(ctx); });
    return () => { cancelled = true; };
  }, [center, capturedAt]);

  useEffect(() => {
    let cancelled = false;
    loadCatalog(region.state)
      .then(rows => { if (!cancelled) { setCatalog(rows); setCatalogError(null); } })
      .catch(e => { if (!cancelled) setCatalogError((e as Error).message); });
    return () => { cancelled = true; };
  }, [region.state]);
  const narrowed = useMemo(() => narrowCatalog(catalog, { region, crop: cropContext }), [catalog, region, cropContext]);

  const reloadArchive = useCallback(() => {
    listObservations(taskId)
      .then(rows => setSaved(Object.fromEntries(rows.map(r => [r.candidate_id, r]))))
      .catch(() => { /* an empty archive and an unreachable one look the same here; saving will say */ });
    loadFeedback().then(setFeedback).catch(() => setFeedback([]));
  }, [taskId]);
  useEffect(() => { reloadArchive(); }, [reloadArchive]);

  const candidates = useMemo(() => result?.candidates ?? [], [result]);
  const selected = useMemo(() => candidates.find(c => c.id === selectedId) ?? null, [candidates, selectedId]);
  const suggestionById = useMemo(
    () => new Map(candidates.map(c => [c.id, suggestionsFor(c, catalog)[0] ?? null])),
    [candidates, catalog],
  );

  // Effective state per spot: the operator's edit, else the archive, else the default.
  const verdictOf = useCallback((c: Candidate): Verdict => verdicts[c.id] ?? saved[c.id]?.verdict ?? defaultVerdict(c), [verdicts, saved]);
  const identificationOf = useCallback(
    (c: Candidate): Identification => identifications[c.id] ?? identificationFromRow(saved[c.id], catalog, suggestionById.get(c.id) ?? null),
    [identifications, saved, catalog, suggestionById],
  );
  const notesOf = useCallback((c: Candidate): string => notesById[c.id] ?? saved[c.id]?.notes ?? "", [notesById, saved]);

  useEffect(() => { setPickerQuery(""); setFreeText(""); setSingleError(null); }, [selectedId]);

  const run = useCallback(() => {
    if (!rings.length || !tileUrl || running) return;
    startRun(taskId,
      { boundary: rings, tileUrl, maxNative, params, feedback },
      { context, crop, growthStage: stage, fieldId, unitSystem: units });
  }, [taskId, rings, tileUrl, maxNative, params, running, feedback, context, crop, stage, fieldId, units]);

  /** Save one spot with its effective verdict, identification and notes. */
  const saveOne = useCallback(async (c: Candidate): Promise<string | null> => {
    if (!user || !context || !result) return "Not signed in, or the capture context has not loaded yet.";
    const suggestion = suggestionById.get(c.id) ?? null;
    const suggestionIn = suggestion ? { catalogId: suggestion.entry.catalog_id, basis: suggestion.basis } : null;
    const identification = identificationOf(c);
    const verdict = verdictOf(c);
    const notes = notesOf(c).trim() || null;
    const r = await saveObservation({
      userId: user.id, fieldId, scanId: taskId, candidate: c, context, crop, growthStage: stage, params,
      gsdM: result.sweep.gsdM ?? result.gsdM, verdict, species: null, notes, suggestion: suggestionIn, identification,
    });
    if ("error" in r) return r.error;
    const idCols = identificationColumns({ species: null, suggestion: suggestionIn, identification });
    setSaved(s => ({
      ...s,
      [c.id]: {
        id: r.id, candidate_id: c.id, scan_id: taskId, tile_id: c.tileId, lat: c.centroid.lat, lng: c.centroid.lng,
        captured_at: context.capturedAt, place: context.place, local_time: context.localTime, season: context.season,
        kind: c.kind, score: c.score, chip_path: null, verdict, species: idCols.species, notes,
        created_at: new Date().toISOString(),
        suggested_catalog_id: idCols.suggested_catalog_id, suggestion_basis: idCols.suggestion_basis,
        identification_status: idCols.identification_status, catalog_id: idCols.catalog_id,
        identification_source: idCols.identification_source, identification_basis: idCols.identification_basis,
      },
    }));
    return null;
  }, [user, context, result, suggestionById, identificationOf, verdictOf, notesOf, fieldId, taskId, crop, stage, params]);

  /** Put one spot on the field (Field View and the Flight Planner), carrying the identification only if stated. */
  const applyOne = useCallback(async (c: Candidate, observationId: string | null): Promise<string | null> => {
    const a = annotationFromCandidate(c, identificationOf(c));
    const id = await applyAnnotation({ ...a, spot_id: c.id, weed_observation_id: observationId });
    if (!id) return "Couldn't put this spot on the field.";
    setLocalApplied(prev => ({ ...prev, [c.id]: id }));
    return null;
  }, [applyAnnotation, identificationOf, setLocalApplied]);

  const unapplyOne = useCallback(async (c: Candidate) => {
    const id = applied[c.id];
    if (!id) return;
    await removeAnnotation(id);
    setLocalApplied(prev => { const next = { ...prev }; delete next[c.id]; return next; });
  }, [applied, removeAnnotation, setLocalApplied]);

  /**
   * Saving a spot means it is on the field: the archive row is written, and
   * the Field View annotation follows the verdict. A kept weed spot is put on
   * the field (or refreshed when its label changed since it was last saved);
   * a spot removed as "not a weed" or left unsure comes off it.
   */
  const saveAndSync = useCallback(async (c: Candidate): Promise<string | null> => {
    const before = saved[c.id];
    const err = await saveOne(c);
    if (err) return err;
    const verdict = verdictOf(c);
    const onField = !!applied[c.id];
    if (verdict === "weed") {
      const id = identificationOf(c);
      const labelNow = isStatedFinding(id) ? id.label : null;
      const labelBefore = before && (before.identification_status === "confirmed" || before.identification_status === "edited") ? before.species : null;
      if (onField && labelNow !== labelBefore) await unapplyOne(c);
      if (!onField || labelNow !== labelBefore) return applyOne(c, before?.id ?? null);
      return null;
    }
    if (onField) await unapplyOne(c);
    return null;
  }, [saved, saveOne, verdictOf, applied, identificationOf, unapplyOne, applyOne]);

  const saveSelected = useCallback(async () => {
    if (!selected) return;
    setSingleBusy("save"); setSingleError(null);
    const err = await saveAndSync(selected);
    setSingleBusy(null);
    if (err) setSingleError(err); else loadFeedback().then(setFeedback).catch(() => { /* keep */ });
  }, [selected, saveAndSync]);

  /** Save every spot as it stands; kept weed spots land on the field, removed ones come off it. */
  const saveAll = useCallback(async () => {
    if (!candidates.length || bulk.phase !== "idle") return;
    let failed = 0;
    setBulk({ phase: "saving", done: 0, total: candidates.length, error: null, failed: 0 });
    for (let i = 0; i < candidates.length; i++) {
      const err = await saveAndSync(candidates[i]);
      if (err) failed += 1;
      setBulk(b => ({ ...b, done: i + 1, failed }));
    }
    setBulk({ phase: "idle", done: 0, total: 0, failed, error: failed ? `${failed} spot${failed === 1 ? "" : "s"} could not be saved. Check your connection and save again; nothing is duplicated.` : null });
    loadFeedback().then(setFeedback).catch(() => { /* keep */ });
  }, [candidates, bulk.phase, saveAndSync]);

  // Identification actions for the selected spot.
  const setIdent = (id: Identification) => { if (selected) setIdentifications(m => ({ ...m, [selected.id]: id })); };
  const setVerdict = (c: Candidate, v: Verdict) => setVerdicts(m => ({ ...m, [c.id]: v }));
  const suggestion = selected ? suggestionById.get(selected.id) ?? null : null;
  const identification = selected ? identificationOf(selected) : UNIDENTIFIED;
  const confirmSuggestion = () => {
    if (!suggestion || !selected) return;
    setIdent(identificationFromEntry(suggestion.entry, "confirmed", suggestion.basis));
    setFreeText("");
    if (verdictOf(selected) !== "weed") setVerdict(selected, "weed");
  };
  const pickEntry = (e: CatalogEntry, why: string) => {
    if (!selected) return;
    const isSuggested = suggestion?.entry.catalog_id === e.catalog_id;
    setIdent(identificationFromEntry(e, isSuggested ? "confirmed" : "edited",
      isSuggested ? suggestion!.basis : `Picked by the operator from the ${region.stateName} reference list. ${why}`));
    setPickerQuery(""); setFreeText("");
    if (verdictOf(selected) !== "weed") setVerdict(selected, "weed");
  };
  const typeName = (text: string) => { setFreeText(text); setIdent(text.trim() ? identificationFromText(text) : UNIDENTIFIED); };
  const pickerResults = useMemo(
    () => (pickerQuery.trim() ? searchRanked(narrowed.ranked, pickerQuery).slice(0, 8) : []),
    [narrowed, pickerQuery],
  );

  if (!rings.length) {
    return (
      <div className="absolute inset-0 grid place-items-center" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md text-center space-y-3 p-6">
          <FlaskConical className="h-8 w-8 mx-auto text-[#4CAF50]" />
          <h2 className="text-lg font-semibold">Weed Scout needs a field boundary</h2>
          <p className="text-sm text-neutral-400">The scout cuts the field into tiles and compares each to the rest. Without an outline there is no field to compare against.</p>
          <button onClick={() => setActiveTab("field")} className={btnPrimary}>Go to Field View</button>
        </div>
      </div>
    );
  }

  const regionCandidates = candidates.filter(c => c.region);
  const pointCandidates = candidates.filter(c => !c.region);
  const kept = candidates.filter(c => verdictOf(c) === "weed");
  const removed = candidates.filter(c => isDismissal(verdictOf(c)));
  const unsure = candidates.length - kept.length - removed.length;
  const savedCount = candidates.filter(c => saved[c.id]).length;
  const rowSpacingShown = units === "metric" ? (params.rowSpacingM * 100).toFixed(1) : (params.rowSpacingM / 0.0254).toFixed(1);
  const rowSpacingUnit = units === "metric" ? "cm" : "in";
  const setRowSpacingShown = (v: number) => setParams(p => ({ ...p, rowSpacingM: units === "metric" ? v / 100 : v * 0.0254 }));
  const areaText = (m2: number) => fmtArea(m2, units).text;
  const busy = bulk.phase !== "idle";
  const nameOf = (c: Candidate) => {
    const id = identificationOf(c);
    if (isStatedFinding(id)) return id.label!;
    return c.region ? `${c.region.klass}, ${areaText(c.areaM2)}` : c.kind;
  };
  const spotColour = (c: Candidate) => (c.region ? CLASS_COLOUR[c.region.klass] : KIND_COLOUR[c.kind]);
  const selectedIndex = selected ? candidates.indexOf(selected) : -1;

  return (
    <div className="absolute inset-0 flex" style={{ background: "#0f0f0f" }}>
      <div className="flex-1 relative">
        <MapContainer bounds={bounds ?? undefined} boundsOptions={{ padding: [40, 40] }} minZoom={1} maxZoom={22} preferCanvas
          zoomControl={false} attributionControl={false} style={{ height: "100%", width: "100%", background: "#0a0a0a" }}>
          <BasemapLayer id={basemap} />
          {tileUrl && bounds && (
            <TileLayer key={tileUrl} url={tileUrl} maxNativeZoom={Math.min(20, maxNative)} maxZoom={22} tileSize={256} keepBuffer={4} bounds={bounds} noWrap zIndex={10} />
          )}
          <FitBounds bounds={bounds} />
          {rings.map((r, i) => (
            <Polygon key={i} positions={r.map(p => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#4CAF50", weight: 1.5, fill: false, dashArray: "4 4" }} />
          ))}
          {regionCandidates.map(c => {
            const colour = spotColour(c);
            const active = c.id === selectedId;
            const gone = isDismissal(verdictOf(c));
            return (
              <Polygon key={c.id}
                positions={c.region!.rings.map(ring => ring.map(p => [p.lat, p.lng] as [number, number]))}
                eventHandlers={{ click: () => setSelectedId(c.id) }}
                pathOptions={{
                  color: active ? "#ffffff" : gone ? "#525252" : applied[c.id] ? "#38bdf8" : colour,
                  weight: active ? 2.5 : applied[c.id] ? 2.5 : 1.5,
                  fillColor: gone ? "#525252" : colour, fillOpacity: gone ? 0.08 : saved[c.id] ? 0.45 : 0.22,
                  dashArray: gone ? "3 3" : undefined,
                }} />
            );
          })}
          {pointCandidates.map(c => {
            const gone = isDismissal(verdictOf(c));
            const active = c.id === selectedId;
            return (
              <CircleMarker key={c.id} center={[c.centroid.lat, c.centroid.lng]}
                radius={active ? 9 : applied[c.id] ? 8 : 5}
                eventHandlers={{ click: () => setSelectedId(c.id) }}
                pathOptions={{
                  color: active ? "#ffffff" : gone ? "#525252" : applied[c.id] ? "#38bdf8" : KIND_COLOUR[c.kind],
                  weight: active ? 2 : applied[c.id] ? 2.5 : 1.5,
                  fillColor: gone ? "#525252" : KIND_COLOUR[c.kind], fillOpacity: gone ? 0.15 : saved[c.id] ? 0.9 : 0.35,
                }} />
            );
          })}
          <BasemapToggle value={basemap} onChange={(id) => { setBasemap(id); saveBasemap(id); }} className="absolute bottom-4 right-4 z-[1000]" />
        </MapContainer>

        <div className="absolute top-3 left-3 z-[400] bg-black/75 text-[10px] px-2.5 py-2 rounded-sm border border-[#222] flex flex-col gap-1">
          <div className="flex items-center gap-2 text-neutral-300"><FlaskConical className="h-3 w-3 text-[#4CAF50]" /> Click a spot to review it</div>
          <div className="flex items-center gap-2 text-neutral-500"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#525252" }} /> Grey: removed (not a weed)</div>
          <div className="flex items-center gap-2 text-neutral-500"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: "#38bdf8" }} /> Blue ring: on Field View and the Flight Planner</div>
          <div className="text-neutral-500">Solid: saved to the archive</div>
        </div>
      </div>

      <aside className="w-[400px] shrink-0 border-l border-[#1f1f1f] flex flex-col min-h-0" style={{ background: "#121212" }}>
        {/* Header and run */}
        <div className="p-4 border-b border-[#1f1f1f] space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold inline-flex items-center gap-2"><FlaskConical className="h-4 w-4 text-[#4CAF50]" /> Weed Scout</h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowAbout(s => !s)} className="text-[10px] underline text-neutral-500 hover:text-neutral-300">{showAbout ? "hide" : "what is this?"}</button>
              <span className="text-[10px] uppercase tracking-wider text-amber-400/90 border border-amber-400/40 rounded-sm px-1.5 py-0.5">Experimental</span>
            </div>
          </div>
          {showAbout && (
            <p className="text-[11px] text-neutral-500">
              Tiles the field, marks what is not average, fits crop rows where there are any, sweeps the field at full depth
              for small plants, and shows you spots to keep or remove. It learns from what you save. Everything runs in this
              browser; nothing here names a species from the pixels.
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {!running ? (
              <button type="button" onClick={run} disabled={!tileUrl || busy} className={btnPrimary}><Play className="h-3.5 w-3.5" /> Scan this field</button>
            ) : (
              <button type="button" onClick={() => stopRun(taskId)} className={btnQuiet}><Square className="h-3.5 w-3.5" /> Stop</button>
            )}
            {progress && (
              <div className="text-[11px] text-neutral-400 inline-flex items-center gap-1.5 min-w-0">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                <span className="truncate">{STAGE_LABEL[progress.stage]}{progress.fraction != null ? ` ${Math.round(progress.fraction * 100)}%` : ""}</span>
              </div>
            )}
            {running && <span className="text-[10px] text-neutral-600">keeps running if you open another tab</span>}
            {!running && feedback.length > 0 && <span className="text-[10px] text-neutral-600" title="Spots that resemble ones you dismissed start removed and rank lower; spots that resemble ones you confirmed start as weeds and rank higher. Needs at least three similar saved verdicts.">learning from {feedback.length} saved verdict{feedback.length === 1 ? "" : "s"}</span>}
          </div>
          {runError && <div className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {runError}</div>}
          <details className="text-[11px]">
            <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
              Settings: {params.rowMode === "none" ? "not a row crop" : params.rowMode === "rows" ? `rows at ${rowSpacingShown} ${rowSpacingUnit}` : "detect rows"},
              {" "}{params.autoTile ? "auto tiles" : `${params.tileM} m tiles`}, headland {params.headlandM} m{params.sweep ? ", full-depth sweep" : ""}
            </summary>
            <div className="grid grid-cols-2 gap-3 pt-3">
              <div className="col-span-2">
                <label className={labelCls}>Crop pattern</label>
                <div className="inline-flex rounded-sm border border-[#222] bg-[#0f0f0f] overflow-hidden">
                  {([{ v: "auto", label: "Detect rows" }, { v: "rows", label: "Row crop" }, { v: "none", label: "Not a row crop" }] as const).map(o => (
                    <button key={o.v} type="button" onClick={() => setParams(p => ({ ...p, rowMode: o.v }))}
                      className={`px-2.5 py-1 text-[11px] ${params.rowMode === o.v ? "bg-[#4CAF50] text-black font-semibold" : "text-neutral-400 hover:text-neutral-200"}`}>{o.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Tile size (m)</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={20} step={0.5} className={inputCls} value={params.tileM} disabled={params.autoTile}
                    onChange={e => setParams(p => ({ ...p, tileM: Math.max(1, Number(e.target.value) || 3) }))} />
                  <label className="text-[11px] text-neutral-400 inline-flex items-center gap-1 shrink-0 cursor-pointer">
                    <input type="checkbox" checked={params.autoTile} onChange={e => setParams(p => ({ ...p, autoTile: e.target.checked }))} className="accent-[#4CAF50]" /> auto
                  </label>
                </div>
              </div>
              <div>
                <label className={labelCls}>Row spacing ({rowSpacingUnit})</label>
                <input type="number" min={1} step={0.5} className={inputCls} value={rowSpacingShown} disabled={params.rowMode === "none"}
                  onChange={e => { const v = Number(e.target.value); if (v > 0) setRowSpacingShown(v); }} />
              </div>
              <div>
                <label className={labelCls}>Headland (m)</label>
                <input type="number" min={0} max={60} step={1} className={inputCls} value={params.headlandM}
                  onChange={e => setParams(p => ({ ...p, headlandM: Math.max(0, Number(e.target.value) || 0) }))} />
              </div>
              <div>
                <label className={labelCls}>Flag tiles beyond (z)</label>
                <input type="number" min={1.5} max={10} step={0.5} className={inputCls} value={params.anomalyZ}
                  onChange={e => setParams(p => ({ ...p, anomalyZ: Math.max(1.5, Number(e.target.value) || 3.5) }))} />
              </div>
              <div>
                <label className={labelCls}>Flag plants beyond (z)</label>
                <input type="number" min={1.5} max={10} step={0.5} className={inputCls} value={params.blobZ}
                  onChange={e => setParams(p => ({ ...p, blobZ: Math.max(1.5, Number(e.target.value) || 3.5) }))} />
              </div>
              <div>
                <label className={labelCls}>Sweep windows (max)</label>
                <input type="number" min={0} max={2000} step={50} className={inputCls} value={params.maxSweepWindows}
                  onChange={e => setParams(p => ({ ...p, maxSweepWindows: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
              </div>
              <div className="col-span-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                  <input type="checkbox" checked={params.sweep} onChange={e => setParams(p => ({ ...p, sweep: e.target.checked }))} className="accent-[#4CAF50]" />
                  Sweep the whole field at full depth
                </label>
                <div className="text-[11px] text-neutral-500">{crop || "crop not set"}{stage ? `, ${stage}` : ""}</div>
              </div>
            </div>
          </details>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Results summary and bulk actions */}
          {result && (
            <section className="p-4 border-b border-[#1f1f1f] space-y-2">
              <div className="text-xs text-neutral-200">
                {candidates.length === 0
                  ? "Nothing stood out at these settings. That is a result, not an absence."
                  : <>{candidates.length} spot{candidates.length === 1 ? "" : "s"}: <span className="text-[#4CAF50]">{kept.length} kept as weeds</span>, {removed.length} removed, {unsure} unsure{savedCount ? `, ${savedCount} saved` : ""}.</>}
              </div>
              {candidates.length > 0 && (
                <>
                  <p className="text-[11px] text-neutral-500">Click a spot on the map or in the list. Press its X to remove a wrong one. Then save everything at once.</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={saveAll} disabled={busy || !user || !context} className={btnPrimary}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {bulk.phase === "saving" ? `Saving ${bulk.done}/${bulk.total}` : `Save all ${candidates.length} to the field`}
                    </button>
                    <span className="text-[11px] text-neutral-400">
                      puts the {kept.length} kept weed spot{kept.length === 1 ? "" : "s"} on Field View and the Flight Planner and takes removed ones off
                    </span>
                  </div>
                  {bulk.error && <div className="text-[11px] text-red-400">{bulk.error}</div>}
                  {!user && <div className="text-[11px] text-neutral-500">Sign in to save.</div>}
                </>
              )}
              <details className="text-[11px]">
                <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">Run details</summary>
                <div className="pt-2 space-y-1">
                  {context && <p className="text-neutral-400 leading-relaxed"><MapPin className="inline h-3 w-3 text-[#4CAF50] mr-1" />{describeEvent(context)}</p>}
                  <Row k="Tiles" v={`${result.tiles.length.toLocaleString()} at ${result.tileM} m${params.autoTile ? " (auto)" : ""}, ${result.baselineTiles.toLocaleString()} in the baseline`} />
                  <Row k="Rows" v={result.rowsUsed} />
                  {result.canopyClosed && <Row k="Canopy" v="closed: regions only, no plant-level detection" />}
                  <Row k="Base pass" v={`${fmtLengthCm(result.gsdM * 100, units).text}/px`} />
                  <Row k="Sweep" v={result.sweep.ran ? `${result.sweep.windows} windows at ${fmtLengthCm((result.sweep.gsdM ?? 0) * 100, units).text}/px` : "not run"} />
                  <Row k="Smallest measurable" v={fmtLengthCm(result.smallestMeasurableM * 100, units).text} />
                  <Row k="Plants measured" v={result.blobCount.toLocaleString()} />
                  <Row k="Regions" v={`${result.regions.length} (${areaText(result.regions.reduce((s, r) => s + r.areaM2, 0))})`} />
                  {result.rows?.usable && <Row k="Row model" v={`confidence ${result.rows.confidence.toFixed(2)}, ${result.rows.medianAngleDeg.toFixed(0)} deg, pitch ${fmtLengthCm(result.rows.medianPitchM * 100, units).text}`} />}
                  <Row k="Candidates" v={`${candidates.length} (${regionCandidates.length} regions, ${pointCandidates.length} points)`} />
                  {result.notes.map((n, i) => (
                    <div key={i} className="text-neutral-500 flex items-start gap-1.5 pt-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-500/80" /> {n}</div>
                  ))}
                </div>
              </details>
            </section>
          )}

          {/* Selected spot */}
          {selected && (
            <section className="p-4 border-b border-[#1f1f1f] space-y-3" style={{ background: "#151515" }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={labelCls}>Spot #{selectedIndex + 1} of {candidates.length}</div>
                  <div className="text-xs text-neutral-200 truncate">{nameOf(selected)}</div>
                  <div className="text-[10px] text-neutral-500">{describeCandidate(selected, units)}</div>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} className="text-neutral-500 hover:text-neutral-200"><X className="h-3.5 w-3.5" /></button>
              </div>
              {selected.chip ? (
                <div>
                  <img src={selected.chip} alt="Chip of the spot" className="w-full rounded-sm border border-[#222]" style={{ imageRendering: "pixelated" }} />
                  <div className="text-[10px] text-neutral-500 mt-1">
                    {selected.chipSpanM ? `${fmtDistance(selected.chipSpanM, units).text} across` : ""}
                    {selected.chipGsdM ? ` at ${fmtLengthCm(selected.chipGsdM * 100, units).text}/px, real pixels, north up` : ""}
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-neutral-500">No close-up for this spot (only the top {params.maxChips} get one). Its location is highlighted on the map.</div>
              )}

              {/* Verdict: one click */}
              <div className="grid grid-cols-3 gap-1">
                {VERDICTS.map(v => {
                  const on = verdictOf(selected) === v.value || (v.value === "not_weed" && isDismissal(verdictOf(selected)));
                  const tone = v.value === "weed" ? "bg-[#4CAF50] text-black border-[#4CAF50]" : v.value === "not_weed" ? "bg-[#525252] text-white border-[#525252]" : "bg-amber-400 text-black border-amber-400";
                  return (
                    <button key={v.value} type="button" onClick={() => setVerdict(selected, v.value)}
                      className={`text-[11px] rounded-sm px-2 py-1.5 border font-semibold ${on ? tone : "border-[#222] text-neutral-300 hover:bg-[#1f1f1f]"}`}>
                      {v.label}
                    </button>
                  );
                })}
              </div>

              {/* Identification */}
              {!isDismissal(verdictOf(selected)) && (
                <div className="border border-[#222] rounded-sm p-3 space-y-2" style={{ background: "#161616" }}>
                  <div className={labelCls}>What weed is it? (your call)</div>
                  {suggestion && identification.status !== "confirmed" && identification.status !== "rejected" && (
                    <div className="border border-[#38bdf8]/40 rounded-sm p-2 space-y-1.5" style={{ background: "#0f171c" }}>
                      <div className="text-[11px] text-neutral-200">
                        Suggested: <span className="font-semibold">{suggestion.entry.common_name}</span>{" "}
                        <span className="italic text-neutral-400">{suggestion.entry.scientific_name_as_source}</span>
                        <span className="ml-1 text-[9px] uppercase tracking-wider text-[#7dd3fc] border border-[#38bdf8]/40 rounded-sm px-1">suggested</span>
                      </div>
                      <div className="text-[10px] text-neutral-400">{suggestion.basis}</div>
                      <div className="text-[10px] text-neutral-500">{evidenceLabel(suggestion.entry)}. {presenceNote(suggestion.entry)}</div>
                      {regulatoryNote(suggestion.entry) && <div className="text-[10px] text-amber-400/90">{regulatoryNote(suggestion.entry)}</div>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button type="button" onClick={confirmSuggestion} className="text-[11px] bg-[#38bdf8] hover:bg-[#0ea5e9] text-black rounded-sm px-2.5 py-1 font-semibold">Confirm</button>
                        <button type="button" onClick={() => setIdent(REJECTED)} className="text-[11px] border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] rounded-sm px-2.5 py-1">Reject</button>
                        <a href={`/app/weeds?id=${encodeURIComponent(suggestion.entry.catalog_id)}`} target="_blank" rel="noreferrer" className="text-[10px] underline text-neutral-400 inline-flex items-center gap-1">Weed Library <ExternalLink className="h-3 w-3" /></a>
                      </div>
                    </div>
                  )}
                  {identification.status !== "unidentified" ? (
                    <div className="text-[11px] flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {identification.status === "rejected" ? (
                          <span className="text-neutral-400">Suggestion rejected. Not identified.</span>
                        ) : (
                          <>
                            <span className="text-[#7dd3fc] font-semibold">{identification.label}</span>
                            <span className="ml-1 text-[9px] uppercase tracking-wider text-[#7dd3fc] border border-[#38bdf8]/40 rounded-sm px-1">{identification.status === "confirmed" ? "user confirmed" : "user identified"}</span>
                            <div className="text-[10px] text-neutral-600 break-all">Source: {identification.source}</div>
                            {identification.catalogId && (
                              <a href={`/app/weeds?id=${encodeURIComponent(identification.catalogId)}`} target="_blank" rel="noreferrer" className="text-[10px] underline text-neutral-400 inline-flex items-center gap-1">Open in Weed Library <ExternalLink className="h-3 w-3" /></a>
                            )}
                          </>
                        )}
                      </div>
                      <button type="button" onClick={() => { setIdent(UNIDENTIFIED); setFreeText(""); }} className="text-[10px] underline text-neutral-500 hover:text-neutral-200 shrink-0">Change</button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-neutral-500">Not identified. <span className="text-[9px] uppercase tracking-wider border border-[#333] rounded-sm px-1">unidentified</span> It stays a weed spot without a name unless you pick one.</div>
                  )}
                  {(identification.status === "unidentified" || identification.status === "rejected") && (
                    <>
                      <div className="relative">
                        <input className={inputCls}
                          placeholder={catalog.length ? `Search the ${region.stateName} list by common or scientific name` : catalogError ? "Reference list unavailable" : "Reference list loading"}
                          value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} disabled={!catalog.length} />
                        {pickerResults.length > 0 && (
                          <ul className="mt-1 border border-[#222] rounded-sm divide-y divide-[#1f1f1f] max-h-56 overflow-y-auto" style={{ background: "#0f0f0f" }}>
                            {pickerResults.map(({ entry: e, why }) => (
                              <li key={e.catalog_id}>
                                <button type="button" onClick={() => pickEntry(e, why)} className="w-full text-left px-2 py-1.5 hover:bg-[#1a1a1a]">
                                  <div className="text-[11px] text-neutral-200">
                                    {e.common_name} <span className="italic text-neutral-500">{e.scientific_name_as_source}</span>
                                    {e.regulatory_tier && <span className="ml-1 text-[9px] uppercase tracking-wider text-amber-400/90 border border-amber-400/40 rounded-sm px-1">{e.regulatory_tier} noxious (legal status)</span>}
                                    {e.usda_status === "unmatched_requires_review" && <span className="ml-1 text-[9px] uppercase tracking-wider text-neutral-500 border border-[#333] rounded-sm px-1">name unresolved</span>}
                                  </div>
                                  <div className="text-[10px] text-neutral-500">{evidenceLabel(e)}. {why}</div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {pickerQuery.trim() && catalog.length > 0 && pickerResults.length === 0 && (
                          <div className="text-[10px] text-neutral-500 mt-1">No name in the {region.stateName} list matches. Type it below if you know it.</div>
                        )}
                      </div>
                      <input className={inputCls} placeholder="Or type a name or group yourself" value={freeText} onChange={e => typeName(e.target.value)} maxLength={120} />
                      <div className="text-[10px] text-neutral-600">{narrowed.note}</div>
                    </>
                  )}
                </div>
              )}

              <input className={inputCls} placeholder="Notes" value={notesOf(selected)} onChange={e => setNotesById(m => ({ ...m, [selected.id]: e.target.value }))} maxLength={300} />

              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={saveSelected} disabled={singleBusy !== null || busy || !user || !context} className={btnQuiet}>
                  {singleBusy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saved[selected.id] ? "Update this spot" : "Save this spot to the field"}
                </button>
                {applied[selected.id] ? (
                  <>
                    <span className="text-[11px] text-[#38bdf8] inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> On the field</span>
                    <button type="button" onClick={() => setActiveTab("field")} className="text-[11px] underline text-neutral-300 hover:text-white">Field View</button>
                    <button type="button" onClick={() => setActiveTab("planner")} className="text-[11px] underline text-neutral-300 hover:text-white">Flight Planner</button>
                  </>
                ) : saved[selected.id] ? (
                  <span className="text-[11px] text-[#4CAF50] inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Saved{verdictOf(selected) === "weed" ? "" : ", not on the field"}</span>
                ) : null}
              </div>
              <div className="text-[10px] text-neutral-600">
                Saving writes your review and puts this spot on Field View and the Flight Planner if it is kept as a weed; removed or unsure spots stay off the field.
              </div>
              {singleError && <div className="text-[11px] text-red-400">{singleError}</div>}

              <details className="text-[11px]">
                <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">Measurements and description</summary>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2">
                  <Dt k="Score" v={selected.score.toFixed(2)} />
                  {selected.region ? (
                    <>
                      <Dt k="Area" v={areaText(selected.areaM2)} />
                      <Dt k="Tiles" v={`${selected.region.tileCount} (${selected.region.coreTiles} core)`} />
                      <Dt k="Deviation" v={`mean ${selected.region.meanStrength.toFixed(1)}, max ${selected.region.maxStrength.toFixed(1)}`} />
                      <Dt k="Drivers" v={selected.region.drivers.map(d => `${d.feature} ${d.z > 0 ? "+" : "-"}${Math.abs(d.z).toFixed(1)}`).join("; ")} />
                    </>
                  ) : (
                    <>
                      <Dt k="Off row" v={selected.distanceToRowM != null ? fmtLengthCm(Math.abs(selected.distanceToRowM) * 100, units).text : "no row model"} />
                      <Dt k="Unlike plants" v={selected.blobZ != null ? `${selected.blobZ.toFixed(1)} z on ${selected.blobZFeature}` : "within the field's plants"} />
                      <Dt k="Tile deviation" v={selected.anomalyZ != null ? `${selected.anomalyZ.toFixed(1)} z on ${selected.anomalyFeature}` : "within the field average"} />
                      <Dt k="Size" v={selected.blob ? `${fmtLengthCm(selected.blob.equivDiameterM * 100, units).text}, ${fmtAreaCm2(selected.blob.areaM2 * 1e4, units).text}` : "no vegetation"} />
                      <Dt k="Greenness" v={selected.blob ? selected.blob.exgMean.toFixed(3) : "n/a"} />
                      <Dt k="Measured at" v={selected.blob ? `${fmtLengthCm(selected.blob.gsdM * 100, units).text}/px` : "n/a"} />
                    </>
                  )}
                </dl>
                {selected.estimate && (
                  <div className="mt-2 space-y-1 text-neutral-400">
                    <p className="text-neutral-200">{selected.estimate.summary}</p>
                    <p>{selected.estimate.positionNote}</p>
                    <p>{selected.estimate.seasonNote}</p>
                    {selected.feedback && <p className={selected.feedback.factor < 1 ? "text-neutral-500" : "text-[#4CAF50]"}>{describeFeedback(selected.feedback)}</p>}
                    <p>To confirm on the ground: {selected.estimate.whatWouldConfirm.join(" ")}</p>
                    <p className="text-neutral-600">{selected.estimate.caveats.join(" ")}</p>
                    <p className="text-neutral-600 font-mono">{selected.estimate.model}, computed in this browser. Spot id {selected.id}</p>
                  </div>
                )}
              </details>
            </section>
          )}

          {/* Spot list */}
          {result && candidates.length > 0 && (
            <section>
              <div className="px-4 pt-3 pb-1"><div className={labelCls}>Spots, strongest first</div></div>
              <ul>
                {candidates.map((c, i) => {
                  const v = verdictOf(c);
                  const gone = isDismissal(v);
                  return (
                    <li key={c.id} className={`flex items-center gap-2 border-t border-[#1a1a1a] pr-2 ${c.id === selectedId ? "bg-[#1a1a1a]" : "hover:bg-[#181818]"} ${gone ? "opacity-50" : ""}`}>
                      <button type="button" onClick={() => setSelectedId(c.id)} className="flex-1 min-w-0 text-left px-4 py-1.5 flex items-center gap-2">
                        {c.chip ? (
                          <img src={c.chip} alt="" className="h-8 w-8 rounded-sm object-cover shrink-0 border border-[#222]" style={{ imageRendering: "pixelated" }} />
                        ) : (
                          <span className="h-8 w-8 rounded-sm shrink-0 border border-[#222] grid place-items-center"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: spotColour(c) }} /></span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="text-xs text-neutral-200 flex items-center gap-1.5">
                            <span className="font-mono text-neutral-500">#{i + 1}</span>
                            <span className="truncate">{nameOf(c)}</span>
                            {saved[c.id] && <CheckCircle2 className="h-3 w-3 text-[#4CAF50] shrink-0" />}
                            {applied[c.id] && <MapPin className="h-3 w-3 text-[#38bdf8] shrink-0" />}
                          </span>
                          <span className={`text-[10px] ${v === "weed" ? "text-[#4CAF50]" : gone ? "text-neutral-500" : "text-amber-400"}`}>
                            {VERDICT_LABEL[v]}{isStatedFinding(identificationOf(c)) ? ", identified" : ""}
                            {!verdicts[c.id] && !saved[c.id] && c.feedback && c.feedback.factor !== 1 && <span className="text-neutral-600"> (from your past verdicts)</span>}
                          </span>
                        </span>
                      </button>
                      <button type="button" title={gone ? "Put it back" : "Not a weed: remove"} onClick={() => setVerdict(c, gone ? defaultVerdict(c) : "not_weed")}
                        className={`shrink-0 h-6 w-6 grid place-items-center rounded-sm border ${gone ? "border-[#333] text-neutral-500 hover:text-neutral-200" : "border-[#333] text-neutral-400 hover:border-red-500 hover:text-red-400"}`}>
                        {gone ? <Play className="h-3 w-3 rotate-180" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-neutral-500 shrink-0">{k}</span>
      <span className="text-neutral-200 text-right">{v}</span>
    </div>
  );
}

function Dt({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-neutral-200 font-mono text-right break-words">{v}</dd>
    </>
  );
}

export default WeedScoutTab;
