// Stage 2: the cameras, from each photograph's header, adjusted to the soil-texture ties between overlapping
// photographs. The port of experiment 1's reference chain (scripts/directGeoref/exp1Align.ts): ties under the
// header-only cameras, a fit of the four flight-wide numbers (camera tilts, spin, ground height), ties again
// under that fit (more windows succeed once the photographs nearly agree), then the reference model: the four
// numbers plus a small per-photo attitude correction (1 degree prior, positions held at 3 cm).
import { SOIL_TIE_DEFAULTS, type AdjustModel, type BaseFrame, type GeorefFrame, type ModelSpec, type SoilTie, type SoilTieOptions, type WindowCache, adjust, emptyModel, evaluateTies, findSoilTies, frameFromDji, frameUnder, groundSampleAt, takeoffPlane, windowCacheFor } from "../../directGeoref";
import { toEnu } from "../../sourceFrames/odm";
import type { PhotoRead } from "./photos";
import type { Pool } from "./pool";
import { type BuildHooks, checkCancelled } from "./types";

export const GLOBAL_SPEC: ModelSpec = { name: "global 4 (tilts, spin, ground)", globals: ["tiltAcrossDeg", "tiltAlongDeg", "spinDeg", "groundOffsetM"] };
export const REFERENCE_SPEC: ModelSpec = { name: "global + per-photo attitude 1 deg", globals: GLOBAL_SPEC.globals, perPhoto: { keys: ["dE", "dN", "dYawDeg", "dTiltAcrossDeg", "dTiltAlongDeg"], sigma: { dE: 0.03, dN: 0.03, dYawDeg: 1, dTiltAcrossDeg: 1, dTiltAlongDeg: 1 } } };

export type CameraResult = {
  model: AdjustModel;
  frames: Map<string, GeorefFrame>;
  bases: BaseFrame[];
  report: {
    photographs: number;
    headerTies: number;
    ties: number;
    pairs: number;
    pairsWithTies: number;
    /** Median tie disagreement, metres, under the header-only cameras and under the final model (the ties the fit saw). */
    headerResidualM: number;
    residualM: number;
    /** Median disagreement of the held-out pairs' ties (never fitted), or null when nothing was held out. */
    heldOutResidualM: number | null;
    heldOutTies: number;
    /** The fine tie window's ground resolution, metres per sample, and the raster's own pixel size it was chosen from. */
    fineResM: number;
    rasterPixelM: number;
    /** Why fine windows were rejected, summed over the last round. */
    rejected: Record<string, number>;
    globals: AdjustModel["globals"];
    model: string;
    note: string | null;
    /** With helper workers: each helper's tie time over both rounds, milliseconds (how evenly the work was spread). */
    tieMsPerHelper?: number[];
  };
};

/** Header-only cameras on the take-off plane, with the aircraft velocity. */
export function baseFrames(reads: PhotoRead[]): { bases: BaseFrame[]; refused: { name: string; reason: string }[] } {
  const bases: BaseFrame[] = [], refused: { name: string; reason: string }[] = [];
  for (const r of reads) {
    const f = frameFromDji(r.name, r.meta, { ground: takeoffPlane(0) });
    if ("reason" in f) { refused.push({ name: r.name, reason: f.reason }); continue; }
    bases.push({ frame: f.frame, velocity: [r.meta.speedEastMs ?? 0, r.meta.speedNorthMs ?? 0] });
  }
  return { bases, refused };
}

/** Candidate pairs: camera centres within `maxM`. */
export function candidatePairs(frames: GeorefFrame[], maxM = 45): [GeorefFrame, GeorefFrame][] {
  const out: [GeorefFrame, GeorefFrame][] = [];
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const e = toEnu({ lat: frames[j].pose.lat, lng: frames[j].pose.lng, altM: 0 }, { lat: frames[i].pose.lat, lng: frames[i].pose.lng, altM: 0 });
    if (Math.hypot(e[0], e[1]) <= maxM) out.push([frames[i], frames[j]]);
  }
  return out;
}

/** Which helper holds which rasters (sent once, before the first tie task that needs them), and each helper's tie time. */
type RasterPlacement = { sent: Set<string>[]; ms: number[] };

/**
 * Groups (in flight order) dealt to `parts` helpers in contiguous runs of about equal work: a group goes to the run its
 * midpoint falls in. Contiguous, so a helper's partners mostly repeat (few rasters per helper); by work, not by count,
 * because early photographs have more partners (pairs are counted once, from the first photograph). Deterministic.
 */
export function partitionByWork(weights: number[], parts: number): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (parts <= 1 || total <= 0) return weights.map(() => 0);
  const target = total / parts;
  let cum = 0;
  return weights.map(w => { const h = Math.min(parts - 1, Math.floor((cum + w / 2) / target)); cum += w; return h; });
}

/** The rejection counts in name order: the helpers answer in any order, the report should not depend on it. */
const byKey = (r: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Every helper drops its tie rasters (the cameras are aligned; nothing after reads them). */
async function releaseRasters(pool: Pool, placement: RasterPlacement): Promise<void> {
  await Promise.all(placement.sent.map((set, h) => { set.clear(); return pool.runOn(h, { kind: "release" }); }));
}

async function findAllTies(frames: GeorefFrame[], reads: Map<string, PhotoRead>, hooks: BuildHooks, label: string, t0: number, opts: SoilTieOptions, pool: Pool | null = null, placement: RasterPlacement | null = null): Promise<{ ties: SoilTie[]; pairs: number; pairsWithTies: number; rejected: Record<string, number> }> {
  const ties: SoilTie[] = [];
  const pairs = candidatePairs(frames);
  const rejected: Record<string, number> = {};
  let withTies = 0;
  if (pool && pool.size > 1 && placement) {
    // Pairs grouped by their first photograph; each group runs whole on one helper (its windows are sampled once),
    // with the rasters it needs sent there once. Groups are dealt to helpers in contiguous runs of equal pair count
    // (the photographs are in flight order, so a helper's partners mostly repeat). The split is made again each round;
    // a raster a helper already holds is not sent again.
    const groups = new Map<string, string[]>();
    for (const [a, b] of pairs) (groups.get(a.name) ?? groups.set(a.name, []).get(a.name)!).push(b.name);
    const names = [...groups.keys()];
    const frameOf = new Map(frames.map(f => [f.name, f]));
    const helperOf = partitionByWork(names.map(a => groups.get(a)!.length), pool.size);
    const jobs: Promise<void>[] = [];
    let done = 0;
    names.forEach((a, i) => {
      const h = helperOf[i];
      const partners = groups.get(a)!;
      const need = [a, ...partners].filter(n => !placement.sent[h].has(n));
      const sendRasters = need.map(n => { placement.sent[h].add(n); const r = reads.get(n)!.grey; const grey = r.grey instanceof Uint8Array ? r.grey : Uint8Array.from(r.grey, v => Math.round(v)); return pool.runOn(h, { kind: "raster", name: n, width: r.width, height: r.height, grey: new Uint8Array(grey), green: new Uint8Array(r.green), toOriginal: r.toOriginal }); });
      const task = Promise.all(sendRasters).then(() => pool.runOn(h, { kind: "ties", a, frames: [a, ...partners].map(n => [n, frameOf.get(n)!] as [string, GeorefFrame]), partners, opts })).then(r => {
        if (r.kind !== "ties") return;
        ties.push(...r.ties); withTies += r.pairsWithTies; placement.ms[h] += r.ms;
        for (const [k, v] of Object.entries(r.rejected)) rejected[k] = (rejected[k] ?? 0) + v;
        done++;
        hooks.onProgress?.({ stage: "cameras", done, total: names.length, message: `${label}: ${ties.length} ties in ${withTies} pairs`, elapsedMs: Date.now() - t0 });
      });
      jobs.push(task);
    });
    await Promise.all(jobs);
    checkCancelled(hooks.signal);
    // The order of ties affects nothing downstream but the fit's arithmetic; keep it deterministic by pair order.
    const order = new Map(pairs.map(([a, b], i) => [`${a.name}|${b.name}`, i]));
    ties.sort((x, y) => (order.get(`${x.a}|${x.b}`) ?? 0) - (order.get(`${y.a}|${y.b}`) ?? 0));
    return { ties, pairs: pairs.length, pairsWithTies: withTies, rejected: byKey(rejected) };
  }
  // Pairs come grouped by their first photograph: its windows are sampled once and kept until it changes.
  let memo: WindowCache | null = null;
  const fineRes = opts.fineRes ?? SOIL_TIE_DEFAULTS.fineRes, fineN = opts.fineN ?? SOIL_TIE_DEFAULTS.fineN;
  for (const [k, [a, b]] of pairs.entries()) {
    checkCancelled(hooks.signal);
    const ra = reads.get(a.name), rb = reads.get(b.name);
    if (!ra || !rb) continue;
    if (!memo || memo.photo !== a.name) memo = windowCacheFor(a.name, fineRes, fineN);
    const r = findSoilTies(a, ra.grey, b, rb.grey, opts, memo);
    ties.push(...r.ties);
    for (const [kk, v] of Object.entries(r.rejected)) rejected[kk] = (rejected[kk] ?? 0) + v;
    if (r.ties.length) withTies++;
    if (k % 25 === 0) { hooks.onProgress?.({ stage: "cameras", done: k, total: pairs.length, message: `${label}: ${ties.length} ties in ${withTies} pairs`, elapsedMs: Date.now() - t0 }); await yieldToEvents(); }
  }
  return { ties, pairs: pairs.length, pairsWithTies: withTies, rejected: byKey(rejected) };
}

/** A deterministic share of photo PAIRS held out of every fit (all ties of a pair go the same way). */
export function isHeldOutPair(a: string, b: string, share: number): boolean {
  if (share <= 0) return false;
  let h = 2166136261;
  for (const ch of `${a}|${b}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) < share * 1000;
}

/** Lets a worker post its progress (and hear a cancel) between long synchronous stretches. */
export const yieldToEvents = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * The adjusted cameras. With too few ties (a flight with little overlap, or no bare soil) the header-only cameras
 * are kept and the report says so; nothing is invented.
 */
export async function alignCameras(reads: PhotoRead[], hooks: BuildHooks = {}, minTies = 40, holdOutShare = 0, pool: Pool | null = null): Promise<CameraResult> {
  const t0 = Date.now();
  const { bases } = baseFrames(reads);
  const byName = new Map(reads.map(r => [r.name, r]));
  const baseBy = new Map(bases.map(b => [b.frame.name, b]));
  const headerOnly = emptyModel({ name: "header only", globals: [] }, bases);
  // The fine tie window follows the raster: 4 cm samples on a quarter decode (the design point), the preview's
  // own 5.6 cm on a preview. Sampling finer than the raster finds nothing new and only smooths the texture gate.
  const pixelsM = bases.map(b => { const r = byName.get(b.frame.name)!; return (groundSampleAt(b.frame, b.frame.intrinsics.cx, b.frame.intrinsics.cy) ?? 0.01) * r.down; }).sort((a, b) => a - b);
  const rasterPixelM = pixelsM.length ? pixelsM[pixelsM.length >> 1] : 0.04;
  const fineRes = Math.max(0.04, rasterPixelM);
  const tieOpts: SoilTieOptions = { fineRes, maxBackM: 0.5 * fineRes };
  const heldOut = (t: SoilTie) => isHeldOutPair(t.a, t.b, holdOutShare);
  const placement: RasterPlacement | null = pool && pool.size > 1 ? { sent: Array.from({ length: pool.size }, () => new Set<string>()), ms: Array.from({ length: pool.size }, () => 0) } : null;
  const result = (model: AdjustModel, ties: SoilTie[], headerTies: number, pairs: number, pairsWithTies: number, rejected: Record<string, number>, note: string | null): CameraResult => {
    const train = ties.filter(t => !heldOut(t)), test = ties.filter(heldOut);
    return {
      model, bases, frames: new Map(bases.map(b => [b.frame.name, frameUnder(b, model)])),
      report: {
        photographs: bases.length, headerTies, ties: train.length, pairs, pairsWithTies,
        headerResidualM: train.length ? evaluateTies(baseBy, headerOnly, train).median : NaN, residualM: train.length ? evaluateTies(baseBy, model, train).median : NaN,
        heldOutResidualM: test.length ? evaluateTies(baseBy, model, test).median : null, heldOutTies: test.length,
        fineResM: fineRes, rasterPixelM, rejected, globals: model.globals, model: model.spec.name, note,
        ...(placement ? { tieMsPerHelper: placement.ms.map(Math.round) } : {}),
      },
    };
  };
  if (bases.length < 2) return result(headerOnly, [], 0, 0, 0, {}, "fewer than two photographs with a camera: header-only placement");
  hooks.log?.(`soil ties under the header-only cameras (${(fineRes * 100).toFixed(1)} cm samples)`);
  // The helpers' rasters are dropped as soon as the last tie round is over (or the build stops), not at the end of the
  // build: they are 0.6-0.7 GB on a 123-photograph flight, and the corn reads come next.
  const release = async () => { if (pool && placement) await releaseRasters(pool, placement); };
  let first: Awaited<ReturnType<typeof findAllTies>>;
  try { first = await findAllTies(bases.map(b => b.frame), byName, hooks, "ties, header cameras", t0, tieOpts, pool, placement); }
  catch (e) { void release().catch(() => undefined); throw e; } // not awaited: a helper that failed may never answer
  hooks.log?.(`${first.ties.length} ties in ${first.pairsWithTies} of ${first.pairs} pairs`);
  const trainOf = (ties: SoilTie[]) => ties.filter(t => !heldOut(t));
  if (trainOf(first.ties).length < minTies) { await release(); return result(headerOnly, first.ties, first.ties.length, first.pairs, first.pairsWithTies, first.rejected, `only ${first.ties.length} soil ties (${minTies} needed): header-only placement, photographs may disagree by a metre or more`); }
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "cameras", done: 0, total: null, message: "fitting the four flight-wide numbers", elapsedMs: Date.now() - t0 });
  await yieldToEvents();
  const g4 = adjust(bases, trainOf(first.ties), GLOBAL_SPEC, { iterations: 15 });
  hooks.log?.(`first fit: tilt across ${g4.model.globals.tiltAcrossDeg.toFixed(2)}, along ${g4.model.globals.tiltAlongDeg.toFixed(2)}, spin ${g4.model.globals.spinDeg.toFixed(2)} deg, ground ${g4.model.globals.groundOffsetM.toFixed(2)} m; ties agree to ${g4.train.median.toFixed(2)} m`);
  let second: Awaited<ReturnType<typeof findAllTies>>;
  try { second = await findAllTies(bases.map(b => frameUnder(b, g4.model)), byName, hooks, "ties, first fit", t0, tieOpts, pool, placement); }
  catch (e) { void release().catch(() => undefined); throw e; }
  await release();
  hooks.log?.(`${second.ties.length} ties in ${second.pairsWithTies} of ${second.pairs} pairs under the first fit`);
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "cameras", done: 0, total: null, message: "fitting the per-photo attitude", elapsedMs: Date.now() - t0 });
  await yieldToEvents();
  const ties = second.ties.length >= first.ties.length ? second.ties : first.ties;
  const rejected = second.ties.length >= first.ties.length ? second.rejected : first.rejected;
  const g4b = adjust(bases, trainOf(ties), GLOBAL_SPEC, { iterations: 15, start: g4.model });
  const ref = adjust(bases, trainOf(ties), REFERENCE_SPEC, { iterations: 15, start: g4b.model });
  hooks.log?.(`reference model: ties agree to ${ref.train.median.toFixed(3)} m`);
  return result(ref.model, ties, first.ties.length, second.pairs, second.pairsWithTies, rejected, null);
}
