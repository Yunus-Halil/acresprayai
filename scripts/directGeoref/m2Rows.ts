// Milestone 2: rows and trees in every photograph, and one field-wide row map, without inventing rows.
//
//   npx vite-node scripts/directGeoref/m2Rows.ts -- [--redo]
//
// Per photograph (quarter size, the reference cameras of experiment 1):
//   pass 1  the app's tree-row reader (default rules) seeds the planting layout fitter: the chain experiment 3 ran
//   pass 2  a photo the reader refused is read again with a lower size share (young trees kept); the result is kept
//           only when its row direction, row spacing and plant spacing agree with the field read in pass 1
//   pass 3  a photo still without rows is seeded from the field: three trees reconciled from OTHER photographs that
//           fall inside it (two neighbours in a row, one in the next row) seed the fitter, as an operator's three
//           marks do in the app; the photo's own pixels then decide what stands where
// Field-wide: every photo's fitted trees are reconciled into one object per tree; field rows are the trees grouped
// across the planting direction; a row needs 4 observed trees and 2 photographs or it is dropped (with the reason);
// inside a row, a gap is filled with INFERRED positions only where both neighbouring rows hold trees at those places
// (the planting pattern) and the row has observed trees on both sides; rows are never extended past their ends.
// Writes m2/{diagnosis.json, perPhoto.json, trees.json, rows.json, report.json}.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GeorefFrame, type Observation, type ReconciledObject, groundToPixel, pixelToGround, reconcile } from "../../src/lib/directGeoref";
import { MIN_ROW_SIZE_SHARE, type RowReadTraceLog, coverMask, fieldRowsFromPixels, shadowMask, vegetationMask } from "../../src/lib/weedVision/fieldRows";
import { proposeFromRows } from "../../src/lib/weedVision/layout/readLayout";
import { fitLayoutAll, latticeFromClicks, layoutsToFieldRows, mergeLayouts, rasterFromMask, type LayoutRaster } from "../../src/lib/weedVision/layout/plantingLayout";
import { mercatorPx } from "../../src/lib/weedVision/mapRun";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { OUT, loadReference, quant, quarterPixels, r2, r3 } from "./common";

const argv = process.argv.slice(2);
const DIR = join(OUT, "m2");
mkdirSync(join(DIR, "photos"), { recursive: true });
const { frames, model } = loadReference();
const groundAlt = model.globals.groundOffsetM;
const origin = model.origin;
const DOWN = 4, Z = 22;
const RELAXED_SHARE = 0.1;

type Tree = { u: number; v: number; rM: number; rPx: number; state: string; merged: boolean };
type Line = { u1: number; v1: number; u2: number; v2: number };
type PhotoRead = {
  name: string; source: "reader" | "reader, young trees kept" | "seeded from the field" | "none"; reason?: string;
  defaultTrace?: RowReadTraceLog; rowSpacingM?: number; plantSpacingM?: number; directionGroundDeg?: number;
  trees: Tree[]; lines: Line[];
};

// ------------------------------------------------------------------------------------------------------------------
// The fitter on one photograph, from a reader result or from given seeds (quarter-size pixels).
// ------------------------------------------------------------------------------------------------------------------
type Prepared = { px: ReturnType<typeof quarterPixels>; f: GeorefFrame; mpp: number; k: number; left: number; top: number; r: LayoutRaster };
function prepare(name: string): Prepared {
  const px = quarterPixels(name, DOWN), f = frames.get(name)!;
  const mpp = ((f.pose.altM - groundAlt) / f.intrinsics.fx) * DOWN;
  const [cx, cy] = mercatorPx(f.pose.lat, f.pose.lng, Z);
  const left = Math.round(cx - px.width / 2), top = Math.round(cy - px.height / 2);
  const k = Math.max(1, Math.round(0.08 / mpp));
  const ring: [number, number][] = [[left, top], [left + px.width, top], [left + px.width, top + px.height], [left, top + px.height]];
  const r = rasterFromMask(vegetationMask(px), px.width, px.height, k, Z, left, top, mpp, [ring], shadowMask(px), coverMask(px));
  return { px, f, mpp, k, left, top, r };
}
function fit(p: Prepared, clicksQuarterPx: [number, number][]): { trees: Tree[]; lines: Line[] } | null {
  const clicks = clicksQuarterPx.map(([x, y]) => [x / p.k, y / p.k] as [number, number]);
  const L0 = latticeFromClicks(clicks[0], clicks[1], clicks[2]);
  if (!L0) return null;
  const fits = fitLayoutAll(L0, p.r, clicks);
  const merged = mergeLayouts(fits);
  const rows = layoutsToFieldRows(fits, p.r);
  const o = (q: number) => q * DOWN;
  return {
    trees: merged.flatMap(m => m.plants).map(t => ({ u: o((t.x + 0.5) * p.k), v: o((t.y + 0.5) * p.k), rM: t.r * p.r.mpp, rPx: o(t.r * p.k), state: t.state, merged: t.merged })),
    lines: (rows?.ctx.lines ?? []).map(l => ({ u1: o(l.x1 + 0.5), v1: o(l.y1 + 0.5), u2: o(l.x2 + 0.5), v2: o(l.y2 + 0.5) })),
  };
}
function fromReader(p: Prepared, share: number, trace?: RowReadTraceLog) {
  const fr = fieldRowsFromPixels(p.px, p.mpp, trace, share);
  if (!fr) return null;
  const prop = proposeFromRows({ ...fr, z: Z, left: p.left, top: p.top, mpp: p.mpp });
  if (!prop) return null;
  const clicks = prop.points.map(q => { const [X, Y] = mercatorPx(q.lat, q.lng, Z); return [X - p.left, Y - p.top] as [number, number]; });
  const res = fit(p, clicks);
  if (!res) return null;
  // The rows' direction on the ground: the image direction at the photo centre, projected.
  const th = (fr.directionDeg * Math.PI) / 180, cu = p.f.intrinsics.cx, cv = p.f.intrinsics.cy;
  const a = pixelToGround(p.f, cu, cv), b = pixelToGround(p.f, cu + 400 * Math.cos(th), cv + 400 * Math.sin(th));
  const dir = a && b ? (((Math.atan2(b.northM - a.northM, b.eastM - a.eastM) * 180) / Math.PI) % 180 + 180) % 180 : NaN;
  return { ...res, rowSpacingM: fr.spacingM, plantSpacingM: fr.seedSpacingM, directionGroundDeg: dir };
}

// ------------------------------------------------------------------------------------------------------------------
// Pass 1
// ------------------------------------------------------------------------------------------------------------------
const reads = new Map<string, PhotoRead>();
const cachePath = (n: string) => join(DIR, "photos", `${n}.json`);
const prepared = new Map<string, Prepared>();
const prep = (n: string) => { let p = prepared.get(n); if (!p) { p = prepare(n); prepared.set(n, p); } return p; };
const t0 = Date.now();
for (const name of frames.keys()) {
  if (existsSync(cachePath(name)) && !argv.includes("--redo")) {
    const c = JSON.parse(readFileSync(cachePath(name), "utf8")) as PhotoRead;
    if (c.source === "reader") { reads.set(name, c); continue; }
  }
  const trace: RowReadTraceLog = { blocks: [] };
  const r = fromReader(prep(name), MIN_ROW_SIZE_SHARE, trace);
  const read: PhotoRead = r ? { name, source: "reader", trees: r.trees, lines: r.lines, rowSpacingM: r.rowSpacingM, plantSpacingM: r.plantSpacingM, directionGroundDeg: r.directionGroundDeg } : { name, source: "none", defaultTrace: trace, trees: [], lines: [] };
  reads.set(name, read);
  if (read.source === "reader") writeFileSync(cachePath(name), JSON.stringify(read));
}
const pass1 = [...reads.values()].filter(r => r.source === "reader");
// Why the reader refused: the first planting it tried, both directions, and where each stopped.
writeFileSync(join(DIR, "diagnosis.json"), JSON.stringify([...reads.values()].filter(r => r.source === "none").map(r => ({ name: r.name, candidates: r.defaultTrace?.candidates, sizeRefM2: r.defaultTrace?.sizeRef, firstBlock: r.defaultTrace?.blocks[0] ?? [] })), null, 1));
console.log(`pass 1 (reader, default rules): ${pass1.length}/${reads.size} photographs (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

// ------------------------------------------------------------------------------------------------------------------
// The field from pass 1: direction, spacings, reconciled trees.
// ------------------------------------------------------------------------------------------------------------------
const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
const circMedian = (v: number[]) => { const ref = quant(v, 0.5); return quant(v.map(x => (angDiff(x, ref) === Math.abs(x - ref) ? x : x > ref ? x - 180 : x + 180)), 0.5); };
function treesToObservations(rs: PhotoRead[]): Observation[] {
  return rs.flatMap(r => {
    const f = frames.get(r.name)!, { width: w, height: h } = f.intrinsics;
    return r.trees.map((t, i) => ({ frame: r.name, id: i + 1, u: t.u, v: t.v, sizeM: 2 * t.rM, areaM2: Math.PI * t.rM * t.rM, touchesEdge: t.u - t.rPx < 0 || t.v - t.rPx < 0 || t.u + t.rPx > w || t.v + t.rPx > h, data: { state: t.state, merged: t.merged, rM: t.rM } }));
  });
}
const field1 = {
  directionDeg: circMedian(pass1.map(r => r.directionGroundDeg!).filter(Number.isFinite)),
  rowSpacingM: quant(pass1.map(r => r.rowSpacingM!), 0.5),
  plantSpacingM: quant(pass1.map(r => r.plantSpacingM!), 0.5),
};
const trees1 = reconcile(treesToObservations(pass1), frames, { maxHeightM: 6 }).filter(t => t.seenBy >= 2);
console.log(`field from pass 1: rows run ${r2(field1.directionDeg)} deg (from east), ${r2(field1.rowSpacingM)} m apart, plants ${r2(field1.plantSpacingM)} m apart; ${trees1.length} trees reconciled from 2+ photos`);

// ------------------------------------------------------------------------------------------------------------------
// Passes 2 and 3 for the photographs the reader refused.
// ------------------------------------------------------------------------------------------------------------------
const thF = (field1.directionDeg * Math.PI) / 180;
let ux = Math.cos(thF), uy = Math.sin(thF);
const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };
function seedsFor(name: string): { clicks: [number, number][]; seedTrees: number[] } | null {
  const f = frames.get(name)!, { width: w, height: h } = f.intrinsics;
  const inside = trees1.map(t => {
    const px = groundToPixel(f, t.lat, t.lng, groundAlt + (t.heightM ?? 1));
    const [e, n] = enOf(t.lat, t.lng);
    return px && px.u > 0.05 * w && px.v > 0.05 * h && px.u < 0.95 * w && px.v < 0.95 * h ? { t, u: px.u, v: px.v, along: e * ux + n * uy, across: -e * uy + n * ux } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (inside.length < 3) return null;
  const cu = w / 2, cv = h / 2;
  inside.sort((a, b) => Math.hypot(a.u - cu, a.v - cv) - Math.hypot(b.u - cu, b.v - cv));
  const S = field1.plantSpacingM, R = field1.rowSpacingM;
  for (const a of inside.slice(0, 25)) {
    const b = inside.find(q => q !== a && Math.abs(Math.abs(q.along - a.along) - S) < 0.25 * S && Math.abs(q.across - a.across) < 0.3 * S);
    if (!b) continue;
    const c = inside.filter(q => Math.abs(Math.abs(q.across - a.across) - R) < 0.2 * R && Math.abs(q.along - a.along) <= 0.5 * S).sort((p, q) => Math.abs(p.along - a.along) - Math.abs(q.along - a.along))[0];
    if (!c) continue;
    return { clicks: [a, b, c].map(q => [q.u / DOWN, q.v / DOWN] as [number, number]), seedTrees: [a.t.id, b.t.id, c.t.id] };
  }
  return null;
}
const counts = { relaxed: 0, relaxedRejected: 0, seeded: 0, none: 0 };
for (const r of reads.values()) {
  if (r.source === "reader") continue;
  const p = prep(r.name);
  const b = fromReader(p, RELAXED_SHARE);
  if (b) {
    const agree = angDiff(b.directionGroundDeg, field1.directionDeg) <= 3 && Math.abs(b.rowSpacingM - field1.rowSpacingM) <= 0.15 * field1.rowSpacingM && Math.abs(b.plantSpacingM - field1.plantSpacingM) <= 0.15 * field1.plantSpacingM;
    if (agree) { Object.assign(r, { source: "reader, young trees kept", trees: b.trees, lines: b.lines, rowSpacingM: b.rowSpacingM, plantSpacingM: b.plantSpacingM, directionGroundDeg: b.directionGroundDeg }); counts.relaxed++; continue; }
    counts.relaxedRejected++;
    r.reason = `lower size share read rows ${r2(b.rowSpacingM)} x ${r2(b.plantSpacingM)} m at ${r2(b.directionGroundDeg)} deg, which disagrees with the field`;
  }
  const s = seedsFor(r.name);
  if (s) {
    const res = fit(p, s.clicks);
    if (res && res.trees.length) { Object.assign(r, { source: "seeded from the field", trees: res.trees, lines: res.lines, reason: `seeded by trees ${s.seedTrees.join(", ")} reconciled from other photographs` }); counts.seeded++; continue; }
  }
  r.reason = (r.reason ? `${r.reason}; ` : "") + (s ? "the seeded fit found nothing" : "no three reconciled trees inside it to seed from");
  counts.none++;
}
for (const r of reads.values()) writeFileSync(cachePath(r.name), JSON.stringify({ ...r, defaultTrace: undefined }));
const readAll = [...reads.values()].filter(r => r.source !== "none");
console.log(`pass 2 (young trees kept, field agrees): ${counts.relaxed} (${counts.relaxedRejected} read but disagreed); pass 3 (seeded from the field): ${counts.seeded}; still unread: ${counts.none}`);
for (const r of reads.values()) if (r.source !== "reader") console.log(`  ${r.name}: ${r.source}${r.reason ? ` (${r.reason})` : ""}, ${r.trees.length} trees`);

// ------------------------------------------------------------------------------------------------------------------
// Trees, field-wide
// ------------------------------------------------------------------------------------------------------------------
const objs = reconcile(treesToObservations(readAll), frames, { maxHeightM: 6 });
const observed = (o: ReconciledObject) => o.seenBy >= 2 || o.members.some(m => m.data?.state === "confirmed");
const trees = objs.filter(observed);
console.log(`trees: ${objs.length} objects from ${readAll.length} photographs; ${trees.length} observed (2+ photographs or a confirmed crown); ${objs.length - trees.length} pattern-only positions seen in one photo, left out`);

// ------------------------------------------------------------------------------------------------------------------
// Field rows from the trees
// ------------------------------------------------------------------------------------------------------------------
type T2 = { o: ReconciledObject; along: number; across: number };
// The planting direction, refined on the trees themselves: the angle (within 2 deg of the photos' median) at which
// their offsets across the rows stack most sharply. Over 150 m, half a degree is 1.3 m of drift across a row.
const stackScore = (th: number) => { const bins = new Map<number, number>(); for (const o of trees) { const [e, n] = enOf(o.lat, o.lng); const k = Math.round((-e * Math.sin(th) + n * Math.cos(th)) / 0.2); bins.set(k, (bins.get(k) ?? 0) + 1); } let sc = 0; for (const v of bins.values()) sc += v * v; return sc; };
let thBest = thF, scBest = -1;
for (let d = -2; d <= 2.0001; d += 0.02) { const th = thF + (d * Math.PI) / 180, sc = stackScore(th); if (sc > scBest) { scBest = sc; thBest = th; } }
ux = Math.cos(thBest); uy = Math.sin(thBest);
const directionRefinedDeg = (thBest * 180) / Math.PI;
const t2: T2[] = trees.map(o => { const [e, n] = enOf(o.lat, o.lng); return { o, along: e * ux + n * uy, across: -e * uy + n * ux }; });
// Rows = peaks of the across-offset histogram (0.2 m bins, smoothed), at least 0.6 row spacings apart; a tree joins
// the nearest peak within 0.3 row spacings, else it is off the rows.
const R0 = field1.rowSpacingM, binW = 0.2;
const lo = Math.min(...t2.map(t => t.across)) - 2, nb = Math.ceil((Math.max(...t2.map(t => t.across)) + 2 - lo) / binW);
const hist = new Float64Array(nb);
for (const t of t2) hist[Math.floor((t.across - lo) / binW)]++;
const sm = hist.map((_, i) => { let v = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < nb) v += hist[j] * Math.exp(-(k * k) / 2); } return v; });
const peaks: number[] = [];
const order = [...sm.keys()].sort((x, y) => sm[y] - sm[x]);
for (const i of order) { if (sm[i] < 3) break; const c = lo + (i + 0.5) * binW; if (peaks.every(p => Math.abs(p - c) >= 0.6 * R0)) peaks.push(c); }
peaks.sort((x, y) => x - y);
const groups: T2[][] = peaks.map(() => []);
const offRow: T2[] = [];
for (const t of t2) { let bi = -1, bd = Infinity; peaks.forEach((p, i) => { const d = Math.abs(t.across - p); if (d < bd) { bd = d; bi = i; } }); if (bi >= 0 && bd <= 0.3 * R0) groups[bi].push(t); else offRow.push(t); }
type FieldRow = { id: number; offsetM: number; trees: T2[]; photos: Set<string>; photosOwn: Set<string>; kept: boolean; reason?: string };
const rows: FieldRow[] = groups.filter(g => g.length).map((g, i) => {
  const photos = new Set(g.flatMap(t => t.o.members.map(m => m.frame)));
  const photosOwn = new Set([...photos].filter(n => reads.get(n)!.source !== "seeded from the field"));
  return { id: i + 1, offsetM: quant(g.map(t => t.across), 0.5), trees: g.sort((a, b) => a.along - b.along), photos, photosOwn, kept: true };
});
// A row is kept on evidence: 4 observed trees, 2 photographs, straight (trees within 0.5 m of one line, sd), and
// filled (observed trees on at least 35 % of the plant positions along its length). Scattered objects strung along
// an offset (the wheat edge, weed clumps) fail the last two.
const ROW_MIN_TREES = 4, ROW_MIN_PHOTOS = 2, ROW_MAX_SD_M = 0.5, ROW_MIN_FILL = 0.35;
for (const r of rows) {
  const offs = r.trees.map(t => t.across - r.offsetM), sd = Math.sqrt(offs.reduce((a, x) => a + x * x, 0) / offs.length);
  const len = r.trees[r.trees.length - 1].along - r.trees[0].along + field1.plantSpacingM;
  const fill = r.trees.length / Math.max(1, len / field1.plantSpacingM);
  if (r.trees.length < ROW_MIN_TREES) { r.kept = false; r.reason = `${r.trees.length} observed trees (${ROW_MIN_TREES} needed)`; }
  else if (r.photos.size < ROW_MIN_PHOTOS) { r.kept = false; r.reason = "seen in one photograph only"; }
  else if (sd > ROW_MAX_SD_M) { r.kept = false; r.reason = `trees ${sd.toFixed(2)} m off one straight line (sd; ${ROW_MAX_SD_M} allowed)`; }
  else if (fill < ROW_MIN_FILL) { r.kept = false; r.reason = `observed trees on ${Math.round(fill * 100)} % of the positions along it (${ROW_MIN_FILL * 100} % needed)`; }
}
const kept = rows.filter(r => r.kept);
// Inferred positions inside a row: a gap of k > 1.5 plant spacings with observed trees at both ends, filled at
// whole spacings only where BOTH neighbouring kept rows hold an observed tree within half a spacing of the position.
const S = field1.plantSpacingM;
const inferred: { row: number; along: number; across: number }[] = [];
kept.forEach((r, i) => {
  const nb = [kept[i - 1], kept[i + 1]].filter(q => q && Math.abs(Math.abs(q.offsetM - r.offsetM) - field1.rowSpacingM) < 0.3 * field1.rowSpacingM);
  if (nb.length < 2) return;
  for (let j = 1; j < r.trees.length; j++) {
    const a = r.trees[j - 1].along, b = r.trees[j].along, k = Math.round((b - a) / S);
    if (k < 2 || (b - a) < 1.5 * S) continue;
    for (let m = 1; m < k; m++) {
      const pos = a + ((b - a) * m) / k;
      if (nb.every(q => q.trees.some(t => Math.abs(t.along - pos) < 0.5 * S))) inferred.push({ row: r.id, along: pos, across: r.offsetM });
    }
  }
});
const llOf = (along: number, across: number) => { const e = along * ux - across * uy, n = along * uy + across * ux, lat0 = (origin.lat * Math.PI) / 180; return { lat: origin.lat + (n / 6378137) * (180 / Math.PI), lng: origin.lng + (e / (6378137 * Math.cos(lat0))) * (180 / Math.PI) }; };
const rowsOut = rows.map(r => {
  const a0 = r.trees[0].along - S / 2, a1 = r.trees[r.trees.length - 1].along + S / 2;
  const offs = r.trees.map(t => t.across - r.offsetM);
  return {
    id: r.id, kept: r.kept, reason: r.reason ?? null, trees: r.trees.length, inferred: inferred.filter(x => x.row === r.id).length,
    photos: r.photos.size, photosWithOwnRows: r.photosOwn.size, lengthM: r2(a1 - a0), straightnessSdM: r3(Math.sqrt(offs.reduce((s, x) => s + x * x, 0) / offs.length)),
    line: [llOf(a0, r.offsetM), llOf(a1, r.offsetM)].map(p => [+p.lat.toFixed(8), +p.lng.toFixed(8)]),
    treeIds: r.trees.map(t => t.o.id),
  };
});
const gapsBetween = kept.slice(1).map((r, i) => r.offsetM - kept[i].offsetM);
const report = {
  photographs: reads.size,
  readBy: { reader: pass1.length, youngTreesKept: counts.relaxed, seededFromField: counts.seeded, unread: counts.none },
  unread: [...reads.values()].filter(r => r.source === "none").map(r => ({ name: r.name, reason: r.reason })),
  field: { directionDeg: r2(field1.directionDeg), directionRefinedDeg: r2(directionRefinedDeg), rowSpacingM: r2(field1.rowSpacingM), plantSpacingM: r2(field1.plantSpacingM) },
  treesOffRows: offRow.length,
  trees: { objects: objs.length, observed: trees.length, seenBy: { median: quant(trees.map(t => t.seenBy), 0.5) }, viewSpreadM: r3(quant(trees.map(t => t.viewSpreadM), 0.5)), heightM: r2(quant(trees.map(t => t.heightM ?? NaN), 0.5)) },
  rows: {
    candidates: rows.length, kept: kept.length, dropped: rows.filter(r => !r.kept).map(r => ({ id: r.id, reason: r.reason })),
    spacingBetweenKeptRowsM: { median: r2(quant(gapsBetween, 0.5)), min: r2(Math.min(...gapsBetween)), max: r2(Math.max(...gapsBetween)) },
    treesOffLineSdM: r3(quant(rowsOut.filter(r => r.kept).map(r => r.straightnessSdM), 0.5)),
    inferredPositions: inferred.length,
  },
};
writeFileSync(join(DIR, "trees.json"), JSON.stringify(objs.map(o => ({ id: o.id, lat: o.lat, lng: o.lng, heightM: o.heightM, crownRadiusM: o.sizeM / 2, seenBy: o.seenBy, coveredBy: o.coveredBy, viewSpreadM: o.viewSpreadM, sizeCv: o.sizeCv, observed: observed(o), members: o.members.map(m => ({ frame: m.frame, u: m.u, v: m.v, rM: m.data?.rM, state: m.data?.state })) }))));
writeFileSync(join(DIR, "rows.json"), JSON.stringify({ field: { ...field1, directionRefinedDeg }, rows: rowsOut, offRowTreeIds: offRow.map(t => t.o.id), inferred: inferred.map(x => ({ row: x.row, ...llOf(x.along, x.across) })) }));
writeFileSync(join(DIR, "report.json"), JSON.stringify(report, null, 1));
console.log("\n" + JSON.stringify(report, null, 1));
