// A model run over a scan's photographs, kept outside the tab so leaving the
// tab does not end it (the pattern of weedScout/runStore.ts).
//
// The run: every kept original of the scan, in the order ODM lists the shots,
// sent to the local research service one at a time (the service serialises
// the GPU anyway); each answer carried to the ground (frames.ts) and saved
// (frameRunCache.ts); the plants seen from several photographs merged to one
// after every photo, so the map fills in as the run goes. Photos already
// scored under the same key are taken from the cache, not the service.
import { useSyncExternalStore } from "react";
import { lookupOriginal } from "../sourceFrames/manifest";
import { type ScanSources, downloadFrame } from "../sourceFrames/scan";
import type { Shot } from "../sourceFrames/odm";
import type { FrameManifestEntry } from "../sourceFrames/manifest";
import { type DetectOptions, type Outcome, type Progress, type WeedVisionResult, detectWeeds } from "./client";
import { type FrameDetection, type FrameRunParams, type GroundPlant, countByClass, frameRunKey, groundFrameResult, mergeAcrossFrames } from "./frames";
import { type SavedFrameRun, deleteFrameRuns, loadFrameRuns, saveFrameRun } from "./frameRunCache";

export type FrameRunProgress = { framesDone: number; framesTotal: number; current: string | null; tilesDone: number; tilesTotal: number | null; fromCache: number };
export type FrameSummary = { filename: string; weeds: number; crops: number; status: "done" | "cached" | "error"; error?: string; ms: number | null };

export type FrameRunSession = {
  running: boolean;
  progress: FrameRunProgress | null;
  params: FrameRunParams | null;
  paramsKey: string | null;
  algorithmLabel: string | null;
  modelSha: string | null;
  /** Plants on the ground after the photographs are merged. */
  plants: GroundPlant[];
  /** Detections before merging, for the summary. */
  raw: number;
  frames: Record<string, FrameSummary>;
  error: string | null;
  note: string | null;
  showWeeds: boolean;
  showCrops: boolean;
  selectedId: string | null;
  /** When the plants came from the cache rather than a run in this session. */
  restoredAt: string | null;
  /** Plant id to the annotation id it was marked on the field as, this session. */
  marked: Record<string, string>;
};

export const EMPTY_FRAME_RUN: FrameRunSession = {
  running: false, progress: null, params: null, paramsKey: null, algorithmLabel: null, modelSha: null,
  plants: [], raw: 0, frames: {}, error: null, note: null, showWeeds: true, showCrops: false, selectedId: null, restoredAt: null, marked: {},
};

const sessions = new Map<string, FrameRunSession>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
/** Every photo's detections before merging, per scan: the batch run and the closer look both feed it. */
const rawByTask = new Map<string, Map<string, FrameDetection[]>>();
function rawOf(taskId: string): Map<string, FrameDetection[]> {
  let m = rawByTask.get(taskId);
  if (!m) { m = new Map(); rawByTask.set(taskId, m); }
  return m;
}

export const getFrameRun = (taskId: string): FrameRunSession => sessions.get(taskId) ?? EMPTY_FRAME_RUN;

export function patchFrameRun(taskId: string, patch: Partial<FrameRunSession> | ((s: FrameRunSession) => Partial<FrameRunSession>)): void {
  const cur = getFrameRun(taskId);
  const p = typeof patch === "function" ? patch(cur) : patch;
  sessions.set(taskId, { ...cur, ...p });
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useFrameRun(taskId: string): FrameRunSession {
  return useSyncExternalStore(subscribe, () => getFrameRun(taskId), () => getFrameRun(taskId));
}

/** The seams a test replaces: the service, the storage and the cache. */
export type FrameRunDeps = {
  detect: (file: Blob, filename: string, opts: DetectOptions, hooks: { onProgress?: (p: Progress) => void; signal?: AbortSignal }) => Promise<Outcome<WeedVisionResult>>;
  download: (entry: FrameManifestEntry) => Promise<Blob | null>;
  cache: { load: typeof loadFrameRuns; save: typeof saveFrameRun; remove: typeof deleteFrameRuns };
};

const DEFAULT_DEPS: FrameRunDeps = { detect: (f, n, o, h) => detectWeeds(f, n, o, h), download: downloadFrame, cache: { load: loadFrameRuns, save: saveFrameRun, remove: deleteFrameRuns } };

/** The photographs that can be scored: shots with a kept original, in ODM's order. */
export function scorableFrames(sources: ScanSources | null): Array<{ shot: Shot; entry: FrameManifestEntry }> {
  if (!sources?.set || !sources.frames) return [];
  const out: Array<{ shot: Shot; entry: FrameManifestEntry }> = [];
  for (const shot of sources.set.shots) {
    const look = lookupOriginal(sources.frames, shot.filename);
    if (look.ok) out.push({ shot, entry: look.entry });
  }
  return out;
}

export type StartFrameRunInput = {
  userId: string;
  sources: ScanSources;
  params: FrameRunParams;
  algorithmLabel: string;
  /** The service's checkpoint hash for the algorithm's model, for the cache key and the rows. */
  modelSha: string | null;
  /** Score every photo again, ignoring the cache. */
  force?: boolean;
  deps?: Partial<FrameRunDeps>;
};

function summarise(plants: GroundPlant[], raw: number, frames: Record<string, FrameSummary>): string {
  const c = countByClass(plants);
  const n = Object.keys(frames).length;
  const errs = Object.values(frames).filter(f => f.status === "error").length;
  const merged = raw - plants.length;
  return `${c.weed.toLocaleString()} weed${c.weed === 1 ? "" : "s"} and ${c.crop.toLocaleString()} crop plant${c.crop === 1 ? "" : "s"} from ${n} photo${n === 1 ? "" : "s"}${merged > 0 ? `; ${merged.toLocaleString()} repeat sightings merged` : ""}${errs ? `; ${errs} photo${errs === 1 ? "" : "s"} failed` : ""}.`;
}

/**
 * Score every kept original with the chosen algorithm. A run already in
 * progress for the scan is left alone. Results land in the session as each
 * photo finishes and are saved per photo, so a stopped run keeps what it did.
 */
export function startFrameRun(taskId: string, input: StartFrameRunInput): void {
  if (getFrameRun(taskId).running) return;
  const deps: FrameRunDeps = { ...DEFAULT_DEPS, ...input.deps, cache: { ...DEFAULT_DEPS.cache, ...(input.deps?.cache ?? {}) } };
  const ctrl = new AbortController();
  controllers.set(taskId, ctrl);
  const mine = () => controllers.get(taskId) === ctrl;
  const { sources, params } = input;
  const paramsKey = frameRunKey(params, input.modelSha);
  const frames = scorableFrames(sources);
  patchFrameRun(taskId, {
    running: true, params, paramsKey, algorithmLabel: input.algorithmLabel, modelSha: input.modelSha, error: null, note: null, restoredAt: null, selectedId: null,
    progress: { framesDone: 0, framesTotal: frames.length, current: null, tilesDone: 0, tilesTotal: null, fromCache: 0 },
  });
  if (!frames.length) {
    patchFrameRun(taskId, { running: false, error: sources.frames ? "none of the scan's photographs has a kept original" : "no original photographs were kept for this scan (Keep original photos on the field page)" });
    return;
  }
  if (!sources.set || sources.groundAltM == null) {
    patchFrameRun(taskId, { running: false, error: "the scan has no camera poses or no ground height, so the photos cannot be placed on the map" });
    return;
  }
  const set = sources.set, altM = sources.groundAltM;
  const byFrame = rawOf(taskId);
  byFrame.clear();
  const summaries: Record<string, FrameSummary> = {};
  const publish = () => {
    if (!mine()) return;
    const all = [...byFrame.values()].flat();
    const plants = mergeAcrossFrames(set, altM, all);
    patchFrameRun(taskId, { plants, raw: all.length, frames: { ...summaries } });
  };
  (async () => {
    const cached = input.force ? new Map<string, SavedFrameRun>() : await deps.cache.load(taskId, paramsKey);
    let fromCache = 0;
    for (let i = 0; i < frames.length; i++) {
      if (ctrl.signal.aborted || !mine()) return;
      const { shot, entry } = frames[i];
      const name = shot.filename;
      patchFrameRun(taskId, s => ({ progress: { ...(s.progress ?? { framesTotal: frames.length }), framesDone: i, framesTotal: frames.length, current: name, tilesDone: 0, tilesTotal: null, fromCache } as FrameRunProgress }));
      const hit = cached.get(name);
      if (hit) {
        byFrame.set(name, hit.detections);
        const c = countByClass(hit.detections);
        summaries[name] = { filename: name, weeds: c.weed, crops: c.crop, status: "cached", ms: hit.timingsMs?.total ?? null };
        fromCache += 1;
        publish();
        continue;
      }
      const blob = await deps.download(entry);
      if (!blob) {
        summaries[name] = { filename: name, weeds: 0, crops: 0, status: "error", error: "the original could not be downloaded", ms: null };
        publish();
        continue;
      }
      const res = await deps.detect(blob, entry.filename, { algorithm: params.algorithm, scale: params.scale, tile: params.tile, overlap: params.overlap, threshold: params.threshold, includeCrop: true }, {
        signal: ctrl.signal,
        onProgress: p => { if (mine()) patchFrameRun(taskId, s => ({ progress: s.progress ? { ...s.progress, tilesDone: p.tilesDone, tilesTotal: p.tilesTotal } : s.progress })); },
      });
      if (!res.ok) {
        if (res.error === "cancelled") return;
        summaries[name] = { filename: name, weeds: 0, crops: 0, status: "error", error: res.error, ms: null };
        publish();
        if (/not reachable/.test(res.error) || res.status === 503) {
          patchFrameRun(taskId, { running: false, error: res.error, note: summarise(getFrameRun(taskId).plants, getFrameRun(taskId).raw, summaries) });
          return;
        }
        continue;
      }
      const dets = groundFrameResult({ set, shot, groundAltM: altM, result: res.value });
      byFrame.set(name, dets);
      const c = countByClass(dets);
      summaries[name] = { filename: name, weeds: c.weed, crops: c.crop, status: "done", ms: res.value.timings_ms?.total ?? null };
      publish();
      void deps.cache.save({ userId: input.userId, scanId: taskId, paramsKey, params, run: { filename: name, algorithm: res.value.algorithm.name, modelSha256: input.modelSha, nativeWidth: res.value.image.width, nativeHeight: res.value.image.height, timingsMs: res.value.timings_ms ?? {}, detections: dets, createdAt: null } });
    }
    if (!mine()) return;
    const s = getFrameRun(taskId);
    patchFrameRun(taskId, { running: false, progress: { ...(s.progress as FrameRunProgress), framesDone: frames.length, current: null, fromCache }, note: summarise(s.plants, s.raw, summaries) });
  })().catch(e => {
    if (mine()) patchFrameRun(taskId, { running: false, error: (e as Error)?.message ?? String(e) });
  });
}

export function stopFrameRun(taskId: string): void {
  const ctrl = controllers.get(taskId);
  if (!ctrl) return;
  ctrl.abort();
  controllers.delete(taskId);
  const s = getFrameRun(taskId);
  patchFrameRun(taskId, { running: false, note: `Stopped. ${summarise(s.plants, s.raw, s.frames)}` });
}

/** Show a scan's saved run again without scoring anything. */
export async function restoreFrameRun(taskId: string, input: { sources: ScanSources; params: FrameRunParams; modelSha: string | null; algorithmLabel: string; deps?: Partial<FrameRunDeps> }): Promise<boolean> {
  if (getFrameRun(taskId).running) return false;
  const load = input.deps?.cache?.load ?? loadFrameRuns;
  const paramsKey = frameRunKey(input.params, input.modelSha);
  const rows = await load(taskId, paramsKey);
  if (!rows.size || !input.sources.set || input.sources.groundAltM == null) return false;
  const all: FrameDetection[] = [];
  const frames: Record<string, FrameSummary> = {};
  let latest: string | null = null;
  const raw = rawOf(taskId);
  raw.clear();
  for (const r of rows.values()) {
    all.push(...r.detections);
    raw.set(r.filename, r.detections);
    const c = countByClass(r.detections);
    frames[r.filename] = { filename: r.filename, weeds: c.weed, crops: c.crop, status: "cached", ms: r.timingsMs?.total ?? null };
    if (r.createdAt && (!latest || r.createdAt > latest)) latest = r.createdAt;
  }
  const plants = mergeAcrossFrames(input.sources.set, input.sources.groundAltM, all);
  patchFrameRun(taskId, { running: false, params: input.params, paramsKey, modelSha: input.modelSha, algorithmLabel: input.algorithmLabel, plants, raw: all.length, frames, error: null, restoredAt: latest ?? new Date().toISOString(), note: summarise(plants, all.length, frames), progress: null });
  return true;
}

/** Forget the run on screen and, when a key is known, its saved rows. */
export async function clearFrameRun(taskId: string, deps?: Partial<FrameRunDeps>): Promise<void> {
  const s = getFrameRun(taskId);
  if (s.running) stopFrameRun(taskId);
  const remove = deps?.cache?.remove ?? deleteFrameRuns;
  if (s.paramsKey) await remove(taskId, s.paramsKey);
  rawByTask.delete(taskId);
  sessions.set(taskId, { ...EMPTY_FRAME_RUN, showWeeds: s.showWeeds, showCrops: s.showCrops });
  emit();
}

export type AddFrameInput = {
  userId: string | null;
  sources: ScanSources;
  shot: Shot;
  /** The service's answer for this one photograph. */
  result: WeedVisionResult;
  params: FrameRunParams;
  modelSha: string | null;
  algorithmLabel: string;
  deps?: Partial<FrameRunDeps>;
};

/**
 * One photograph scored on its own (the closer look): its instances carried
 * to the ground, merged with whatever the scan already has, drawn on the map
 * and saved like a batch run's photo. Returns the grounded detections, or null
 * when the scan cannot place a photo on the ground.
 */
export async function addFrameDetections(taskId: string, input: AddFrameInput): Promise<FrameDetection[] | null> {
  const { sources, shot, result } = input;
  if (!sources.set || sources.groundAltM == null) return null;
  const set = sources.set, altM = sources.groundAltM;
  const dets = groundFrameResult({ set, shot, groundAltM: altM, result });
  const raw = rawOf(taskId);
  raw.set(shot.filename, dets);
  const all = [...raw.values()].flat();
  const plants = mergeAcrossFrames(set, altM, all);
  const c = countByClass(dets);
  const cur = getFrameRun(taskId);
  const paramsKey = frameRunKey(input.params, input.modelSha);
  const frames = { ...cur.frames, [shot.filename]: { filename: shot.filename, weeds: c.weed, crops: c.crop, status: "done" as const, ms: result.timings_ms?.total ?? null } };
  patchFrameRun(taskId, {
    plants, raw: all.length, frames, error: null, restoredAt: null,
    params: cur.params ?? input.params, paramsKey: cur.paramsKey ?? paramsKey, modelSha: cur.modelSha ?? input.modelSha, algorithmLabel: input.algorithmLabel,
    note: summarise(plants, all.length, frames),
  });
  if (input.userId) {
    const save = input.deps?.cache?.save ?? saveFrameRun;
    void save({ userId: input.userId, scanId: taskId, paramsKey, params: input.params, run: { filename: shot.filename, algorithm: result.algorithm.name, modelSha256: input.modelSha, nativeWidth: result.image.width, nativeHeight: result.image.height, timingsMs: result.timings_ms ?? {}, detections: dets, createdAt: null } });
  }
  return dets;
}

/** For tests. */
export function resetFrameRunStore(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  sessions.clear();
  rawByTask.clear();
  emit();
}
