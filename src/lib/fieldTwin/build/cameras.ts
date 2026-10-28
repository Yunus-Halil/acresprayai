// Stage 2: the cameras, from each photograph's header, adjusted to the soil-texture ties between overlapping
// photographs. The port of experiment 1's reference chain (scripts/directGeoref/exp1Align.ts): ties under the
// header-only cameras, a fit of the four flight-wide numbers (camera tilts, spin, ground height), ties again
// under that fit (more windows succeed once the photographs nearly agree), then the reference model: the four
// numbers plus a small per-photo attitude correction (1 degree prior, positions held at 3 cm).
import { type AdjustModel, type BaseFrame, type GeorefFrame, type ModelSpec, type SoilTie, adjust, emptyModel, evaluateTies, findSoilTies, frameFromDji, frameUnder, takeoffPlane } from "../../directGeoref";
import { toEnu } from "../../sourceFrames/odm";
import type { PhotoRead } from "./photos";
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
    /** Median tie disagreement, metres, under the header-only cameras and under the final model. */
    headerResidualM: number;
    residualM: number;
    globals: AdjustModel["globals"];
    model: string;
    note: string | null;
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

async function findAllTies(frames: GeorefFrame[], reads: Map<string, PhotoRead>, hooks: BuildHooks, label: string, t0: number): Promise<{ ties: SoilTie[]; pairs: number; pairsWithTies: number }> {
  const ties: SoilTie[] = [];
  const pairs = candidatePairs(frames);
  let withTies = 0;
  for (const [k, [a, b]] of pairs.entries()) {
    checkCancelled(hooks.signal);
    const ra = reads.get(a.name), rb = reads.get(b.name);
    if (!ra || !rb) continue;
    const r = findSoilTies(a, ra.grey, b, rb.grey);
    ties.push(...r.ties);
    if (r.ties.length) withTies++;
    if (k % 25 === 0) { hooks.onProgress?.({ stage: "cameras", done: k, total: pairs.length, message: `${label}: ${ties.length} ties in ${withTies} pairs`, elapsedMs: Date.now() - t0 }); await yieldToEvents(); }
  }
  return { ties, pairs: pairs.length, pairsWithTies: withTies };
}

/** Lets a worker post its progress (and hear a cancel) between long synchronous stretches. */
export const yieldToEvents = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * The adjusted cameras. With too few ties (a flight with little overlap, or no bare soil) the header-only cameras
 * are kept and the report says so; nothing is invented.
 */
export async function alignCameras(reads: PhotoRead[], hooks: BuildHooks = {}, minTies = 40): Promise<CameraResult> {
  const t0 = Date.now();
  const { bases } = baseFrames(reads);
  const byName = new Map(reads.map(r => [r.name, r]));
  const baseBy = new Map(bases.map(b => [b.frame.name, b]));
  const headerOnly = emptyModel({ name: "header only", globals: [] }, bases);
  const result = (model: AdjustModel, ties: SoilTie[], headerTies: number, pairs: number, pairsWithTies: number, note: string | null): CameraResult => ({
    model, bases, frames: new Map(bases.map(b => [b.frame.name, frameUnder(b, model)])),
    report: { photographs: bases.length, headerTies, ties: ties.length, pairs, pairsWithTies, headerResidualM: ties.length ? evaluateTies(baseBy, headerOnly, ties).median : NaN, residualM: ties.length ? evaluateTies(baseBy, model, ties).median : NaN, globals: model.globals, model: model.spec.name, note },
  });
  if (bases.length < 2) return result(headerOnly, [], 0, 0, 0, "fewer than two photographs with a camera: header-only placement");
  hooks.log?.("soil ties under the header-only cameras");
  const first = await findAllTies(bases.map(b => b.frame), byName, hooks, "ties, header cameras", t0);
  hooks.log?.(`${first.ties.length} ties in ${first.pairsWithTies} of ${first.pairs} pairs`);
  if (first.ties.length < minTies) return result(headerOnly, first.ties, first.ties.length, first.pairs, first.pairsWithTies, `only ${first.ties.length} soil ties (${minTies} needed): header-only placement, photographs may disagree by a metre or more`);
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "cameras", done: 0, total: null, message: "fitting the four flight-wide numbers", elapsedMs: Date.now() - t0 });
  await yieldToEvents();
  const g4 = adjust(bases, first.ties, GLOBAL_SPEC, { iterations: 15 });
  hooks.log?.(`first fit: tilt across ${g4.model.globals.tiltAcrossDeg.toFixed(2)}, along ${g4.model.globals.tiltAlongDeg.toFixed(2)}, spin ${g4.model.globals.spinDeg.toFixed(2)} deg, ground ${g4.model.globals.groundOffsetM.toFixed(2)} m; ties agree to ${g4.train.median.toFixed(2)} m`);
  const second = await findAllTies(bases.map(b => frameUnder(b, g4.model)), byName, hooks, "ties, first fit", t0);
  hooks.log?.(`${second.ties.length} ties in ${second.pairsWithTies} of ${second.pairs} pairs under the first fit`);
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "cameras", done: 0, total: null, message: "fitting the per-photo attitude", elapsedMs: Date.now() - t0 });
  await yieldToEvents();
  const ties = second.ties.length >= first.ties.length ? second.ties : first.ties;
  const g4b = adjust(bases, ties, GLOBAL_SPEC, { iterations: 15, start: g4.model });
  const ref = adjust(bases, ties, REFERENCE_SPEC, { iterations: 15, start: g4b.model });
  hooks.log?.(`reference model: ties agree to ${ref.train.median.toFixed(3)} m`);
  return result(ref.model, ties, first.ties.length, second.pairs, second.pairsWithTies, null);
}
