// Weed Scout's model panel: pick an algorithm from the local research
// service, run it over every kept original of the scan, watch it land on the
// map, and keep or clear what it found. The service's own word rules the
// list: an algorithm whose model is not loaded cannot be chosen, and a
// service that is not running says so instead of failing later.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Cpu, Loader2, Play, Square } from "lucide-react";
import { storageKey } from "@/lib/storage";
import { type Shot, pixelToGround, projectToFrame } from "@/lib/sourceFrames/odm";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import { type PhotoReadStore, photoPassParams } from "@/lib/weedScout/photoPass";
import type { ScoutParams } from "@/lib/weedScout/types";
import { type AlgorithmInfo, type Health, algorithmReady, fetchAlgorithms, fetchHealth } from "@/lib/weedVision/client";
import { type FrameRunParams, countByClass, countByRow } from "@/lib/weedVision/frames";
import { clearFrameRun, patchFrameRun, restoreFrameRun, retagRows, scorableFrames, startFrameRun, stopFrameRun, useFrameRun } from "@/lib/weedVision/frameRunStore";
import { rowContextForPhoto } from "@/lib/weedVision/photoRows";
import { PLANT_COLOUR } from "./ModelDetectionLayer";

const PARAMS_KEY = storageKey("weedVision", "frameParams");
export const DEFAULT_FRAME_PARAMS: FrameRunParams = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };
const TILE_CHOICES = [
  { tile: 1024, overlap: 256, label: "1024 px tiles (as trained)" },
  { tile: 512, overlap: 128, label: "512 px tiles (finer: small weeds, 4x slower)" },
  { tile: 2048, overlap: 256, label: "2048 px tiles (coarser: big plants, fast)" },
];

function loadParams(): FrameRunParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (!raw) return DEFAULT_FRAME_PARAMS;
    const p = JSON.parse(raw) as Partial<FrameRunParams>;
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    return { algorithm: typeof p.algorithm === "string" ? p.algorithm : DEFAULT_FRAME_PARAMS.algorithm, threshold: Math.min(0.95, Math.max(0.05, num(p.threshold, 0.5))), tile: num(p.tile, 1024), overlap: num(p.overlap, 256), scale: 1 };
  } catch {
    return DEFAULT_FRAME_PARAMS;
  }
}

/** The checkpoint hash the service reports for the model an algorithm uses, or null. */
export function modelShaFor(info: AlgorithmInfo | undefined, health: Health | null): string | null {
  if (!info?.needs_model) return null;
  const key = info.model ?? (info.family === "rfdetr" ? "rfdetr" : "erfnet");
  const st = health?.models?.[key] ?? (key === "erfnet" ? health?.model : undefined);
  return st?.checkpoint_sha256 ?? null;
}

export function ModelDetectionsPanel({ taskId, userId, sources, readStore = null, passParams = null, fetchImpl }: {
  taskId: string; userId: string | null; sources: ScanSources | null;
  /** The scan's saved photo reads: the rows and crop plants of each photo the pass read; photos without one are read here and saved. */
  readStore?: PhotoReadStore | null;
  /** The scout's row settings, so a photo read here is read the way the pass reads it. */
  passParams?: Pick<ScoutParams, "rowSpacingAuto" | "rowSpacingM" | "minBlobCm2"> | null;
  fetchImpl?: typeof fetch;
}) {
  const run = useFrameRun(taskId);
  const [health, setHealth] = useState<Health | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [algorithms, setAlgorithms] = useState<Record<string, AlgorithmInfo>>({});
  const [params, setParams] = useState<FrameRunParams>(loadParams);
  const [open, setOpen] = useState(true);
  const frames = useMemo(() => scorableFrames(sources), [sources]);
  const f = fetchImpl ?? fetch;

  const refresh = useCallback(async () => {
    const h = await fetchHealth(f);
    if (!h.ok) { setHealth(null); setServiceError(h.error); return; }
    setHealth(h.value); setServiceError(null);
    const a = await fetchAlgorithms(f);
    if (a.ok) setAlgorithms(a.value.algorithms);
  }, [f]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* private mode */ } }, [params]);

  const info = algorithms[params.algorithm];
  const ready = algorithmReady(info, health);
  const modelSha = modelShaFor(info, health);
  const choices = useMemo(() => Object.entries(algorithms).filter(([k]) => k !== "selected").sort(([, a], [, b]) => (a.family === "rfdetr" ? -1 : b.family === "rfdetr" ? 1 : 0)), [algorithms]);
  // If the saved choice is not on the service's list, fall back to the first ready one.
  useEffect(() => {
    if (!choices.length || algorithms[params.algorithm]) return;
    const first = choices.find(([, a]) => algorithmReady(a, health)) ?? choices[0];
    setParams(p => ({ ...p, algorithm: first[0], threshold: first[1].default_threshold ?? p.threshold }));
  }, [choices, algorithms, health, params.algorithm]);
  // A saved run under these settings comes back by itself.
  useEffect(() => {
    if (!sources || !info || run.running || run.plants.length) return;
    void restoreFrameRun(taskId, { sources, params, modelSha, algorithmLabel: info.label });
  }, [taskId, sources, info, modelSha, params.algorithm, params.threshold, params.tile, params.overlap]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = countByClass(run.plants);
  const canRun = !!userId && !!sources && frames.length > 0 && ready && !run.running;
  /** A photo's rows: the saved read, else read from the photo now with the scout's settings and the frame's ground sampling. */
  const rowContextFor = useCallback((filename: string, blob: Blob, shot: Shot, onProgress: (f: number) => void, signal: AbortSignal) => {
    const set = sources?.set;
    if (!set || sources.groundAltM == null) return null;
    const cam = set.cameras[shot.cameraKey];
    const centre = pixelToGround(set, shot, cam.width / 2, cam.height / 2, sources.groundAltM);
    const pr = centre ? projectToFrame(set, shot, centre) : null;
    if (!pr) return null;
    return rowContextForPhoto({ blob, filename, frameGsdM: pr.gsdM, frameWidth: cam.width, passParams: photoPassParams(passParams ?? { rowSpacingAuto: true, rowSpacingM: 0.762, minBlobCm2: 1 }), store: readStore, onProgress, signal });
  }, [sources, readStore, passParams]);
  const start = (force: boolean) => {
    if (!userId || !sources || !info) return;
    startFrameRun(taskId, { userId, sources, params, algorithmLabel: info.label, modelSha, force, rowContextFor });
  };
  const rows = countByRow(run.plants);
  const pct = run.progress && run.progress.framesTotal ? Math.round((100 * (run.progress.framesDone + (run.progress.tilesTotal ? run.progress.tilesDone / run.progress.tilesTotal : 0))) / run.progress.framesTotal) : 0;
  const sel = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-[11px] text-neutral-200";
  const btn = "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="p-4 border-b border-[#1f1f1f] space-y-2" data-testid="model-detections-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold inline-flex items-center gap-2"><Cpu className="h-3.5 w-3.5 text-[#ffe600]" /> Model detections</h3>
        <button type="button" onClick={() => setOpen(o => !o)} className="text-[10px] underline text-neutral-500 hover:text-neutral-300">{open ? "hide" : "show"}</button>
      </div>
      {open && (
        <>
          {serviceError && (
            <div className="text-[11px] text-amber-400 flex items-start gap-1.5" data-testid="service-error">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>The local model service is not running. {serviceError} <button type="button" className="underline" onClick={() => void refresh()}>retry</button></span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Model</label>
              <select className={sel} value={params.algorithm} data-testid="model-select" disabled={run.running}
                onChange={e => { const a = algorithms[e.target.value]; setParams(p => ({ ...p, algorithm: e.target.value, threshold: a?.default_threshold ?? p.threshold })); }}>
                {choices.length === 0 && <option value={params.algorithm}>{params.algorithm}</option>}
                {choices.map(([k, a]) => <option key={k} value={k} disabled={!algorithmReady(a, health)}>{a.label}{algorithmReady(a, health) ? "" : " (model not loaded)"}</option>)}
              </select>
              {info && <p className="text-[10px] text-neutral-600 mt-0.5 line-clamp-3" title={info.description}>{info.description}</p>}
            </div>
            {info?.family === "rfdetr" && (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Confidence at least</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0.1} max={0.9} step={0.05} value={params.threshold} disabled={run.running} data-testid="threshold"
                    onChange={e => setParams(p => ({ ...p, threshold: Number(e.target.value) }))} className="accent-[#ffe600] flex-1" />
                  <span className="text-[11px] text-neutral-300 w-8 text-right">{params.threshold.toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-neutral-600">Lower finds more small weeds; higher trusts fewer, surer ones.</p>
              </div>
            )}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Tiling</label>
              <select className={sel} value={`${params.tile}/${params.overlap}`} disabled={run.running} data-testid="tile-select"
                onChange={e => { const [t, o] = e.target.value.split("/").map(Number); setParams(p => ({ ...p, tile: t, overlap: o })); }}>
                {TILE_CHOICES.map(c => <option key={c.tile} value={`${c.tile}/${c.overlap}`}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!run.running ? (
              <button type="button" data-testid="run-frames" onClick={() => start(false)} disabled={!canRun} className={`${btn} bg-[#ffe600] text-black`} title={!userId ? "Sign in to run" : !frames.length ? "No kept originals for this scan" : !ready ? "The model is not loaded on the service" : ""}>
                <Play className="h-3.5 w-3.5" /> Run on {frames.length} photo{frames.length === 1 ? "" : "s"}
              </button>
            ) : (
              <button type="button" onClick={() => stopFrameRun(taskId)} className={`${btn} border border-[#333] text-neutral-200`}><Square className="h-3.5 w-3.5" /> Stop</button>
            )}
            {run.running && run.progress && (
              <div className="text-[11px] text-neutral-400 inline-flex items-center gap-1.5 min-w-0" data-testid="frame-progress">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                <span className="truncate">Photo {Math.min(run.progress.framesDone + 1, run.progress.framesTotal)} of {run.progress.framesTotal}{run.progress.phase === "rows" ? ` · reading its rows${run.progress.rowsFraction ? ` ${Math.round(run.progress.rowsFraction * 100)}%` : ""}` : run.progress.tilesTotal ? ` · model tile ${run.progress.tilesDone}/${run.progress.tilesTotal}` : ""} ({pct}%)</span>
              </div>
            )}
            {!run.running && run.plants.length > 0 && (
              <>
                <button type="button" onClick={() => start(true)} className="text-[10px] underline text-neutral-500 hover:text-neutral-300" title="Score every photo again with these settings, ignoring saved results">rerun all</button>
                <button type="button" onClick={() => void clearFrameRun(taskId)} className="text-[10px] underline text-neutral-500 hover:text-neutral-300" data-testid="clear-frames">clear</button>
              </>
            )}
          </div>
          {run.error && <div className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {run.error}</div>}
          {run.plants.length > 0 && (
            <div className="space-y-1" data-testid="frame-summary">
              <div className="text-[11px] text-neutral-300">
                <span style={{ color: PLANT_COLOUR.weed }} className="font-semibold">{rows.offRow.toLocaleString()} weeds off the rows</span>
                {rows.onRow > 0 ? <span className="text-neutral-500"> · {rows.onRow.toLocaleString()} on crop plants or row lines, set aside</span> : ""}
                {rows.noRows > 0 ? <span className="text-neutral-500"> · {rows.noRows.toLocaleString()} in photos without a row read</span> : ""}
                {" · "}<span style={{ color: PLANT_COLOUR.crop }}>{counts.crop.toLocaleString()} crop plants</span>
                {" · "}{Object.keys(run.frames).length} photo{Object.keys(run.frames).length === 1 ? "" : "s"}
                {run.raw > run.plants.length + run.outside ? ` · ${(run.raw - run.plants.length - run.outside).toLocaleString()} repeat sightings merged` : ""}
                {run.outside > 0 ? ` · ${run.outside.toLocaleString()} outside the field, not shown` : ""}
              </div>
              {run.restoredAt && <p className="text-[10px] text-neutral-600">From the run saved {new Date(run.restoredAt).toLocaleString()}.</p>}
              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400">
                <input type="checkbox" checked={run.showWeeds} onChange={e => patchFrameRun(taskId, { showWeeds: e.target.checked })} className="accent-[#ffe600]" /> Weeds on the map
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400">
                <input type="checkbox" checked={run.showCrops} onChange={e => patchFrameRun(taskId, { showCrops: e.target.checked })} className="accent-[#40e0ff]" /> Crop plants on the map
              </label>
              {rows.onRow > 0 && (
                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400" title="The photo pass placed these on a crop plant or a row line: in an orchard that is the tree. Shown dashed and faint when on.">
                  <input type="checkbox" checked={run.showOnRow} onChange={e => patchFrameRun(taskId, { showOnRow: e.target.checked })} className="accent-[#ffe600]" data-testid="show-on-row" /> Also show the {rows.onRow.toLocaleString()} weeds on the crop rows
                </label>
              )}
              {rows.noRows > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" data-testid="read-rows" disabled={!sources || run.running}
                    onClick={() => { if (sources) retagRows(taskId, { userId, sources, rowContextFor }); }}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-[#ffe600] text-[#ffe600] px-2 py-0.5 text-[11px] hover:bg-[#ffe600]/10 disabled:opacity-40"
                    title="Reads the rows and crop plants in every photo whose weeds have no row status yet (a few seconds a photo, saved), and sets the weeds on crop plants or row lines aside. The model is not run again.">
                    Read the rows in the photos without one ({rows.noRows.toLocaleString()} weeds)
                  </button>
                </div>
              )}
              {run.algorithmLabel && <p className="text-[10px] text-neutral-600">{run.algorithmLabel}{modelSha ? ` · checkpoint ${modelSha.slice(0, 8)}` : ""}. Click a plant on the map for its card.</p>}
            </div>
          )}
          {!run.running && run.note && !run.plants.length && <p className="text-[10px] text-neutral-600">{run.note}</p>}
        </>
      )}
    </div>
  );
}
