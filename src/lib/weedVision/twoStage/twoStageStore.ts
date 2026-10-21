// The two-stage prototype's session per scan, kept outside the tab like the
// model run (frameRunStore.ts), so leaving the tab does not end a run.
//
//   Stage 1   readStage1 over the registered map, boundary and field rows:
//             a pressure grid in seconds; the windows are planned and routed
//             at once, and any windows already scored are taken from the cache.
//   Stage 2   RF-DETR on the routed windows only, or on every window (the
//             reference run that the scorecard compares against). Each window
//             is one model tile, scored once and saved like a map chunk
//             (scan_frame_detections, key prefixed "two-stage|"), so the routed
//             run after a reference run costs nothing and vice versa.
//   Labels    the operator's blind cell labels, in this browser only (export
//             and import as a file), never mixed with model output on screen.
import { useSyncExternalStore } from "react";
import { storageKey } from "../../storage";
import { type DetectOptions, type Outcome, type Progress, type WeedVisionResult, detectWeeds } from "../client";
import { type FieldRows, fieldRowStatusAt } from "../fieldRows";
import { isOnRow } from "../rowFilter";
import { type SavedFrameRun, loadFrameRuns, saveFrameRun } from "../frameRunCache";
import { ensureFieldRows, fieldRowsOf, frameRunBoundaryOf, frameRunMapOf } from "../frameRunStore";
import type { FrameDetection, FrameRunParams, GroundPlant } from "../frames";
import { type MapChunk, type RenderedChunk, MIN_COVERAGE, chooseMapZoom, groundMapResult, mapRunKey, mapTiling, renderMapChunk, upscaleFor } from "../mapRun";
import { type MapWindow, type Routing, DEFAULT_ROUTER, planWindows, routeWindows, seeded } from "./router";
import { type ChunkPainter, betweenRowsPainter, rowsSignature } from "../layout/rowBand";
import type { CellLabel } from "./score";
import { mergeSeamDuplicates } from "./seams";
import { type Stage1Params, type Stage1Result, DEFAULT_STAGE1, gridKeyOf, readStage1 } from "./stage1";

export const TWO_STAGE_KEY_PREFIX = "two-stage|";

export type TwoStageLayers = { pressure: boolean; candidates: boolean; windows: boolean; weeds: boolean };

export type TwoStageSession = {
  stage1: Stage1Result | null;
  stage1State: "idle" | "reading" | "done" | "none";
  stage1Progress: number | null;
  windows: MapWindow[];
  routing: Routing | null;
  /** The model tile (= window canvas), map pixels, and the cache key the windows are saved under. */
  tilePx: number | null;
  paramsKey: string | null;
  params: FrameRunParams | null;
  modelSha: string | null;
  /** Windows with a result: their plants and the service time (null when unknown). */
  runs: Record<string, { plants: GroundPlant[]; ms: number | null }>;
  stage2: { mode: "routed" | "everywhere"; done: number; total: number; fromCache: number } | null;
  running: boolean;
  error: string | null;
  layers: TwoStageLayers;
  labelMode: boolean;
  labels: Record<string, CellLabel>;
  activeCell: string | null;
  focus: { lat: number; lng: number; nonce: number } | null;
  /**
   * Paint the crop rows and crowns with the field's bare-ground colour before the model sees a window (true), or
   * leave the picture untouched and drop what lands on the rows afterwards (false). Painting is what Simple mode
   * does; the literature has not tested it, and general vision work finds painted regions can make a model fire on
   * the paint's edges (docs/research/weed-pressure-grading-2026-10-21.md, section 5), so the two can be run on the
   * same windows and compared (paintComparison).
   */
  paintCrop: boolean;
  /** The last Stage 1 input, kept so the windows can be restored under the other painting key. */
  photoGsdM: number | null;
  /** The windows' cache key without the painting suffix, and the rows' signature, for the comparison. */
  keyBase: string | null;
  rowsSig: string | null;
};

const EMPTY: TwoStageSession = {
  stage1: null, stage1State: "idle", stage1Progress: null, windows: [], routing: null, tilePx: null, paramsKey: null, params: null, modelSha: null,
  runs: {}, stage2: null, running: false, error: null,
  layers: { pressure: true, candidates: true, windows: true, weeds: true }, labelMode: false, labels: {}, activeCell: null, focus: null,
  paintCrop: true, photoGsdM: null, keyBase: null, rowsSig: null,
};

const sessions = new Map<string, TwoStageSession>();
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getTwoStage = (taskId: string): TwoStageSession => sessions.get(taskId) ?? EMPTY;
export function patchTwoStage(taskId: string, patch: Partial<TwoStageSession> | ((s: TwoStageSession) => Partial<TwoStageSession>)): void {
  const cur = getTwoStage(taskId);
  sessions.set(taskId, { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) });
  for (const l of listeners) l();
}
export function useTwoStage(taskId: string): TwoStageSession {
  return useSyncExternalStore(subscribe, () => getTwoStage(taskId), () => getTwoStage(taskId));
}
export function resetTwoStageStore(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  sessions.clear();
  for (const l of listeners) l();
}

/** Every plant from the windows that ran, a plant seen by two windows across their seam counted once. */
const plantsMemo = new WeakMap<object, GroundPlant[]>();
export const twoStagePlants = (s: Pick<TwoStageSession, "runs">): GroundPlant[] => {
  let v = plantsMemo.get(s.runs);
  if (!v) { v = mergeSeamDuplicates(Object.values(s.runs).flatMap(r => r.plants)); plantsMemo.set(s.runs, v); }
  return v;
};

// ------------------------------------------------------------- labels (this browser)

const labelsKey = (taskId: string, s: Stage1Result) => storageKey("twoStage", "labels", taskId, gridKeyOf(s.grid));
function loadLabels(taskId: string, s: Stage1Result): Record<string, CellLabel> {
  try { const raw = localStorage.getItem(labelsKey(taskId, s)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function storeLabels(taskId: string, s: Stage1Result, labels: Record<string, CellLabel>): void {
  try { localStorage.setItem(labelsKey(taskId, s), JSON.stringify(labels)); } catch { /* kept for the session */ }
}

export function labelCell(taskId: string, key: string, label: Omit<CellLabel, "at"> | null): void {
  const s = getTwoStage(taskId);
  if (!s.stage1) return;
  const labels = { ...s.labels };
  if (label) labels[key] = { ...label, at: new Date().toISOString() }; else delete labels[key];
  storeLabels(taskId, s.stage1, labels);
  patchTwoStage(taskId, { labels });
}

/** The next unlabelled cell, drawn at random (seeded by how many are labelled, so the order can be replayed), and the map sent to it. */
export function nextRandomCell(taskId: string): string | null {
  const s = getTwoStage(taskId);
  if (!s.stage1) return null;
  const open = s.stage1.cells.filter(c => !s.labels[c.key]);
  if (!open.length) return null;
  const c = open[Math.floor(seeded(DEFAULT_ROUTER.seed + Object.keys(s.labels).length)() * open.length)];
  patchTwoStage(taskId, x => ({ activeCell: c.key, focus: { lat: c.centre.lat, lng: c.centre.lng, nonce: (x.focus?.nonce ?? 0) + 1 } }));
  return c.key;
}

export type LabelFile = { format: "swardus-cell-labels-v1"; scanId: string; grid: string; cellM: number; exportedAt: string; labels: Array<CellLabel & { cell: string; lat: number; lng: number }> };

export function exportLabels(taskId: string): LabelFile | null {
  const s = getTwoStage(taskId);
  if (!s.stage1) return null;
  const at = new Map(s.stage1.cells.map(c => [c.key, c.centre]));
  return {
    format: "swardus-cell-labels-v1", scanId: taskId, grid: gridKeyOf(s.stage1.grid), cellM: s.stage1.params.cellM, exportedAt: new Date().toISOString(),
    labels: Object.entries(s.labels).map(([cell, l]) => ({ cell, ...l, lat: at.get(cell)?.lat ?? NaN, lng: at.get(cell)?.lng ?? NaN })),
  };
}

/** Labels from a file of this scan and grid; returns how many were taken. */
export function importLabels(taskId: string, file: LabelFile): number {
  const s = getTwoStage(taskId);
  if (!s.stage1 || file?.format !== "swardus-cell-labels-v1" || file.grid !== gridKeyOf(s.stage1.grid)) return 0;
  const keys = new Set(s.stage1.cells.map(c => c.key));
  const labels = { ...s.labels };
  let n = 0;
  for (const l of file.labels ?? []) {
    if (!keys.has(l.cell) || ![0, 1, 2, 3, 4].includes(l.coverClass)) continue;
    labels[l.cell] = { coverClass: l.coverClass, highPriority: !!l.highPriority, at: l.at ?? new Date().toISOString() };
    n++;
  }
  storeLabels(taskId, s.stage1, labels);
  patchTwoStage(taskId, { labels });
  return n;
}

// ------------------------------------------------------------- the runs

export type TwoStageDeps = {
  readStage1: typeof readStage1;
  ensureRows: (taskId: string) => Promise<void>;
  rowsOf: (taskId: string) => FieldRows | undefined;
  mapChunk: (chunk: MapChunk, tile: (z: number, x: number, y: number) => string, upscale: number, signal: AbortSignal, paint?: ChunkPainter) => Promise<RenderedChunk | null>;
  detect: (file: Blob, filename: string, opts: DetectOptions, hooks: { signal?: AbortSignal; onProgress?: (p: Progress) => void }) => Promise<Outcome<WeedVisionResult>>;
  cache: { load: typeof loadFrameRuns; save: typeof saveFrameRun };
};
const DEFAULT_DEPS: TwoStageDeps = {
  readStage1, ensureRows: t => ensureFieldRows(t), rowsOf: fieldRowsOf, mapChunk: renderMapChunk,
  detect: (f, n, o, h) => detectWeeds(f, n, o, h), cache: { load: loadFrameRuns, save: saveFrameRun },
};
const depsOf = (d?: Partial<TwoStageDeps>): TwoStageDeps => ({ ...DEFAULT_DEPS, ...d, cache: { ...DEFAULT_DEPS.cache, ...(d?.cache ?? {}) } });

/** Weeds judged against the field's rows; on-row weeds are the crop. */
function tagRows(dets: FrameDetection[], rows: FieldRows | undefined): GroundPlant[] {
  return dets.map(d => ({ ...d, rowStatus: d.klass === "weed" ? (rows && d.centre ? fieldRowStatusAt(rows, d.centre) : "no-rows") : d.rowStatus, seenIn: [d.frame], duplicates: 0 }));
}

export type RunStage1Input = { params: FrameRunParams; modelSha: string | null; photoGsdM: number | null; /** Stage 1's own parameters, the cell size among them; the defaults otherwise. */ stage1Params?: Partial<Stage1Params>; deps?: Partial<TwoStageDeps> };

/** Stage 1 over the field, then the windows planned and routed, and windows already scored restored from the cache. */
export async function runStage1(taskId: string, input: RunStage1Input): Promise<void> {
  const s0 = getTwoStage(taskId);
  if (s0.running || s0.stage1State === "reading") return;
  const deps = depsOf(input.deps);
  const map = frameRunMapOf(taskId), rings = frameRunBoundaryOf(taskId);
  const avail = map ? chooseMapZoom(map.maxNative, map.lat) : null;
  if (!map || !rings?.length) { patchTwoStage(taskId, { error: "The field map or its boundary is not loaded yet." }); return; }
  if (!avail) { patchTwoStage(taskId, { error: "The field map is too coarse for the model (it needs about 3 cm per pixel)." }); return; }
  const ctrl = new AbortController();
  controllers.set(taskId, ctrl);
  patchTwoStage(taskId, { stage1State: "reading", stage1Progress: 0, error: null });
  await deps.ensureRows(taskId);
  const rows = deps.rowsOf(taskId) ?? null;
  const stage1 = await deps.readStage1({ rings, tile: map.tile, maxNative: map.maxNative, lat: map.lat, rows, params: input.stage1Params ? { ...DEFAULT_STAGE1, ...input.stage1Params } : undefined, signal: ctrl.signal, onProgress: f => patchTwoStage(taskId, { stage1Progress: f }) });
  if (ctrl.signal.aborted || controllers.get(taskId) !== ctrl) return;
  if (!stage1) { patchTwoStage(taskId, { stage1State: "none", stage1Progress: null, error: "The field map could not be read here." }); return; }
  const upscale = upscaleFor(avail.mpp, input.photoGsdM);
  const tilePx = mapTiling(input.params, upscale).tile;
  const windows = planWindows(rings, avail.z, tilePx);
  const routing = routeWindows(windows, stage1);
  const size = windows[0]?.size ?? tilePx;
  const keyBase = `${TWO_STAGE_KEY_PREFIX}${mapRunKey({ ...input.params, tile: tilePx, overlap: 0 }, input.modelSha, avail.z, 1)}|w${size}`;
  const rowsSig = rows?.source === "layout" ? rowsSignature(rows) : null;
  const paramsKey = windowsKey(keyBase, rowsSig, s0.paintCrop);
  const cached = await deps.cache.load(taskId, paramsKey);
  const runs: TwoStageSession["runs"] = {};
  for (const w of windows) { const hit = cached.get(w.name); if (hit) runs[w.name] = { plants: tagRows(hit.detections, rows ?? undefined), ms: hit.timingsMs?.total ?? null }; }
  patchTwoStage(taskId, { stage1, stage1State: "done", stage1Progress: null, windows, routing, tilePx, paramsKey, params: input.params, modelSha: input.modelSha, photoGsdM: input.photoGsdM, keyBase, rowsSig, runs, labels: loadLabels(taskId, stage1), activeCell: null });
}

/** The windows' cache key: the base, and the painting suffix only when the crop is painted out over a layout's rows. */
export const windowsKey = (keyBase: string, rowsSig: string | null, paintCrop: boolean): string => `${keyBase}${rowsSig && paintCrop ? `|between-rows|${rowsSig}` : ""}`;

/** Switch the painting on or off and restore the windows already scored under that key, without reading Stage 1 again. */
export async function setPaintCrop(taskId: string, paintCrop: boolean, deps?: Partial<TwoStageDeps>): Promise<void> {
  const s = getTwoStage(taskId);
  if (s.running) return;
  patchTwoStage(taskId, { paintCrop });
  if (!s.stage1 || !s.keyBase) return;
  const d = depsOf(deps);
  const rows = d.rowsOf(taskId);
  const paramsKey = windowsKey(s.keyBase, s.rowsSig, paintCrop);
  const cached = await d.cache.load(taskId, paramsKey);
  const runs: TwoStageSession["runs"] = {};
  for (const w of s.windows) { const hit = cached.get(w.name); if (hit) runs[w.name] = { plants: tagRows(hit.detections, rows ?? undefined), ms: hit.timingsMs?.total ?? null }; }
  patchTwoStage(taskId, { paramsKey, runs });
}

export type PaintComparison = {
  /** Windows scored under both keys. */
  windows: number;
  /** Weeds between the rows found on those windows, painted and unpainted. */
  painted: number;
  unpainted: number;
  /** Weeds the unpainted run put ON the rows (dropped afterwards): what painting takes out of the model's sight. */
  unpaintedOnRow: number;
};

/**
 * The same windows scored with the crop painted out and left in: how many weeds between the rows each gave. Null until
 * both runs exist on at least one window. The two keys differ only in the painting suffix.
 */
export async function paintComparison(taskId: string, deps?: Partial<TwoStageDeps>): Promise<PaintComparison | null> {
  const s = getTwoStage(taskId);
  if (!s.keyBase || !s.rowsSig) return null;
  const d = depsOf(deps);
  const rows = d.rowsOf(taskId);
  const [a, b] = await Promise.all([d.cache.load(taskId, windowsKey(s.keyBase, s.rowsSig, true)), d.cache.load(taskId, windowsKey(s.keyBase, s.rowsSig, false))]);
  const names = s.windows.map(w => w.name).filter(n => a.has(n) && b.has(n));
  if (!names.length) return null;
  const between = (dets: FrameDetection[]) => tagRows(dets, rows ?? undefined).filter(p => p.klass === "weed" && p.centre && !isOnRow(p.rowStatus)).length;
  const onRow = (dets: FrameDetection[]) => tagRows(dets, rows ?? undefined).filter(p => p.klass === "weed" && p.centre && isOnRow(p.rowStatus)).length;
  let painted = 0, unpainted = 0, unpaintedOnRow = 0;
  for (const n of names) { painted += between(a.get(n)!.detections); unpainted += between(b.get(n)!.detections); unpaintedOnRow += onRow(b.get(n)!.detections); }
  return { windows: names.length, painted, unpainted, unpaintedOnRow };
}

/** Stage 2: RF-DETR on the routed windows, or on every window for the reference. */
export function runStage2(taskId: string, input: { userId: string | null; mode: "routed" | "everywhere"; deps?: Partial<TwoStageDeps> }): void {
  const s = getTwoStage(taskId);
  const map = frameRunMapOf(taskId);
  if (s.running || !s.stage1 || !s.routing || !s.params || !s.paramsKey || !s.tilePx || !map) return;
  const deps = depsOf(input.deps);
  const ctrl = new AbortController();
  controllers.set(taskId, ctrl);
  const mine = () => controllers.get(taskId) === ctrl;
  const order = input.mode === "routed" ? s.routing.order : s.windows.map(w => w.name);
  const byName = new Map(s.windows.map(w => [w.name, w]));
  const todo = order.filter(n => !s.runs[n]);
  const { params, paramsKey, tilePx, modelSha } = s;
  const rows = deps.rowsOf(taskId);
  const paint = rows?.source === "layout" && s.paintCrop ? betweenRowsPainter(rows) : undefined;
  patchTwoStage(taskId, { running: true, error: null, stage2: { mode: input.mode, done: order.length - todo.length, total: order.length, fromCache: order.length - todo.length } });
  (async () => {
    for (const name of todo) {
      if (ctrl.signal.aborted || !mine()) return;
      const w = byName.get(name)!;
      const current = frameRunMapOf(taskId) ?? map;
      const rendered = await deps.mapChunk(w, current.tile, 1, ctrl.signal, paint);
      if (ctrl.signal.aborted || !mine()) return;
      let plants: GroundPlant[] = [], ms: number | null = 0;
      if (rendered && rendered.coverage >= MIN_COVERAGE) {
        const res = await deps.detect(rendered.image, `${name.replace(/\//g, "_")}.jpg`, { algorithm: params.algorithm, scale: 1, tile: tilePx, overlap: 0, threshold: params.threshold, includeCrop: true, geometry: "lite" }, { signal: ctrl.signal });
        if (!res.ok) {
          if (res.error === "cancelled") return;
          patchTwoStage(taskId, { running: false, error: res.error });
          return;
        }
        const dets = groundMapResult({ chunk: w, result: res.value, upscale: 1, rows: null, lat: current.lat });
        plants = tagRows(dets, rows);
        ms = res.value.timings_ms?.total ?? null;
        if (input.userId) {
          const run: SavedFrameRun = { filename: name, algorithm: res.value.algorithm.name, modelSha256: modelSha, nativeWidth: tilePx, nativeHeight: tilePx, timingsMs: res.value.timings_ms ?? {}, detections: dets, createdAt: null };
          void deps.cache.save({ userId: input.userId, scanId: taskId, paramsKey, params: { ...params, tile: tilePx, overlap: 0 }, run });
        }
      }
      patchTwoStage(taskId, x => ({ runs: { ...x.runs, [name]: { plants, ms } }, stage2: x.stage2 ? { ...x.stage2, done: x.stage2.done + 1 } : x.stage2 }));
    }
    if (mine()) patchTwoStage(taskId, { running: false });
  })().catch(e => { if (mine()) patchTwoStage(taskId, { running: false, error: (e as Error)?.message ?? String(e) }); });
}

export function stopTwoStage(taskId: string): void {
  controllers.get(taskId)?.abort();
  controllers.delete(taskId);
  patchTwoStage(taskId, s => ({ running: false, stage1State: s.stage1State === "reading" ? (s.stage1 ? "done" : "idle") : s.stage1State, stage1Progress: null }));
}
