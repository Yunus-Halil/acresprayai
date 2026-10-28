// The boundary engine measured: the apricot flight's inferred block against the metrics the brief asks for, its
// determinism and runtime, and a set of adversarial ablations (crop objects removed, a neighbouring block or a
// hedge inserted, plants removed near the row ends, the photographs' coverage cut short, the trees jittered).
// The rule under test: the engine must become LESS CONFIDENT before it becomes geometrically absurd.
//
//   npx vite-node scripts/directGeoref/boundaryBench.ts -- [--id apricot-2021-04-27] [--reference boundary.geojson]
//
// Reads boundary/measures.{json,bin} (boundaryEvidence.ts) and the twin; writes boundary/bench.{json,md}. The
// reference is optional: a hand-drawn GeoJSON polygon (lng, lat) for the overlap and distance metrics. Without one
// those metrics are reported as "no reference" and never guessed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BoundaryResult, type FieldPoint, distToRing, inferBoundaryFromMeasures, polygonArea } from "../../src/lib/fieldTwin/boundary";
import type { EvidenceMeasures } from "../../src/lib/fieldTwin/boundaryEvidence";
import { localFrame, pointInRing } from "../../src/lib/fieldTwin/intelligence";
import type { TwinBundle, TwinTree } from "../../src/lib/fieldTwin/types";
import { BOUNDARY_DIR as DIR, cloneMeasures, loadMeasures, loadTwin } from "./boundaryCommon";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ID = arg("id", "apricot-2021-04-27");
const REF = arg("reference", "");

const twin0 = loadTwin(ID);
const fr = localFrame(twin0);
const { header, measures: measures0 } = loadMeasures();
const S = twin0.field.plantSpacingM;
const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return x; };
const toField = (t: { lat: number; lng: number }): FieldPoint => fr.toField(...fr.toLocal(t.lat, t.lng));
const fromField = (al: number, ac: number): [number, number] => { const [e, n] = fr.fromField(al, ac); return fr.toLatLng(e, n); };

// ------------------------------------------------------------------------------------------------------------------
// Metrics
// ------------------------------------------------------------------------------------------------------------------
function samplePoints(ring: FieldPoint[], step: number): FieldPoint[] {
  const out: FieldPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const pct95 = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] : NaN; };
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** Overlap and boundary distances between two rings in the field frame. */
function compareRings(pred: FieldPoint[], ref: FieldPoint[], cellM = 0.25) {
  const pts = [...pred, ...ref];
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  let both = 0, either = 0;
  for (let y = y0 + cellM / 2; y < y1; y += cellM) for (let x = x0 + cellM / 2; x < x1; x += cellM) { const a = pointInRing(x, y, pred), b = pointInRing(x, y, ref); if (a && b) both++; if (a || b) either++; }
  const dPR = samplePoints(pred, 0.25).map(p => distToRing(p, ref)), dRP = samplePoints(ref, 0.25).map(p => distToRing(p, pred));
  const all = [...dPR, ...dRP];
  return { iou: either ? both / either : 0, meanDistM: mean(all), p95DistM: pct95(all), maxDistM: Math.max(...all), meanPredToRefM: mean(dPR), meanRefToPredM: mean(dRP), areaBias: Math.abs(polygonArea(pred) - polygonArea(ref)) / polygonArea(ref) };
}

type Run = { result: BoundaryResult; classifyMs: number; totalMs: number; fieldTreeIds: Set<number>; rawFieldTreeIds: Set<number> };

/** One inference on a twin and its measurements; the field's own trees are those on the used rows, not in cover and not trimmed. */
function run(twin: TwinBundle, measures: EvidenceMeasures): Run {
  const t0 = performance.now();
  const { result, classifyMs, raster } = inferBoundaryFromMeasures(twin, measures, {}, fr);
  const totalMs = performance.now() - t0;
  if (!result) throw new Error("no reliable row");
  void raster;
  const used = new Set(result.rowsUsed);
  // The field's trees by the engine's own accounting: on a used row, not standing in dense cover, not trimmed from a
  // row's end. `rawFieldTreeIds` is every tree with a used row's id, before that judgement.
  const left = new Set([...result.excludedTrees.inCover, ...result.excludedTrees.trimmed]);
  const rawFieldTreeIds = new Set<number>(), fieldTreeIds = new Set<number>();
  for (const t of twin.trees) if (t.rowId != null && used.has(t.rowId)) { rawFieldTreeIds.add(t.id); if (!left.has(t.id)) fieldTreeIds.add(t.id); }
  return { result, classifyMs, totalMs, fieldTreeIds, rawFieldTreeIds };
}

/** Crop inclusion: recall of the field's trees inside the ring; precision of the trees inside that are the field's. */
function cropInclusion(twin: TwinBundle, ring: FieldPoint[], fieldIds: Set<number>, excluded: Set<number>) {
  let fieldIn = 0, fieldAll = 0, inAll = 0;
  for (const t of twin.trees) {
    if (excluded.has(t.id)) continue;
    const [al, ac] = toField(t);
    const inside = pointInRing(al, ac, ring);
    if (inside) inAll++;
    if (fieldIds.has(t.id)) { fieldAll++; if (inside) fieldIn++; }
  }
  return { recall: fieldAll ? fieldIn / fieldAll : NaN, precision: inAll ? fieldIn / inAll : NaN, fieldTrees: fieldAll, insideTrees: inAll, foreignInside: inAll - fieldIn };
}

const summary = (r: BoundaryResult) => ({
  areaHa: +(r.areaM2 / 10_000).toFixed(4), uncertaintyHa: +(r.uncertaintyM2 / 10_000).toFixed(4), vertices: r.vertices.length, confidence: r.confidence.overall, level: r.confidence.level, meanConfidence: r.confidence.mean,
  codes: r.failureModes.map(f => f.code), rowsUsed: r.rowsUsed.length, lengthBySupport: Object.fromEntries(Object.entries(r.stats.lengthBySupport).map(([k, v]) => [k, +v.toFixed(3)])),
  inside: r.stats.inside ? Object.fromEntries(Object.entries(r.stats.inside).map(([k, v]) => [k, +v.toFixed(3)])) : null, offRowTreesInside: r.stats.offRowTreesInside, onRowTreesOutside: r.stats.onRowTreesOutside,
  stability: r.stability ? { areaMinHa: +(r.stability.areaMinM2 / 10_000).toFixed(4), areaMaxHa: +(r.stability.areaMaxM2 / 10_000).toFixed(4), medianShiftM: +r.stability.medianShiftM.toFixed(2), maxShiftM: +r.stability.maxShiftM.toFixed(2) } : null,
  components: r.components.map(c => ({ rows: c.rows.length, trees: c.trees, score: +c.score.toFixed(3), chosen: c.chosen, separatedBy: c.separatedBy })),
  processingMs: +r.processingMs.toFixed(0),
});

// ------------------------------------------------------------------------------------------------------------------
// The nominal run: twice for determinism, timed.
// ------------------------------------------------------------------------------------------------------------------
console.log(`${ID}: ${twin0.trees.length} trees, ${twin0.rows.filter(r => r.kept).length} kept rows, ${header.photos.length} photographs, measures ${header.width} x ${header.height} at ${header.cellM} m`);
const a = run(twin0, measures0), b = run(twin0, measures0);
const nominal = a.result;
const deterministic = JSON.stringify(a.result.ringField) === JSON.stringify(b.result.ringField) && a.result.confidence.overall === b.result.confidence.overall && JSON.stringify(a.result.failureModes) === JSON.stringify(b.result.failureModes);
const nominalIncl = cropInclusion(twin0, nominal.ringField, a.fieldTreeIds, new Set());
const nominalRaw = cropInclusion(twin0, nominal.ringField, a.rawFieldTreeIds, new Set());
console.log(`nominal: ${(nominal.areaM2 / 10_000).toFixed(3)} ha, ${nominal.vertices.length} vertices, confidence ${nominal.confidence.overall} (${nominal.confidence.level}), codes ${nominal.failureModes.map(f => f.code).join(", ") || "none"}`);
console.log(`  deterministic: ${deterministic}; classification ${a.classifyMs.toFixed(0)} / ${b.classifyMs.toFixed(0)} ms, inference ${a.result.processingMs.toFixed(0)} / ${b.result.processingMs.toFixed(0)} ms, whole pass ${a.totalMs.toFixed(0)} / ${b.totalMs.toFixed(0)} ms`);
console.log(`  crop inclusion: recall ${(100 * nominalIncl.recall).toFixed(2)} % of ${nominalIncl.fieldTrees} trees the engine counts as the field's (${(100 * nominalRaw.recall).toFixed(2)} % of all ${nominalRaw.fieldTrees} with a used row's id: ${nominal.excludedTrees.inCover.length} in dense cover and ${nominal.excludedTrees.trimmed.length} trimmed are left out), precision ${(100 * nominalIncl.precision).toFixed(2)} % (${nominalIncl.foreignInside} trees inside are not the field's)`);

// The reference, if one was drawn.
let reference: { ringField: FieldPoint[]; metrics: ReturnType<typeof compareRings>; vertices: number } | null = null;
if (REF) {
  if (!existsSync(REF)) throw new Error(`no reference at ${REF}`);
  const gj = JSON.parse(readFileSync(REF, "utf8"));
  const geom = gj.type === "FeatureCollection" ? gj.features[0].geometry : gj.type === "Feature" ? gj.geometry : gj;
  if (geom.type !== "Polygon") throw new Error(`the reference must be a Polygon, got ${geom.type}`);
  let ring: FieldPoint[] = (geom.coordinates[0] as [number, number][]).map(([lng, lat]) => fr.toField(...fr.toLocal(lat, lng)));
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  reference = { ringField: ring, metrics: compareRings(nominal.ringField, ring), vertices: ring.length };
  console.log(`  against the reference (${ring.length} vertices, ${(polygonArea(ring) / 10_000).toFixed(3)} ha): IoU ${reference.metrics.iou.toFixed(3)}, mean boundary distance ${reference.metrics.meanDistM.toFixed(2)} m, 95th ${reference.metrics.p95DistM.toFixed(2)} m, area bias ${(100 * reference.metrics.areaBias).toFixed(1)} %`);
}

// ------------------------------------------------------------------------------------------------------------------
// Ablations
// ------------------------------------------------------------------------------------------------------------------
type Ablation = { name: string; what: string; expect: string; twin: TwinBundle; measures: EvidenceMeasures; excludedIds?: Set<number> };
const usedRows = new Set(nominal.rowsUsed);
const rowGeom = new Map<number, { a0: number; a1: number; across: number }>();
for (const id of usedRows) {
  const pts = twin0.trees.filter(t => t.rowId === id).map(toField);
  rowGeom.set(id, { a0: Math.min(...pts.map(p => p[0])), a1: Math.max(...pts.map(p => p[0])), across: pts.map(p => p[1]).sort((p, q) => p - q)[pts.length >> 1] });
}
const geoms = [...rowGeom.values()];
const pitch = nominal.stats.rowPitchM;
const maxAcross = Math.max(...geoms.map(g => g.across)), minA0 = Math.min(...geoms.map(g => g.a0)), maxA1 = Math.max(...geoms.map(g => g.a1));
const spanMid = (minA0 + maxA1) / 2;
let nextId = Math.max(...twin0.trees.map(t => t.id)) + 1;
const mkTree = (al: number, ac: number, rowId: number | null): TwinTree => { const [lat, lng] = fromField(al, ac); return { id: nextId++, lat, lng, crownRadiusM: 1.1, heightM: 0.8, seenBy: 3, coveredBy: 4, viewSpreadM: 0.03, sizeCv: 0.05, rowId, evidence: [] }; };
const mkRow = (id: number, al0: number, al1: number, ac: number, trees: number): TwinBundle["rows"][number] => ({ id, kept: true, reason: null, line: [fromField(al0, ac), fromField(al1, ac)], trees, inferred: 0, photos: 10, lengthM: al1 - al0, straightnessSdM: 0.1 });
const withTrees = (keep: (t: TwinTree) => boolean): TwinBundle => ({ ...twin0, trees: twin0.trees.filter(keep) });
const removeShare = (share: number) => withTrees(t => hash(t.id) % 100 >= share * 100);
const insertBlock = (gapPitches: number, rows = 4, lengthM = 100): TwinBundle => {
  const t: TwinBundle = { ...twin0, trees: [...twin0.trees], rows: [...twin0.rows] };
  for (let k = 0; k < rows; k++) {
    const ac = maxAcross + gapPitches * pitch + k * pitch, id = 101 + k;
    const al0 = spanMid - lengthM / 2, al1 = spanMid + lengthM / 2;
    let n = 0;
    for (let al = al0; al <= al1; al += S) { t.trees.push(mkTree(al, ac, id)); n++; }
    t.rows.push(mkRow(id, al0, al1, ac, n));
  }
  return t;
};
const paintTrack = (m: EvidenceMeasures, across: number, widthM: number, al0: number, al1: number): EvidenceMeasures => {
  const c = cloneMeasures(m);
  for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
    const al = c.along0 + (i + 0.5) * c.cellM, ac = c.across0 + (j + 0.5) * c.cellM;
    if (al < al0 || al > al1 || Math.abs(ac - across) > widthM / 2) continue;
    const k = j * c.width + i;
    c.seen[k] = 1; c.cover[k] = 0; c.luma[k] = 170; c.sat[k] = 0.25;
  }
  return c;
};
const cutCoverage = (m: EvidenceMeasures, alongFrom: number): EvidenceMeasures => {
  const c = cloneMeasures(m);
  for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) if (c.along0 + (i + 0.5) * c.cellM > alongFrom) c.seen[j * c.width + i] = 0;
  return c;
};
const hedgeAlong = maxA1 + 3;
const hedgeTwin: TwinBundle = { ...twin0, trees: [...twin0.trees] };
const hedgeIds = new Set<number>();
for (let ac = Math.min(...geoms.map(g => g.across)) - 2; ac <= maxAcross + 2; ac += 3) { const t = mkTree(hedgeAlong, ac, null); hedgeIds.add(t.id); hedgeTwin.trees.push(t); }
const endTrimmed = (() => {
  const drop = new Set<number>();
  for (const id of usedRows) { const ts = twin0.trees.filter(t => t.rowId === id).map(t => ({ t, al: toField(t)[0] })).sort((p, q) => q.al - p.al); for (const x of ts.slice(0, 3)) drop.add(x.t.id); }
  return { twin: withTrees(t => !drop.has(t.id)), dropped: drop };
})();
const jittered: TwinBundle = { ...twin0, trees: twin0.trees.map(t => { const [al, ac] = toField(t); const h = hash(t.id); const [lat, lng] = fromField(al + ((h % 201) - 100) / 1000, ac + (((h >>> 8) % 201) - 100) / 1000); return { ...t, lat, lng }; }) };

const ablations: Ablation[] = [
  { name: "remove 10 % of the trees", what: "every tree whose id hashes into the lowest tenth is dropped", expect: "the block holds within a few percent; confidence may fall", twin: removeShare(0.1), measures: measures0 },
  { name: "remove 25 % of the trees", what: "a quarter dropped the same way", expect: "the block holds; the ends rest on fewer trees", twin: removeShare(0.25), measures: measures0 },
  { name: "remove 40 % of the trees", what: "two fifths dropped", expect: "SPARSE_OR_IRREGULAR_PLANTING; no catastrophic expansion", twin: removeShare(0.4), measures: measures0 },
  { name: "neighbouring block, 3 pitches away", what: "4 rows of 32 trees at the pitch, beyond the last side, a gap of 3 pitches", expect: "another block, separated by a gap of rows; ADJACENT_CULTIVATED_BLOCK_DETECTED; not merged", twin: insertBlock(3), measures: measures0 },
  { name: "neighbouring block, 2 pitches away, a track between", what: "the same 4 rows 2 pitches away with a 3 m track painted between", expect: "another block, separated by the ground between; not merged", twin: insertBlock(2), measures: paintTrack(measures0, maxAcross + pitch, 3, spanMid - 60, spanMid + 60) },
  { name: "neighbouring block, 2 pitches away, nothing between", what: "the same 4 rows 2 pitches away, the real ground between (the second planting's trees and its cover)", expect: "whatever the photographs show between decides; reported either way", twin: insertBlock(2), measures: measures0 },
  { name: "neighbouring block, 1 pitch away", what: "the same 4 rows continuing the planting at its own pitch", expect: "indistinguishable from the field by geometry: merged, and said so here", twin: insertBlock(1), measures: measures0 },
  { name: "hedge-like line of trees across the row ends", what: `${hedgeIds.size} trees off the rows every 3 m, 3 m beyond the last trees of the rows`, expect: "the row ends stop at the hedge (foreign); none of its trees inside", twin: hedgeTwin, measures: measures0 },
  { name: "plants removed near the row ends", what: `the last 3 trees of every used row dropped (${endTrimmed.dropped.size} trees)`, expect: "the end edge must not collapse to the last tree: the probes reach the same edge in the photographs", twin: endTrimmed.twin, measures: measures0, excludedIds: endTrimmed.dropped },
  { name: "image coverage cut short", what: `nothing seen beyond along ${(maxA1 - 15).toFixed(0)} m (15 m before the last trees)`, expect: "coverage support at the ends, BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE, no vertex beyond the cut", twin: twin0, measures: cutCoverage(measures0, maxA1 - 15) },
  { name: "tree positions jittered 10 cm", what: "every tree moved up to 10 cm along and across (deterministic)", expect: "the boundary moves a few centimetres", twin: jittered, measures: measures0 },
];

type AblationResult = { name: string; what: string; expect: string; summary: ReturnType<typeof summary>; areaChangePct: number; confidenceChange: number; newCodes: string[]; shiftM: { mean: number; p95: number; max: number }; inclusion: ReturnType<typeof cropInclusion>; foreignInserted?: number; graceful: boolean; seconds: number; notes: string[] };
const results: AblationResult[] = [];
for (const ab of ablations) {
  const t0 = performance.now();
  const r = run(ab.twin, ab.measures);
  const seconds = (performance.now() - t0) / 1000;
  const res = r.result;
  const d = samplePoints(res.ringField, 0.25).map(p => distToRing(p, nominal.ringField));
  const original = new Set(twin0.trees.map(t => t.id));
  const inserted = new Set(ab.twin.trees.filter(t => !original.has(t.id)).map(t => t.id));
  // The field's trees for recall: the nominal field's trees still present; precision counts inserted trees as not the field's.
  const present = new Set(ab.twin.trees.map(t => t.id));
  const fieldIds = new Set([...a.fieldTreeIds].filter(id => present.has(id)));
  const inclusion = cropInclusion(ab.twin, res.ringField, fieldIds, ab.excludedIds ?? new Set());
  const foreignInserted = inserted.size ? ab.twin.trees.filter(t => inserted.has(t.id) && pointInRing(...toField(t), res.ringField)).length : undefined;
  const areaChangePct = (100 * (res.areaM2 - nominal.areaM2)) / nominal.areaM2;
  const newCodes = res.failureModes.map(f => f.code).filter(c => !nominal.failureModes.some(f => f.code === c));
  const confidenceChange = res.confidence.overall - nominal.confidence.overall;
  const graceful = Math.abs(areaChangePct) <= 10 || confidenceChange <= -0.05 || newCodes.length > 0;
  const notes: string[] = [];
  if (res.rowsUsed.length !== nominal.rowsUsed.length) notes.push(`rows used ${res.rowsUsed.length} (nominal ${nominal.rowsUsed.length})`);
  for (const c of res.components) if (!c.chosen) notes.push(`another block: ${c.rows.length} rows, ${c.trees} trees, score ${c.score.toFixed(2)}, separated by ${c.separatedBy}`);
  if (foreignInserted != null) notes.push(`${foreignInserted} of ${inserted.size} inserted trees inside the block`);
  const ends = res.vertices.filter(v => v.side === "end1");
  if (ends.length) notes.push(`last-end margins: median ${ends.map(v => v.marginM).sort((p, q) => p - q)[ends.length >> 1].toFixed(1)} m, supports ${[...new Set(ends.map(v => v.support))].join("/")}`);
  results.push({ name: ab.name, what: ab.what, expect: ab.expect, summary: summary(res), areaChangePct: +areaChangePct.toFixed(2), confidenceChange: +confidenceChange.toFixed(3), newCodes, shiftM: { mean: +mean(d).toFixed(2), p95: +pct95(d).toFixed(2), max: +Math.max(...d).toFixed(2) }, inclusion, foreignInserted, graceful, seconds: +seconds.toFixed(2), notes });
  console.log(`${ab.name}: ${(res.areaM2 / 10_000).toFixed(3)} ha (${areaChangePct >= 0 ? "+" : ""}${areaChangePct.toFixed(1)} %), confidence ${res.confidence.overall} (${res.confidence.level}), shift mean ${mean(d).toFixed(2)} / p95 ${pct95(d).toFixed(2)} / max ${Math.max(...d).toFixed(2)} m, recall ${(100 * inclusion.recall).toFixed(1)} %, new codes ${newCodes.join(", ") || "none"}, ${graceful ? "graceful" : "NOT GRACEFUL"}${notes.length ? `; ${notes.join("; ")}` : ""}`);
}

// ------------------------------------------------------------------------------------------------------------------
// Report
// ------------------------------------------------------------------------------------------------------------------
const out = {
  id: ID, date: new Date().toISOString().slice(0, 10), photographs: header.photos.length, measures: { cellM: header.cellM, width: header.width, height: header.height, sampledMs: header.sampledMs },
  nominal: { ...summary(nominal), deterministic, classifyMs: [a.classifyMs, b.classifyMs].map(x => +x.toFixed(0)), inferenceMs: [a.result.processingMs, b.result.processingMs].map(x => +x.toFixed(0)), wholePassMs: [a.totalMs, b.totalMs].map(x => +x.toFixed(0)), inclusion: nominalIncl, inclusionRaw: nominalRaw, excluded: { inCover: nominal.excludedTrees.inCover.length, trimmed: nominal.excludedTrees.trimmed.length }, coverage: { anyViewHa: +(nominal.coverage.areaM2 / 10_000).toFixed(3), twoPlusHa: +(nominal.coverage.twoPlusAreaM2 / 10_000).toFixed(3), meanViews: +nominal.coverage.meanViews.toFixed(2) }, failureModes: nominal.failureModes },
  reference: reference ? { file: REF, vertices: reference.vertices, areaHa: +(polygonArea(reference.ringField) / 10_000).toFixed(4), ...reference.metrics } : null,
  ablations: results,
};
writeFileSync(join(DIR, "bench.json"), JSON.stringify(out, null, 1));
const pc = (v: number) => `${(100 * v).toFixed(1)} %`;
const target = (ok: boolean | null, text: string) => (ok == null ? `${text} (no reference)` : `${text} ${ok ? "✓" : "✗"}`);
const n = out.nominal;
const md = `# Boundary engine benchmark: ${twin0.name} (${ID}), ${out.date}

${header.photos.length} photographs, ${twin0.trees.length} reconciled trees, ${twin0.rows.filter(r => r.kept).length} kept rows; ground measured at ${header.cellM} m (${header.width} × ${header.height} cells, sampled in ${(header.sampledMs / 1000).toFixed(1)} s once, reused here). No orthomosaic anywhere in this pass.

## The inferred block

| | |
|---|---|
| Area | ${n.areaHa.toFixed(3)} ha ± ${n.uncertaintyHa.toFixed(3)} (${n.vertices} vertices, ${n.rowsUsed} rows) |
| Confidence | ${n.confidence} (${n.level}; length-weighted 20th percentile of the edges, mean ${n.meanConfidence}) |
| Edge length by support | ${Object.entries(n.lengthBySupport).map(([k, v]) => `${k} ${pc(v as number)}`).join(", ")} |
| Failure codes | ${n.codes.length ? n.codes.map(c => `\`${c}\``).join(", ") : "none"} |
| Ground inside by class | ${n.inside ? Object.entries(n.inside).map(([k, v]) => `${k} ${pc(v as number)}`).join(", ") : "no photographs"} |
| Image coverage | ${n.coverage.anyViewHa} ha by any photograph, ${n.coverage.twoPlusHa} ha by two or more, ${n.coverage.meanViews} views on average |
| Stability (10 rule variants) | area ${n.stability?.areaMinHa} to ${n.stability?.areaMaxHa} ha; vertices move ${n.stability?.medianShiftM} m (median), ${n.stability?.maxShiftM} m at most |
| Blocks of rows | ${n.components.map(c => `${c.rows} rows, ${c.trees} trees, score ${c.score}${c.chosen ? " (the field)" : ""}`).join("; ")} |

## Acceptance targets (the brief's; measured where a reference exists)

| Metric | Target | Measured |
|---|---|---|
| Polygon IoU against a hand-drawn reference | ≥ 0.93 | ${reference ? target(reference.metrics.iou >= 0.93, reference.metrics.iou.toFixed(3)) : "no reference drawn yet: pass one with --reference"} |
| Mean boundary distance (both ways) | ≤ 1.0 m | ${reference ? target(reference.metrics.meanDistM <= 1, `${reference.metrics.meanDistM.toFixed(2)} m`) : "no reference"} |
| 95th-percentile boundary error | ≤ 2.0 m | ${reference ? target(reference.metrics.p95DistM <= 2, `${reference.metrics.p95DistM.toFixed(2)} m`) : "no reference"} |
| Area bias | < 3 % | ${reference ? target(reference.metrics.areaBias < 0.03, pc(reference.metrics.areaBias)) : "no reference"} |
| Crop inclusion recall (the field's trees inside) | ≥ 98.5 % | ${target(n.inclusion.recall >= 0.985, `${pc(n.inclusion.recall)} of ${n.inclusion.fieldTrees} trees the engine counts as the field's; ${pc(n.inclusionRaw.recall)} of all ${n.inclusionRaw.fieldTrees} objects with a used row's id (${n.excluded.inCover} standing in dense cover and ${n.excluded.trimmed} trimmed from row ends are judged not the field's: see the notes)`)} |
| Included-object precision (trees inside that are the field's) | ≥ 99 % | ${target(n.inclusion.precision >= 0.99, `${pc(n.inclusion.precision)} (${n.inclusion.foreignInside} off-row trees inside: the second planting's trees that cross the rows' ends)`)} |
| Neighbouring cultivated area included (ground inside classed cover, road or trees off the rows) | < 1 % | ${target(n.inside ? ((n.inside as Record<string, number>).cover + (n.inside as Record<string, number>).road + (n.inside as Record<string, number>).foreign) < 0.01 : null, n.inside ? pc((n.inside as Record<string, number>).cover + (n.inside as Record<string, number>).road + (n.inside as Record<string, number>).foreign) : "")} |
| Repeatability | identical polygon | ${target(deterministic, deterministic ? "two runs identical (ring, confidence, codes)" : "two runs DIFFER")} |
| Boundary runtime, rows already reconstructed, CPU only | < 2 s here | ${target(n.inferenceMs[1] < 2000, `inference ${n.inferenceMs.join(" / ")} ms including the stability ensemble; classification ${n.classifyMs.join(" / ")} ms; the whole pass ${n.wholePassMs.join(" / ")} ms`)} |
| Works without an orthomosaic | must | ✓ (nothing here reads one) |

A reference boundary is the one thing not in this table: nobody has drawn one for this field. When one exists, ${"`"}--reference file.geojson${"`"} fills the first four rows; the Field Twin's Adjust tool can draw it and the dev API (${"`"}window.__fieldTwin.boundary().corrected${"`"}) hands the ring back.

## Ablations: less confident before absurd

| Ablation | Area | Confidence | Boundary shift (mean / 95th / max) | Crop recall | New codes | Graceful |
|---|---|---|---|---|---|---|
${results.map(r => `| ${r.name} | ${r.summary.areaHa.toFixed(3)} ha (${r.areaChangePct >= 0 ? "+" : ""}${r.areaChangePct.toFixed(1)} %) | ${r.summary.confidence} (${r.summary.level}, ${r.confidenceChange >= 0 ? "+" : ""}${r.confidenceChange.toFixed(3)}) | ${r.shiftM.mean} / ${r.shiftM.p95} / ${r.shiftM.max} m | ${pc(r.inclusion.recall)} | ${r.newCodes.map(c => `\`${c}\``).join(", ") || "none"} | ${r.graceful ? "yes" : "NO"} |`).join("\n")}

"Graceful" means: the area changed by at most 10 %, or the confidence fell by at least 0.05, or a failure code was raised. Boundary shift is from the ablated ring to the nominal one, sampled every 0.25 m.

${results.map(r => `### ${r.name}
What: ${r.what}. Expected: ${r.expect}.
${r.notes.length ? r.notes.map(x => `- ${x}`).join("\n") : "- nothing further"}
- codes: ${r.summary.codes.map(c => `\`${c}\``).join(", ") || "none"}; precision ${pc(r.inclusion.precision)}; ${r.seconds} s`).join("\n\n")}
`;
writeFileSync(join(DIR, "bench.md"), md);
console.log(`-> ${join(DIR, "bench.md")}`);
