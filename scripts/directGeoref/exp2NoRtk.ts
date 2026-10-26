// Experiment 2: how much of a consumer GPS's error the photographs' overlap can take out.
//
//   npx vite-node scripts/directGeoref/exp2NoRtk.ts -- [--only S2]
//
// Reference cameras: the RTK header plus experiment 1's best adjustment (global + per-photo attitude, 1 deg prior).
// Each scenario adds GPS errors to the photographs' positions (and barometric height drift), then does what a
// non-RTK pipeline would: find soil ties under the noisy cameras (coarse-to-fine, so metre offsets are caught),
// adjust (global camera numbers + per-photo position with a prior the size of the GPS error + per-photo attitude),
// find ties again under that fit, adjust again. Ground error is measured on a 5 x 5 grid of pixels in every photo
// against the reference cameras, before and after, and split into the COMMON offset of the whole block (the mean
// error vector, which ties cannot see) and what is left once that is removed (the relative error ties can fix).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AdjustModel, type BaseFrame, type ModelSpec, type PhotoKey, type SoilTie, adjust, cloneModel, evaluateTies, frameUnder, pixelToGround } from "../../src/lib/directGeoref";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { OUT, baseFrames, findAllTies, isHeldOut, loadCache, loadRasters, quant, r3 } from "./common";

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const SEED = argv.includes("--seed") ? Number(argv[argv.indexOf("--seed") + 1]) : 20261026;
const DIR = join(OUT, "exp2");
mkdirSync(DIR, { recursive: true });
const cached = loadCache();
const bases = baseFrames(cached);
const rasters = loadRasters(cached);
const names = bases.map(b => b.frame.name);

type SavedModel = { name: string; spec: ModelSpec; origin: AdjustModel["origin"]; globals: AdjustModel["globals"]; photo: [string, Record<PhotoKey, number>][]; terrain: null };
const saved = (JSON.parse(readFileSync(join(OUT, "exp1", "models.json"), "utf8")) as SavedModel[]).find(m => m.name === "global + per-photo attitude 1 deg")!;
const reference: AdjustModel = { spec: saved.spec, origin: saved.origin, globals: saved.globals, photo: new Map(saved.photo), terrain: null };
const refFrames = new Map(bases.map(b => [b.frame.name, frameUnder(b, reference)]));
const globalOnly = cloneModel(reference, { name: "reference global numbers only", globals: saved.spec.globals });

// ------------------------------------------------------------------------------------------------------------------
// GPS error scenarios
// ------------------------------------------------------------------------------------------------------------------
let seed = SEED;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
/** First-order Gauss-Markov sequence: stationary sd `sd`, correlation exp(-1 / tau) between consecutive photographs. */
const markov = (n: number, sd: number, tau: number) => { const a = Math.exp(-1 / tau), out: number[] = []; let x = gauss() * sd; for (let i = 0; i < n; i++) { out.push(x); x = a * x + Math.sqrt(1 - a * a) * sd * gauss(); } return out; };

type Scenario = { id: string; label: string; e: number[]; n: number[]; h: number[]; priorM: number };
const n = names.length;
const scenarios: Scenario[] = [];
const iid = (sd: number) => Array.from({ length: n }, () => gauss() * sd);
const baro = () => markov(n, 0.2, 20);
scenarios.push({ id: "S0", label: "RTK (no added error): control", e: Array(n).fill(0), n: Array(n).fill(0), h: Array(n).fill(0), priorM: 0.03 });
scenarios.push({ id: "S1", label: "random, 1 m per photo", e: iid(1), n: iid(1), h: baro(), priorM: 1 });
scenarios.push({ id: "S2", label: "random, 3 m per photo", e: iid(3), n: iid(3), h: baro(), priorM: 3 });
{ const e = iid(0.5), nn = iid(0.5); scenarios.push({ id: "S3", label: "common offset 2.5 m + random 0.5 m", e: e.map(v => v + 2.0), n: nn.map(v => v - 1.5), h: baro(), priorM: 2.5 }); }
{ const e = markov(n, 2, 15), nn = markov(n, 2, 15); scenarios.push({ id: "S4", label: "slow drift 2 m (correlated over ~15 photos) + offset 1.4 m", e: e.map(v => v + 1), n: nn.map(v => v + 1), h: baro(), priorM: 2.5 }); }

function noisy(s: Scenario): BaseFrame[] {
  return bases.map((b, i) => {
    const f = b.frame, lat0 = (f.pose.lat * Math.PI) / 180;
    return { ...b, frame: { ...f, pose: { ...f.pose, lat: f.pose.lat + (s.n[i] / 6378137) * (180 / Math.PI), lng: f.pose.lng + (s.e[i] / (6378137 * Math.cos(lat0))) * (180 / Math.PI), altM: f.pose.altM + s.h[i] } } };
  });
}

// Ground error on a 5 x 5 pixel grid per photograph, against the reference cameras.
const FR = [0.1, 0.3, 0.5, 0.7, 0.9];
function groundError(noisyBases: BaseFrame[], m: AdjustModel) {
  const vec: [number, number][] = [];
  const perPhoto: number[] = [];
  noisyBases.forEach(b => {
    const est = frameUnder(b, m), ref = refFrames.get(b.frame.name)!;
    const { width: w, height: h } = ref.intrinsics;
    const o = { lat: ref.pose.lat, lng: ref.pose.lng, altM: 0 };
    let sum = 0, k = 0;
    for (const fy of FR) for (const fx of FR) {
      const g1 = pixelToGround(ref, fx * w, fy * h), g2 = pixelToGround(est, fx * w, fy * h);
      if (!g1 || !g2) continue;
      const a = toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, o), c = toEnu({ lat: g2.lat, lng: g2.lng, altM: 0 }, o);
      vec.push([c[0] - a[0], c[1] - a[1]]); sum += Math.hypot(c[0] - a[0], c[1] - a[1]); k++;
    }
    perPhoto.push(sum / Math.max(1, k));
  });
  const mean: [number, number] = [vec.reduce((s, v) => s + v[0], 0) / vec.length, vec.reduce((s, v) => s + v[1], 0) / vec.length];
  const abs = vec.map(v => Math.hypot(v[0], v[1])), rel = vec.map(v => Math.hypot(v[0] - mean[0], v[1] - mean[1]));
  return { absMedian: r3(quant(abs, 0.5)), absP90: r3(quant(abs, 0.9)), commonOffsetM: r3(Math.hypot(...mean)), commonOffset: mean.map(r3), relMedian: r3(quant(rel, 0.5)), relP90: r3(quant(rel, 0.9)), worstPhotoM: r3(Math.max(...perPhoto)) };
}

const results: Record<string, unknown>[] = [];
for (const s of scenarios) {
  if (only && s.id !== only) continue;
  const t0 = Date.now();
  console.log(`\n${s.id}: ${s.label}`);
  const nb = noisy(s);
  const byName = new Map(nb.map(b => [b.frame.name, b]));
  const meanNoise = [s.e.reduce((a, v) => a + v, 0) / n, s.n.reduce((a, v) => a + v, 0) / n];
  const spec: ModelSpec = {
    name: `${s.id} adjusted`, globals: ["tiltAcrossDeg", "tiltAlongDeg", "spinDeg", "groundOffsetM"],
    perPhoto: { keys: ["dE", "dN", "dH", "dYawDeg", "dTiltAcrossDeg", "dTiltAlongDeg"], sigma: { dE: s.priorM, dN: s.priorM, dH: s.id === "S0" ? 0.03 : 0.3, dYawDeg: 1, dTiltAcrossDeg: 1, dTiltAlongDeg: 1 } },
  };
  // Pass 1: ties under the noisy header cameras.
  const t1 = findAllTies(nb.map(b => b.frame), rasters, 45 + 3 * s.priorM, false);
  const fit1 = adjust(nb, t1.ties.filter(t => !isHeldOut(t)), spec, { iterations: 15 });
  // Pass 2: ties under the first fit.
  const t2 = findAllTies(nb.map(b => frameUnder(b, fit1.model)), rasters, 45 + 3 * s.priorM, false);
  const train = t2.ties.filter(t => !isHeldOut(t)), test = t2.ties.filter((t: SoilTie) => isHeldOut(t));
  const fit2 = adjust(nb, train, spec, { iterations: 15, start: fit1.model });
  // Without matching: the noisy positions with the flight's global camera numbers (as if calibrated once, elsewhere).
  const before = groundError(nb, globalOnly);
  const after = groundError(nb, fit2.model);
  const posErr = (m: AdjustModel) => r3(quant(nb.map((b, i) => { const c = m.photo.get(b.frame.name)!; return Math.hypot(s.e[i] + c.dE, s.n[i] + c.dN); }), 0.5));
  const row = {
    id: s.id, label: s.label,
    injected: { medianM: r3(quant(s.e.map((v, i) => Math.hypot(v, s.n[i])), 0.5)), meanM: meanNoise.map(r3), heightSdM: r3(Math.sqrt(s.h.reduce((a, v) => a + v * v, 0) / n)) },
    ties: { pass1: t1.ties.length, pass1Pairs: t1.pairsWithTies, pass2: t2.ties.length, pass2Pairs: t2.pairsWithTies, pairs: t2.pairs },
    heldOutTies: { before: r3(evaluateTies(byName, globalOnly, test).median), after: r3(evaluateTies(byName, fit2.model, test).median), afterP90: r3(evaluateTies(byName, fit2.model, test).p90) },
    groundBefore: before, groundAfter: after,
    cameraPositionErrorM: { before: r3(quant(s.e.map((v, i) => Math.hypot(v, s.n[i])), 0.5)), after: posErr(fit2.model) },
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  results.push(row);
  if (SEED === 20261026) writeFileSync(join(DIR, `model-${s.id}.json`), JSON.stringify({ id: s.id, label: s.label, noise: names.map((nm, i) => [nm, s.e[i], s.n[i], s.h[i]]), model: { spec: fit2.model.spec, origin: fit2.model.origin, globals: fit2.model.globals, photo: [...fit2.model.photo] } }));
  console.log(JSON.stringify(row, null, 1));
}
writeFileSync(join(DIR, only || SEED !== 20261026 ? `results-${only ?? "all"}-seed${SEED}.json` : "results.json"), JSON.stringify(results, null, 1));
console.log("\nscenario".padEnd(62), "ground abs median before -> after", " relative median before -> after", " common offset (injected mean)");
for (const r of results as { id: string; label: string; groundBefore: { absMedian: number; relMedian: number }; groundAfter: { absMedian: number; relMedian: number; commonOffsetM: number }; injected: { meanM: number[] } }[]) {
  console.log(`${r.id} ${r.label}`.padEnd(62), `${r.groundBefore.absMedian} -> ${r.groundAfter.absMedian}`.padEnd(34), `${r.groundBefore.relMedian} -> ${r.groundAfter.relMedian}`.padEnd(32), `${r.groundAfter.commonOffsetM} (${r3(Math.hypot(r.injected.meanM[0], r.injected.meanM[1]))})`);
}
