// Experiment 3: the app's own detectors on every raw photograph, projected into one map, reconciled across views.
//
//   npx vite-node scripts/directGeoref/exp3Detectors.ts -- [--redetect]
//
// Detectors (unchanged app code, the same chain scripts/bench/layoutTrial.ts --propose runs on a stand-in map):
//   vegetation   fieldRows vegetationMask / shadowMask / coverMask (ExGR), pooled by rasterFromMask
//   rows         fieldRowsFromPixels: the tree-row reader; proposeFromRows: three plants that seed a lattice
//   trees        fitLayoutAll + mergeLayouts: the planting layout Yunus accepted on this field (rings = crowns)
//   row lines    layoutsToFieldRows: one straight line per row
// Each photograph is read in its OWN pixels (quarter size, 3.9 cm), as the detectors would read a map; the photo is
// given a Web Mercator frame at its own position only because the layout code speaks in global pixels.
//
// Then, with experiment 1's best cameras: every crown and row line is projected; crowns seen in several photographs
// are matched, triangulated (one 3D position and height per tree) and clustered; row lines are grouped into field
// rows. The DJI_0301 hand labels are checked against trees reconciled from the OTHER photographs only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import {
  type AdjustModel, type GeorefFrame, type GroundObject, type ModelSpec, type PairResult, type PhotoKey, type PixelObject,
  clusterMatches, frameFootprint, frameUnder, matchPair, objectsToGround, pixelToGround, worldRay, cameraCentreIn,
} from "../../src/lib/directGeoref";
import { coverMask, fieldRowsFromPixels, shadowMask, vegetationMask } from "../../src/lib/weedVision/fieldRows";
import { proposeFromRows } from "../../src/lib/weedVision/layout/readLayout";
import { fitLayoutAll, latticeFromClicks, layoutsToFieldRows, mergeLayouts, rasterFromMask } from "../../src/lib/weedVision/layout/plantingLayout";
import { mercatorPx } from "../../src/lib/weedVision/mapRun";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { OUT, PHOTOS, baseFrames, loadCache, quant, r2, r3 } from "./common";

const argv = process.argv.slice(2);
const DIR = join(OUT, "exp3");
mkdirSync(join(DIR, "detections"), { recursive: true });
const cached = loadCache();
const bases = baseFrames(cached);
type SavedModel = { name: string; spec: ModelSpec; origin: AdjustModel["origin"]; globals: AdjustModel["globals"]; photo: [string, Record<PhotoKey, number>][] };
const saved = (JSON.parse(readFileSync(join(OUT, "exp1", "models.json"), "utf8")) as SavedModel[]).find(m => m.name === "global + per-photo attitude 1 deg")!;
const model: AdjustModel = { spec: saved.spec, origin: saved.origin, globals: saved.globals, photo: new Map(saved.photo), terrain: null };
const frames = new Map(bases.map(b => [b.frame.name, frameUnder(b, model)]));
const groundAlt = model.globals.groundOffsetM;

// ------------------------------------------------------------------------------------------------------------------
// 1. Detect, per photograph (cached)
// ------------------------------------------------------------------------------------------------------------------
type Det = {
  name: string; ok: boolean; reason?: string;
  rowSpacingM?: number; plantSpacingM?: number; directionDeg?: number;
  /** Original-frame pixels; crown radius in metres at the detector's own scale. */
  trees: { u: number; v: number; rM: number; rPx: number; state: string; merged: boolean }[];
  lines: { u1: number; v1: number; u2: number; v2: number }[];
  ms: number;
};
const DOWN = 4;
function detect(name: string): Det {
  const t0 = Date.now();
  const img = decodeImage(new Uint8Array(readFileSync(join(PHOTOS, `${name}.JPG`))));
  const W = Math.floor(img.width / DOWN), H = Math.floor(img.height / DOWN), rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < DOWN; dy++) { let o = ((y * DOWN + dy) * img.width + x * DOWN) * 4; for (let dx = 0; dx < DOWN; dx++, o += 4) { r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; } }
    const p = (y * W + x) * 4, kk = DOWN * DOWN;
    rgba[p] = r / kk; rgba[p + 1] = g / kk; rgba[p + 2] = b / kk; rgba[p + 3] = 255;
  }
  const f = frames.get(name)!;
  const mpp = (f.pose.altM - groundAlt) / f.intrinsics.fx * DOWN; // ground metres per quarter-size pixel at the centre
  const px = { width: W, height: H, rgba };
  const z = 22;
  const [cx, cy] = mercatorPx(f.pose.lat, f.pose.lng, z);
  const left = Math.round(cx - W / 2), top = Math.round(cy - H / 2);
  const k = Math.max(1, Math.round(0.08 / mpp));
  const ring: [number, number][] = [[left, top], [left + W, top], [left + W, top + H], [left, top + H]];
  const r = rasterFromMask(vegetationMask(px), W, H, k, z, left, top, mpp, [ring], shadowMask(px), coverMask(px));
  const fr = fieldRowsFromPixels(px, mpp);
  if (!fr) return { name, ok: false, reason: "row reader found no rows", trees: [], lines: [], ms: Date.now() - t0 };
  const prop = proposeFromRows({ ...fr, z, left, top, mpp });
  if (!prop) return { name, ok: false, reason: "no three plants to seed the lattice", trees: [], lines: [], ms: Date.now() - t0, rowSpacingM: fr.spacingM, plantSpacingM: fr.seedSpacingM, directionDeg: fr.directionDeg };
  const clicks = prop.points.map(q => { const [X, Y] = mercatorPx(q.lat, q.lng, z); return [(X - left) / k, (Y - top) / k] as [number, number]; });
  const L0 = latticeFromClicks(clicks[0], clicks[1], clicks[2]);
  if (!L0) return { name, ok: false, reason: "seed plants do not make a lattice", trees: [], lines: [], ms: Date.now() - t0 };
  const fits = fitLayoutAll(L0, r, clicks);
  const merged = mergeLayouts(fits);
  const rows = layoutsToFieldRows(fits, r);
  // Raster cell (x, y) covers quarter pixels [x k, x k + k): its centre is (x + 0.5) k, then x4 to the original.
  const toOrig = (q: number) => q * DOWN;
  const trees = merged.flatMap(m => m.plants).map(p => ({ u: toOrig((p.x + 0.5) * k), v: toOrig((p.y + 0.5) * k), rM: p.r * r.mpp, rPx: toOrig(p.r * k), state: p.state, merged: p.merged }));
  const lines = (rows?.ctx.lines ?? []).map(l => ({ u1: toOrig(l.x1 + 0.5), v1: toOrig(l.y1 + 0.5), u2: toOrig(l.x2 + 0.5), v2: toOrig(l.y2 + 0.5) }));
  return { name, ok: true, rowSpacingM: fr.spacingM, plantSpacingM: fr.seedSpacingM, directionDeg: fr.directionDeg, trees, lines, ms: Date.now() - t0 };
}
const dets: Det[] = [];
for (const b of bases) {
  const p = join(DIR, "detections", `${b.frame.name}.json`);
  if (existsSync(p) && !argv.includes("--redetect")) { dets.push(JSON.parse(readFileSync(p, "utf8"))); continue; }
  const d = detect(b.frame.name);
  writeFileSync(p, JSON.stringify(d));
  dets.push(d);
  console.log(`${d.name}: ${d.ok ? `${d.trees.length} trees, ${d.lines.length} row lines, rows ${r2(d.rowSpacingM!)} m x plants ${r2(d.plantSpacingM!)} m` : d.reason} (${(d.ms / 1000).toFixed(1)} s)`);
}
const okDets = dets.filter(d => d.ok);
console.log(`\n${okDets.length}/${dets.length} photographs read by the detectors; ${okDets.reduce((s, d) => s + d.trees.length, 0)} tree crowns, ${okDets.reduce((s, d) => s + d.lines.length, 0)} row lines`);

// ------------------------------------------------------------------------------------------------------------------
// 2. Project and reconcile the trees
// ------------------------------------------------------------------------------------------------------------------
const circle = (u: number, v: number, r: number): [number, number][] => Array.from({ length: 16 }, (_, i) => [u + r * Math.cos((i * Math.PI) / 8), v + r * Math.sin((i * Math.PI) / 8)] as [number, number]);
const treeObjects = new Map<string, GroundObject[]>();
for (const d of okDets) {
  const f = frames.get(d.name)!;
  const { width: w, height: h } = f.intrinsics;
  const objs: PixelObject[] = d.trees.map((t, i) => ({ id: i + 1, u: t.u, v: t.v, hull: circle(t.u, t.v, t.rPx), cells: 1, areaPx: Math.PI * t.rPx * t.rPx, touchesEdge: t.u - t.rPx < 0 || t.v - t.rPx < 0 || t.u + t.rPx > w || t.v + t.rPx > h }));
  treeObjects.set(d.name, objectsToGround(f, objs));
}
const foot = new Map([...frames].map(([k, f]) => [k, frameFootprint(f, 8)!.map(g => ({ lat: g.lat, lng: g.lng }))]));
function pairsFor(names: string[]): PairResult[] {
  const out: PairResult[] = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j], fa = frames.get(a)!, fb = frames.get(b)!;
    const e = toEnu({ lat: fb.pose.lat, lng: fb.pose.lng, altM: 0 }, { lat: fa.pose.lat, lng: fa.pose.lng, altM: 0 });
    if (Math.hypot(e[0], e[1]) > 45) continue;
    const r = matchPair(fa, treeObjects.get(a)!, fb, treeObjects.get(b)!, foot.get(a)!, foot.get(b)!, { maxM: 1.5, ratio: 1.5, minAreaM2: 0.05 });
    if (r.matches.length) out.push(r);
  }
  return out;
}
const names = okDets.map(d => d.name);
const pairs = pairsFor(names);
const clusters = clusterMatches(pairs, 0.6).filter(c => c.views.length >= 2);
const matchesAll = pairs.flatMap(p => p.matches);

// Per view: where its ray meets the tree's own height, against where it meets the soil (the flat projection).
const viewAtHeight: number[] = [], viewFlat: number[] = [], radiusCv: number[] = [];
const treeOf = new Map<string, GroundObject>();
for (const [nm, objs] of treeObjects) for (const o of objs) treeOf.set(`${nm}#${o.id}`, o);
for (const c of clusters) {
  const o = { lat: c.lat, lng: c.lng, altM: 0 };
  const radii: number[] = [];
  for (const v of c.views) {
    const f = frames.get(v.frame)!, t = treeOf.get(`${v.frame}#${v.objectId}`)!;
    const C = cameraCentreIn(f, o), d = worldRay(f, t.u, t.v)!;
    const s = (c.altM - C[2]) / d[2];
    viewAtHeight.push(Math.hypot(C[0] + s * d[0], C[1] + s * d[1]));
    const g = toEnu({ lat: t.ground.lat, lng: t.ground.lng, altM: 0 }, o);
    viewFlat.push(Math.hypot(g[0], g[1]));
    radii.push(Math.sqrt(t.areaM2 / Math.PI));
  }
  const m = radii.reduce((s, x) => s + x, 0) / radii.length;
  radiusCv.push(Math.sqrt(radii.reduce((s, x) => s + (x - m) ** 2, 0) / radii.length) / m);
}
const heights = clusters.map(c => c.altM - groundAlt);
const singles = (() => { const seen = new Set(clusters.flatMap(c => c.views.map(v => `${v.frame}#${v.objectId}`))); return [...treeOf.keys()].filter(k => !seen.has(k)).length; })();
const treeStats = {
  crownsDetected: treeOf.size, pairsWithMatches: pairs.length, matches: matchesAll.length,
  rayMissM: { median: r3(quant(matchesAll.filter(m => m.tri).map(m => m.tri!.missM), 0.5)), p90: r3(quant(matchesAll.filter(m => m.tri).map(m => m.tri!.missM), 0.9)) },
  reconciledTrees: clusters.length, viewsPerTree: { median: quant(clusters.map(c => c.views.length), 0.5), max: Math.max(...clusters.map(c => c.views.length)) },
  crownsSeenOnce: singles,
  heightAboveGroundM: { p10: r2(quant(heights, 0.1)), median: r2(quant(heights, 0.5)), p90: r2(quant(heights, 0.9)) },
  spreadOfPairPositionsM: { median: r3(quant(clusters.map(c => c.spreadM), 0.5)), p90: r3(quant(clusters.map(c => c.spreadM), 0.9)) },
  viewFromTreeFlatM: { median: r3(quant(viewFlat, 0.5)), p90: r3(quant(viewFlat, 0.9)) },
  viewFromTreeAtItsHeightM: { median: r3(quant(viewAtHeight, 0.5)), p90: r3(quant(viewAtHeight, 0.9)) },
  crownRadiusVariationAcrossViews: { median: r3(quant(radiusCv, 0.5)), p90: r3(quant(radiusCv, 0.9)) },
};
console.log("\nTrees:", JSON.stringify(treeStats, null, 1));

// ------------------------------------------------------------------------------------------------------------------
// 3. Row lines: projected at the trees' height, grouped into field rows
// ------------------------------------------------------------------------------------------------------------------
const treeH = groundAlt + quant(heights, 0.5);
const atHeight = (f: GeorefFrame): GeorefFrame => ({ ...f, ground: { kind: "flat", altM: treeH, datum: f.ground.datum, basis: "median tree height" } });
type GLine = { frame: string; e1: number; n1: number; e2: number; n2: number; theta: number; rho: number };
const glines: GLine[] = [];
for (const d of okDets) {
  const f = atHeight(frames.get(d.name)!);
  for (const l of d.lines) {
    const a = pixelToGround(f, l.u1, l.v1), b = pixelToGround(f, l.u2, l.v2);
    if (!a || !b) continue;
    const pa = toEnu({ lat: a.lat, lng: a.lng, altM: 0 }, model.origin), pb = toEnu({ lat: b.lat, lng: b.lng, altM: 0 }, model.origin);
    let th = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
    if (th < 0) th += Math.PI;
    if (th >= Math.PI) th -= Math.PI;
    glines.push({ frame: d.name, e1: pa[0], n1: pa[1], e2: pb[0], n2: pb[1], theta: th, rho: 0 });
  }
}
const th0 = quant(glines.map(l => l.theta), 0.5);
const aligned = glines.filter(l => Math.abs(l.theta - th0) < (5 * Math.PI) / 180);
for (const l of aligned) { const mx = (l.e1 + l.e2) / 2, my = (l.n1 + l.n2) / 2; l.rho = -mx * Math.sin(th0) + my * Math.cos(th0); }
aligned.sort((a, b) => a.rho - b.rho);
const groups: GLine[][] = [];
for (const l of aligned) { const g = groups[groups.length - 1]; if (g && l.rho - g[g.length - 1].rho < 1.2) g.push(l); else groups.push([l]); }
const multi = groups.filter(g => new Set(g.map(l => l.frame)).size >= 2);
const rhoSd = multi.map(g => { const m = g.reduce((s, l) => s + l.rho, 0) / g.length; return Math.sqrt(g.reduce((s, l) => s + (l.rho - m) ** 2, 0) / g.length); });
const angSd = multi.map(g => { const m = g.reduce((s, l) => s + l.theta, 0) / g.length; return (Math.sqrt(g.reduce((s, l) => s + (l.theta - m) ** 2, 0) / g.length) * 180) / Math.PI; });
const centres = groups.map(g => g.reduce((s, l) => s + l.rho, 0) / g.length);
const gapsBetween = centres.slice(1).map((c, i) => c - centres[i]);
const rowStats = {
  rowLines: glines.length, alignedWithField: aligned.length, fieldDirectionDeg: r2(90 - (th0 * 180) / Math.PI),
  fieldRows: groups.length, fieldRowsSeenInTwoOrMorePhotos: multi.length, photosPerRow: { median: quant(multi.map(g => new Set(g.map(l => l.frame)).size), 0.5) },
  acrossOffsetSdM: { median: r3(quant(rhoSd, 0.5)), p90: r3(quant(rhoSd, 0.9)) }, angleSdDeg: { median: r3(quant(angSd, 0.5)), p90: r3(quant(angSd, 0.9)) },
  spacingBetweenFieldRowsM: { median: r2(quant(gapsBetween, 0.5)) },
  detectorRowSpacingM: { median: r2(quant(okDets.map(d => d.rowSpacingM!), 0.5)) }, detectorPlantSpacingM: { median: r2(quant(okDets.map(d => d.plantSpacingM!), 0.5)) },
};
console.log("\nRows:", JSON.stringify(rowStats, null, 1));

// ------------------------------------------------------------------------------------------------------------------
// 4. DJI_0301 hand labels against trees reconciled WITHOUT DJI_0301
// ------------------------------------------------------------------------------------------------------------------
const LABELS = join(OUT, "../../../evaluation/groundtruth/image1/DJI_0301.labels.json");
let labelStats: Record<string, unknown> = { note: "no labels" };
const f301 = frames.get("DJI_0301");
if (f301 && existsSync(LABELS)) {
  const others = clusterMatches(pairsFor(names.filter(n2 => n2 !== "DJI_0301")), 0.6).filter(c => c.views.length >= 2);
  const crops = (JSON.parse(readFileSync(LABELS, "utf8")).labels as { cls: string; x: number; y: number }[]).filter(l => l.cls === "crop");
  const dists: number[] = [];
  for (const l of crops) {
    let best = Infinity;
    for (const c of others) {
      const o = { lat: c.lat, lng: c.lng, altM: 0 };
      const C = cameraCentreIn(f301, o), d = worldRay(f301, l.x, l.y)!;
      const s = (c.altM - C[2]) / d[2];
      best = Math.min(best, Math.hypot(C[0] + s * d[0], C[1] + s * d[1]));
    }
    dists.push(best);
  }
  labelStats = {
    labelledTrees: crops.length, reconciledTreesWithout0301: others.length,
    within06m: dists.filter(d => d <= 0.6).length, within10m: dists.filter(d => d <= 1.0).length, within15m: dists.filter(d => d <= 1.5).length,
    medianM: r3(quant(dists, 0.5)),
    note: "labels mark the trunk, rings the crown centre: the earlier audit found the two within 1.2 m for 97 of 104",
  };
}
console.log("\nDJI_0301 labels:", JSON.stringify(labelStats, null, 1));

writeFileSync(join(DIR, "results.json"), JSON.stringify({ photos: dets.length, read: okDets.length, failed: dets.filter(d => !d.ok).map(d => ({ name: d.name, reason: d.reason })), trees: treeStats, rows: rowStats, labels: labelStats }, null, 1));
// For the viewer: crowns per photo (flat), reconciled trees, field rows.
const ll = (e: number, nn: number) => { const lat0 = (model.origin.lat * Math.PI) / 180; return [+(model.origin.lat + (nn / 6378137) * (180 / Math.PI)).toFixed(8), +(model.origin.lng + (e / (6378137 * Math.cos(lat0))) * (180 / Math.PI)).toFixed(8)]; };
writeFileSync(join(DIR, "view.json"), JSON.stringify({
  crowns: Object.fromEntries([...treeObjects].map(([k, objs]) => [k, objs.map(o => o.outline.map(p => [+p.lat.toFixed(7), +p.lng.toFixed(7)]))])),
  trees: clusters.map(c => { const rs = c.views.map(v => Math.sqrt(treeOf.get(`${v.frame}#${v.objectId}`)!.areaM2 / Math.PI)); return [+c.lat.toFixed(8), +c.lng.toFixed(8), c.views.length, r2(c.altM - groundAlt), r2(rs.reduce((s, x) => s + x, 0) / rs.length)]; }),
  rows: groups.map(g => { const ends = g.flatMap(l => [[l.e1, l.n1], [l.e2, l.n2]]); const ux = Math.cos(th0), uy = Math.sin(th0); const t = ends.map(([e, nn]) => e * ux + nn * uy); const m = g.reduce((s, l) => s + l.rho, 0) / g.length; const lo = Math.min(...t), hi = Math.max(...t); return { photos: new Set(g.map(l => l.frame)).size, line: [ll(lo * ux - m * Math.sin(th0), lo * uy + m * Math.cos(th0)), ll(hi * ux - m * Math.sin(th0), hi * uy + m * Math.cos(th0))] }; }),
}));
console.log(`\nwritten ${DIR}`);
