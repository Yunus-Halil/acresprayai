// Shared loading for the direct-georeferencing experiments: the per-photo cache run.ts wrote, header-only cameras,
// quarter-size rasters, overlapping pairs, soil ties, and the train / held-out split of pairs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeImage } from "../bench/images";
import {
  type BaseFrame, type DjiPhotoMeta, type GeorefFrame, type GreyRaster, type PixelObject, type SoilTie,
  findSoilTies, frameFromDji, greyRaster, parseDjiHeader, takeoffPlane,
} from "../../src/lib/directGeoref";
import { toEnu } from "../../src/lib/sourceFrames/odm";

export const ROOT = resolve(__dirname, "../..");
export const OUT = resolve(ROOT, "data/direct-georef/apricot");

export type Cached = { name: string; meta: DjiPhotoMeta; viewW: number; viewH: number; objects: PixelObject[] };

export const PHOTOS = resolve(ROOT, "directtestimagery");

/** The per-photo cache, with each header read again from the photograph (fields added since the cache was written). */
export function loadCache(): Cached[] {
  const dir = join(OUT, "cache");
  if (!existsSync(dir)) throw new Error(`no cache at ${dir}: run scripts/directGeoref/run.ts first`);
  return readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8")) as Cached;
    const src = join(PHOTOS, `${c.name}.JPG`);
    if (existsSync(src)) {
      const fd = readFileSync(src).subarray(0, 1 << 20);
      c.meta = { ...parseDjiHeader(new Uint8Array(fd)), width: c.meta.width, height: c.meta.height };
    }
    return c;
  });
}

export function isTurn(f: GeorefFrame): boolean {
  const a = f.pose.attitude;
  return Math.abs(a.rollDeg) > 0.5 || Math.abs(a.pitchDeg + 90) > 1;
}

/** Header-only cameras on the take-off plane, with the aircraft velocity (east, north). */
export function baseFrames(cached: Cached[]): BaseFrame[] {
  const out: BaseFrame[] = [];
  for (const c of cached) {
    const r = frameFromDji(c.name, c.meta, { ground: takeoffPlane(0) });
    if ("reason" in r) continue;
    out.push({ frame: r.frame, velocity: [c.meta.speedEastMs ?? 0, c.meta.speedNorthMs ?? 0] });
  }
  return out;
}

export function loadRasters(cached: Cached[]): Map<string, GreyRaster> {
  const out = new Map<string, GreyRaster>();
  for (const c of cached) {
    const img = decodeImage(new Uint8Array(readFileSync(join(OUT, "frames", `${c.name}.jpg`))));
    const meta = c.meta;
    out.set(c.name, greyRaster({ width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) }, (meta.width ?? img.width * 4) / img.width));
  }
  return out;
}

export function headingDiff(a: GeorefFrame, b: GeorefFrame): number {
  let d = Math.abs(a.pose.attitude.yawDeg - b.pose.attitude.yawDeg) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export type PairKind = "same" | "opposite" | "turn";
export function pairKind(a: GeorefFrame, b: GeorefFrame): PairKind {
  if (isTurn(a) || isTurn(b)) return "turn";
  return headingDiff(a, b) < 30 ? "same" : headingDiff(a, b) > 150 ? "opposite" : "turn";
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

export function findAllTies(frames: GeorefFrame[], rasters: Map<string, GreyRaster>, maxM = 45, log = true): { ties: SoilTie[]; rejected: Record<string, number>; pairs: number; pairsWithTies: number } {
  const ties: SoilTie[] = [];
  const rejected: Record<string, number> = {};
  const pairs = candidatePairs(frames, maxM);
  let withTies = 0;
  const t0 = Date.now();
  pairs.forEach(([a, b], k) => {
    const r = findSoilTies(a, rasters.get(a.name)!, b, rasters.get(b.name)!);
    ties.push(...r.ties);
    if (r.ties.length) withTies++;
    for (const [kk, v] of Object.entries(r.rejected)) rejected[kk] = (rejected[kk] ?? 0) + v;
    if (log && (k + 1) % 100 === 0) console.log(`  ties: ${k + 1}/${pairs.length} pairs, ${ties.length} ties (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  });
  return { ties, rejected, pairs: pairs.length, pairsWithTies: withTies };
}

/** Deterministic 70 / 30 split of photo PAIRS (all ties of a pair go the same way). */
export function isHeldOut(t: { a: string; b: string }): boolean {
  let h = 2166136261;
  for (const ch of `${t.a}|${t.b}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10) < 3;
}

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const quant = (v: number[], q: number) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : NaN; };

// ------------------------------------------------------------------------------------------------------------------
// Reference cameras (experiment 1's best adjustment) and quarter-size photographs, for the milestone scripts.
// ------------------------------------------------------------------------------------------------------------------
import type { AdjustModel, ModelSpec, PhotoKey } from "../../src/lib/directGeoref";
import { frameUnder } from "../../src/lib/directGeoref";

export const REFERENCE_MODEL = "global + per-photo attitude 1 deg";

export function loadReference(): { model: AdjustModel; frames: Map<string, GeorefFrame>; bases: BaseFrame[]; cached: Cached[] } {
  type Saved = { name: string; spec: ModelSpec; origin: AdjustModel["origin"]; globals: AdjustModel["globals"]; photo: [string, Record<PhotoKey, number>][] };
  const saved = (JSON.parse(readFileSync(join(OUT, "exp1", "models.json"), "utf8")) as Saved[]).find(m => m.name === REFERENCE_MODEL);
  if (!saved) throw new Error(`no "${REFERENCE_MODEL}" in exp1/models.json: run exp1Align.ts first`);
  const model: AdjustModel = { spec: saved.spec, origin: saved.origin, globals: saved.globals, photo: new Map(saved.photo), terrain: null };
  const cached = loadCache();
  const bases = baseFrames(cached);
  return { model, frames: new Map(bases.map(b => [b.frame.name, frameUnder(b, model)])), bases, cached };
}

/** An original photograph decoded and box-averaged by `down` (4: 1368 x 912 for the Phantom 4 RTK). */
export function quarterPixels(name: string, down = 4): { width: number; height: number; rgba: Uint8ClampedArray } {
  const img = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, `${name}.JPG`))));
  const W = Math.floor(img.width / down), H = Math.floor(img.height / down), rgba = new Uint8ClampedArray(W * H * 4), kk = down * down;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < down; dy++) { let o = ((y * down + dy) * img.width + x * down) * 4; for (let dx = 0; dx < down; dx++, o += 4) { r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; } }
    const p = (y * W + x) * 4;
    rgba[p] = r / kk; rgba[p + 1] = g / kk; rgba[p + 2] = b / kk; rgba[p + 3] = 255;
  }
  return { width: W, height: H, rgba };
}
