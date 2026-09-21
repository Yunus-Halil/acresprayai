// Weed Scout: the experimental, developer-mode replacement for the Treatment
// Grid tab.
//
// The screen runs lib/weedScout end to end over the scan on screen and shows
// what came out: the not-average tiles, the off-row vegetation, and for each
// candidate the zoomed chip, the measurements, the event context, the brain's
// estimate on request, and the operator's verdict. Saving a verdict writes an
// observation to the archive; nothing is written by the run itself.
//
// Everything on this screen is a candidate, never a verdict. The only place
// the word "weed" is applied to a plant is the verdict button the operator
// presses.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Rectangle, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, Bot, CheckCircle2, FlaskConical, Loader2, MapPin, Play, Save, Square, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { type FarmerSettings, growthStage } from "@/lib/farmerSettings";
import type { LatLng2 } from "@/lib/geo";
import { storageKey } from "@/lib/storage";
import { fmtDistance } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { describeCandidate } from "@/lib/weedScout/candidates";
import { type EventContext, describeEvent, fetchEventContext } from "@/lib/weedScout/context";
import { type BrainResult, askBrain } from "@/lib/weedScout/brain";
import {
  type ObservationRow, type Verdict, VERDICTS, listObservations, saveObservation,
} from "@/lib/weedScout/observations";
import { runWeedScout } from "@/lib/weedScout/pipeline";
import {
  type Candidate, type ScoutParams, type ScoutProgress, type ScoutResult, DEFAULT_SCOUT_PARAMS,
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
      maxZoomTiles: Math.round(num(p.maxZoomTiles, DEFAULT_SCOUT_PARAMS.maxZoomTiles)),
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
  rows: "Fitting the crop rows",
  blobs: "Finding vegetation",
  zooming: "Zooming in on the not-average tiles",
  ranking: "Ranking candidates",
  done: "Done",
};

const KIND_COLOUR: Record<Candidate["kind"], string> = {
  "off-row vegetation": "#f59e0b",
  "field outlier": "#38bdf8",
  "off-row and outlier": "#f43f5e",
};

const inputCls = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]";
const labelCls = "text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block";

export function WeedScoutTab({
  boundary, tileUrl, bounds, maxNative, fieldId, taskId, scanCreatedAt, settings, center, setActiveTab,
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
  const [brain, setBrain] = useState<Record<string, BrainResult | "asking">>({});
  const [saved, setSaved] = useState<Record<string, ObservationRow>>({});
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [species, setSpecies] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // `boundary` is what changes; the cast is stable per boundary.
  const rings = useMemo(() => (boundary ?? []) as unknown as LatLng2[][], [boundary]);
  const capturedAt = scanCreatedAt ?? new Date().toISOString();
  const crop = settings.crop_type ?? "";
  const stage = growthStage(crop, settings.planting_date);

  useEffect(() => { try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* private mode */ } }, [params]);

  // The event context for this capture, once. Failure is a context with nulls.
  useEffect(() => {
    let cancelled = false;
    fetchEventContext(center[0], center[1], capturedAt).then(ctx => { if (!cancelled) setContext(ctx); });
    return () => { cancelled = true; };
  }, [center, capturedAt]);

  // What is already in the archive for this scan.
  useEffect(() => {
    let cancelled = false;
    listObservations(taskId)
      .then(rows => { if (!cancelled) setSaved(Object.fromEntries(rows.map(r => [r.candidate_id, r]))); })
      .catch(() => { /* an empty archive and an unreachable one look the same here; saving will say */ });
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = useMemo(
    () => result?.candidates.find(c => c.id === selectedId) ?? null,
    [result, selectedId],
  );
  useEffect(() => {
    // Reset the verdict form when the selection changes; prefill from the archive.
    const row = selectedId ? saved[selectedId] : undefined;
    setVerdict((row?.verdict as Verdict | null) ?? null);
    setSpecies(row?.species ?? "");
    setNotes(row?.notes ?? "");
    setSaveError(null);
  }, [selectedId, saved]);

  const run = useCallback(async () => {
    if (!rings.length || !tileUrl || running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setRunError(null);
    setResult(null);
    setSelectedId(null);
    setBrain({});
    try {
      const res = await runWeedScout(
        { boundary: rings, tileUrl, maxNative, params },
        { onProgress: setProgress, signal: ctrl.signal },
      );
      setResult(res);
      setSelectedId(res.candidates[0]?.id ?? null);
    } catch (e) {
      if ((e as Error)?.name !== "Aborted") setRunError((e as Error)?.message ?? String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [rings, tileUrl, maxNative, params, running]);

  const ask = useCallback(async (c: Candidate) => {
    if (!context) return;
    setBrain(b => ({ ...b, [c.id]: "asking" }));
    const r = await askBrain({ candidate: c, context, crop, growthStage: stage, rowSpacingM: params.rowSpacingM });
    setBrain(b => ({ ...b, [c.id]: r }));
  }, [context, crop, stage, params.rowSpacingM]);

  const save = useCallback(async () => {
    if (!selected || !user || !context || !result) return;
    setSaving(true);
    setSaveError(null);
    const b = brain[selected.id];
    const r = await saveObservation({
      userId: user.id,
      fieldId,
      scanId: taskId,
      candidate: selected,
      context,
      crop,
      growthStage: stage,
      params,
      gsdM: result.gsdM,
      brain: b && b !== "asking" && b.kind === "estimate" ? { estimate: b.estimate, model: b.model } : null,
      verdict,
      species: species.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    // strict:false, so the boolean discriminant does not narrow; test the key.
    if ("error" in r) { setSaveError(r.error); return; }
    setSaved(s => ({
      ...s,
      [selected.id]: {
        id: r.id, candidate_id: selected.id, scan_id: taskId, tile_id: selected.tileId,
        lat: selected.centroid.lat, lng: selected.centroid.lng, captured_at: context.capturedAt,
        place: context.place, local_time: context.localTime, season: context.season,
        kind: selected.kind, score: selected.score, chip_path: null,
        verdict, species: species.trim() || null, notes: notes.trim() || null,
        brain: null, created_at: new Date().toISOString(),
      },
    }));
  }, [selected, user, context, result, brain, fieldId, taskId, crop, stage, params, verdict, species, notes]);

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

  const flagsByTile = new Map((result?.flags ?? []).map(f => [f.tileId, f]));
  const flaggedTiles = result ? result.tiles.filter(t => flagsByTile.has(t.id)) : [];
  const rowSpacingShown = units === "metric" ? (params.rowSpacingM * 100).toFixed(1) : (params.rowSpacingM / 0.0254).toFixed(1);
  const rowSpacingUnit = units === "metric" ? "cm" : "in";
  const setRowSpacingShown = (v: number) =>
    setParams(p => ({ ...p, rowSpacingM: units === "metric" ? v / 100 : v * 0.0254 }));

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
          {flaggedTiles.map(t => {
            const f = flagsByTile.get(t.id)!;
            const alpha = Math.min(0.55, 0.15 + (f.z - params.anomalyZ) * 0.08);
            return (
              <Rectangle key={t.id}
                bounds={[[t.ring[2].lat, t.ring[0].lng], [t.ring[0].lat, t.ring[1].lng]]}
                pathOptions={{ color: "#38bdf8", weight: 1, fillColor: "#38bdf8", fillOpacity: alpha }} />
            );
          })}
          {(result?.candidates ?? []).map(c => (
            <CircleMarker key={c.id} center={[c.centroid.lat, c.centroid.lng]}
              radius={c.id === selectedId ? 9 : 5}
              eventHandlers={{ click: () => setSelectedId(c.id) }}
              pathOptions={{
                color: c.id === selectedId ? "#ffffff" : KIND_COLOUR[c.kind],
                weight: c.id === selectedId ? 2 : 1.5,
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
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(56,189,248,0.4)" }} /> Not-average tile</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["off-row vegetation"] }} /> Off-row vegetation</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["field outlier"] }} /> Field outlier</div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KIND_COLOUR["off-row and outlier"] }} /> Both</div>
          <div className="text-neutral-500">Solid marker: saved to the archive</div>
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
            Tiles the field, marks what is not average, fits the crop rows, zooms in on the flagged ground, and
            ranks candidates for you to look at. Candidates, never verdicts.
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Parameters */}
          <section className="p-4 border-b border-[#1f1f1f] space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Tile size (m)</label>
                <input type="number" min={1} max={20} step={0.5} className={inputCls} value={params.tileM}
                  onChange={e => setParams(p => ({ ...p, tileM: Math.max(1, Number(e.target.value) || 3) }))} />
              </div>
              <div>
                <label className={labelCls}>Row spacing ({rowSpacingUnit})</label>
                <input type="number" min={1} step={0.5} className={inputCls} value={rowSpacingShown}
                  onChange={e => { const v = Number(e.target.value); if (v > 0) setRowSpacingShown(v); }} />
              </div>
              <div>
                <label className={labelCls}>Headland (m)</label>
                <input type="number" min={0} max={60} step={1} className={inputCls} value={params.headlandM}
                  onChange={e => setParams(p => ({ ...p, headlandM: Math.max(0, Number(e.target.value) || 0) }))} />
              </div>
              <div>
                <label className={labelCls}>Flag beyond (z)</label>
                <input type="number" min={1.5} max={10} step={0.5} className={inputCls} value={params.anomalyZ}
                  onChange={e => setParams(p => ({ ...p, anomalyZ: Math.max(1.5, Number(e.target.value) || 3.5) }))} />
              </div>
              <div>
                <label className={labelCls}>Zoom tiles (max)</label>
                <input type="number" min={0} max={200} step={1} className={inputCls} value={params.maxZoomTiles}
                  onChange={e => setParams(p => ({ ...p, maxZoomTiles: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
              </div>
              <div>
                <label className={labelCls}>Crop / stage</label>
                <div className="text-xs text-neutral-300 py-1">{crop || "not set"}{stage ? `, ${stage}` : ""}</div>
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
              <Row k="Tiles" v={`${result.tiles.length.toLocaleString()} at ${params.tileM} m, ${result.baselineTiles.toLocaleString()} in the baseline`} />
              <Row k="Imagery" v={`${(result.gsdM * 100).toFixed(1)} cm/px base${result.zoomGsdM ? `, ${(result.zoomGsdM * 100).toFixed(1)} cm/px zoomed` : ""}`} />
              <Row k="Not-average tiles" v={String(result.flags.length)} />
              <Row k="Row model" v={result.rows?.usable
                ? `found, confidence ${result.rows.confidence.toFixed(2)}, ${result.rows.medianAngleDeg.toFixed(0)} deg, pitch ${(result.rows.medianPitchM * 100).toFixed(0)} cm`
                : "no trustworthy rows in this imagery"} />
              <Row k="Candidates" v={String(result.candidates.length)} />
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
                <div className="px-4 pb-3 text-[11px] text-neutral-500">Nothing stood out at these thresholds. That is a result, not an absence: lower the flag threshold or check the notes above.</div>
              )}
              <ul className="max-h-64 overflow-y-auto">
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
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: KIND_COLOUR[c.kind] }} />
                          <span className="truncate">{c.kind}</span>
                          {saved[c.id] && <CheckCircle2 className="h-3 w-3 text-[#4CAF50] shrink-0" />}
                        </div>
                        <div className="text-[10px] text-neutral-500 truncate">{describeCandidate(c)}</div>
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
                  <div className="text-xs text-neutral-200">{selected.kind}</div>
                  <div className="text-[10px] text-neutral-500">{describeCandidate(selected)}</div>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} className="text-neutral-500 hover:text-neutral-200"><X className="h-3.5 w-3.5" /></button>
              </div>
              {selected.chip ? (
                <div>
                  <img src={selected.chip} alt="Zoomed chip of the candidate" className="w-full rounded-sm border border-[#222]" style={{ imageRendering: "pixelated" }} />
                  <div className="text-[10px] text-neutral-500 mt-1">
                    {selected.chipSpanM ? `${fmtDistance(selected.chipSpanM, units).text} across` : ""}
                    {selected.chipGsdM ? ` at ${(selected.chipGsdM * 100).toFixed(2)} cm/px, real pixels, north up` : ""}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-neutral-500">No chip: this tile was not among the zoomed ones. Raise the zoom-tile limit and run again.</div>
              )}
              <dl className="text-[11px] grid grid-cols-2 gap-x-3 gap-y-1">
                <Dt k="Score" v={selected.score.toFixed(2)} />
                <Dt k="Off row" v={selected.distanceToRowM != null ? `${(Math.abs(selected.distanceToRowM) * 100).toFixed(0)} cm` : "no row model"} />
                <Dt k="Tile deviation" v={selected.anomalyZ != null ? `${selected.anomalyZ.toFixed(1)} z on ${selected.anomalyFeature}` : "within the field average"} />
                <Dt k="Size" v={selected.blob ? `${(selected.blob.equivDiameterM * 100).toFixed(0)} cm, ${(selected.blob.areaM2 * 1e4).toFixed(0)} cm2` : "no vegetation"} />
                <Dt k="Greenness" v={selected.blob ? selected.blob.exgMean.toFixed(3) : "n/a"} />
                <Dt k="Measured at" v={selected.blob ? `${(selected.blob.gsdM * 100).toFixed(2)} cm/px` : "n/a"} />
              </dl>

              {/* The brain */}
              <div className="border border-[#222] rounded-sm p-3 space-y-2" style={{ background: "#161616" }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold inline-flex items-center gap-1.5"><Bot className="h-3.5 w-3.5 text-[#4CAF50]" /> The brain</div>
                  <button type="button" onClick={() => ask(selected)}
                    disabled={!context || brain[selected.id] === "asking"}
                    className="text-[11px] bg-[#262626] hover:bg-[#333] disabled:opacity-40 text-neutral-200 rounded-sm px-2 py-1 inline-flex items-center gap-1.5">
                    {brain[selected.id] === "asking" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                    {brain[selected.id] && brain[selected.id] !== "asking" ? "Ask again" : "Describe this"}
                  </button>
                </div>
                <BrainView r={brain[selected.id]} />
                <p className="text-[10px] text-neutral-600">
                  An estimate from the chip and its context, for you to check on the ground. Never a product, never a rate.
                </p>
              </div>

              {/* Verdict */}
              <div className="space-y-2">
                <div className={labelCls}>Your verdict (the label the archive learns from)</div>
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
                <input className={inputCls} placeholder="Species or group, if you know it" value={species} onChange={e => setSpecies(e.target.value)} />
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
      <dd className="text-neutral-200 font-mono text-right">{v}</dd>
    </>
  );
}

function BrainView({ r }: { r: BrainResult | "asking" | undefined }) {
  if (!r) return <div className="text-[11px] text-neutral-500">Not asked yet.</div>;
  if (r === "asking") return <div className="text-[11px] text-neutral-400">Looking at the chip and its context.</div>;
  if (r.kind === "unavailable") {
    const why: Record<typeof r.reason, string> = {
      unconfigured: "The brain is not configured on the server (ANTHROPIC_API_KEY is not set on the weed-brain function).",
      unauthorized: "Sign in to use the brain.",
      refused: "The model declined to describe this one.",
      malformed: "The reply could not be used.",
      error: "The brain is unavailable right now.",
    };
    return <div className="text-[11px] text-amber-400/90">{why[r.reason]}{r.detail ? ` ${r.detail}` : ""}</div>;
  }
  const e = r.estimate;
  return (
    <div className="text-[11px] space-y-2">
      <p className="text-neutral-200 leading-relaxed">{e.summary}</p>
      <div className="text-neutral-400">
        {e.is_vegetation ? "Reads as vegetation" : "May not be vegetation"} ({Math.round(e.vegetation_confidence * 100)}% sure).
        {e.growth_habit ? ` ${e.growth_habit}.` : ""}{e.leaf_notes ? ` ${e.leaf_notes}` : ""}{e.colour_notes ? ` ${e.colour_notes}` : ""}
      </div>
      {e.plausible.length > 0 && (
        <ul className="space-y-1">
          {e.plausible.map((p, i) => (
            <li key={i} className="border-l-2 border-[#333] pl-2">
              <span className="text-neutral-200">{p.group}</span>
              <span className="text-neutral-500"> {p.likelihood}</span>
              {p.examples.length > 0 && <span className="text-neutral-500">, e.g. {p.examples.join(", ")}</span>}
              {p.why && <div className="text-neutral-500">{p.why}</div>}
            </li>
          ))}
        </ul>
      )}
      {e.crop_lookalike && <div className="text-neutral-400">Could be the crop: {e.crop_lookalike}</div>}
      {e.what_would_confirm.length > 0 && (
        <div className="text-neutral-400">To confirm on the ground: {e.what_would_confirm.join("; ")}</div>
      )}
      {e.caveats.length > 0 && <div className="text-neutral-500">{e.caveats.join(" ")}</div>}
      <div className="text-neutral-600 font-mono">{r.model}</div>
    </div>
  );
}

export default WeedScoutTab;
