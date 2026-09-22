// Weed Scout: the experimental, developer-mode replacement for the Treatment
// Grid tab.
//
// The screen runs lib/weedScout end to end over the scan on screen and shows
// what came out: not-average regions as shapes with an area, single odd tiles
// and plants as points, and for each candidate the chip, the measurements,
// the in-house description, what the archive said about things like it, and
// the operator's verdict. Saving a verdict writes an observation to the
// archive, which the next run learns from; nothing is written by the run
// itself.
//
// Everything on this screen is a candidate, never a verdict. The only place
// the word "weed" is applied to a plant is the verdict button the operator
// presses. Nothing here calls anything outside the tile server and the
// operator's own archive.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, CheckCircle2, FlaskConical, Loader2, MapPin, Play, Save, Square, X,
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
  type ObservationRow, type Verdict, VERDICTS, identificationColumns, listObservations, loadFeedback, saveObservation,
} from "@/lib/weedScout/observations";
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
import { runWeedScout } from "@/lib/weedScout/pipeline";
import {
  type Candidate, type FeedbackRow, type RegionClass, type ScoutParams, type ScoutProgress, type ScoutResult,
  DEFAULT_SCOUT_PARAMS,
} from "@/lib/weedScout/types";
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

const inputCls = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]";
const labelCls = "text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block";

export function WeedScoutTab({
  boundary, tileUrl, bounds, maxNative, fieldId, taskId, scanCreatedAt, settings, center, setActiveTab,
  applyAnnotation, removeAnnotation,
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
  setActiveTab: (k: "field") => void;
  /**
   * Writes an ordinary `user_annotations` row - the same shape a hand-drawn
   * polygon produces. Field View and the Flight Planner already draw and
   * route over that table; nothing about this candidate having come from the
   * scout needs to reach either of them. Resolves to the new row's id, or
   * null on failure - never throws, so a failed apply reads the same way a
   * failed save already does elsewhere on this screen.
   */
  applyAnnotation: (input: AppliedAnnotation & { weed_observation_id?: string | null }) => Promise<string | null>;
  removeAnnotation: (id: string) => Promise<void>;
}) {
  const units = useUnitSystem();
  const { user } = useAuth();
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const [params, setParams] = useState<ScoutParams>(() => {
    const p = loadParams();
    // The field's own headland setting is the honest default for this field.
    return { ...p, headlandM: settings.flight_plan?.boundary_buffer_m ?? p.headlandM };
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScoutProgress | null>(null);
  const [result, setResult] = useState<ScoutResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState<EventContext | null>(null);
  const [saved, setSaved] = useState<Record<string, ObservationRow>>({});
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [notes, setNotes] = useState("");
  // The reference catalog for the field's (assumed) state, and the operator's
  // identification of the selected candidate. The identification is theirs:
  // the scout may put a name on screen only as a suggestion drawn from their
  // own past verdicts (lib/weedCatalog/suggest.ts), and a suggestion is never
  // saved as the label.
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [identification, setIdentification] = useState<Identification>(UNIDENTIFIED);
  const [pickerQuery, setPickerQuery] = useState("");
  const [freeText, setFreeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Candidate id -> the user_annotations row it became. Tracked for this run
  // only: candidate ids are not stable across runs (they derive from blob
  // labelling order), so there is nothing durable to key "already applied"
  // against on reopen - the same limitation the archive's own `saved` lookup
  // already has. Re-running and re-applying the same ground twice is
  // harmless; Field View just shows two overlapping shapes.
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // `boundary` is what changes; the cast is stable per boundary.
  const rings = useMemo(() => (boundary ?? []) as unknown as LatLng2[][], [boundary]);
  const capturedAt = scanCreatedAt ?? new Date().toISOString();
  const crop = settings.crop_type ?? "";
  const stage = growthStage(crop, settings.planting_date);
  const region = fieldRegion();
  const cropContext = cropContextFor(crop);

  useEffect(() => { try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* private mode */ } }, [params]);

  // The reference list, once. A failed read is said, not hidden: the panel
  // then offers free text only.
  useEffect(() => {
    let cancelled = false;
    loadCatalog(region.state)
      .then(rows => { if (!cancelled) { setCatalog(rows); setCatalogError(null); } })
      .catch(e => { if (!cancelled) setCatalogError((e as Error).message); });
    return () => { cancelled = true; };
  }, [region.state]);
  const narrowed = useMemo(() => narrowCatalog(catalog, { region, crop: cropContext }), [catalog, region, cropContext]);

  // The event context for this capture, once. Failure is a context with nulls.
  useEffect(() => {
    let cancelled = false;
    fetchEventContext(center[0], center[1], capturedAt).then(ctx => { if (!cancelled) setContext(ctx); });
    return () => { cancelled = true; };
  }, [center, capturedAt]);

  // What is already in the archive for this scan, and every verdict to learn from.
  const reloadArchive = useCallback(() => {
    listObservations(taskId)
      .then(rows => setSaved(Object.fromEntries(rows.map(r => [r.candidate_id, r]))))
      .catch(() => { /* an empty archive and an unreachable one look the same here; saving will say */ });
    loadFeedback().then(setFeedback).catch(() => setFeedback([]));
  }, [taskId]);
  useEffect(() => { reloadArchive(); }, [reloadArchive]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = useMemo(
    () => result?.candidates.find(c => c.id === selectedId) ?? null,
    [result, selectedId],
  );
  // The suggestion for the selected candidate, if the archive supports one.
  const suggestions = useMemo(() => (selected ? suggestionsFor(selected, catalog) : []), [selected, catalog]);
  const suggestion: Suggestion | null = suggestions[0] ?? null;

  useEffect(() => {
    const row = selectedId ? saved[selectedId] : undefined;
    setVerdict((row?.verdict as Verdict | null) ?? null);
    setNotes(row?.notes ?? "");
    setSaveError(null);
    setPickerQuery("");
    setFreeText("");
    // Restore what the operator said last time, from the archive row. A
    // confirmation whose suggestion is no longer the one on screen (the
    // archive moved on) is restored as the operator's own pick: the label
    // stands on their authority either way, and the database only accepts
    // "confirmed" for the id that was suggested.
    if (!row) { setIdentification(UNIDENTIFIED); return; }
    const status = row.identification_status;
    if (status === "rejected") { setIdentification(REJECTED); return; }
    if ((status === "confirmed" || status === "edited") && row.species) {
      const entry = row.catalog_id ? catalog.find(e => e.catalog_id === row.catalog_id) : undefined;
      if (entry) {
        const stillSuggested = status === "confirmed" && suggestion?.entry.catalog_id === entry.catalog_id;
        setIdentification(identificationFromEntry(entry, stillSuggested ? "confirmed" : "edited",
          row.identification_basis ?? "Picked by the operator from the reference list."));
      } else {
        setIdentification(identificationFromText(row.species));
      }
      return;
    }
    // Legacy rows: free species text typed before identifications existed is
    // the operator's own label, so it is restored as one.
    setIdentification(row.species ? identificationFromText(row.species) : UNIDENTIFIED);
  }, [selectedId, saved, catalog, suggestion]);

  const run = useCallback(async () => {
    if (!rings.length || !tileUrl || running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setRunError(null);
    setResult(null);
    setSelectedId(null);
    try {
      const res = await runWeedScout(
        { boundary: rings, tileUrl, maxNative, params, feedback },
        { onProgress: setProgress, signal: ctrl.signal, context, crop, growthStage: stage, fieldId, unitSystem: units },
      );
      setResult(res);
      setSelectedId(res.candidates[0]?.id ?? null);
    } catch (e) {
      if ((e as Error)?.name !== "Aborted") setRunError((e as Error)?.message ?? String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [rings, tileUrl, maxNative, params, running, feedback, context, crop, stage, fieldId, units]);

  const save = useCallback(async () => {
    if (!selected || !user || !context || !result) return;
    setSaving(true);
    setSaveError(null);
    const suggestionIn = suggestion ? { catalogId: suggestion.entry.catalog_id, basis: suggestion.basis } : null;
    const r = await saveObservation({
      userId: user.id,
      fieldId,
      scanId: taskId,
      candidate: selected,
      context,
      crop,
      growthStage: stage,
      params,
      gsdM: result.sweep.gsdM ?? result.gsdM,
      verdict,
      species: null,
      notes: notes.trim() || null,
      suggestion: suggestionIn,
      identification,
    });
    setSaving(false);
    // strict:false, so the boolean discriminant does not narrow; test the key.
    if ("error" in r) { setSaveError(r.error); return; }
    const idCols = identificationColumns({ species: null, suggestion: suggestionIn, identification });
    setSaved(s => ({
      ...s,
      [selected.id]: {
        id: r.id, candidate_id: selected.id, scan_id: taskId, tile_id: selected.tileId,
        lat: selected.centroid.lat, lng: selected.centroid.lng, captured_at: context.capturedAt,
        place: context.place, local_time: context.localTime, season: context.season,
        kind: selected.kind, score: selected.score, chip_path: null,
        verdict, species: idCols.species, notes: notes.trim() || null,
        created_at: new Date().toISOString(),
        suggested_catalog_id: idCols.suggested_catalog_id, suggestion_basis: idCols.suggestion_basis,
        identification_status: idCols.identification_status, catalog_id: idCols.catalog_id,
        identification_source: idCols.identification_source, identification_basis: idCols.identification_basis,
      },
    }));
    // The next run learns from this verdict.
    loadFeedback().then(setFeedback).catch(() => { /* keep what we had */ });
  }, [selected, user, context, result, fieldId, taskId, crop, stage, params, verdict, notes, suggestion, identification]);

  // Identification actions. Each one is the operator's, on the record.
  const confirmSuggestion = useCallback(() => {
    if (!suggestion) return;
    setIdentification(identificationFromEntry(suggestion.entry, "confirmed", suggestion.basis));
    setFreeText("");
    setVerdict(v => v ?? "weed");
  }, [suggestion]);
  const rejectSuggestion = useCallback(() => { setIdentification(REJECTED); setFreeText(""); }, []);
  const pickEntry = useCallback((e: CatalogEntry, why: string) => {
    const isSuggested = suggestion?.entry.catalog_id === e.catalog_id;
    setIdentification(identificationFromEntry(e, isSuggested ? "confirmed" : "edited",
      isSuggested ? suggestion!.basis : `Picked by the operator from the ${region.stateName} reference list. ${why}`));
    setPickerQuery("");
    setFreeText("");
    setVerdict(v => v ?? "weed");
  }, [suggestion, region.stateName]);
  const typeName = useCallback((text: string) => {
    setFreeText(text);
    setIdentification(text.trim() ? identificationFromText(text) : (suggestion ? UNIDENTIFIED : UNIDENTIFIED));
  }, [suggestion]);
  const clearIdentification = useCallback(() => { setIdentification(UNIDENTIFIED); setFreeText(""); setPickerQuery(""); }, []);
  const pickerResults = useMemo(
    () => (pickerQuery.trim() ? searchRanked(narrowed.ranked, pickerQuery).slice(0, 8) : []),
    [narrowed, pickerQuery],
  );

  // Puts a candidate on Field View and in reach of the Flight Planner, as an
  // ordinary hand-drawn-shaped annotation - see lib/weedScout/applyToField.ts
  // for why that is the right target rather than a new zone system.
  const apply = useCallback(async () => {
    if (!selected) return;
    setApplying(true);
    setApplyError(null);
    // The identification travels only if the operator stated one; a
    // suggestion on screen does not (annotationFromCandidate enforces it).
    const a = annotationFromCandidate(selected, identification);
    const id = await applyAnnotation({ ...a, weed_observation_id: saved[selected.id]?.id ?? null });
    setApplying(false);
    if (!id) { setApplyError("Couldn't apply this to Field View. Check your connection and try again."); return; }
    setApplied(prev => ({ ...prev, [selected.id]: id }));
  }, [selected, applyAnnotation, identification, saved]);

  const unapply = useCallback(async () => {
    if (!selected) return;
    const id = applied[selected.id];
    if (!id) return;
    setApplying(true);
    await removeAnnotation(id);
    setApplying(false);
    setApplied(prev => { const next = { ...prev }; delete next[selected.id]; return next; });
  }, [selected, applied, removeAnnotation]);

  if (!rings.length) {
    return (
      <div className="absolute inset-0 grid place-items-center" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md text-center space-y-3 p-6">
          <FlaskConical className="h-8 w-8 mx-auto text-[#4CAF50]" />
          <h2 className="text-lg font-semibold">Weed Scout needs a field boundary</h2>
          <p className="text-sm text-neutral-400">
            The scout cuts the field into tiles and compares each to the rest. Without an outline there is
            no field to compare against.
          </p>
          <button onClick={() => setActiveTab("field")}
            className="text-xs bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 font-semibold">
            Go to Field View
          </button>
        </div>
      </div>
    );
  }

  const regionCandidates = result?.candidates.filter(c => c.region) ?? [];
  const pointCandidates = result?.candidates.filter(c => !c.region) ?? [];
  const rowSpacingShown = units === "metric" ? (params.rowSpacingM * 100).toFixed(1) : (params.rowSpacingM / 0.0254).toFixed(1);
  const rowSpacingUnit = units === "metric" ? "cm" : "in";
  const setRowSpacingShown = (v: number) =>
    setParams(p => ({ ...p, rowSpacingM: units === "metric" ? v / 100 : v * 0.0254 }));
  const areaText = (m2: number) => fmtArea(m2, units).text;

  return (
    <div className="absolute inset-0 flex" style={{ background: "#0f0f0f" }}>
      <div className="flex-1 relative">
        <MapContainer
          bounds={bounds ?? undefined}
          boundsOptions={{ padding: [40, 40] }}
          minZoom={1} maxZoom={22} preferCanvas
          zoomControl={false} attributionControl={false}
          style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
        >
          <BasemapLayer id={basemap} />
          {tileUrl && bounds && (
            <TileLayer
              key={tileUrl} url={tileUrl}
              maxNativeZoom={Math.min(20, maxNative)} maxZoom={22}
              tileSize={256} keepBuffer={4}
              bounds={bounds} noWrap zIndex={10}
            />
          )}
          <FitBounds bounds={bounds} />
          {rings.map((r, i) => (
            <Polygon key={i} positions={r.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: "#4CAF50", weight: 1.5, fill: false, dashArray: "4 4" }} />
          ))}
          {showRegions && regionCandidates.map(c => {
            const colour = CLASS_COLOUR[c.region!.klass];
            const active = c.id === selectedId;
            const isApplied = !!applied[c.id];
            return (
              <Polygon key={c.id}
                positions={c.region!.rings.map(ring => ring.map(p => [p.lat, p.lng] as [number, number]))}
                eventHandlers={{ click: () => setSelectedId(c.id) }}
                pathOptions={{
                  color: active ? "#ffffff" : isApplied ? "#38bdf8" : colour,
                  weight: active ? 2.5 : isApplied ? 2.5 : 1.5,
                  fillColor: colour, fillOpacity: saved[c.id] ? 0.45 : 0.22,
                }} />
            );
          })}
          {showPoints && pointCandidates.map(c => (
            <CircleMarker key={c.id} center={[c.centroid.lat, c.centroid.lng]}
              radius={c.id === selectedId ? 9 : applied[c.id] ? 8 : 5}
              eventHandlers={{ click: () => setSelectedId(c.id) }}
              pathOptions={{
                color: c.id === selectedId ? "#ffffff" : applied[c.id] ? "#38bdf8" : KIND_COLOUR[c.kind],
                weight: c.id === selectedId ? 2 : applied[c.id] ? 2.5 : 1.5,
                fillColor: KIND_COLOUR[c.kind],
                fillOpacity: saved[c.id] ? 0.9 : 0.35,
              }} />
          ))}
          <BasemapToggle
            value={basemap}
            onChange={(id) => { setBasemap(id); saveBasemap(id); }}
            className="absolute bottom-4 right-4 z-[1000]"
          />
        </MapContainer>

        <div className="absolute top-3 left-3 z-[400] bg-black/75 text-[10px] px-2.5 py-2 rounded-sm border border-[#222] flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-neutral-300"><FlaskConical className="h-3 w-3 text-[#4CAF50]" /> Weed Scout, experimental</div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showRegions} onChange={e => setShowRegions(e.target.checked)} className="accent-[#4CAF50]" />
            Regions (shape colour is how it reads)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showPoints} onChange={e => setShowPoints(e.target.checked)} className="accent-[#4CAF50]" />
            Points
          </label>
          <div className="flex items-center gap-2 pl-4"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["off-row vegetation"] }} /> Off-row plant</div>
          <div className="flex items-center gap-2 pl-4"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["vegetation outlier"] }} /> Plant unlike the field's plants</div>
          <div className="flex items-center gap-2 pl-4"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["off-row and outlier"] }} /> Both</div>
          <div className="flex items-center gap-2 pl-4"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["field outlier"] }} /> Single not-average tile</div>
          <div className="text-neutral-500">Solid: saved to the archive</div>
          <div className="flex items-center gap-2 text-neutral-500"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: "#38bdf8" }} /> Blue ring: applied to Field View and the Flight Planner</div>
        </div>
      </div>

      <aside className="w-[400px] shrink-0 border-l border-[#1f1f1f] flex flex-col min-h-0" style={{ background: "#121212" }}>
        <div className="p-4 border-b border-[#1f1f1f]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold inline-flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-[#4CAF50]" /> Weed Scout
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-amber-400/90 border border-amber-400/40 rounded-sm px-1.5 py-0.5">Experimental</span>
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">
            Any crop, any field shape. Tiles the field, marks what is not average at two scales and merges it
            into regions, fits crop rows where there are any, sweeps the whole field at full depth for the small
            things, and ranks candidates for you to look at. Learns from your verdicts. Everything runs in this
            browser.
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Parameters */}
          <section className="p-4 border-b border-[#1f1f1f] space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Crop pattern</label>
                <div className="inline-flex rounded-sm border border-[#222] bg-[#0f0f0f] overflow-hidden">
                  {([
                    { v: "auto", label: "Detect rows" },
                    { v: "rows", label: "Row crop" },
                    { v: "none", label: "Not a row crop" },
                  ] as const).map(o => (
                    <button key={o.v} type="button" onClick={() => setParams(p => ({ ...p, rowMode: o.v }))}
                      className={`px-2.5 py-1 text-[11px] ${params.rowMode === o.v ? "bg-[#4CAF50] text-black font-semibold" : "text-neutral-400 hover:text-neutral-200"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-neutral-500 mt-1">
                  Any crop, any field shape. Rows only add the between-the-rows signal; regions and plant outliers work without them.
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
            <div className="flex items-center gap-2">
              {!running ? (
                <button type="button" onClick={run} disabled={!tileUrl}
                  className="inline-flex items-center gap-1.5 text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 text-black rounded-sm px-3 py-1.5 font-semibold">
                  <Play className="h-3.5 w-3.5" /> Scan this field
                </button>
              ) : (
                <button type="button" onClick={() => abortRef.current?.abort()}
                  className="inline-flex items-center gap-1.5 text-xs bg-[#262626] hover:bg-[#333] text-neutral-200 rounded-sm px-3 py-1.5 font-semibold">
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              )}
              {progress && (
                <div className="text-[11px] text-neutral-400 inline-flex items-center gap-1.5 min-w-0">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span className="truncate">
                    {STAGE_LABEL[progress.stage]}{progress.fraction != null ? ` ${Math.round(progress.fraction * 100)}%` : ""}
                  </span>
                </div>
              )}
            </div>
            {feedback.length > 0 && (
              <div className="text-[11px] text-neutral-500">Learning from {feedback.length} saved verdict{feedback.length === 1 ? "" : "s"}.</div>
            )}
            {runError && (
              <div className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {runError}</div>
            )}
          </section>

          {/* Event context */}
          <section className="p-4 border-b border-[#1f1f1f]">
            <div className={labelCls}>Event context</div>
            {context ? (
              <p className="text-[11px] text-neutral-300 leading-relaxed"><MapPin className="inline h-3 w-3 text-[#4CAF50] mr-1" />{describeEvent(context)}</p>
            ) : (
              <p className="text-[11px] text-neutral-500">Looking up place, local time and station weather for this capture.</p>
            )}
          </section>

          {/* Run summary */}
          {result && (
            <section className="p-4 border-b border-[#1f1f1f] text-[11px] space-y-1">
              <div className={labelCls}>This run</div>
              <Row k="Tiles" v={`${result.tiles.length.toLocaleString()} at ${result.tileM} m${params.autoTile ? " (auto)" : ""}, ${result.baselineTiles.toLocaleString()} in the baseline`} />
              <Row k="Rows" v={result.rowsUsed} />
              {result.canopyClosed && <Row k="Canopy" v="closed: regions only, no plant-level detection" />}
              <Row k="Base pass" v={`${fmtLengthCm(result.gsdM * 100, units).text}/px`} />
              <Row k="Sweep" v={result.sweep.ran
                ? `${result.sweep.windows} windows at ${fmtLengthCm((result.sweep.gsdM ?? 0) * 100, units).text}/px${result.sweep.rowWindows ? `, rows in ${result.sweep.rowWindows}` : ""}`
                : "not run"} />
              <Row k="Smallest measurable" v={fmtLengthCm(result.smallestMeasurableM * 100, units).text} />
              <Row k="Plants measured" v={result.blobCount.toLocaleString()} />
              <Row k="Regions" v={`${result.regions.length} (${areaText(result.regions.reduce((s, r) => s + r.areaM2, 0))})`} />
              {result.rows?.usable && (
                <Row k="Row model" v={`confidence ${result.rows.confidence.toFixed(2)}, ${result.rows.medianAngleDeg.toFixed(0)} deg, pitch ${fmtLengthCm(result.rows.medianPitchM * 100, units).text}`} />
              )}
              <Row k="Candidates" v={`${result.candidates.length} (${regionCandidates.length} regions, ${pointCandidates.length} points)`} />
              {result.notes.map((n, i) => (
                <div key={i} className="text-neutral-500 flex items-start gap-1.5 pt-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-500/80" /> {n}</div>
              ))}
            </section>
          )}

          {/* Candidate list */}
          {result && (
            <section className="border-b border-[#1f1f1f]">
              <div className="px-4 pt-3 pb-1"><div className={labelCls}>Candidates, best first</div></div>
              {result.candidates.length === 0 && (
                <div className="px-4 pb-3 text-[11px] text-neutral-500">Nothing stood out at these thresholds. That is a result, not an absence: lower a threshold or check the notes above.</div>
              )}
              <ul className="max-h-72 overflow-y-auto">
                {result.candidates.map((c, i) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-4 py-2 flex items-center gap-3 border-t border-[#1a1a1a] hover:bg-[#181818] ${c.id === selectedId ? "bg-[#1a1a1a]" : ""}`}>
                      {c.chip ? (
                        <img src={c.chip} alt="" className="h-10 w-10 rounded-sm object-cover shrink-0 border border-[#222]" style={{ imageRendering: "pixelated" }} />
                      ) : (
                        <div className="h-10 w-10 rounded-sm shrink-0 border border-[#222] grid place-items-center text-[9px] text-neutral-600">no chip</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-neutral-200 flex items-center gap-2">
                          <span className="font-mono text-neutral-500">#{i + 1}</span>
                          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: c.region ? CLASS_COLOUR[c.region.klass] : KIND_COLOUR[c.kind] }} />
                          <span className="truncate">{c.region ? `${c.region.klass}, ${areaText(c.areaM2)}` : c.kind}</span>
                          {saved[c.id] && <CheckCircle2 className="h-3 w-3 text-[#4CAF50] shrink-0" />}
                          {applied[c.id] && <MapPin className="h-3 w-3 text-[#38bdf8] shrink-0" />}
                        </div>
                        <div className="text-[10px] text-neutral-500 truncate">{describeCandidate(c, units)}</div>
                      </div>
                      <div className="text-[10px] font-mono text-neutral-400">{c.score.toFixed(2)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Candidate detail */}
          {selected && (
            <section className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className={labelCls}>Selected candidate</div>
                  <div className="text-xs text-neutral-200">{selected.region ? `${selected.region.klass}, ${areaText(selected.areaM2)}` : selected.kind}</div>
                  <div className="text-[10px] text-neutral-500">{describeCandidate(selected, units)}</div>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} className="text-neutral-500 hover:text-neutral-200"><X className="h-3.5 w-3.5" /></button>
              </div>
              {selected.chip ? (
                <div>
                  <img src={selected.chip} alt="Chip of the candidate" className="w-full rounded-sm border border-[#222]" style={{ imageRendering: "pixelated" }} />
                  <div className="text-[10px] text-neutral-500 mt-1">
                    {selected.chipSpanM ? `${fmtDistance(selected.chipSpanM, units).text} across` : ""}
                    {selected.chipGsdM ? ` at ${fmtLengthCm(selected.chipGsdM * 100, units).text}/px, real pixels, north up` : ""}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-neutral-500">No chip rendered for this one (only the top {params.maxChips} get one). Raise the chip limit in the stored parameters if you need it.</div>
              )}
              <dl className="text-[11px] grid grid-cols-2 gap-x-3 gap-y-1">
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

              {/* The in-house description */}
              {selected.estimate && (
                <div className="border border-[#222] rounded-sm p-3 space-y-2 text-[11px]" style={{ background: "#161616" }}>
                  <div className="text-xs font-semibold">What it looks like</div>
                  <p className="text-neutral-200 leading-relaxed">{selected.estimate.summary}</p>
                  <p className="text-neutral-400">{selected.estimate.positionNote}</p>
                  <p className="text-neutral-400">{selected.estimate.seasonNote}</p>
                  {selected.feedback && (
                    <p className={selected.feedback.factor < 1 ? "text-neutral-500" : "text-[#4CAF50]"}>{describeFeedback(selected.feedback)}</p>
                  )}
                  <div className="text-neutral-400">To confirm on the ground: {selected.estimate.whatWouldConfirm.join(" ")}</div>
                  <div className="text-neutral-600">{selected.estimate.caveats.join(" ")}</div>
                  <div className="text-neutral-600 font-mono">{selected.estimate.model}, computed in this browser</div>
                </div>
              )}

              {/* Apply: put this on the field the operator actually works from.
                  Separate from the archive verdict on purpose - one is "flag
                  this ground on my map and my flight plan", the other is "teach
                  the scout what this was". Either can happen without the other. */}
              <div className="border border-[#222] rounded-sm p-3 space-y-2" style={{ background: "#161616" }}>
                <div className="text-xs font-semibold inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[#38bdf8]" /> Field View and Flight Planner</div>
                <p className="text-[11px] text-neutral-500">
                  Applying draws this on Field View as a marked area and puts it in reach of the Flight Planner,
                  exactly like a polygon you had drawn by hand. Click it on the map to read what it is.
                  {isStatedFinding(identification)
                    ? ` It will carry your identification (${identification.label}).`
                    : " It will be marked as not identified unless you identify it below first."}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {!applied[selected.id] ? (
                    <button type="button" onClick={apply} disabled={applying || !user}
                      className="inline-flex items-center gap-1.5 text-xs bg-[#38bdf8] hover:bg-[#0ea5e9] disabled:opacity-40 text-black rounded-sm px-3 py-1.5 font-semibold">
                      {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                      Apply to Field View
                    </button>
                  ) : (
                    <>
                      <span className="text-[11px] text-[#38bdf8] inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Applied</span>
                      <button type="button" onClick={() => setActiveTab("field")}
                        className="text-[11px] underline text-neutral-300 hover:text-white">Open Field View</button>
                      <button type="button" onClick={unapply} disabled={applying}
                        className="text-[11px] underline text-neutral-500 hover:text-red-400 disabled:opacity-40">Remove</button>
                    </>
                  )}
                </div>
                {applyError && <div className="text-[11px] text-red-400">{applyError}</div>}
              </div>

              {/* Verdict */}
              <div className="space-y-2">
                <div className={labelCls}>Your verdict (the label the scout learns from)</div>
                <div className="grid grid-cols-4 gap-1">
                  {VERDICTS.map(v => (
                    <button key={v.value} type="button" onClick={() => setVerdict(v.value)}
                      className={`text-[11px] rounded-sm px-2 py-1.5 border ${verdict === v.value
                        ? "bg-[#4CAF50] text-black border-[#4CAF50] font-semibold"
                        : "border-[#222] text-neutral-300 hover:bg-[#1f1f1f]"}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
                {/* Identification: the operator's statement. The scout may only
                    suggest, and only from their own past verdicts. */}
                <div className="border border-[#222] rounded-sm p-3 space-y-2" style={{ background: "#161616" }}>
                  <div className={labelCls}>Identification (yours, never the scout's)</div>
                  <div className="text-[10px] text-neutral-500">{narrowed.note}</div>

                  {suggestion && identification.status !== "confirmed" && identification.status !== "rejected" && (
                    <div className="border border-[#38bdf8]/40 rounded-sm p-2 space-y-1.5" style={{ background: "#0f171c" }}>
                      <div className="text-[11px] text-neutral-200">
                        Suggested name: <span className="font-semibold">{suggestion.entry.common_name}</span>{" "}
                        <span className="italic text-neutral-400">{suggestion.entry.scientific_name_as_source}</span>
                      </div>
                      <div className="text-[10px] text-neutral-400">{suggestion.basis}</div>
                      <div className="text-[10px] text-neutral-500">{evidenceLabel(suggestion.entry)}. {presenceNote(suggestion.entry)}</div>
                      {regulatoryNote(suggestion.entry) && <div className="text-[10px] text-amber-400/90">{regulatoryNote(suggestion.entry)}</div>}
                      <div className="text-[10px] text-neutral-600 break-all">Source: {sourceTextFor(suggestion.entry)}</div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={confirmSuggestion}
                          className="text-[11px] bg-[#38bdf8] hover:bg-[#0ea5e9] text-black rounded-sm px-2.5 py-1 font-semibold">Confirm</button>
                        <button type="button" onClick={rejectSuggestion}
                          className="text-[11px] border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] rounded-sm px-2.5 py-1">Reject</button>
                      </div>
                    </div>
                  )}

                  {identification.status !== "unidentified" && (
                    <div className="text-[11px] flex items-start justify-between gap-2">
                      <div>
                        {identification.status === "rejected" ? (
                          <span className="text-neutral-400">Suggestion rejected. Not identified.</span>
                        ) : (
                          <>
                            <span className="text-[#7dd3fc] font-semibold">{identification.label}</span>
                            <span className="text-neutral-500"> ({identification.status === "confirmed" ? "confirmed from the suggestion" : "your own identification"})</span>
                            <div className="text-[10px] text-neutral-600 break-all">Source: {identification.source}</div>
                          </>
                        )}
                      </div>
                      <button type="button" onClick={clearIdentification} className="text-[10px] underline text-neutral-500 hover:text-neutral-200 shrink-0">Clear</button>
                    </div>
                  )}

                  <div className="relative">
                    <input className={inputCls}
                      placeholder={catalog.length ? `Search the ${region.stateName} reference list (${narrowed.ranked.length} names)` : "Reference list loading"}
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
                  {catalogError && <div className="text-[10px] text-amber-400/90">Reference list unavailable ({catalogError}). You can still type a name.</div>}
                  <input className={inputCls} placeholder="Or type a name or group yourself" value={freeText} onChange={e => typeName(e.target.value)} maxLength={120} />
                  <div className="text-[10px] text-neutral-600">
                    A name here is your statement, saved with its source and whether you confirmed a suggestion or chose it yourself.
                    Suggestions come only from your own past verdicts on similar candidates; nothing here recognises a species from the pixels.
                  </div>
                </div>
                <input className={inputCls} placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={300} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={save} disabled={saving || !user || !context}
                    className="inline-flex items-center gap-1.5 text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 text-black rounded-sm px-3 py-1.5 font-semibold">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {saved[selected.id] ? "Update in archive" : "Save to archive"}
                  </button>
                  {saved[selected.id] && !saving && <span className="text-[11px] text-[#4CAF50] inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Saved</span>}
                </div>
                {saveError && <div className="text-[11px] text-red-400">{saveError}</div>}
                {!user && <div className="text-[11px] text-neutral-500">Sign in to save observations.</div>}
              </div>
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
