// Direct photo georeferencing, part 7: a light block adjustment over pixel ties.
//
// Each tie says "pixel (ua, va) of photo A and pixel (ub, vb) of photo B see the same spot of bare soil". Under a
// camera model both pixels project to the ground; the distance between the two ground points is the tie's residual.
// The adjustment changes a chosen set of parameters to shrink the residuals (Levenberg-Marquardt, numerical sparse
// Jacobian, Huber weights so a wrong tie cannot pull hard), with priors:
//
//   globals    one value for the whole flight: camera tilt across / along the image, spin, ground height, and the
//              shutter timing offset (the camera moves velocity x dt along its track). Weak priors.
//   terrain    an optional ground surface: heights on a grid, bilinear, held smooth by a prior on second differences
//              (replaces the global ground height)
//   per photo  optional corrections to each photograph's east / north / height / yaw / camera tilt, each held toward the header
//              value by a prior of a stated size. The prior is what stops drift: a correction is only made where the
//              ties outweigh it, and the photographs' own positions anchor the block to the map.
//
// Nothing here assumes RTK; the per-photo prior states what the positions are worth (2 cm for RTK, metres for a
// consumer GPS). A common offset of every photograph cannot be seen by ties at all; only the positions fix it.
import { toEnu, type LatLngAlt } from "../sourceFrames/odm";
import { boresightOf, NO_CALIBRATION } from "./calibrate";
import { type GeorefFrame, pixelToGround } from "./projection";
import type { SoilTie } from "./soilTies";

export type GlobalKey = "tiltAcrossDeg" | "tiltAlongDeg" | "spinDeg" | "groundOffsetM" | "timingS";
/** Per-photo corrections: position (metres) and attitude (degrees: yaw, and the camera tilt across / along the image). */
export type PhotoKey = "dE" | "dN" | "dH" | "dYawDeg" | "dTiltAcrossDeg" | "dTiltAlongDeg";

export type ModelSpec = {
  name: string;
  globals: GlobalKey[];
  /** Per-photo corrections and their prior standard deviations (metres, degrees). */
  perPhoto?: { keys: PhotoKey[]; sigma: Partial<Record<PhotoKey, number>> } | null;
  /** Ground heights on a grid of this spacing, held smooth (second differences ~ N(0, smoothSigmaM)). */
  terrain?: { spacingM: number; smoothSigmaM: number } | null;
};

export type BaseFrame = { frame: GeorefFrame; /** Aircraft velocity, east and north, m/s. */ velocity: [number, number] };

export type Terrain = { e0: number; n0: number; nx: number; ny: number; spacing: number; h: Float64Array };

export type AdjustModel = {
  spec: ModelSpec;
  origin: LatLngAlt;
  globals: Record<GlobalKey, number>;
  photo: Map<string, Record<PhotoKey, number>>;
  terrain: Terrain | null;
};

const ZERO_GLOBALS: Record<GlobalKey, number> = { tiltAcrossDeg: 0, tiltAlongDeg: 0, spinDeg: 0, groundOffsetM: 0, timingS: 0 };
const ZERO_PHOTO: Record<PhotoKey, number> = { dE: 0, dN: 0, dH: 0, dYawDeg: 0, dTiltAcrossDeg: 0, dTiltAlongDeg: 0 };
const R_EARTH = 6378137;

export function terrainAt(t: Terrain, e: number, n: number): number {
  const fx = Math.min(t.nx - 1.000001, Math.max(0, (e - t.e0) / t.spacing)), fy = Math.min(t.ny - 1.000001, Math.max(0, (n - t.n0) / t.spacing));
  const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, h = t.h, w = t.nx;
  return h[j * w + i] * (1 - a) * (1 - b) + h[j * w + i + 1] * a * (1 - b) + h[(j + 1) * w + i] * (1 - a) * b + h[(j + 1) * w + i + 1] * a * b;
}

/** The camera of one photograph under the model. */
export function frameUnder(base: BaseFrame, m: AdjustModel): GeorefFrame {
  const f = base.frame, c = m.photo.get(f.name) ?? ZERO_PHOTO, g = m.globals;
  const dE = c.dE + base.velocity[0] * g.timingS, dN = c.dN + base.velocity[1] * g.timingS;
  const lat0 = (f.pose.lat * Math.PI) / 180;
  const pose = {
    ...f.pose,
    lat: f.pose.lat + (dN / R_EARTH) * (180 / Math.PI),
    lng: f.pose.lng + (dE / (R_EARTH * Math.cos(lat0))) * (180 / Math.PI),
    altM: f.pose.altM + c.dH,
    attitude: { ...f.pose.attitude, yawDeg: f.pose.attitude.yawDeg + c.dYawDeg },
    boresight: boresightOf({ ...NO_CALIBRATION, tiltAcrossDeg: g.tiltAcrossDeg + c.dTiltAcrossDeg, tiltAlongDeg: g.tiltAlongDeg + c.dTiltAlongDeg, spinDeg: g.spinDeg }, `adjusted (${m.spec.name})`),
  };
  const base0 = f.ground.kind === "flat" ? f.ground.altM : 0;
  if (m.terrain) {
    const t = m.terrain, o = m.origin;
    return { ...f, pose, ground: { kind: "surface", datum: f.ground.datum, basis: `terrain grid ${t.spacing} m from the overlap (${m.spec.name})`, altAt: (lat, lng) => { const e = toEnu({ lat, lng, altM: 0 }, o); return base0 + terrainAt(t, e[0], e[1]); } } };
  }
  return { ...f, pose, ground: { kind: "flat", datum: f.ground.datum, altM: base0 + g.groundOffsetM, basis: `flat ground ${g.groundOffsetM.toFixed(2)} m from take-off (${m.spec.name})` } };
}

export function emptyModel(spec: ModelSpec, bases: BaseFrame[]): AdjustModel {
  const origin = { lat: bases.reduce((s, b) => s + b.frame.pose.lat, 0) / bases.length, lng: bases.reduce((s, b) => s + b.frame.pose.lng, 0) / bases.length, altM: 0 };
  let terrain: Terrain | null = null;
  if (spec.terrain) {
    const pts = bases.map(b => toEnu({ lat: b.frame.pose.lat, lng: b.frame.pose.lng, altM: 0 }, origin));
    const sp = spec.terrain.spacingM, pad = 40;
    const e0 = Math.min(...pts.map(p => p[0])) - pad, n0 = Math.min(...pts.map(p => p[1])) - pad;
    const nx = Math.ceil((Math.max(...pts.map(p => p[0])) + pad - e0) / sp) + 1, ny = Math.ceil((Math.max(...pts.map(p => p[1])) + pad - n0) / sp) + 1;
    terrain = { e0, n0, nx, ny, spacing: sp, h: new Float64Array(nx * ny) };
  }
  return { spec, origin, globals: { ...ZERO_GLOBALS }, photo: new Map(bases.map(b => [b.frame.name, { ...ZERO_PHOTO }])), terrain };
}

/** Ground disagreement of each tie under the model, metres east and north (B minus A); null where a ray misses. */
function tieResidual(fa: GeorefFrame, fb: GeorefFrame, t: SoilTie, origin: LatLngAlt): [number, number] | null {
  const ga = pixelToGround(fa, t.ua, t.va), gb = pixelToGround(fb, t.ub, t.vb);
  if (!ga || !gb) return null;
  const ea = toEnu({ lat: ga.lat, lng: ga.lng, altM: 0 }, origin), eb = toEnu({ lat: gb.lat, lng: gb.lng, altM: 0 }, origin);
  return [eb[0] - ea[0], eb[1] - ea[1]];
}

export type TieStats = { n: number; median: number; p90: number; rms: number; dist: Float64Array; vec: Float64Array };

export function evaluateTies(bases: Map<string, BaseFrame>, m: AdjustModel, ties: SoilTie[]): TieStats {
  const frames = new Map([...bases].map(([k, b]) => [k, frameUnder(b, m)]));
  const dist = new Float64Array(ties.length).fill(NaN), vec = new Float64Array(ties.length * 2).fill(NaN);
  ties.forEach((t, i) => {
    const fa = frames.get(t.a), fb = frames.get(t.b);
    if (!fa || !fb) return;
    const r = tieResidual(fa, fb, t, m.origin);
    if (!r) return;
    vec[2 * i] = r[0]; vec[2 * i + 1] = r[1]; dist[i] = Math.hypot(r[0], r[1]);
  });
  const d = [...dist].filter(Number.isFinite).sort((a, b) => a - b);
  return { n: d.length, median: d.length ? d[d.length >> 1] : NaN, p90: d.length ? d[Math.floor(0.9 * (d.length - 1))] : NaN, rms: Math.sqrt(d.reduce((s, v) => s + v * v, 0) / Math.max(1, d.length)), dist, vec };
}

// ------------------------------------------------------------------------------------------------------------------
// Parameters
// ------------------------------------------------------------------------------------------------------------------

type Param = { kind: "global"; key: GlobalKey } | { kind: "terrain"; index: number } | { kind: "photo"; name: string; key: PhotoKey };

const STEP: Record<GlobalKey | PhotoKey | "terrain", number> = { tiltAcrossDeg: 0.01, tiltAlongDeg: 0.01, spinDeg: 0.01, groundOffsetM: 0.01, timingS: 0.002, dE: 0.01, dN: 0.01, dH: 0.01, dYawDeg: 0.01, dTiltAcrossDeg: 0.01, dTiltAlongDeg: 0.01, terrain: 0.01 };
const GLOBAL_PRIOR: Record<GlobalKey, number> = { tiltAcrossDeg: 10, tiltAlongDeg: 10, spinDeg: 10, groundOffsetM: 5, timingS: 1 };
export const TERRAIN_ABS_SIGMA_M = 5;

function getP(m: AdjustModel, p: Param): number {
  return p.kind === "global" ? m.globals[p.key] : p.kind === "terrain" ? m.terrain!.h[p.index] : m.photo.get(p.name)![p.key];
}
function setP(m: AdjustModel, p: Param, v: number) {
  if (p.kind === "global") m.globals[p.key] = v; else if (p.kind === "terrain") m.terrain!.h[p.index] = v; else m.photo.get(p.name)![p.key] = v;
}
const stepOf = (p: Param) => (p.kind === "global" ? STEP[p.key] : p.kind === "terrain" ? STEP.terrain : STEP[p.key]);

function cholSolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * n + j];
    for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (s <= 0) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

export type AdjustOptions = { iterations?: number; huberM?: number; start?: AdjustModel; log?: (s: string) => void };

export type AdjustResult = { model: AdjustModel; train: TieStats; iterations: number; cost: number };

/** Fit the model's parameters to the ties. */
export function adjust(basesList: BaseFrame[], ties: SoilTie[], spec: ModelSpec, opts: AdjustOptions = {}): AdjustResult {
  const bases = new Map(basesList.map(b => [b.frame.name, b]));
  const m: AdjustModel = opts.start ? cloneModel(opts.start, spec) : emptyModel(spec, basesList);
  if (spec.terrain && !m.terrain) {
    // Start the surface at the level the starting model had.
    m.terrain = emptyModel(spec, basesList).terrain;
    m.terrain!.h.fill(opts.start?.globals.groundOffsetM ?? 0);
  }
  const huber = opts.huberM ?? 0.1, iters = opts.iterations ?? 12;
  const used = ties.filter(t => bases.has(t.a) && bases.has(t.b));

  const params: Param[] = [];
  for (const k of spec.globals) params.push({ kind: "global", key: k });
  if (m.terrain) for (let i = 0; i < m.terrain.h.length; i++) params.push({ kind: "terrain", index: i });
  if (spec.perPhoto) for (const b of basesList) for (const k of spec.perPhoto.keys) params.push({ kind: "photo", name: b.frame.name, key: k });
  const P = params.length;

  // Which ties each parameter touches, and which end of the tie the photograph is (0 = a, 1 = b).
  const byPhoto = new Map<string, number[]>();
  const sideOf = new Map<string, Map<number, 0 | 1>>();
  used.forEach((t, i) => { for (const [nm, side] of [[t.a, 0], [t.b, 1]] as const) { (byPhoto.get(nm) ?? byPhoto.set(nm, []).get(nm)!).push(i); (sideOf.get(nm) ?? sideOf.set(nm, new Map()).get(nm)!).set(i, side); } });
  const tieEN = used.map(t => toEnu({ lat: t.lat, lng: t.lng, altM: 0 }, m.origin));
  const all = used.map((_, i) => i);
  const touched = params.map(p => {
    if (p.kind === "global") return all;
    if (p.kind === "photo") return byPhoto.get(p.name) ?? [];
    const t = m.terrain!, ix = p.index % t.nx, iy = Math.floor(p.index / t.nx);
    const ce = t.e0 + ix * t.spacing, cn = t.n0 + iy * t.spacing;
    return all.filter(i => Math.abs(tieEN[i][0] - ce) < t.spacing * 1.5 && Math.abs(tieEN[i][1] - cn) < t.spacing * 1.5);
  });

  // Both ends of every tie on the ground (east, north about the origin), and the residual b minus a from them.
  // The ends are kept per iteration so that a per-photo parameter re-projects only that photograph's end.
  const endsOf = (model: AdjustModel): Float64Array => {
    const out = new Float64Array(used.length * 4).fill(NaN), cache = new Map<string, GeorefFrame>();
    const fr = (nm: string) => { let f = cache.get(nm); if (!f) { f = frameUnder(bases.get(nm)!, model); cache.set(nm, f); } return f; };
    used.forEach((t, i) => {
      const ga = pixelToGround(fr(t.a), t.ua, t.va), gb = pixelToGround(fr(t.b), t.ub, t.vb);
      if (!ga || !gb) return;
      const ea = toEnu({ lat: ga.lat, lng: ga.lng, altM: 0 }, model.origin), eb = toEnu({ lat: gb.lat, lng: gb.lng, altM: 0 }, model.origin);
      out[4 * i] = ea[0]; out[4 * i + 1] = ea[1]; out[4 * i + 2] = eb[0]; out[4 * i + 3] = eb[1];
    });
    return out;
  };
  const residualsFrom = (ends: Float64Array): Float64Array => {
    const out = new Float64Array(used.length * 2);
    for (let i = 0; i < used.length; i++) { const ok = Number.isFinite(ends[4 * i]); out[2 * i] = ok ? ends[4 * i + 2] - ends[4 * i] : 0; out[2 * i + 1] = ok ? ends[4 * i + 3] - ends[4 * i + 1] : 0; }
    return out;
  };
  const residuals = (model: AdjustModel, idx: number[]) => {
    const out = new Float64Array(idx.length * 2), cache = new Map<string, GeorefFrame>();
    const fr = (nm: string) => { let f = cache.get(nm); if (!f) { f = frameUnder(bases.get(nm)!, model); cache.set(nm, f); } return f; };
    idx.forEach((ti, k) => { const t = used[ti]; const r = tieResidual(fr(t.a), fr(t.b), t, model.origin); out[2 * k] = r ? r[0] : 0; out[2 * k + 1] = r ? r[1] : 0; });
    return out;
  };
  // The residuals of the ties a photo parameter touches, with only that photograph's end re-projected under the
  // perturbed model; the other end is the current one. Identical floats to recomputing both ends.
  const residualsOneEnd = (model: AdjustModel, name: string, idx: number[], ends: Float64Array) => {
    const out = new Float64Array(idx.length * 2), f = frameUnder(bases.get(name)!, model), sides = sideOf.get(name)!;
    idx.forEach((ti, k) => {
      const t = used[ti], side = sides.get(ti)!;
      if (!Number.isFinite(ends[4 * ti])) return;
      const g = side === 0 ? pixelToGround(f, t.ua, t.va) : pixelToGround(f, t.ub, t.vb);
      if (!g) return;
      const e = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, model.origin);
      if (side === 0) { out[2 * k] = ends[4 * ti + 2] - e[0]; out[2 * k + 1] = ends[4 * ti + 3] - e[1]; }
      else { out[2 * k] = e[0] - ends[4 * ti]; out[2 * k + 1] = e[1] - ends[4 * ti + 1]; }
    });
    return out;
  };
  const priorSigma = (p: Param) => p.kind === "global" ? GLOBAL_PRIOR[p.key] : p.kind === "terrain" ? TERRAIN_ABS_SIGMA_M : spec.perPhoto!.sigma[p.key] ?? 1;
  const smooth = spec.terrain?.smoothSigmaM ?? 1;
  const terrainOffset = params.findIndex(p => p.kind === "terrain");

  const costOf = (model: AdjustModel, r: Float64Array) => {
    let c = 0;
    for (let i = 0; i < used.length; i++) { const d = Math.hypot(r[2 * i], r[2 * i + 1]); c += d <= huber ? d * d : 2 * huber * d - huber * huber; }
    params.forEach(p => { c += (getP(model, p) / priorSigma(p)) ** 2; });
    if (model.terrain) c += terrainRough(model.terrain) / (smooth * smooth);
    return c;
  };

  let ends = endsOf(m), r = residualsFrom(ends), cost = costOf(m, r), mu = 1e-3, it = 0;
  for (; it < iters; it++) {
    // Huber weights from the current residuals.
    const w = new Float64Array(used.length);
    for (let i = 0; i < used.length; i++) { const d = Math.hypot(r[2 * i], r[2 * i + 1]); w[i] = d <= huber ? 1 : huber / d; }
    // Sparse numerical Jacobian: per tie, the (param, dr) entries.
    const entries: { p: number; dx: number; dy: number }[][] = used.map(() => []);
    params.forEach((p, j) => {
      const idx = touched[j];
      if (!idx.length) return;
      const v0 = getP(m, p), h = stepOf(p);
      setP(m, p, v0 + h);
      const rp = p.kind === "photo" ? residualsOneEnd(m, p.name, idx, ends) : residuals(m, idx);
      setP(m, p, v0);
      idx.forEach((ti, k) => { const dx = (rp[2 * k] - r[2 * ti]) / h, dy = (rp[2 * k + 1] - r[2 * ti + 1]) / h; if (dx || dy) entries[ti].push({ p: j, dx, dy }); });
    });
    const N = new Float64Array(P * P), g = new Float64Array(P);
    entries.forEach((es, ti) => {
      const wi = w[ti], rx = r[2 * ti], ry = r[2 * ti + 1];
      for (const a of es) {
        g[a.p] += wi * (a.dx * rx + a.dy * ry);
        for (const b of es) N[a.p * P + b.p] += wi * (a.dx * b.dx + a.dy * b.dy);
      }
    });
    params.forEach((p, j) => { const s = priorSigma(p); N[j * P + j] += 1 / (s * s); g[j] += getP(m, p) / (s * s); });
    if (m.terrain) addTerrainSmoothness(m.terrain, N, g, P, terrainOffset, smooth);
    let improved = false;
    for (let tryN = 0; tryN < 8 && !improved; tryN++) {
      const A = new Float64Array(N);
      for (let j = 0; j < P; j++) A[j * P + j] += mu * (N[j * P + j] + 1e-9);
      const neg = g.map(v => -v);
      const dx = cholSolve(A, neg, P);
      if (!dx) { mu *= 10; continue; }
      const trial = cloneModel(m, spec);
      params.forEach((p, j) => setP(trial, p, getP(trial, p) + dx[j]));
      const et = endsOf(trial), rt = residualsFrom(et), ct = costOf(trial, rt);
      if (ct < cost) {
        params.forEach((p, j) => setP(m, p, getP(trial, p)));
        const rel = (cost - ct) / cost;
        ends = et; r = rt; cost = ct; mu = Math.max(1e-7, mu / 5); improved = true;
        opts.log?.(`  ${spec.name} it ${it + 1}: cost ${ct.toFixed(2)}`);
        if (rel < 1e-5) it = iters;
      } else mu *= 10;
    }
    if (!improved) break;
  }
  return { model: m, train: evaluateTies(bases, m, used), iterations: it, cost };
}

function terrainRough(t: Terrain): number {
  let c = 0;
  const h = t.h, w = t.nx;
  for (let j = 0; j < t.ny; j++) for (let i = 1; i < t.nx - 1; i++) c += (h[j * w + i - 1] - 2 * h[j * w + i] + h[j * w + i + 1]) ** 2;
  for (let j = 1; j < t.ny - 1; j++) for (let i = 0; i < t.nx; i++) c += (h[(j - 1) * w + i] - 2 * h[j * w + i] + h[(j + 1) * w + i]) ** 2;
  return c;
}

/** Add the second-difference smoothness prior's normal equations (it is quadratic, so exact). */
function addTerrainSmoothness(t: Terrain, N: Float64Array, g: Float64Array, P: number, off: number, sigma: number) {
  const w = t.nx, s2 = 1 / (sigma * sigma);
  const add = (a: number, b: number, c: number) => {
    const ids = [a, b, c], co = [1, -2, 1];
    const val = co.reduce((s, k, q) => s + k * t.h[ids[q]], 0);
    for (let p = 0; p < 3; p++) {
      g[off + ids[p]] += s2 * co[p] * val;
      for (let q = 0; q < 3; q++) N[(off + ids[p]) * P + off + ids[q]] += s2 * co[p] * co[q];
    }
  };
  for (let j = 0; j < t.ny; j++) for (let i = 1; i < t.nx - 1; i++) add(j * w + i - 1, j * w + i, j * w + i + 1);
  for (let j = 1; j < t.ny - 1; j++) for (let i = 0; i < t.nx; i++) add((j - 1) * w + i, j * w + i, (j + 1) * w + i);
}

/** A copy of a model, re-shaped to `spec` (parameters the spec does not use are dropped to zero). */
export function cloneModel(m: AdjustModel, spec: ModelSpec = m.spec): AdjustModel {
  const globals = { ...ZERO_GLOBALS };
  for (const k of spec.globals) globals[k] = m.globals[k];
  const photo = new Map<string, Record<PhotoKey, number>>();
  for (const [k, v] of m.photo) { const c = { ...ZERO_PHOTO }; for (const key of spec.perPhoto?.keys ?? []) c[key] = v[key]; photo.set(k, c); }
  return { spec, origin: m.origin, globals, photo, terrain: spec.terrain && m.terrain ? { ...m.terrain, h: new Float64Array(m.terrain.h) } : null };
}
