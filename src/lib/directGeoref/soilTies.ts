// Soil-texture ties: the same patch of bare soil found in two overlapping photographs.
//
// Bare soil is the ideal tie: it lies on the ground (no relief, unlike crowns), and its grain is unique at the
// centimetre scale. Both photographs are resampled onto the same ground grid with the current camera models, and
// phase correlation measures how far one sits from the other. The result is stored as a PIXEL correspondence
// (pixel in A <-> pixel in B), which no later camera model changes; a better model only finds more of them.
//
// Two levels: a coarse correlation of the whole overlap (16 cm cells, a 20 m window: metre-scale disagreements, as
// with a non-RTK GPS), then fine soil-only windows (4 cm cells, 2.6 m) seeded with the coarse shift. A fine window is
// kept only when it is soil (green under 5 % in both), textured, not a pattern of parallel lines (tyre tracks match
// anywhere along their length), has a clear single peak, and correlates back to itself after the shift.
import { toEnu, type LatLngAlt } from "../sourceFrames/odm";
import type { PhotoPixels } from "../photoScout/pattern";
import { vegetationMask } from "../weedVision/fieldRows";
import { type Spectrum, correlate, spectrum } from "./fft";
import { applyHomography, homographyFrom4, type H3, type P2 } from "./homography";
import { type GeorefFrame, frameCorners, frameFootprint } from "./projection";

export type GreyRaster = { width: number; height: number; /** Luma per pixel, floats or bytes (the ties read it by index either way; bytes hold seventy photographs in a browser). */ grey: Float32Array | Uint8Array; green: Uint8Array; /** Original pixels per raster pixel. */ toOriginal: number };

export function greyRaster(px: PhotoPixels, toOriginal: number): GreyRaster {
  const n = px.width * px.height, grey = new Float32Array(n);
  for (let i = 0; i < n; i++) grey[i] = 0.299 * px.rgba[i * 4] + 0.587 * px.rgba[i * 4 + 1] + 0.114 * px.rgba[i * 4 + 2];
  return { width: px.width, height: px.height, grey, green: vegetationMask(px), toOriginal };
}

export type SoilTie = {
  a: string;
  b: string;
  /** Original-frame pixels. */
  ua: number; va: number; ub: number; vb: number;
  /** Where on the ground (approximately), for maps and terrain locality. */
  lat: number; lng: number;
  peak: number;
};

export type SoilTieOptions = {
  fineRes?: number; fineN?: number; coarseRes?: number; coarseN?: number;
  /** Spacing of fine window centres, metres. */
  stepM?: number;
  maxPerPair?: number;
  maxGreenShare?: number;
  minTextureStd?: number;
  /** Largest eigenvalue ratio of the gradient structure tensor (parallel lines have a large one). */
  maxAnisotropy?: number;
  minPeak?: number;
  maxSecondRatio?: number;
  /** Largest residual when the window is correlated again at the found shift, metres. */
  maxBackM?: number;
};
export const SOIL_TIE_DEFAULTS: Required<SoilTieOptions> = {
  fineRes: 0.04, fineN: 64, coarseRes: 0.16, coarseN: 128, stepM: 2, maxPerPair: 60,
  maxGreenShare: 0.05, minTextureStd: 3, maxAnisotropy: 8, minPeak: 0.12, maxSecondRatio: 0.6, maxBackM: 0.02,
};

type Mapper = { H: H3; r: GreyRaster };

/** Ground (east, north metres about `origin`) to raster pixels, for this frame's current model (exact on a plane). */
function mapperOf(f: GeorefFrame, r: GreyRaster, origin: LatLngAlt): Mapper | null {
  const c = frameCorners(f);
  if (!c) return null;
  const s = 1 / r.toOriginal, { width: w, height: h } = f.intrinsics;
  const H = homographyFrom4(c.map(k => { const e = toEnu({ lat: k.lat, lng: k.lng, altM: 0 }, origin); return [e[0], e[1]] as P2; }), [[0, 0], [w * s, 0], [w * s, h * s], [0, h * s]]);
  return H ? { H, r } : null;
}

type Window = { grey: Float64Array; green: number; outside: number };

function sampleWindow(m: Mapper, cx: number, cy: number, res: number, n: number): Window {
  const { r, H } = m, grey = new Float64Array(n * n);
  let green = 0, outside = 0, sum = 0, valid = 0;
  const bad: number[] = [];
  const h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7], h8 = H[8];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // The homography inlined (the same expression as applyHomography), no tuple per sample.
    const gx = cx + (i - n / 2 + 0.5) * res, gy = cy - (j - n / 2 + 0.5) * res;
    const w = h6 * gx + h7 * gy + h8;
    const u = (h0 * gx + h1 * gy + h2) / w, v = (h3 * gx + h4 * gy + h5) / w;
    const x = u - 0.5, y = v - 0.5;
    if (x < 0 || y < 0 || x >= r.width - 1 || y >= r.height - 1) { outside++; bad.push(j * n + i); continue; }
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = y0 * r.width + x0;
    const g = r.grey[o] * (1 - fx) * (1 - fy) + r.grey[o + 1] * fx * (1 - fy) + r.grey[o + r.width] * (1 - fx) * fy + r.grey[o + r.width + 1] * fx * fy;
    grey[j * n + i] = g; sum += g; valid++;
    if (r.green[Math.round(y) * r.width + Math.round(x)]) green++;
  }
  const mean = valid ? sum / valid : 0;
  for (const k of bad) grey[k] = mean;
  return { grey, green: valid ? green / valid : 1, outside: outside / (n * n) };
}

function texture(g: Float64Array, n: number): { std: number; anisotropy: number } {
  let s = 0, s2 = 0, xx = 0, yy = 0, xy = 0;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = j * n + i, v = g[k];
    s += v; s2 += v * v;
    const gx = g[k + 1] - g[k - 1], gy = g[k + n] - g[k - n];
    xx += gx * gx; yy += gy * gy; xy += gx * gy;
  }
  const m = (n - 2) * (n - 2), mean = s / m;
  const tr = xx + yy, root = Math.sqrt(Math.max(0, (tr * tr) / 4 - (xx * yy - xy * xy)));
  const l1 = tr / 2 + root, l2 = Math.max(1e-9, tr / 2 - root);
  return { std: Math.sqrt(Math.max(0, s2 / m - mean * mean)), anisotropy: l1 / l2 };
}

export type PairTies = { ties: SoilTie[]; coarseShiftM: [number, number] | null; windowsTried: number; rejected: Record<string, number> };

/** Inside a ring (east/north metres, the same frame as the point) and at least `marginM` from its border. */
function inRingM(e: number, n: number, q: P2[], marginM: number): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const xi = q[i][0] - e, yi = q[i][1] - n, xj = q[j][0] - e, yj = q[j][1] - n;
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (!inside) return false;
  if (marginM <= 0) return true;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const ax = q[j][0] - e, ay = q[j][1] - n, bx = q[i][0] - e, by = q[i][1] - n;
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / L2)) : 0;
    if (Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)) < marginM) return false;
  }
  return true;
}

/** What a window of photograph A gave: its verdict, and when it passed, its pixels and spectrum. */
type WindowMemo = { reason: string | null; A: Window | null; spec: Spectrum | null };

/**
 * A's windows, kept while the photograph is the first of its pairs: the window lattice is anchored to A's own
 * footprint, so the same lattice index is the same ground in every pair A begins (to about a nanometre; the
 * homography is built per pair, so the pixels agree to 1e-10 px, not to the bit). The caller clears it when A
 * changes. At most a few hundred windows of 32 KB plus their spectra.
 */
export type WindowCache = { photo: string; fineRes: number; fineN: number; windows: Map<number, WindowMemo> };
export const windowCacheFor = (photo: string, fineRes: number, fineN: number): WindowCache => ({ photo, fineRes, fineN, windows: new Map() });

/** Soil ties between two overlapping photographs under their current camera models. */
export function findSoilTies(fa: GeorefFrame, ra: GreyRaster, fb: GeorefFrame, rb: GreyRaster, opts: SoilTieOptions = {}, cache: WindowCache | null = null): PairTies {
  const o = { ...SOIL_TIE_DEFAULTS, ...opts };
  const origin: LatLngAlt = { lat: (fa.pose.lat + fb.pose.lat) / 2, lng: (fa.pose.lng + fb.pose.lng) / 2, altM: 0 };
  const rejected: Record<string, number> = {};
  const reject = (k: string) => { rejected[k] = (rejected[k] ?? 0) + 1; };
  const empty: PairTies = { ties: [], coarseShiftM: null, windowsTried: 0, rejected };
  const ma = mapperOf(fa, ra, origin), mb = mapperOf(fb, rb, origin);
  const footA = frameFootprint(fa, 4), footB = frameFootprint(fb, 4);
  if (!ma || !mb || !footA || !footB) return empty;
  const ringA = footA.map(g => ({ lat: g.lat, lng: g.lng })), ringB = footB.map(g => ({ lat: g.lat, lng: g.lng }));
  const enOf = (g: { lat: number; lng: number }) => { const e = toEnu({ ...g, altM: 0 }, origin); return [e[0], e[1]] as P2; };
  const llOf = (e: number, nn: number) => {
    const R = 6378137, lat0 = (origin.lat * Math.PI) / 180;
    return { lat: origin.lat + (nn / R) * (180 / Math.PI), lng: origin.lng + (e / (R * Math.cos(lat0))) * (180 / Math.PI) };
  };
  // Candidate centres: a grid over A's footprint, inside both. Both rings are projected once about the pair's
  // origin and every grid point is tested in that frame (the rings used to be re-projected about each point).
  const pa = ringA.map(enOf), pb = ringB.map(enOf);
  const xs = pa.map(p => p[0]), ys = pa.map(p => p[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const inBoth = (e: number, nn: number, margin: number) => inRingM(e, nn, pa, margin) && inRingM(e, nn, pb, margin);
  const overlap: P2[] = [];
  for (let e = xMin; e <= xMax; e += 1) for (let nn = yMin; nn <= yMax; nn += 1) if (inBoth(e, nn, 0)) overlap.push([e, nn]);
  if (overlap.length < 25) return empty;
  const memo = cache && cache.photo === fa.name && cache.fineRes === o.fineRes && cache.fineN === o.fineN ? cache.windows : null;

  // Coarse: the whole overlap at 16 cm.
  const cx = overlap.reduce((s, p) => s + p[0], 0) / overlap.length, cy = overlap.reduce((s, p) => s + p[1], 0) / overlap.length;
  let s0: [number, number] = [0, 0], coarse: [number, number] | null = null;
  {
    const A = sampleWindow(ma, cx, cy, o.coarseRes, o.coarseN), B = sampleWindow(mb, cx, cy, o.coarseRes, o.coarseN);
    if (A.outside < 0.6 && B.outside < 0.6) {
      const ps = correlate(spectrum(A.grey, o.coarseN), spectrum(B.grey, o.coarseN));
      if (ps.peak >= 0.04 && ps.secondRatio <= 0.8) { s0 = [ps.dx * o.coarseRes, -ps.dy * o.coarseRes]; coarse = s0; }
      else reject("coarse unclear");
    }
  }

  // Fine: soil windows on a grid, seeded by the coarse shift.
  const half = (o.fineN * o.fineRes) / 2;
  const centres: [number, number, number][] = [];
  let ie = 0;
  for (let e = xMin; e <= xMax; e += o.stepM, ie++) { let inn = 0; for (let nn = yMin; nn <= yMax; nn += o.stepM, inn++) {
    if (inBoth(e, nn, half * 1.45) && inBoth(e + s0[0], nn + s0[1], half * 1.45)) centres.push([e, nn, ie * 65536 + inn]);
  } }
  const ties: SoilTie[] = [];
  let tried = 0;
  for (const [e, nn, key] of centres) {
    if (ties.length >= o.maxPerPair) break;
    tried++;
    // Window A: from the memo when this photograph's lattice point was sampled in an earlier pair.
    let m = memo?.get(key);
    if (!m) {
      const A = sampleWindow(ma, e, nn, o.fineRes, o.fineN);
      if (A.outside > 0 || A.green > o.maxGreenShare) m = { reason: "green or outside", A: null, spec: null };
      else {
        const t = texture(A.grey, o.fineN);
        m = t.std < o.minTextureStd ? { reason: "no texture", A: null, spec: null } : t.anisotropy > o.maxAnisotropy ? { reason: "parallel lines", A: null, spec: null } : { reason: null, A, spec: spectrum(A.grey, o.fineN) };
      }
      memo?.set(key, m);
    }
    if (m.reason) { reject(m.reason); continue; }
    const specA = m.spec!;
    const B = sampleWindow(mb, e + s0[0], nn + s0[1], o.fineRes, o.fineN);
    if (B.outside > 0 || B.green > o.maxGreenShare) { reject("green or outside"); continue; }
    const ps = correlate(specA, spectrum(B.grey, o.fineN));
    if (ps.peak < o.minPeak || ps.secondRatio > o.maxSecondRatio) { reject("unclear peak"); continue; }
    const d: P2 = [s0[0] + ps.dx * o.fineRes, s0[1] - ps.dy * o.fineRes];
    const B2 = sampleWindow(mb, e + d[0], nn + d[1], o.fineRes, o.fineN);
    if (B2.outside > 0) { reject("green or outside"); continue; }
    const back = correlate(specA, spectrum(B2.grey, o.fineN));
    if (Math.hypot(back.dx, back.dy) * o.fineRes > o.maxBackM) { reject("not consistent"); continue; }
    const da: P2 = [d[0] + back.dx * o.fineRes, d[1] - back.dy * o.fineRes];
    const pa2 = applyHomography(ma.H, e, nn), pb2 = applyHomography(mb.H, e + da[0], nn + da[1]);
    const ll = llOf(e, nn);
    ties.push({ a: fa.name, b: fb.name, ua: pa2[0] * ra.toOriginal, va: pa2[1] * ra.toOriginal, ub: pb2[0] * rb.toOriginal, vb: pb2[1] * rb.toOriginal, lat: ll.lat, lng: ll.lng, peak: ps.peak });
  }
  return { ties, coarseShiftM: coarse, windowsTried: tried, rejected };
}
