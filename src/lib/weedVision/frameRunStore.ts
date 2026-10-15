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
import { type LatLng2, pointInRing } from "../geo";
import { lookupOriginal } from "../sourceFrames/manifest";
import { type ScanSources, downloadFrame } from "../sourceFrames/scan";
import type { Shot, SourceFrameSet } from "../sourceFrames/odm";
import type { FrameManifestEntry } from "../sourceFrames/manifest";
import { type DetectOptions, type Outcome, type Progress, type WeedVisionResult, detectWeeds } from "./client";
import { type FrameDetection, type FrameRunParams, type GroundPlant, countByClass, countByRow, frameRunKey, groundFrameResult, mergeAcrossFrames } from "./frames";
import { type SavedFrameRun, deleteFrameRuns, loadFrameRuns, saveFrameRun } from "./frameRunCache";
import { type HotspotParams, type HotspotResult, type HotspotReview, DEFAULT_HOTSPOT_PARAMS, buildHotspots } from "./hotspots";
import { type HotspotReviewRow, deleteHotspotReview, loadHotspotReviews, saveHotspotReview } from "./hotspotReviewCache";
import { type RowContext, rowStatusOf } from "./rowFilter";

export type ViewMode = "priority" | "heatmap" | "detections";

export type FrameRunProgress = { framesDone: number; framesTotal: number; current: string | null; tilesDone: number; tilesTotal: number | null; fromCache: number; /** What the current photo is in: reading its rows, or in the model. */ phase?: "rows" | "model" | null; rowsFraction?: number | null };
export type FrameSummary = { filename: string; weeds: number; crops: number; status: "done" | "cached" | "error"; error?: string; ms: number | null };

export type FrameRunSession = {
  running: boolean;
  progress: FrameRunProgress | null;
  params: FrameRunParams | null;
  paramsKey: string | null;
  algorithmLabel: string | null;
  modelSha: string | null;
  /** Plants on the ground after the photographs are merged, inside the field when a boundary is known. */
  plants: GroundPlant[];
  /** Detections before merging, for the summary. */
  raw: number;
  /** Merged plants dropped for landing outside the field boundary. */
  outside: number;
  /** The reconstruction the plants were placed with, so a later boundary or photo can re-merge them. */
  scanSet: { set: SourceFrameSet; altM: number } | null;
  frames: Record<string, FrameSummary>;
  error: string | null;
  note: string | null;
  showWeeds: boolean;
  showCrops: boolean;
  /** Weeds the pattern puts on a crop plant or a row line are set aside; this shows them anyway. */
  showOnRow: boolean;
  selectedId: string | null;
  /** When the plants came from the cache rather than a run in this session. */
  restoredAt: string | null;
  /** Plant id to the annotation id it was marked on the field as, this session. */
  marked: Record<string, string>;
  /** The plants grouped into review areas (hotspots.ts); recomputed only when the plants change. */
  hotspots: HotspotResult | null;
  hotspotParams: HotspotParams;
  /** Priority (areas), heatmap (cells) or detections (every plant). */
  viewMode: ViewMode;
  selectedHotspotId: string | null;
  /** The operator's reviews by area id, from the table and this session. */
  reviews: Record<string, HotspotReviewRow>;
  /** Area ids the map should fly to; the nonce changes on every request. */
  focus: { south: number; west: number; north: number; east: number; nonce: number } | null;
  /** Area id to the annotation id it was marked on the field as, this session. */
  markedAreas: Record<string, string>;
};

export const EMPTY_FRAME_RUN: FrameRunSession = {
  running: false, progress: null, params: null, paramsKey: null, algorithmLabel: null, modelSha: null,
  plants: [], raw: 0, outside: 0, scanSet: null, frames: {}, error: null, note: null, showWeeds: true, showCrops: false, showOnRow: false, selectedId: null, restoredAt: null, marked: {},
  hotspots: null, hotspotParams: DEFAULT_HOTSPOT_PARAMS, viewMode: "priority", selectedHotspotId: null, reviews: {}, focus: null, markedAreas: {},
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
/** The field boundary per scan: plants whose centre lands outside it are not shown (a frame's edge projected onto the ground plane lands far outside the field). */
const boundaries = new Map<string, LatLng2[][]>();
export function setFrameRunBoundary(taskId: string, rings: LatLng2[][] | null): void {
  const cur = boundaries.get(taskId);
  if (!rings || !rings.length) { if (cur) { boundaries.delete(taskId); republish(taskId); } return; }
  if (cur === rings) return;
  boundaries.set(taskId, rings);
  republish(taskId);
}
/** Plants inside the boundary (or all, when none is known); the rest counted. Plants with no centre are kept: nothing can be said about them. */
function withinField(taskId: string, plants: GroundPlant[]): { kept: GroundPlant[]; outside: number } {
  const rings = boundaries.get(taskId);
  if (!rings) return { kept: plants, outside: 0 };
  const kept: GroundPlant[] = [];
  let outside = 0;
  for (const p of plants) {
    if (!p.centre || rings.some(r => pointInRing(p.centre!, r))) kept.push(p); else outside += 1;
  }
  return { kept, outside };
}
/** Merge a scan's raw detections and publish them, filtered to the field. */
function republish(taskId: string): void {
  const s = getFrameRun(taskId);
  if (!s.scanSet) return;
  const all = [...rawOf(taskId).values()].flat();
  const { kept, outside } = withinField(taskId, mergeAcrossFrames(s.scanSet.set, s.scanSet.altM, all));
  patchFrameRun(taskId, { plants: kept, raw: all.length, outside });
}

export const getFrameRun = (taskId: string): FrameRunSession => sessions.get(taskId) ?? EMPTY_FRAME_RUN;

export function patchFrameRun(taskId: string, patch: Partial<FrameRunSession> | ((s: FrameRunSession) => Partial<FrameRunSession>)): void {
  const cur = getFrameRun(taskId);
  const p = typeof patch === "function" ? patch(cur) : patch;
  const next = { ...cur, ...p };
  // The areas follow the plants and the grouping settings, nothing else: a display toggle recomputes nothing.
  if (("plants" in p && p.plants !== cur.plants) || ("hotspotParams" in p && p.hotspotParams !== cur.hotspotParams) || ("scanSet" in p && p.scanSet !== cur.scanSet)) {
    next.hotspots = next.scanSet && next.plants.length ? buildHotspots(next.scanSet.set.reference, next.scanSet.altM, next.plants, next.hotspotParams) : null;
    if (next.selectedHotspotId && !next.hotspots?.hotspots.some(h => h.id === next.selectedHotspotId)) next.selectedHotspotId = null;
  }
  sessions.set(taskId, next);
  emit();
}

export function setViewMode(taskId: string, viewMode: ViewMode): void { patchFrameRun(taskId, { viewMode }); }

/** Select an area and ask the map to fly to it (null clears the selection and flies back to the field). */
export function selectHotspot(taskId: string, id: string | null): void {
  const s = getFrameRun(taskId);
  const h = id ? s.hotspots?.hotspots.find(x => x.id === id) ?? null : null;
  patchFrameRun(taskId, { selectedHotspotId: h ? h.id : null, selectedId: null, focus: h ? { ...h.bbox, nonce: (s.focus?.nonce ?? 0) + 1 } : s.focus });
}

export function setHotspotParams(taskId: string, hotspotParams: HotspotParams): void { patchFrameRun(taskId, { hotspotParams }); }

/** The saved reviews of a scan, into the session (called once by the panel). */
export async function restoreHotspotReviews(taskId: string, load: typeof loadHotspotReviews = loadHotspotReviews): Promise<void> {
  const reviews = await load(taskId);
  patchFrameRun(taskId, s => ({ reviews: { ...reviews, ...s.reviews } }));
}

/** The operator's word on an area: kept for the session at once, saved when signed in; null clears it. */
export async function reviewHotspot(taskId: string, input: { userId: string | null; hotspotId: string; verdict: HotspotReview | null; notes?: string; save?: typeof saveHotspotReview; remove?: typeof deleteHotspotReview }): Promise<{ ok: boolean; error?: string }> {
  const s = getFrameRun(taskId);
  if (input.verdict === null) {
    const { [input.hotspotId]: _gone, ...rest } = s.reviews;
    patchFrameRun(taskId, { reviews: rest });
    return input.userId ? (input.remove ?? deleteHotspotReview)(taskId, input.hotspotId) : { ok: true };
  }
  const row: HotspotReviewRow = { hotspotId: input.hotspotId, verdict: input.verdict, notes: input.notes ?? s.reviews[input.hotspotId]?.notes ?? "", updatedAt: new Date().toISOString(), paramsKey: s.paramsKey };
  patchFrameRun(taskId, { reviews: { ...s.reviews, [input.hotspotId]: row } });
  if (!input.userId) return { ok: true };
  return (input.save ?? saveHotspotReview)({ userId: input.userId, scanId: taskId, hotspotId: input.hotspotId, verdict: input.verdict, notes: row.notes, paramsKey: s.paramsKey });
}

/** Reviews whose area no longer exists in the current grouping: kept, never deleted by a rescan, listed for the operator. */
export function orphanedReviews(s: FrameRunSession): HotspotReviewRow[] {
  const ids = new Set(s.hotspots?.hotspots.map(h => h.id) ?? []);
  return Object.values(s.reviews).filter(r => !ids.has(r.hotspotId));
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
  /** The photograph's planting pattern: from the scan's saved reads, or read from the photo here (photoRows.ts); null marks its weeds "no-rows". */
  rowContextFor?: (filename: string, blob: Blob, shot: Shot, onProgress: (fraction: number) => void, signal: AbortSignal) => RowContext | null | Promise<RowContext | null>;
  deps?: Partial<FrameRunDeps>;
};

function summarise(plants: GroundPlant[], raw: number, frames: Record<string, FrameSummary>): string {
  const c = countByClass(plants);
  const r = countByRow(plants);
  const n = Object.keys(frames).length;
  const errs = Object.values(frames).filter(f => f.status === "error").length;
  const merged = raw - plants.length;
  return `${r.offRow.toLocaleString()} weed${r.offRow === 1 ? "" : "s"} off the rows${r.onRow ? `, ${r.onRow.toLocaleString()} on crop plants or row lines set aside` : ""}${r.noRows ? `, ${r.noRows.toLocaleString()} in photos without a row read` : ""}, and ${c.crop.toLocaleString()} crop plant${c.crop === 1 ? "" : "s"} from ${n} photo${n === 1 ? "" : "s"}${merged > 0 ? `; ${merged.toLocaleString()} repeat sightings merged` : ""}${errs ? `; ${errs} photo${errs === 1 ? "" : "s"} failed` : ""}.`;
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
  patchFrameRun(taskId, { scanSet: { set, altM } });
  const byFrame = rawOf(taskId);
  byFrame.clear();
  const summaries: Record<string, FrameSummary> = {};
  // Merging and drawing thousands of plants after every photo is what makes the map lag: publish at most
  // every PUBLISH_MS while the run goes, and once more at the end.
  const PUBLISH_MS = 2000;
  let lastPublish = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const publishNow = () => {
    if (!mine()) return;
    lastPublish = Date.now();
    const all = [...byFrame.values()].flat();
    const { kept, outside } = withinField(taskId, mergeAcrossFrames(set, altM, all));
    patchFrameRun(taskId, { plants: kept, raw: all.length, outside, frames: { ...summaries } });
  };
  const publish = (final = false) => {
    if (trailing) { clearTimeout(trailing); trailing = null; }
    if (final || Date.now() - lastPublish >= PUBLISH_MS) { publishNow(); return; }
    trailing = setTimeout(publishNow, PUBLISH_MS - (Date.now() - lastPublish));
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
      // The photo's rows first (saved read or a read made now), then the model.
      let rowContext: RowContext | null = null;
      if (input.rowContextFor) {
        patchFrameRun(taskId, s => ({ progress: s.progress ? { ...s.progress, phase: "rows", rowsFraction: 0 } : s.progress }));
        try {
          rowContext = (await input.rowContextFor(name, blob, shot, f => { if (mine()) patchFrameRun(taskId, s => ({ progress: s.progress ? { ...s.progress, rowsFraction: f } : s.progress })); }, ctrl.signal)) ?? null;
        } catch { rowContext = null; }
        if (ctrl.signal.aborted || !mine()) return;
      }
      patchFrameRun(taskId, s => ({ progress: s.progress ? { ...s.progress, phase: "model", rowsFraction: null } : s.progress }));
      const res = await deps.detect(blob, entry.filename, { algorithm: params.algorithm, scale: params.scale, tile: params.tile, overlap: params.overlap, threshold: params.threshold, includeCrop: true }, {
        signal: ctrl.signal,
        onProgress: p => { if (mine()) patchFrameRun(taskId, s => ({ progress: s.progress ? { ...s.progress, tilesDone: p.tilesDone, tilesTotal: p.tilesTotal } : s.progress })); },
      });
      if (!res.ok) {
        if (res.error === "cancelled") return;
        summaries[name] = { filename: name, weeds: 0, crops: 0, status: "error", error: res.error, ms: null };
        publish();
        if (/not reachable/.test(res.error) || res.status === 503) {
          publish(true);
          patchFrameRun(taskId, { running: false, error: res.error, note: summarise(getFrameRun(taskId).plants, getFrameRun(taskId).raw, summaries) });
          return;
        }
        continue;
      }
      const dets = groundFrameResult({ set, shot, groundAltM: altM, result: res.value, rowContext });
      byFrame.set(name, dets);
      const c = countByClass(dets);
      summaries[name] = { filename: name, weeds: c.weed, crops: c.crop, status: "done", ms: res.value.timings_ms?.total ?? null };
      publish();
      void deps.cache.save({ userId: input.userId, scanId: taskId, paramsKey, params, run: { filename: name, algorithm: res.value.algorithm.name, modelSha256: input.modelSha, nativeWidth: res.value.image.width, nativeHeight: res.value.image.height, timingsMs: res.value.timings_ms ?? {}, detections: dets, createdAt: null } });
    }
    if (!mine()) return;
    publish(true);
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
  const { kept, outside } = withinField(taskId, mergeAcrossFrames(input.sources.set, input.sources.groundAltM, all));
  patchFrameRun(taskId, { running: false, params: input.params, paramsKey, modelSha: input.modelSha, algorithmLabel: input.algorithmLabel, plants: kept, raw: all.length, outside, scanSet: { set: input.sources.set, altM: input.sources.groundAltM }, frames, error: null, restoredAt: latest ?? new Date().toISOString(), note: summarise(kept, all.length, frames), progress: null });
  return true;
}

/** Forget the run on screen and, when a key is known, its saved rows. */
export async function clearFrameRun(taskId: string, deps?: Partial<FrameRunDeps>): Promise<void> {
  const s = getFrameRun(taskId);
  if (s.running) stopFrameRun(taskId);
  const remove = deps?.cache?.remove ?? deleteFrameRuns;
  if (s.paramsKey) await remove(taskId, s.paramsKey);
  rawByTask.delete(taskId);
  sessions.set(taskId, { ...EMPTY_FRAME_RUN, showWeeds: s.showWeeds, showCrops: s.showCrops, showOnRow: s.showOnRow, viewMode: s.viewMode, reviews: s.reviews, hotspotParams: s.hotspotParams });
  emit();
}

/**
 * Read the rows for photos already scored and re-tag their weeds, without
 * running the model again: the saved rows carry each plant's centre in the
 * photo's own pixels, so a row read made now can say where it stood. Photos
 * whose weeds already have a row status are skipped unless `force`.
 */
export function retagRows(taskId: string, input: { userId: string | null; sources: ScanSources; rowContextFor: NonNullable<StartFrameRunInput["rowContextFor"]>; force?: boolean; deps?: Partial<FrameRunDeps> }): void {
  const s = getFrameRun(taskId);
  if (s.running || !input.sources.set || input.sources.groundAltM == null) return;
  const deps: FrameRunDeps = { ...DEFAULT_DEPS, ...input.deps, cache: { ...DEFAULT_DEPS.cache, ...(input.deps?.cache ?? {}) } };
  const ctrl = new AbortController();
  controllers.set(taskId, ctrl);
  const mine = () => controllers.get(taskId) === ctrl;
  const raw = rawOf(taskId);
  const byName = new Map(input.sources.set.shots.map(sh => [sh.filename, sh]));
  const todo = [...raw.entries()].filter(([name, dets]) => byName.has(name) && (input.force || dets.some(d => d.klass === "weed" && (!d.rowStatus || d.rowStatus === "no-rows"))));
  patchFrameRun(taskId, { running: true, error: null, progress: { framesDone: 0, framesTotal: todo.length, current: null, tilesDone: 0, tilesTotal: null, fromCache: 0, phase: "rows", rowsFraction: 0 } });
  (async () => {
    for (let i = 0; i < todo.length; i++) {
      if (ctrl.signal.aborted || !mine()) return;
      const [name, dets] = todo[i];
      const shot = byName.get(name)!;
      patchFrameRun(taskId, sx => ({ progress: { ...(sx.progress as FrameRunProgress), framesDone: i, current: name, phase: "rows", rowsFraction: 0 } }));
      const look = lookupOriginal(input.sources.frames, name);
      if (!look.ok) continue;
      const blob = await deps.download(look.entry);
      if (!blob) continue;
      let ctx: RowContext | null = null;
      try { ctx = (await input.rowContextFor(name, blob, shot, f => { if (mine()) patchFrameRun(taskId, sx => ({ progress: sx.progress ? { ...sx.progress, rowsFraction: f } : sx.progress })); }, ctrl.signal)) ?? null; } catch { ctx = null; }
      if (ctrl.signal.aborted || !mine()) return;
      const retagged = dets.map(d => (d.klass === "weed" ? { ...d, rowStatus: rowStatusOf(ctx, d.nativeCentroid[0], d.nativeCentroid[1]) } : d));
      raw.set(name, retagged);
      const sx = getFrameRun(taskId);
      if (input.userId && sx.paramsKey && sx.params) {
        const saved = sx.frames[name];
        void deps.cache.save({ userId: input.userId, scanId: taskId, paramsKey: sx.paramsKey, params: sx.params, run: { filename: name, algorithm: sx.params.algorithm, modelSha256: sx.modelSha, nativeWidth: 0, nativeHeight: 0, timingsMs: saved?.ms != null ? { total: saved.ms } : {}, detections: retagged, createdAt: null } });
      }
      republish(taskId);
    }
    if (!mine()) return;
    const done = getFrameRun(taskId);
    patchFrameRun(taskId, { running: false, progress: { ...(done.progress as FrameRunProgress), framesDone: todo.length, current: null, phase: null, rowsFraction: null }, note: summarise(done.plants, done.raw, done.frames) });
  })().catch(e => { if (mine()) patchFrameRun(taskId, { running: false, error: (e as Error)?.message ?? String(e) }); });
}

/** The plants a map should draw: crops when asked, weeds off the rows, and the set-aside ones only when asked. */
export function visiblePlants(s: FrameRunSession): GroundPlant[] {
  return s.plants.filter(p => {
    if (p.klass === "crop") return s.showCrops;
    if (!s.showWeeds) return false;
    return s.showOnRow || !(p.rowStatus === "on-crop" || p.rowStatus === "on-row");
  });
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
  /** The photograph's planting pattern, when read. */
  rowContext?: RowContext | null;
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
  const dets = groundFrameResult({ set, shot, groundAltM: altM, result, rowContext: input.rowContext ?? null });
  const raw = rawOf(taskId);
  raw.set(shot.filename, dets);
  const all = [...raw.values()].flat();
  const { kept: plants, outside } = withinField(taskId, mergeAcrossFrames(set, altM, all));
  const c = countByClass(dets);
  const cur = getFrameRun(taskId);
  const paramsKey = frameRunKey(input.params, input.modelSha);
  const frames = { ...cur.frames, [shot.filename]: { filename: shot.filename, weeds: c.weed, crops: c.crop, status: "done" as const, ms: result.timings_ms?.total ?? null } };
  patchFrameRun(taskId, {
    plants, raw: all.length, outside, scanSet: { set, altM }, frames, error: null, restoredAt: null,
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
