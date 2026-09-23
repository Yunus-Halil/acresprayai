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
import { CircleMarker, MapContainer, Polygon, Popup, TileLayer, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, FlaskConical, Loader2, MapPin, Play, Square,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { type FarmerSettings, growthStage } from "@/lib/farmerSettings";
import type { LatLng2 } from "@/lib/geo";
import { storageKey } from "@/lib/storage";
import { fmtArea, fmtLengthCm } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { describeCandidate } from "@/lib/weedScout/candidates";
import { type AppliedAnnotation, annotationFromCandidate } from "@/lib/weedScout/applyToField";
import { type EventContext, describeEvent, fetchEventContext } from "@/lib/weedScout/context";
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
} from "@/lib/weedCatalog/identification";
import { cropContextFor, fieldRegion } from "@/lib/weedCatalog/region";
import { loadCatalog } from "@/lib/weedCatalog/repo";
import {
  type Suggestion, cropShortlist, narrowCatalog, recentLabels, searchRanked, suggestionsFor,
} from "@/lib/weedCatalog/suggest";
import { plannedAreaM2, plannedZones } from "@/lib/treatment/plannedArea";
import { ScanSummary } from "./ScanSummary";
import { SpotPopup } from "./SpotPopup";
import type { CatalogEntry } from "@/lib/weedCatalog/types";
import { type BasemapId, BasemapLayer, BasemapToggle, FitBounds, MouseReadout, loadBasemap, saveBasemap } from "./layers";
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

/**
 * The colour of a decision, not of a measurement.
 *
 * The map's job here is to show what the scout already decided about every
 * spot, so the operator can find the wrong ones at a glance rather than read
 * a list. The class still tints the fill, but the outline is the verdict.
 */
const VERDICT_COLOUR: Record<string, string> = {
  weed: "#4CAF50",
  not_weed: "#525252",
  unsure: "#fbbf24",
  crop: "#525252",
  not_vegetation: "#525252",
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
  applyAnnotation, removeAnnotation, appliedSpots, fieldAreaHa, cursorCoordRef, cursorZoomRef,
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
   * The workspace's shared bottom-status-bar readout. This tab only exists
   * while it is the one on screen, so it always owns the bar while mounted -
   * unlike Field View, which stays mounted hidden and needs its own guard.
   */
  cursorCoordRef?: React.MutableRefObject<HTMLDivElement | null>;
  cursorZoomRef?: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * Writes an ordinary `user_annotations` row, the same shape a hand-drawn
   * polygon produces, plus the spot id and the operator's identification if
   * they made one. Resolves to the new row's id, or null on failure.
   */
  applyAnnotation: (input: AppliedAnnotation & { spot_id?: string | null; weed_observation_id?: string | null }) => Promise<string | null>;
  removeAnnotation: (id: string) => Promise<void>;
  /** Spot id to annotation id, for spots already on Field View. */
  appliedSpots: Record<string, string>;
  /**
   * The field's own area, hectares, or null when no boundary area is on file.
   * Only used to say what share of the field needs nothing; with no number
   * here the results screen says so rather than inventing a percentage.
   */
  fieldAreaHa: number | null;
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
  // The map says what the scout thinks without being asked. Thirty labels on a
  // small field can crowd each other, so it is a toggle, defaulting to on.
  const [showLabels, setShowLabels] = useState(true);

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
  // The state's crop-guide list for this crop, and whether it is short enough
  // for any member of it to be favoured. For every crop in Virginia's catalog
  // it is not: see cropShortlist.
  const shortlist = useMemo(() => cropShortlist(narrowed.ranked, cropContext, region), [narrowed, cropContext, region]);
  // The operator's own vocabulary, for the chips. Not a claim about any spot.
  const recent = useMemo(() => recentLabels(feedback, fieldId), [feedback, fieldId]);

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

  // ---- How much ground, answered by the planner's own function -------------
  //
  // Not by summing the areas these spots would store. The planner ignores
  // those: it drops any zone centred outside the boundary, insets the rest by
  // the headland and re-measures (lib/treatment/plannedArea.ts). Calling the
  // same function here is the only way the acreage on this screen and the
  // acreage one tab over can be the same number, and a region wide enough to
  // take a headland is where they used to differ most.
  const plannedById = useMemo(() => {
    const rings = candidates.map(c => ({ id: c.id, ring: annotationFromCandidate(c).ring, source: "user" as const }));
    const planned = plannedZones(rings, rings.length ? (boundary as LatLng2[][] | null) : null, params.headlandM);
    return new Map(planned.map(z => [z.id, z.areaM2]));
  }, [candidates, boundary, params.headlandM]);
  /** Planned area for one spot, or null when the planner would not carry it. */
  const areaOf = useCallback((c: Candidate): number | null => plannedById.get(c.id) ?? null, [plannedById]);

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

  /**
   * Whether a spot has anything left to write.
   *
   * Saving is one network round trip per spot, in sequence, and a scan can
   * carry hundreds. A spot whose archive row is already written, which the
   * operator has not touched this run, and whose presence on the field already
   * matches its verdict has nothing to say, so it is not said again. The last
   * of those three matters as much as the others: a spot saved as a weed whose
   * annotation was deleted from Field View is not in agreement with the
   * archive, and "already saved" must not be read as "already correct".
   */
  const isDirty = useCallback((c: Candidate): boolean => {
    if (!saved[c.id]) return true;
    if (c.id in verdicts || c.id in identifications || c.id in notesById) return true;
    return (verdictOf(c) === "weed") !== !!applied[c.id];
  }, [saved, verdicts, identifications, notesById, applied, verdictOf]);

  /** Save every spot that has something to write; kept weed spots land on the field, removed ones come off it. */
  const saveAll = useCallback(async () => {
    if (!candidates.length || bulk.phase !== "idle") return;
    const pending = candidates.filter(isDirty);
    if (!pending.length) {
      setBulk({ phase: "idle", done: 0, total: 0, failed: 0, error: null });
      return;
    }
    let failed = 0;
    setBulk({ phase: "saving", done: 0, total: pending.length, error: null, failed: 0 });
    for (let i = 0; i < pending.length; i++) {
      const err = await saveAndSync(pending[i]);
      if (err) failed += 1;
      setBulk(b => ({ ...b, done: i + 1, failed }));
    }
    setBulk({ phase: "idle", done: 0, total: 0, failed, error: failed ? `${failed} spot${failed === 1 ? "" : "s"} could not be saved. Check your connection and save again; nothing is duplicated.` : null });
    loadFeedback().then(setFeedback).catch(() => { /* keep */ });
  }, [candidates, bulk.phase, saveAndSync, isDirty]);

  /**
   * Save everything, then hand over to the Flight Planner.
   *
   * The hand-off is the whole point of the button: the planner already groups
   * these zones by what the operator said they are, prices them at the rates
   * the operator already set, and refuses to compute quantities it cannot
   * defend. Nothing about a product or a rate is decided here.
   */
  const buildMission = useCallback(async () => {
    await saveAll();
    setActiveTab("planner");
  }, [saveAll, setActiveTab]);

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
  /**
   * A name the operator has used before. If it is in the catalog it is picked
   * as that entry, with the entry's source; if it is not, it is their own text,
   * recorded as such. Either way it is their statement, never a suggestion.
   */
  const pickName = (name: string) => {
    if (!selected) return;
    const hit = narrowed.ranked.find(r => r.entry.common_name.toLowerCase() === name.trim().toLowerCase());
    if (hit) { pickEntry(hit.entry, `You have used this name before. ${hit.why}`); return; }
    setIdent(identificationFromText(name));
    setPickerQuery(""); setFreeText("");
    if (verdictOf(selected) !== "weed") setVerdict(selected, "weed");
  };
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
  const rowSpacingShown = units === "metric" ? (params.rowSpacingM * 100).toFixed(1) : (params.rowSpacingM / 0.0254).toFixed(1);
  const rowSpacingUnit = units === "metric" ? "cm" : "in";
  const setRowSpacingShown = (v: number) => setParams(p => ({ ...p, rowSpacingM: units === "metric" ? v / 100 : v * 0.0254 }));
  const areaText = (m2: number) => fmtArea(m2, units).text;
  const busy = bulk.phase !== "idle";
  const spotColour = (c: Candidate) => (c.region ? CLASS_COLOUR[c.region.klass] : KIND_COLOUR[c.kind]);
  /** What the map says about a spot without being clicked. Short, or it crowds. */
  const spotLabel = (c: Candidate): string => {
    const id = identificationOf(c);
    if (isStatedFinding(id)) return id.label!;
    if (c.region) return c.region.klass;
    return c.kind;
  };

  /** The identification wiring, handed to every spot's popup. */
  const identificationProps = {
    shortlist, recent,
    searchResults: pickerResults,
    searchQuery: pickerQuery,
    onSearchQuery: setPickerQuery,
    freeText,
    onFreeText: typeName,
    listNote: narrowed.note,
    region,
    catalogSize: catalog.length,
    catalogError,
    onConfirmSuggestion: confirmSuggestion,
    onSetIdentification: setIdent,
    onPickEntry: pickEntry,
    onPickRecent: pickName,
  };

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
          {cursorCoordRef && cursorZoomRef && <MouseReadout coordRef={cursorCoordRef} zoomRef={cursorZoomRef} />}
          {rings.map((r, i) => (
            <Polygon key={i} positions={r.map(p => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#4CAF50", weight: 1.5, fill: false, dashArray: "4 4" }} />
          ))}
          {/* Every spot carries its own decision and its own review panel.
              The outline is the verdict, the fill is what it reads as, and the
              popup is where the operator disagrees with either. */}
          {candidates.map((c, i) => {
            const v = verdictOf(c);
            const gone = isDismissal(v);
            const active = c.id === selectedId;
            const klass = spotColour(c);
            const outline = active ? "#ffffff" : VERDICT_COLOUR[v] ?? klass;
            const label = spotLabel(c);
            const popup = (
              <Popup closeOnClick={false} maxWidth={400} minWidth={300} autoPan
                eventHandlers={{ remove: () => setSelectedId(null) }}>
                <SpotPopup
                  candidate={c}
                  index={i}
                  total={candidates.length}
                  units={units}
                  areaM2={areaOf(c)}
                  verdict={v}
                  onVerdict={next => setVerdict(c, next)}
                  identification={identificationOf(c)}
                  suggestion={suggestionById.get(c.id) ?? null}
                  notes={notesOf(c)}
                  onNotes={text => setNotesById(m => ({ ...m, [c.id]: text }))}
                  saved={!!saved[c.id]}
                  onField={!!applied[c.id]}
                  {...identificationProps}
                />
              </Popup>
            );
            const tooltip = showLabels && (
              <Tooltip permanent direction="top" opacity={1} className="scout-label">
                {label}
              </Tooltip>
            );
            if (c.region) {
              return (
                <Polygon key={c.id}
                  positions={c.region.rings.map(ring => ring.map(p => [p.lat, p.lng] as [number, number]))}
                  eventHandlers={{ click: () => setSelectedId(c.id) }}
                  pathOptions={{
                    color: outline,
                    weight: active ? 3 : gone ? 1 : 2,
                    fillColor: gone ? "#525252" : klass,
                    fillOpacity: gone ? 0.06 : saved[c.id] ? 0.4 : 0.22,
                    dashArray: gone ? "3 3" : undefined,
                  }}>
                  {tooltip}
                  {popup}
                </Polygon>
              );
            }
            return (
              <CircleMarker key={c.id} center={[c.centroid.lat, c.centroid.lng]}
                radius={active ? 10 : gone ? 4 : 7}
                eventHandlers={{ click: () => setSelectedId(c.id) }}
                pathOptions={{
                  color: outline,
                  weight: active ? 3 : 2,
                  fillColor: gone ? "#525252" : klass,
                  fillOpacity: gone ? 0.15 : saved[c.id] ? 0.9 : 0.5,
                }}>
                {tooltip}
                {popup}
              </CircleMarker>
            );
          })}
          <BasemapToggle value={basemap} onChange={(id) => { setBasemap(id); saveBasemap(id); }} className="absolute bottom-4 right-4 z-[1000]" />
        </MapContainer>

        <div className="absolute top-3 left-3 z-[400] bg-black/75 text-[10px] px-2.5 py-2 rounded-sm border border-[#222] flex flex-col gap-1">
          <div className="flex items-center gap-2 text-neutral-300"><FlaskConical className="h-3 w-3 text-[#4CAF50]" /> Click a spot to change it</div>
          {/* The outline is the decision. Everything is already decided. */}
          <div className="flex items-center gap-2 text-neutral-400"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: VERDICT_COLOUR.weed }} /> Kept as a weed</div>
          <div className="flex items-center gap-2 text-neutral-400"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: VERDICT_COLOUR.unsure }} /> Unsure, left off the field</div>
          <div className="flex items-center gap-2 text-neutral-500"><span className="inline-block w-3 h-3 rounded-full border-2 border-dashed" style={{ borderColor: VERDICT_COLOUR.not_weed }} /> Removed</div>
          <div className="text-neutral-500">Fill colour is what it reads as. Solid: saved.</div>
          <label className="flex items-center gap-2 cursor-pointer pt-0.5 border-t border-[#222] mt-0.5">
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} className="accent-[#4CAF50]" />
            Labels on the map
          </label>
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
          {/* What the scan found, and the hand-off. The spots themselves are
              reviewed on the map by clicking them, not from a list here. */}
          {result && (
            <>
              <ScanSummary
                spots={candidates.length}
                kept={kept.length}
                removed={removed.length}
                unsure={unsure}
                treatAreaM2={plannedAreaM2(kept.map(c => ({ areaM2: areaOf(c) ?? 0 })))}
                fieldAreaM2={fieldAreaHa != null && fieldAreaHa > 0 ? fieldAreaHa * 10_000 : null}
                units={units}
                onBuildMission={buildMission}
                building={bulk.phase === "saving" ? { done: bulk.done, total: bulk.total } : null}
                buildError={bulk.error}
                canBuild={!!user && !!context}
              />
            <section className="p-4 border-b border-[#1f1f1f] space-y-2">
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
            </>
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
