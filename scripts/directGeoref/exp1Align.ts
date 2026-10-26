// Experiment 1: cross-photo alignment from soil-texture ties, judged on photo pairs held out of every fit.
//
//   npx vite-node scripts/directGeoref/exp1Align.ts -- [--refind]
//
// 1. Soil ties under the header-only cameras; a first global fit; ties found again under that fit (more windows
//    succeed once the photographs nearly agree). Ties are pixel correspondences, so the second set is not biased
//    toward the model that found it.
// 2. Models fitted on 70 % of the photo PAIRS, scored on the other 30 %:
//      header only; the four global numbers (now fitted on soil, not patches); timing in place of the along-image
//      tilt; both; a smooth terrain surface; modest per-photo corrections (tight and loose priors); terrain plus
//      per-photo.
// 3. What is left: residuals of the held-out ties in each photo's own along/cross-track frame, by kind of pair, and
//    the per-photo corrections (do they drift, do they follow the leg direction, the roll, the speed?).
// Writes data/direct-georef/apricot/exp1/{ties.json,results.json,models.json} and prints the tables.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AdjustModel, type ModelSpec, type PhotoKey, type SoilTie, adjust, emptyModel, evaluateTies, frameUnder } from "../../src/lib/directGeoref";
import { OUT, baseFrames, findAllTies, isHeldOut, isTurn, loadCache, loadRasters, pairKind, quant, r2, r3 } from "./common";

const argv = process.argv.slice(2);
const DIR = join(OUT, "exp1");
mkdirSync(DIR, { recursive: true });
const cached = loadCache();
const bases = baseFrames(cached);
const byName = new Map(bases.map(b => [b.frame.name, b]));
console.log(`${bases.length} photographs; decoding quarter-size rasters...`);
const rasters = loadRasters(cached);

const G4: ModelSpec = { name: "global 4 (tilts, spin, ground)", globals: ["tiltAcrossDeg", "tiltAlongDeg", "spinDeg", "groundOffsetM"] };
const tiesPath = join(DIR, "ties.json");
let ties: SoilTie[];
let found: Record<string, unknown> = {};
if (existsSync(tiesPath) && !argv.includes("--refind")) {
  ({ ties, found } = JSON.parse(readFileSync(tiesPath, "utf8")));
  console.log(`${ties.length} ties from cache`);
} else {
  console.log("soil ties under the header-only cameras...");
  const t0 = findAllTies(bases.map(b => b.frame), rasters);
  console.log(`  ${t0.ties.length} ties in ${t0.pairsWithTies}/${t0.pairs} pairs; rejected ${JSON.stringify(t0.rejected)}`);
  const first = adjust(bases, t0.ties.filter(t => !isHeldOut(t)), G4);
  console.log(`  first global fit: ${JSON.stringify(roundAll(first.model.globals))}`);
  console.log("soil ties again under the first fit...");
  const t1 = findAllTies(bases.map(b => frameUnder(b, first.model)), rasters);
  console.log(`  ${t1.ties.length} ties in ${t1.pairsWithTies}/${t1.pairs} pairs; rejected ${JSON.stringify(t1.rejected)}`);
  ties = t1.ties;
  found = { headerOnly: { ties: t0.ties.length, pairsWithTies: t0.pairsWithTies, pairs: t0.pairs, rejected: t0.rejected }, afterFirstFit: { ties: t1.ties.length, pairsWithTies: t1.pairsWithTies, pairs: t1.pairs, rejected: t1.rejected } };
  writeFileSync(tiesPath, JSON.stringify({ ties, found }));
}

const train = ties.filter(t => !isHeldOut(t)), test = ties.filter(t => isHeldOut(t));
const kindOf = (t: SoilTie) => pairKind(byName.get(t.a)!.frame, byName.get(t.b)!.frame);
console.log(`train ${train.length} ties in ${new Set(train.map(t => t.a + t.b)).size} pairs; held out ${test.length} ties in ${new Set(test.map(t => t.a + t.b)).size} pairs`);

function roundAll(o: Record<string, number>) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)])); }

const specs: ModelSpec[] = [
  G4,
  { name: "global, timing for along tilt", globals: ["tiltAcrossDeg", "spinDeg", "groundOffsetM", "timingS"] },
  { name: "global 5 (both)", globals: ["tiltAcrossDeg", "tiltAlongDeg", "spinDeg", "groundOffsetM", "timingS"] },
  { name: "global + terrain 25 m", globals: ["tiltAcrossDeg", "tiltAlongDeg", "spinDeg"], terrain: { spacingM: 25, smoothSigmaM: 0.3 } },
  { name: "global + per-photo tight (5 cm, 0.2 deg)", globals: G4.globals, perPhoto: { keys: ["dE", "dN", "dYawDeg"], sigma: { dE: 0.05, dN: 0.05, dYawDeg: 0.2 } } },
  { name: "global + per-photo loose (25 cm, 0.5 deg)", globals: G4.globals, perPhoto: { keys: ["dE", "dN", "dYawDeg"], sigma: { dE: 0.25, dN: 0.25, dYawDeg: 0.5 } } },
  { name: "global + terrain + per-photo tight", globals: ["tiltAcrossDeg", "tiltAlongDeg", "spinDeg"], terrain: { spacingM: 25, smoothSigmaM: 0.3 }, perPhoto: { keys: ["dE", "dN", "dYawDeg"], sigma: { dE: 0.05, dN: 0.05, dYawDeg: 0.2 } } },
  // Per-photo ATTITUDE (the gimbal's per-photo error), positions held at RTK quality.
  ...[0.25, 0.5, 1, 2].map(sd => ({ name: `global + per-photo attitude ${sd} deg`, globals: G4.globals, perPhoto: { keys: ["dE", "dN", "dYawDeg", "dTiltAcrossDeg", "dTiltAlongDeg"] as PhotoKey[], sigma: { dE: 0.03, dN: 0.03, dYawDeg: sd, dTiltAcrossDeg: sd, dTiltAlongDeg: sd } } })),
];

type Row = { model: string; params: number; heldOut: Record<string, { n: number; median: number; p90: number }>; train: { median: number }; globals: Record<string, number>; ms: number };
const rows: Row[] = [];
const models = new Map<string, AdjustModel>();
const header = emptyModel({ name: "header only", globals: [] }, bases);
models.set("header only", header);
const statsBy = (m: AdjustModel) => {
  const all = evaluateTies(byName, m, test);
  const out: Row["heldOut"] = { all: { n: all.n, median: r3(all.median), p90: r3(all.p90) } };
  for (const k of ["same", "opposite", "turn"] as const) {
    const sub = test.filter(t => kindOf(t) === k);
    const s = evaluateTies(byName, m, sub);
    out[k] = { n: s.n, median: r3(s.median), p90: r3(s.p90) };
  }
  return out;
};
rows.push({ model: "header only", params: 0, heldOut: statsBy(header), train: { median: r3(evaluateTies(byName, header, train).median) }, globals: {}, ms: 0 });
let warm: AdjustModel | undefined;
for (const spec of specs) {
  const t0 = Date.now();
  const res = adjust(bases, train, spec, { start: warm, iterations: 15 });
  if (spec === G4) warm = res.model;
  models.set(spec.name, res.model);
  const np = spec.globals.length + (res.model.terrain ? res.model.terrain.h.length : 0) + (spec.perPhoto ? spec.perPhoto.keys.length * bases.length : 0);
  rows.push({ model: spec.name, params: np, heldOut: statsBy(res.model), train: { median: r3(res.train.median) }, globals: roundAll(res.model.globals), ms: Date.now() - t0 });
  console.log(`${spec.name}: held-out median ${rows[rows.length - 1].heldOut.all.median} m (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

console.log("\nHeld-out soil ties, metres (median / p90):");
console.log("model".padEnd(44), "params", "all".padStart(14), "same heading".padStart(16), "opposite".padStart(16), "turn".padStart(16));
for (const r of rows) console.log(r.model.padEnd(44), String(r.params).padStart(6), ...(["all", "same", "opposite", "turn"] as const).map(k => `${r.heldOut[k].median} / ${r.heldOut[k].p90}`.padStart(k === "all" ? 14 : 16)));
for (const r of rows) if (Object.keys(r.globals).length) console.log(`  ${r.model}: ${JSON.stringify(r.globals)}`);

// ------------------------------------------------------------------------------------------------------------------
// What is left after the global model: residuals in photo A's track frame, per kind of pair.
// ------------------------------------------------------------------------------------------------------------------
function trackFrame(m: AdjustModel, label: string) {
  const ev = evaluateTies(byName, m, test);
  const groups: Record<string, { along: number[]; cross: number[] }> = {};
  test.forEach((t, i) => {
    if (!Number.isFinite(ev.dist[i])) return;
    const a = byName.get(t.a)!.frame, y = (a.pose.attitude.yawDeg * Math.PI) / 180;
    const ux = Math.sin(y), uy = Math.cos(y), e = ev.vec[2 * i], n = ev.vec[2 * i + 1];
    const k = kindOf(t);
    (groups[k] ??= { along: [], cross: [] }).along.push(e * ux + n * uy);
    groups[k].cross.push(-e * uy + n * ux);
  });
  console.log(`\nResidual (B minus A) in A's track frame, ${label}: median along / cross, metres`);
  const out: Record<string, { along: number; cross: number }> = {};
  for (const [k, g] of Object.entries(groups)) { out[k] = { along: r3(quant(g.along, 0.5)), cross: r3(quant(g.cross, 0.5)) }; console.log(`  ${k.padEnd(9)} ${out[k].along} / ${out[k].cross}  (${g.along.length} ties)`); }
  return out;
}
const trackHeader = trackFrame(header, "header only");
const trackG4 = trackFrame(models.get(G4.name)!, G4.name);
const trackTiming = trackFrame(models.get(specs[1].name)!, specs[1].name);

// Per-photo corrections: modest? drifting? following the leg, the roll, the speed?
function photoReport(name: string) {
  const m = models.get(name)!;
  const rows2 = bases.map(b => {
    const c = m.photo.get(b.frame.name)!, y = (b.frame.pose.attitude.yawDeg * Math.PI) / 180;
    return { name: b.frame.name, dE: c.dE, dN: c.dN, dYaw: c.dYawDeg, tiltAcross: c.dTiltAcrossDeg, tiltAlong: c.dTiltAlongDeg, along: c.dE * Math.sin(y) + c.dN * Math.cos(y), cross: -c.dE * Math.cos(y) + c.dN * Math.sin(y), ne: Math.cos(y) > 0, turn: isTurn(b.frame), roll: cached.find(x => x.name === b.frame.name)!.meta.flightRollDeg ?? 0 };
  });
  const mag = rows2.map(r => Math.hypot(r.dE, r.dN));
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let c = 0, va = 0, vb = 0; a.forEach((x, i) => { c += (x - ma) * (b[i] - mb); va += (x - ma) ** 2; vb += (b[i] - mb) ** 2; }); return c / Math.sqrt(va * vb); };
  const straight = rows2.filter(r => !r.turn);
  const res = {
    medianShiftM: r3(quant(mag, 0.5)), maxShiftM: r3(Math.max(...mag)), medianYawDeg: r3(quant(rows2.map(r => Math.abs(r.dYaw)), 0.5)),
    meanShiftM: [r3(mean(rows2.map(r => r.dE))), r3(mean(rows2.map(r => r.dN)))],
    alongMeanNE: r3(mean(straight.filter(r => r.ne).map(r => r.along))), alongMeanSW: r3(mean(straight.filter(r => !r.ne).map(r => r.along))),
    crossMeanNE: r3(mean(straight.filter(r => r.ne).map(r => r.cross))), crossMeanSW: r3(mean(straight.filter(r => !r.ne).map(r => r.cross))),
    corrCrossWithRoll: r3(corr(straight.map(r => r.cross), straight.map(r => r.roll))),
    turnFramesMedianShiftM: r3(quant(rows2.filter(r => r.turn).map(r => Math.hypot(r.dE, r.dN)), 0.5)),
    tiltMedianDeg: r3(quant(rows2.map(r => Math.hypot(r.tiltAcross, r.tiltAlong)), 0.5)), tiltP90Deg: r3(quant(rows2.map(r => Math.hypot(r.tiltAcross, r.tiltAlong)), 0.9)),
    tiltMeanDeg: [r3(mean(rows2.map(r => r.tiltAcross))), r3(mean(rows2.map(r => r.tiltAlong)))],
    corrTiltAcrossWithRoll: r3(corr(straight.map(r => r.tiltAcross), straight.map(r => r.roll))),
    corrTiltAlongWithPitch: r3(corr(straight.map(r => r.tiltAlong), straight.map(r => cached.find(x => x.name === r.name)!.meta.flightPitchDeg ?? 0))),
    lag1CorrTiltAcross: r3(corr(rows2.slice(0, -1).map(r => r.tiltAcross), rows2.slice(1).map(r => r.tiltAcross))),
    lag1CorrTiltAlong: r3(corr(rows2.slice(0, -1).map(r => r.tiltAlong), rows2.slice(1).map(r => r.tiltAlong))),
    tiltAlongMeanNE: r3(mean(straight.filter(r => r.ne).map(r => r.tiltAlong))), tiltAlongMeanSW: r3(mean(straight.filter(r => !r.ne).map(r => r.tiltAlong))),
    tiltAcrossMeanNE: r3(mean(straight.filter(r => r.ne).map(r => r.tiltAcross))), tiltAcrossMeanSW: r3(mean(straight.filter(r => !r.ne).map(r => r.tiltAcross))),
    yawMeanNE: r3(mean(straight.filter(r => r.ne).map(r => r.dYaw))), yawMeanSW: r3(mean(straight.filter(r => !r.ne).map(r => r.dYaw))),
    tiltTurnMedianDeg: r3(quant(rows2.filter(r => r.turn).map(r => Math.hypot(r.tiltAcross, r.tiltAlong)), 0.5)),
  };
  console.log(`\nPer-photo corrections, ${name}: ${JSON.stringify(res)}`);
  return { summary: res, photos: rows2.map(r => ({ ...r, dE: r3(r.dE), dN: r3(r.dN), dYaw: r3(r.dYaw), along: r3(r.along), cross: r3(r.cross) })) };
}
const photoTight = photoReport(specs[4].name);
const photoLoose = photoReport(specs[5].name);
const photoTerrain = photoReport(specs[6].name);
const photoAttitude = [7, 8, 9, 10].map(i => photoReport(specs[i].name));
const trackAttitude = trackFrame(models.get(specs[9].name)!, specs[9].name);
const terr = models.get(specs[3].name)!.terrain!;
const th = [...terr.h];
console.log(`\nTerrain (global + terrain): heights ${r2(Math.min(...th))} to ${r2(Math.max(...th))} m against take-off, ${terr.nx} x ${terr.ny} nodes`);

writeFileSync(join(DIR, "results.json"), JSON.stringify({ found, train: train.length, test: test.length, rows, track: { header: trackHeader, global4: trackG4, timing: trackTiming, attitude1: trackAttitude }, photoTight, photoLoose, photoTerrain, photoAttitude, terrain: { min: Math.min(...th), max: Math.max(...th), nx: terr.nx, ny: terr.ny } }, null, 1));
writeFileSync(join(DIR, "models.json"), JSON.stringify([...models].map(([k, m]) => ({ name: k, spec: m.spec, origin: m.origin, globals: m.globals, photo: [...m.photo], terrain: m.terrain ? { ...m.terrain, h: [...m.terrain.h] } : null }))));
console.log(`\nwritten ${DIR}`);
