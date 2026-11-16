// Development only, a diagnostic that changes nothing: do photographs disagree on where the same plants are, so that one
// plant becomes two dots (one on its row, one "on no row")? Run over a stored corn flight (an analysis record plus the
// cache of its second-look candidates, cornCandidates.ts) with the rules as they stand (SEQUENCE, the field's ground).
//
//   npx vite-node scripts/rowCrop/cornDiagnostic.ts -- --flight <label> --analysis <analysis.json> --cache <dir> --out <dir>
//       [--photos <dir> --draw <part of a photograph's name> --regions "x,y,w,h;x,y,w,h"]
//
// Writes <out>/<flight>.json (the summaries) and CSV histograms:
//   step1-distance.csv            every dot's signed distance to its nearest row line, 1 cm bins, per group of dots
//   step1-distance-squares.csv    the same per 10 m square of field (along x across the rows)
//   step2-offsets.csv             a dot on no row against the dots on rows within 30 cm: offset along and across the
//                                 rows, 1 cm bins, by whether the two dots share a photograph
//   step3-frame.csv               each sighting against the nearest sighting of another photograph within 30 cm, after
//                                 registration: by position in the frame (12 x 9)
//   step3-photos.csv              the same by photograph, with what registerPhotos fitted for it
//   step3-lines.csv               the same by flight line
//   step5-spacing.csv             distances between marks along a row (neighbours, and all pairs to 0.8 m), 1 cm bins
//   step5-scores.csv              seedSpacing's score at every spacing (its own scan, and beyond it)
// With --draw: close-ups of one photograph with its OWN stricter marks (yellow) and the field's dots projected into it
// with its registration shift and nothing else (cyan on a row, magenta on no row), and the same close-ups plain.
import "../bench/nodeStorageShim";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import { type GeorefFrame, groundSampleAt, groundToPixel, pixelToGround } from "../../src/lib/directGeoref/projection";
import { type CornPhotoRead, FIELD, cornFieldAndGround } from "../../src/lib/fieldTwin/cornField";
import { placeDots, readRows } from "../../src/lib/fieldTwin/cornPlants";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { PLANTS_FIRST, SEQUENCE, certainEvidence, courseAt, projectSightings, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { CORN_POPULATION_PER_HA, seedSpacing } from "../../src/lib/fieldTwin/rowGuided";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1]; };
const arg = (k: string) => { const v = opt(k); if (v == null) throw new Error(`--${k} is required`); return v; };
const FLIGHT = arg("flight"), CACHE = arg("cache"), OUT = arg("out");
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis;
const frames = framesFromAnalysis(A);
mkdirSync(OUT, { recursive: true });

// The record's reads with their candidates, as a build on this code carries them (cornScoreboard.ts, variant p4).
type Cached = { applies: boolean; low: [number, number][]; lowWhole: [number, number][]; span: [number, number][]; axis: [number, number] | null };
const reads: CornPhotoRead[] = A.reads.map(r => {
  const { low: _l, lowSpan: _s, lowAxis: _a, ...rest } = r, f = join(CACHE, `${r.name}.json`);
  const c = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Cached) : null;
  if (!c?.applies) return rest;
  return c.axis ? { ...rest, low: c.lowWhole, lowSpan: c.span, lowAxis: c.axis } : { ...rest, low: c.low };
});
const { field: F, ground } = cornFieldAndGround(reads, frames, A.fieldOptions ?? FIELD);
const P = placeDots(reads, frames, F, { ground });
if (!P) throw new Error("the photographs made no dot");
const rec = readRows(P, F, { ground });
const { sights, photos } = projectSightings(reads, frames, F.origin);
const n = P.all.length, strict = P.strict, tier = P.tier ?? new Uint8Array(n);
const S = rec.geometry.spacingM, seed = rec.geometry.seedM ?? 0.18, reach = SEQUENCE.maxGapSeeds * seed, band = PLANTS_FIRST.onRowShare * S;
const th = (rec.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
const gateM = Math.min(PLANTS_FIRST.gateMax, Math.max(PLANTS_FIRST.gateMin, PLANTS_FIRST.gateTimes * P.repeatM));
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
const median = (v: number[]) => { const t = [...v].sort((a, b) => a - b); return t.length ? t[t.length >> 1] : NaN; };
const csv = (name: string, head: string, rows: (string | number)[][]) => { const f = join(OUT, name), had = existsSync(f); writeFileSync(f, (had ? readFileSync(f, "utf8").split("\n").filter(l => l && !l.startsWith(`${FLIGHT},`) && !l.startsWith("flight,")).map(l => l + "\n").join("") : "").replace(/^/, head + "\n") + rows.map(r => r.join(",")).join("\n") + "\n"); };

/** A grid over points for neighbour queries. */
function gridOf(xs: ArrayLike<number>, ys: ArrayLike<number>, size: number) {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < xs.length; i++) { const k = `${Math.floor(xs[i] / size)}:${Math.floor(ys[i] / size)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(i); }
  return (x: number, y: number, r: number, fn: (i: number) => void) => { for (let i = Math.floor((x - r) / size); i <= Math.floor((x + r) / size); i++) for (let j = Math.floor((y - r) / size); j <= Math.floor((y + r) / size); j++) for (const k of cells.get(`${i}:${j}`) ?? []) fn(k); };
}

/** Peaks of a 1 cm histogram: runs of bins whose 3-bin sum stands above the level between the rows by 3 times its
 * square root (the form registerPhotos asks of a peak, plantsFirst.ts:138). `cm[k]` is bin k's offset. */
function peaksOf(h: number[], cm: number[], bandCm: number) {
  const sm = h.map((_, k) => (h[k - 1] ?? 0) + h[k] + (h[k + 1] ?? 0));
  const bg = median(sm.filter((_, k) => Math.abs(cm[k]) > bandCm)) || 0, thr = bg + 3 * Math.sqrt(Math.max(1, bg));
  const out: { atCm: number; fromCm: number; toCm: number; dots: number; above: number }[] = [];
  for (let k = 0; k < h.length;) {
    if (sm[k] <= thr) { k++; continue; }
    let e = k; while (e + 1 < h.length && sm[e + 1] > thr) e++;
    let best = k, tot = 0; for (let j = k; j <= e; j++) { tot += h[j]; if (h[j] > h[best]) best = j; }
    out.push({ atCm: cm[best], fromCm: cm[k], toCm: cm[e], dots: tot, above: Math.round(tot - (bg / 3) * (e - k + 1)) });
    k = e + 1;
  }
  return { backgroundPerCm: r1(bg / 3), peaks: out };
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 1: distance from the row.
const courses = [...rec.courses, ...rec.geomCourses];
const dist = new Float64Array(n).fill(NaN);
for (let i = 0; i < n; i++) { let best = Infinity; for (const c of courses) { if (rec.a[i] < c.a0 - reach || rec.a[i] > c.a1 + reach) continue; const d = rec.c[i] - courseAt(c, rec.a[i]); if (Math.abs(d) < Math.abs(best)) best = d; } if (Math.abs(best) <= S / 2) dist[i] = best; }
const HB = Math.round((S / 2) * 100), cmBins = Array.from({ length: 2 * HB + 1 }, (_, k) => k - HB);
const GROUPS = ["certain", "2+ photographs, not certain", "second look, 2+ photographs", "second look, 1 photograph", "on a row (all kinds)", "on no row (stricter marks)", "on no row (second-look candidates)"] as const;
const groupsOf = (i: number): number[] => { const g = [i < strict ? (rec.certainty[i] === 0 ? 0 : 1) : tier[i] === 1 ? 2 : 3]; g.push(rec.rowOf[i] >= 0 ? 4 : i < strict ? 5 : 6); return g; };
const SQ = 10, aMin = Math.min(...Array.from(rec.a)), cMin = Math.min(...Array.from(rec.c));
const sqOf = (i: number) => `${Math.floor((rec.a[i] - aMin) / SQ)}:${Math.floor((rec.c[i] - cMin) / SQ)}`;
const hist1 = GROUPS.map(() => new Array<number>(cmBins.length).fill(0)), sqHist = new Map<string, number[][]>();
for (let i = 0; i < n; i++) {
  if (!Number.isFinite(dist[i])) continue;
  const b = Math.max(0, Math.min(cmBins.length - 1, Math.round(dist[i] * 100) + HB)), k = sqOf(i);
  const sq = sqHist.get(k) ?? sqHist.set(k, GROUPS.map(() => new Array<number>(cmBins.length).fill(0))).get(k)!;
  for (const g of groupsOf(i)) { hist1[g][b]++; sq[g][b]++; }
}
csv("step1-distance.csv", "flight,group,distance_cm,dots", GROUPS.flatMap((g, gi) => cmBins.map((cm, k) => [FLIGHT, `"${g}"`, cm, hist1[gi][k]])));
csv("step1-distance-squares.csv", "flight,square_along,square_across,group,distance_cm,dots", [...sqHist].flatMap(([k, hs]) => hs.flatMap((h, gi) => h.flatMap((v, b) => (v ? [[FLIGHT, ...k.split(":"), `"${GROUPS[gi]}"`, cmBins[b], v]] : [])))));
const step1 = GROUPS.map((g, gi) => ({ group: g, dots: hist1[gi].reduce((t, x) => t + x, 0), inBand: hist1[gi].reduce((t, x, k) => t + (Math.abs(cmBins[k]) <= band * 100 ? x : 0), 0), ...peaksOf(hist1[gi], cmBins, band * 100) }));
// Per square, the dots on no row (stricter marks): where they peak beside the row.
const squares = [...sqHist].map(([k, hs]) => {
  const off = hs[5], pk = peaksOf(off, cmBins, band * 100).peaks.filter(p => Math.abs(p.atCm) > 3).sort((x, y) => y.above - x.above)[0];
  return { square: k, onRows: hs[4].reduce((t, x) => t + x, 0), onNoRow: off.reduce((t, x) => t + x, 0), peakCm: pk ? pk.atCm : null, peakDots: pk ? pk.dots : 0 };
}).sort((x, y) => { const [a, b] = x.square.split(":").map(Number), [c, d] = y.square.split(":").map(Number); return a - c || b - d; });

// ---------------------------------------------------------------------------------------------------------------------
// Step 2: is it the same plant twice?
const photosOf = (i: number) => new Set(P.all[i].members.map(m => sights[m].p));
const onIdx: number[] = [], offIdx: number[] = [];
for (let i = 0; i < n; i++) { if (rec.rowOf[i] >= 0) onIdx.push(i); else if (i < strict) offIdx.push(i); }
const nearOn = gridOf(onIdx.map(i => rec.a[i]), onIdx.map(i => rec.c[i]), 0.3);
const STATUS = ["no photograph in common", "a photograph in common", "the dot on the row is a second-look candidate (its photographs are not kept)"] as const;
const R2 = 30, W2 = 2 * R2 + 1, hist2 = STATUS.map(() => new Int32Array(W2 * W2));
const nearest = [0, 0, 0]; let withOne = 0;
const sameAlong = STATUS.map(() => new Array<number>(W2).fill(0));
for (const i of offIdx) {
  const mine = photosOf(i); let best = Infinity, bestStatus = -1;
  nearOn(rec.a[i], rec.c[i], 0.3, k => {
    const j = onIdx[k], da = rec.a[i] - rec.a[j], dc = rec.c[i] - rec.c[j]; if (Math.abs(da) > 0.3 || Math.abs(dc) > 0.3) return;
    let status = 2; if (j < strict) { status = 0; for (const p of photosOf(j)) if (mine.has(p)) { status = 1; break; } }
    const ba = Math.round(da * 100) + R2, bc = Math.round(dc * 100) + R2; hist2[status][bc * W2 + ba]++;
    if (Math.abs(da) <= gateM) sameAlong[status][bc]++;
    const d = Math.hypot(da, dc); if (d < best) { best = d; bestStatus = status; }
  });
  if (bestStatus >= 0) { withOne++; nearest[bestStatus]++; }
}
csv("step2-offsets.csv", "flight,status,offset_along_cm,offset_across_cm,pairs", STATUS.flatMap((s, si) => Array.from(hist2[si]).flatMap((v, k) => (v ? [[FLIGHT, `"${s}"`, (k % W2) - R2, Math.floor(k / W2) - R2, v]] : []))));
const cm2 = Array.from({ length: W2 }, (_, k) => k - R2);
const step2 = {
  dotsOnNoRow: offIdx.length, withADotOnARowWithin30cm: withOne,
  nearestDotOnARow: Object.fromEntries(STATUS.map((s, k) => [s, nearest[k]])),
  // Pairs at the same place along the row (within the merge gate): how far apart across the rows.
  sameAlongGateM: r3(gateM),
  sameAlong: STATUS.map((s, k) => ({ status: s, pairs: sameAlong[k].reduce((t, x) => t + x, 0), ...peaksOf(sameAlong[k], cm2, band * 100), histogram: sameAlong[k] })),
  strongest: STATUS.map((s, k) => { let b = 0; for (let q = 1; q < W2 * W2; q++) if (hist2[k][q] > hist2[k][b]) b = q; return { status: s, alongCm: (b % W2) - R2, acrossCm: Math.floor(b / W2) - R2, pairs: hist2[k][b], allPairs: hist2[k].reduce((t, x) => t + x, 0) }; }),
};

// ---------------------------------------------------------------------------------------------------------------------
// Step 3: where the disagreement comes from.
const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length);
sights.forEach((s, i) => { const [de, dn] = shiftOf(P.shifts[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; });
const nearS = gridOf(xs, ys, 0.3);
const dotOf = new Int32Array(sights.length).fill(-1); for (let i = 0; i < strict; i++) for (const m of P.all[i].members) dotOf[m] = i;
// Each photograph's axes on the ground (unit vectors of +u and +v at its centre) and its ground sample there.
const axes = photos.map(name => {
  const f = frames.get(name)!, g = (u: number, v: number) => { const p = pixelToGround(f, u, v)!; const q = toEnu({ lat: p.lat, lng: p.lng, altM: 0 }, F.origin); return [q[0], q[1]]; };
  const o = g(f.intrinsics.cx, f.intrinsics.cy), a = g(f.intrinsics.cx + 200, f.intrinsics.cy), b = g(f.intrinsics.cx, f.intrinsics.cy + 200);
  const un = Math.hypot(a[0] - o[0], a[1] - o[1]), vn = Math.hypot(b[0] - o[0], b[1] - o[1]);
  return { f, eu: [(a[0] - o[0]) / un, (a[1] - o[1]) / un], ev: [(b[0] - o[0]) / vn, (b[1] - o[1]) / vn], gsd: groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? un / 200, centre: o };
});
type Acc = { planted: number; onRowP: number; offRowP: number; noDotP: number; n: number; near: number; gate: number; su: number; sv: number; suu: number; svv: number; sr: number; sa: number; sc: number; scc: number; onRow: number; offRow: number; noDot: number };
const acc = (): Acc => ({ planted: 0, onRowP: 0, offRowP: 0, noDotP: 0, n: 0, near: 0, gate: 0, su: 0, sv: 0, suu: 0, svv: 0, sr: 0, sa: 0, sc: 0, scc: 0, onRow: 0, offRow: 0, noDot: 0 });
const GU = 12, GV = 9, frameAcc = Array.from({ length: GU * GV }, acc), photoAcc = photos.map(acc);
for (let i = 0; i < sights.length; i++) {
  const s = sights[i], ax = axes[s.p], W = ax.f.intrinsics.width, H = ax.f.intrinsics.height;
  let best = Infinity, bx = 0, by = 0;
  nearS(xs[i], ys[i], 0.3, j => { if (sights[j].p === s.p) return; const dx = xs[j] - xs[i], dy = ys[j] - ys[i], d = Math.hypot(dx, dy); if (d < best) { best = d; bx = dx; by = dy; } });
  const cell = frameAcc[Math.min(GV - 1, Math.floor((s.v / H) * GV)) * GU + Math.min(GU - 1, Math.floor((s.u / W) * GU))];
  for (const t of [cell, photoAcc[s.p]]) {
    t.n++;
    const d = dotOf[i]; if (d < 0) t.noDot++; else if (rec.rowOf[d] >= 0) t.onRow++; else t.offRow++;
    if (ground && ground.state(xs[i], ys[i]) === 1) { t.planted++; if (d < 0) t.noDotP++; else if (rec.rowOf[d] >= 0) t.onRowP++; else t.offRowP++; }
    if (best > 0.3) continue;
    t.near++; if (best <= gateM) t.gate++;
    const ou = bx * ax.eu[0] + by * ax.eu[1], ov = bx * ax.ev[0] + by * ax.ev[1];
    const ru = s.u - ax.f.intrinsics.cx, rv = s.v - ax.f.intrinsics.cy, rn = Math.hypot(ru, rv) || 1;
    const al = bx * ct + by * st, ac = -bx * st + by * ct;
    t.su += ou; t.sv += ov; t.suu += ou * ou; t.svv += ov * ov; t.sr += (ou * ru + ov * rv) / rn; t.sa += al; t.sc += ac; t.scc += ac * ac;
  }
}
const cmOf = (sum: number, k: number) => (k ? r1((100 * sum) / k) : null), sdOf = (sum: number, sq: number, k: number) => (k > 1 ? r1(100 * Math.sqrt(Math.max(0, sq / k - (sum / k) ** 2))) : null);
const pct = (a: number, b: number) => (b ? r1((100 * a) / b) : null);
const frameRows = frameAcc.map((t, k) => ({ col: (k % GU) + 1, row: Math.floor(k / GU) + 1, sightings: t.n, withAnotherWithin30cm: pct(t.near, t.n), withinTheMergeGate: pct(t.gate, t.n), meanAlongU_cm: cmOf(t.su, t.near), meanAlongV_cm: cmOf(t.sv, t.near), spreadU_cm: sdOf(t.su, t.suu, t.near), spreadV_cm: sdOf(t.sv, t.svv, t.near), meanOutward_cm: cmOf(t.sr, t.near), inADotOnARow: pct(t.onRow, t.n), inADotOnNoRow: pct(t.offRow, t.n), inNoDot: pct(t.noDot, t.n), onPlantedGround: t.planted, plantedInADotOnARow: pct(t.onRowP, t.planted), plantedInADotOnNoRow: pct(t.offRowP, t.planted), plantedInNoDot: pct(t.noDotP, t.planted) }));
csv("step3-frame.csv", "flight,frame_col_of_12,frame_row_of_9,sightings,pct_with_another_within_30cm,pct_within_merge_gate,mean_offset_along_u_cm,mean_offset_along_v_cm,spread_u_cm,spread_v_cm,mean_offset_outward_cm,pct_in_a_dot_on_a_row,pct_in_a_dot_on_no_row,pct_in_no_dot,sightings_on_ground_judged_planted,planted_pct_in_a_dot_on_a_row,planted_pct_in_a_dot_on_no_row,planted_pct_in_no_dot",
  frameRows.map(r => [FLIGHT, r.col, r.row, r.sightings, r.withAnotherWithin30cm ?? "", r.withinTheMergeGate ?? "", r.meanAlongU_cm ?? "", r.meanAlongV_cm ?? "", r.spreadU_cm ?? "", r.spreadV_cm ?? "", r.meanOutward_cm ?? "", r.inADotOnARow ?? "", r.inADotOnNoRow ?? "", r.inNoDot ?? "", r.onPlantedGround, r.plantedInADotOnARow ?? "", r.plantedInADotOnNoRow ?? "", r.plantedInNoDot ?? ""]));
// Flight lines: photographs in name order; a new line where the step between cameras turns by more than 45 degrees.
const order = photos.map((name, p) => ({ name, p })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
const lineOf = new Int32Array(photos.length); let line = 0, prev: number[] | null = null;
for (let k = 1; k < order.length; k++) {
  const a = axes[order[k - 1].p].centre, b = axes[order[k].p].centre, step = [b[0] - a[0], b[1] - a[1]];
  if (prev) { const cos = (step[0] * prev[0] + step[1] * prev[1]) / ((Math.hypot(step[0], step[1]) || 1) * (Math.hypot(prev[0], prev[1]) || 1)); if (cos < Math.SQRT1_2) line++; }
  lineOf[order[k].p] = line; prev = step;
}
// A photograph's line is the line of the step that reaches it; the first photograph belongs with the second.
if (order.length > 1) lineOf[order[0].p] = lineOf[order[1].p];
const photoRows = order.map(({ name, p }) => {
  const t = photoAcc[p], sh = P.shifts[p], f = frames.get(name)!, W = f.intrinsics.width, H = f.intrinsics.height;
  const corner = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([u, v]) => Math.hypot(sh.e[1] * (u - sh.u0) + sh.e[2] * (v - sh.v0), sh.n[1] * (u - sh.u0) + sh.n[2] * (v - sh.v0))));
  return { name, line: lineOf[p] + 1, sightings: t.n, withAnotherWithin30cm: pct(t.near, t.n), withinTheMergeGate: pct(t.gate, t.n), meanAcrossRows_cm: cmOf(t.sc, t.near), spreadAcrossRows_cm: sdOf(t.sc, t.scc, t.near), meanAlongRows_cm: cmOf(t.sa, t.near), inADotOnNoRow: pct(t.offRow, t.n), cellsWithAPeak: sh.cells, cellsPossible: PLANTS_FIRST.gridU * PLANTS_FIRST.gridV, singleShiftOnly: sh.e[1] === 0 && sh.e[2] === 0 && sh.n[1] === 0 && sh.n[2] === 0, shift_cm: r1(100 * Math.hypot(sh.e[0], sh.n[0])), planeMovesACornerBy_cm: r1(100 * corner) };
});
csv("step3-photos.csv", "flight,photograph,flight_line,sightings,pct_with_another_within_30cm,pct_within_merge_gate,mean_offset_across_rows_cm,spread_across_rows_cm,mean_offset_along_rows_cm,pct_in_a_dot_on_no_row,cells_with_a_peak,cells_possible,single_shift_only,shift_cm,plane_moves_a_corner_by_cm",
  photoRows.map(r => [FLIGHT, r.name, r.line, r.sightings, r.withAnotherWithin30cm ?? "", r.withinTheMergeGate ?? "", r.meanAcrossRows_cm ?? "", r.spreadAcrossRows_cm ?? "", r.meanAlongRows_cm ?? "", r.inADotOnNoRow ?? "", r.cellsWithAPeak, r.cellsPossible, r.singleShiftOnly, r.shift_cm, r.planeMovesACornerBy_cm]));
const lineRows = Array.from({ length: line + 1 }, (_, l) => {
  const ps = order.filter(o => lineOf[o.p] === l), t = acc();
  for (const o of ps) { const q = photoAcc[o.p]; t.n += q.n; t.near += q.near; t.gate += q.gate; t.sa += q.sa; t.sc += q.sc; t.scc += q.scc; t.offRow += q.offRow; }
  const a = axes[ps[0].p].centre, b = axes[ps[ps.length - 1].p].centre;
  return { line: l + 1, photographs: ps.length, first: ps[0].name, last: ps[ps.length - 1].name, headingDeg: ps.length > 1 ? Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) : null, sightings: t.n, withinTheMergeGate: pct(t.gate, t.n), meanAcrossRows_cm: cmOf(t.sc, t.near), spreadAcrossRows_cm: sdOf(t.sc, t.scc, t.near), meanAlongRows_cm: cmOf(t.sa, t.near), inADotOnNoRow: pct(t.offRow, t.n) };
});
csv("step3-lines.csv", "flight,flight_line,photographs,first,last,heading_deg_from_east,sightings,pct_within_merge_gate,mean_offset_across_rows_cm,spread_across_rows_cm,mean_offset_along_rows_cm,pct_in_a_dot_on_no_row",
  lineRows.map(r => [FLIGHT, r.line, r.photographs, r.first, r.last, r.headingDeg ?? "", r.sightings, r.withinTheMergeGate ?? "", r.meanAcrossRows_cm ?? "", r.spreadAcrossRows_cm ?? "", r.meanAlongRows_cm ?? "", r.inADotOnNoRow ?? ""]));

// Step 3, continued: each photograph against all the others, cell by cell of its frame (6 x 4), as registerPhotos reads a
// repeat (plantsFirst.ts:104-142: every pair of sightings of different photographs within reachM votes for its
// offset in 1 cm bins; the peak is the sharpest 3 x 3 box above a wider one, and must stand 3 times the square root of
// that background above it). Here it is read AFTER registration: what the fitted plane left over. Then, per photograph,
// how much of what is left a model can take: a plane again (nothing, if the fit converged), a plane plus the two terms
// a camera tilted by a small angle adds on flat ground (for a ray at x, y in focal lengths, a tilt moves the ground
// point by p (1 + x^2) + q x y along u and p x y + q (1 + y^2) along v, p and q being the height times the two tilt
// angles: the x^2, x y, y^2 part is what no plane holds), and a free second-order surface (for comparison).
const CU = 6, CV = 4, RR = PLANTS_FIRST.reachM, NBIN = Math.round((2 * RR) / 0.01) + 1, HALF = Math.max(2, Math.round(PLANTS_FIRST.backgroundM / 0.01));
const cellHist = new Map<number, Float32Array>(), cellXY = new Map<number, [number, number, number]>();
const camOf = photos.map((name, p) => { const f = frames.get(name)!, c = toEnu({ lat: f.pose.lat, lng: f.pose.lng, altM: 0 }, F.origin); return { e: c[0], n: c[1], h: axes[p].gsd * f.intrinsics.fx }; });
for (let i = 0; i < sights.length; i++) {
  const s = sights[i], ax = axes[s.p], cam = camOf[s.p], W = ax.f.intrinsics.width, H = ax.f.intrinsics.height;
  const key = s.p * CU * CV + Math.min(CV - 1, Math.floor((s.v / H) * CV)) * CU + Math.min(CU - 1, Math.floor((s.u / W) * CU));
  const xy = cellXY.get(key) ?? cellXY.set(key, [0, 0, 0]).get(key)!;
  xy[0] += ((s.e - cam.e) * ax.eu[0] + (s.n - cam.n) * ax.eu[1]) / cam.h; xy[1] += ((s.e - cam.e) * ax.ev[0] + (s.n - cam.n) * ax.ev[1]) / cam.h; xy[2]++;
  nearS(xs[i], ys[i], RR, j => {
    if (sights[j].p === s.p) return; const dx = xs[j] - xs[i], dy = ys[j] - ys[i]; if (Math.abs(dx) > RR || Math.abs(dy) > RR) return;
    const h = cellHist.get(key) ?? cellHist.set(key, new Float32Array(NBIN * NBIN)).get(key)!; h[Math.round((dy + RR) / 0.01) * NBIN + Math.round((dx + RR) / 0.01)]++;
  });
}
const peakOf = (h: Float32Array): { x: number; y: number } | null => {
  let tot = 0; for (let k = 0; k < h.length; k++) tot += h[k]; if (tot < PLANTS_FIRST.minVotes) return null;
  const SA = new Float64Array((NBIN + 1) * (NBIN + 1));
  for (let y = 0; y < NBIN; y++) { let row = 0; for (let x = 0; x < NBIN; x++) { row += h[y * NBIN + x]; SA[(y + 1) * (NBIN + 1) + x + 1] = SA[y * (NBIN + 1) + x + 1] + row; } }
  const box = (x0: number, y0: number, x1: number, y1: number) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(NBIN - 1, x1); y1 = Math.min(NBIN - 1, y1); return [SA[(y1 + 1) * (NBIN + 1) + x1 + 1] - SA[y0 * (NBIN + 1) + x1 + 1] - SA[(y1 + 1) * (NBIN + 1) + x0] + SA[y0 * (NBIN + 1) + x0], (x1 - x0 + 1) * (y1 - y0 + 1)]; };
  let bx = -1, by = -1, best = 0, bg = 0;
  for (let y = 1; y < NBIN - 1; y++) for (let x = 1; x < NBIN - 1; x++) { const [s3] = box(x - 1, y - 1, x + 1, y + 1), [sw, aw] = box(x - HALF, y - HALF, x + HALF, y + HALF), ex = s3 - (9 * sw) / aw; if (ex > best) { best = ex; bx = x; by = y; bg = (9 * sw) / aw; } }
  if (bx < 0 || best < 3 * Math.sqrt(Math.max(1, bg))) return null;
  let sx = 0, sy = 0, sw = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const w = h[(by + dy) * NBIN + bx + dx]; sx += w * (bx + dx); sy += w * (by + dy); sw += w; }
  return { x: (sx / sw) * 0.01 - RR, y: (sy / sw) * 0.01 - RR };
};
/** Least squares: the unknowns minimising the sum of (row . unknowns - value)^2. */
function solve(rows: number[][], vals: number[]): number[] | null {
  const m = rows[0].length, M = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0));
  rows.forEach((r, k) => { for (let i = 0; i < m; i++) { M[i][m] += r[i] * vals[k]; for (let j = 0; j < m; j++) M[i][j] += r[i] * r[j]; } });
  for (let c = 0; c < m; c++) { let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r; if (Math.abs(M[pv][c]) < 1e-12) return null; [M[c], M[pv]] = [M[pv], M[c]]; for (let r = 0; r < m; r++) { if (r === c) continue; const k = M[r][c] / M[c][c]; for (let j = c; j <= m; j++) M[r][j] -= k * M[c][j]; } }
  return M.map((r, i) => r[m] / r[i]);
}
type CellPeak = { p: number; col: number; row: number; x: number; y: number; du: number; dv: number };
const cellPeaks: CellPeak[] = [];
for (const [key, h] of cellHist) { const pk = peakOf(h); if (!pk) continue; const p = Math.floor(key / (CU * CV)), c = key % (CU * CV), ax = axes[p], xy = cellXY.get(key)!; cellPeaks.push({ p, col: (c % CU) + 1, row: Math.floor(c / CU) + 1, x: xy[0] / xy[2], y: xy[1] / xy[2], du: pk.x * ax.eu[0] + pk.y * ax.eu[1], dv: pk.x * ax.ev[0] + pk.y * ax.ev[1] }); }
const rms = (v: number[]) => (v.length ? Math.sqrt(v.reduce((t, x) => t + x * x, 0) / v.length) : NaN);
const tiltRows = order.map(({ name, p }) => {
  const cs = cellPeaks.filter(c => c.p === p), raw = cs.map(c => Math.hypot(c.du, c.dv));
  const out = { name, cellsWithARepeat: cs.length, cellsPossible: CU * CV, leftOver_cm: r1(100 * rms(raw)), worstCell_cm: raw.length ? r1(100 * Math.max(...raw)) : null as number | null, cellsOverTheMergeGate: raw.filter(d => d > gateM).length,
    afterAPlane_cm: null as number | null, afterTilt_cm: null as number | null, afterSecondOrder_cm: null as number | null, cellsOverTheGateAfterTilt: null as number | null, tiltU_deg: null as number | null, tiltV_deg: null as number | null };
  if (cs.length < 16) return out;
  const fit = (basis: (c: CellPeak) => [number[], number[]]) => { const rows: number[][] = [], vals: number[] = []; for (const c of cs) { const [ru, rv] = basis(c); rows.push(ru, rv); vals.push(c.du, c.dv); } const sol = solve(rows, vals); if (!sol) return null; const res = cs.map(c => { const [ru, rv] = basis(c); return Math.hypot(c.du - ru.reduce((t, x, k) => t + x * sol[k], 0), c.dv - rv.reduce((t, x, k) => t + x * sol[k], 0)); }); return { sol, res }; };
  const plane = fit(c => [[1, c.x, c.y, 0, 0, 0], [0, 0, 0, 1, c.x, c.y]]);
  const tilt = fit(c => [[1, c.x, c.y, 0, 0, 0, c.x * c.x, c.x * c.y], [0, 0, 0, 1, c.x, c.y, c.x * c.y, c.y * c.y]]);
  const second = fit(c => [[1, c.x, c.y, c.x * c.x, c.x * c.y, c.y * c.y, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, c.x, c.y, c.x * c.x, c.x * c.y, c.y * c.y]]);
  if (plane) out.afterAPlane_cm = r1(100 * rms(plane.res));
  if (tilt) { out.afterTilt_cm = r1(100 * rms(tilt.res)); out.cellsOverTheGateAfterTilt = tilt.res.filter(d => d > gateM).length; out.tiltU_deg = r2((Math.atan(tilt.sol[6] / camOf[p].h) * 180) / Math.PI); out.tiltV_deg = r2((Math.atan(tilt.sol[7] / camOf[p].h) * 180) / Math.PI); }
  if (second) out.afterSecondOrder_cm = r1(100 * rms(second.res));
  return out;
});
csv("step3-cells.csv", "flight,photograph,cell_col_of_6,cell_row_of_4,x_focal_lengths,y_focal_lengths,left_over_along_u_cm,left_over_along_v_cm", cellPeaks.map(c => [FLIGHT, photos[c.p], c.col, c.row, r3(c.x), r3(c.y), r1(100 * c.du), r1(100 * c.dv)]));
csv("step3-tilt.csv", "flight,photograph,cells_with_a_repeat,cells_possible,left_over_rms_cm,worst_cell_cm,cells_over_merge_gate,after_a_plane_rms_cm,after_tilt_terms_rms_cm,after_second_order_rms_cm,cells_over_gate_after_tilt,tilt_about_v_deg,tilt_about_u_deg",
  tiltRows.map(r => [FLIGHT, r.name, r.cellsWithARepeat, r.cellsPossible, r.leftOver_cm, r.worstCell_cm ?? "", r.cellsOverTheMergeGate, r.afterAPlane_cm ?? "", r.afterTilt_cm ?? "", r.afterSecondOrder_cm ?? "", r.cellsOverTheGateAfterTilt ?? "", r.tiltU_deg ?? "", r.tiltV_deg ?? ""]));
const fitted = tiltRows.filter(r => r.afterTilt_cm != null);
const quart = (v: (number | null)[]) => { const t = v.filter((x): x is number => x != null).sort((a, b) => a - b); return t.length ? [0, 0.25, 0.5, 0.75, 1].map(q => t[Math.floor(q * (t.length - 1))]) : null; };
const cellMap = Array.from({ length: CU * CV }, (_, k) => { const cs = cellPeaks.filter(c => c.col === (k % CU) + 1 && c.row === Math.floor(k / CU) + 1).map(c => 100 * Math.hypot(c.du, c.dv)); return { col: (k % CU) + 1, row: Math.floor(k / CU) + 1, photographs: cs.length, medianLeftOver_cm: cs.length ? r1(median(cs)) : null, overTheGate: cs.filter(d => d > gateM * 100).length }; });
const step3tilt = {
  photographs: photos.length, fitted: fitted.length, cells: cellPeaks.length, cellsOverTheMergeGate: cellPeaks.filter(c => Math.hypot(c.du, c.dv) > gateM).length,
  cellsOverTheGateAmongFitted: fitted.reduce((t, r) => t + r.cellsOverTheMergeGate, 0), cellsOverTheGateAfterTilt: fitted.reduce((t, r) => t + (r.cellsOverTheGateAfterTilt ?? 0), 0),
  leftOver_cm: quart(fitted.map(r => r.leftOver_cm)), afterAPlane_cm: quart(fitted.map(r => r.afterAPlane_cm)), afterTilt_cm: quart(fitted.map(r => r.afterTilt_cm)), afterSecondOrder_cm: quart(fitted.map(r => r.afterSecondOrder_cm)),
  tiltSize_deg: quart(fitted.map(r => (r.tiltU_deg == null || r.tiltV_deg == null ? null : r2(Math.hypot(r.tiltU_deg, r.tiltV_deg))))), worstCell_cm: quart(tiltRows.map(r => r.worstCell_cm)), cellMap,
};

// ---------------------------------------------------------------------------------------------------------------------
// Step 5: plant spacing. The marks the first reading of rows kept (cornPlants.ts placeDots: rowsFromDots over the
// certain dots), along its own direction: seedSpacing ran on the same rows before their ends were trimmed.
const certainDots = P.all.slice(0, strict).filter((d, i) => certainEvidence(d, P.covered[i]));
const th0 = (P.pre.directionDeg * Math.PI) / 180, marks = P.pre.rows.flatMap(r => r.dots.map(k => ({ row: r.id, a: certainDots[k].e * Math.cos(th0) + certainDots[k].n * Math.sin(th0) })));
const byRow = new Map<number, number[]>(); for (const m of marks) (byRow.get(m.row) ?? byRow.set(m.row, []).get(m.row)!).push(m.a);
const neighbours = new Array<number>(81).fill(0), pairsH = new Array<number>(81).fill(0), pairD: number[] = [];
for (const as of byRow.values()) { as.sort((x, y) => x - y); for (let i = 0; i < as.length; i++) { if (i + 1 < as.length && as[i + 1] - as[i] <= 0.8) neighbours[Math.round((as[i + 1] - as[i]) * 100)]++; for (let j = i + 1; j < as.length && as[j] - as[i] <= 0.8; j++) { pairD.push(as[j] - as[i]); pairsH[Math.round((as[j] - as[i]) * 100)]++; } } }
csv("step5-spacing.csv", "flight,kind,distance_cm,count", [...neighbours.map((v, k) => [FLIGHT, "neighbouring marks on a row", k, v]), ...pairsH.map((v, k) => [FLIGHT, "every pair on a row up to 0.8 m", k, v])]);
// seedSpacing's score (rowGuided.ts seedSpacing): the mean cosine of each pair's distance in turns of the spacing.
const allowed: [number, number] = [1 / (CORN_POPULATION_PER_HA[1] / 10_000) / P.pre.spacingM, 1 / (CORN_POPULATION_PER_HA[0] / 10_000) / P.pre.spacingM];
const score = (s: number) => { let c = 0; for (const x of pairD) c += Math.cos((2 * Math.PI * x) / s); return pairD.length ? c / pairD.length : 0; };
const scan: { s: number; score: number; tried: boolean }[] = [];
for (let s = 0.04; s <= 0.8 + 1e-9; s += 0.002) scan.push({ s: r3(s), score: r3(score(s)), tried: false });
const tried: { s: number; score: number }[] = []; for (let s = allowed[0]; s <= allowed[1] + 1e-9; s += 0.002) tried.push({ s: r3(s), score: r3(score(s)) });
csv("step5-scores.csv", "flight,spacing_m,score,tried_by_seedSpacing", [...tried.map(t => [FLIGHT, t.s, t.score, "yes"]), ...scan.map(t => [FLIGHT, t.s, t.score, "no (outside what it tries, for comparison)"])]);
const again = seedSpacing(marks, P.pre.spacingM), bestTried = Math.max(...tried.map(t => t.score));
const nbPeaks = peaksOf(neighbours, neighbours.map((_, k) => k), -1).peaks;
const step5 = {
  rowSpacingM: r3(P.pre.spacingM), spacingTheBuildUses: P.pre.seedM, seedSpacingOnTheseMarks: again.spacingM, regularity: again.regularity, pairs: again.pairs,
  triedFromM: r3(allowed[0]), triedToM: r3(allowed[1]), bestScoreTried: bestTried, triedWithinAHairOfBest: tried.filter(t => t.score >= bestTried - 0.02).map(t => t.s),
  scoreAtHalf: again.spacingM ? r3(score(again.spacingM / 2)) : null, scoreAtAThird: again.spacingM ? r3(score(again.spacingM / 3)) : null, scoreAtDouble: again.spacingM ? r3(score(again.spacingM * 2)) : null,
  neighbourDistances: { marks: marks.length, rows: byRow.size, pairs: neighbours.reduce((t, x) => t + x, 0), mostCommonCm: neighbours.indexOf(Math.max(...neighbours)), medianCm: (() => { let t = 0; const half = neighbours.reduce((s, x) => s + x, 0) / 2; for (let k = 0; k < neighbours.length; k++) { t += neighbours[k]; if (t >= half) return k; } return null; })(), peaks: nbPeaks, histogram: neighbours },
};

const summary = {
  flight: FLIGHT, photographs: photos.length, sightings: sights.length, dots: { all: n, stricterMarks: strict, candidates: n - strict },
  geometry: { rowSpacingM: r3(S), plantSpacingM: rec.geometry.seedM, directionDegFromEast: r2(rec.geometry.directionDeg), acrossPositiveIsTowards: `east ${r2(-st)}, north ${r2(ct)} (unit vector)`, bandHalfWidthCm: r1(band * 100), rows: rec.rows.length },
  registration: { repeatM: r3(P.repeatM), mergeGateM: r3(gateM), photographsWithASingleShiftOnly: photoRows.filter(r => r.singleShiftOnly).map(r => r.name), cellsWithAPeak: { median: median(photoRows.map(r => r.cellsWithAPeak)), min: Math.min(...photoRows.map(r => r.cellsWithAPeak)), under4: photoRows.filter(r => r.cellsWithAPeak < 4).length, possible: PLANTS_FIRST.gridU * PLANTS_FIRST.gridV } },
  step1, squares, step2, step3: { frame: frameRows, lines: lineRows, photos: photoRows, leftOver: step3tilt, leftOverByPhotograph: tiltRows }, step5,
};
writeFileSync(join(OUT, `${FLIGHT}.json`), JSON.stringify(summary, null, 1));
console.log(`${FLIGHT}: ${photos.length} photographs, ${sights.length} sightings, ${n} dots; dots on no row ${offIdx.length}, ${withOne} with a dot on a row within 30 cm (nearest: ${nearest.join(" / ")} no photograph in common / in common / candidate); plant spacing ${rec.geometry.seedM}`);

// ---------------------------------------------------------------------------------------------------------------------
// Step 4: one photograph, its own marks against the field's dots.
const DRAW = opt("draw");
if (DRAW) {
  const pi = photos.findIndex(p => p.includes(DRAW)); if (pi < 0) throw new Error(`no photograph named like ${DRAW}`);
  const name = photos[pi], f = frames.get(name)!, DIR = arg("photos"), path = [".JPG", ".jpg", ".jpeg"].map(e => join(DIR, name + e)).find(existsSync);
  if (!path) throw new Error(`no file for ${name}`);
  const img = decodeImage(new Uint8Array(readFileSync(path))), W = img.width, H = img.height, plain = { width: W, height: H, data: Uint8Array.from(img.data) };
  // A field dot in this photograph: through its camera, moved back by its own registration shift (nothing else).
  const pixelOf = (e: number, nn: number): [number, number] | null => {
    let de = 0, dn = 0, u = 0, v = 0;
    for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, nn - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, (f.ground as { altM: number }).altM ?? 0); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(P.shifts[pi], u, v); }
    return u < 0 || v < 0 || u >= W || v >= H ? null : [u, v];
  };
  const ring = (x: number, y: number, r: number, t: number, col: [number, number, number]) => { for (let dy = -r - t; dy <= r + t; dy++) for (let dx = -r - t; dx <= r + t; dx++) { const d = Math.hypot(dx, dy); if (d < r || d > r + t) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = (yy * W + xx) * 4; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; } };
  const fieldPx: { u: number; v: number; on: boolean; mine: boolean }[] = [];
  for (let i = 0; i < n; i++) { if (i >= strict && rec.rowOf[i] < 0) continue; const p = pixelOf(P.all[i].e, P.all[i].n); if (!p) continue; fieldPx.push({ u: p[0], v: p[1], on: rec.rowOf[i] >= 0, mine: i < strict && photosOf(i).has(pi) }); }
  for (const d of fieldPx) ring(d.u, d.v, 11, 2, d.on ? [0, 230, 255] : [255, 0, 220]);
  const own = sights.map((s, i) => ({ s, i })).filter(x => x.s.p === pi);
  for (const { s } of own) ring(s.u, s.v, 4, 2, [255, 235, 0]);
  const regions = (opt("regions") ?? "").split(";").filter(Boolean).map(r => r.split(",").map(Number));
  const crop = (src: { width: number; data: Uint8Array }, x0: number, y0: number, w: number, h: number, k: number) => { const o = new Uint8Array(w * k * h * k * 4); for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) { const q = ((y0 + Math.floor(y / k)) * src.width + x0 + Math.floor(x / k)) * 4, p = (y * w * k + x) * 4; o[p] = src.data[q]; o[p + 1] = src.data[q + 1]; o[p + 2] = src.data[q + 2]; o[p + 3] = 255; } return { width: w * k, height: h * k, data: o }; };
  const gsd = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? NaN, tag = name.slice(-6, -2);
  const nearF = gridOf(fieldPx.map(d => d.u), fieldPx.map(d => d.v), 100);
  const out = regions.map(([x0, y0, w, h], k) => {
    const zoom = w <= 600 ? 3 : 2;
    writeFileSync(join(OUT, `step4-${tag}-region${k + 1}-marked.jpg`), encodeJpeg(crop(img, x0, y0, w, h, zoom), 92));
    writeFileSync(join(OUT, `step4-${tag}-region${k + 1}-plain.jpg`), encodeJpeg(crop(plain, x0, y0, w, h, zoom), 92));
    // This photograph's own marks here: what became of each, and how far the nearest field dot on a row is.
    const mine = own.filter(({ s }) => s.u >= x0 && s.u < x0 + w && s.v >= y0 && s.v < y0 + h), fate = { inADotOnARow: 0, inADotOnNoRow: 0, inNoDot: 0 }, du: number[] = [], dv: number[] = [];
    for (const { s, i } of mine) {
      const d = dotOf[i]; if (d < 0) fate.inNoDot++; else if (rec.rowOf[d] >= 0) fate.inADotOnARow++; else fate.inADotOnNoRow++;
      let best = Infinity, bu = 0, bv = 0; nearF(s.u, s.v, 100, q => { const g = fieldPx[q]; if (!g.on) return; const dd = Math.hypot(g.u - s.u, g.v - s.v); if (dd < best) { best = dd; bu = g.u - s.u; bv = g.v - s.v; } });
      if (best <= 100) { du.push(bu); dv.push(bv); }
    }
    // The field's dots on no row here that this photograph had no part in: how far each is from this photograph's
    // nearest own mark (a plant it saw), within 100 pixels.
    const nearOwn = gridOf(own.map(o => o.s.u), own.map(o => o.s.v), 100), ou: number[] = [], ov: number[] = [];
    const others = fieldPx.filter(d => !d.on && !d.mine && d.u >= x0 && d.u < x0 + w && d.v >= y0 && d.v < y0 + h);
    for (const d of others) { let best = Infinity, bu = 0, bv = 0; nearOwn(d.u, d.v, 100, q => { const s = own[q].s, dd = Math.hypot(d.u - s.u, d.v - s.v); if (dd < best) { best = dd; bu = d.u - s.u; bv = d.v - s.v; } }); if (best <= 100) { ou.push(bu); ov.push(bv); } }
    return { region: k + 1, x0, y0, w, h, zoom, ownMarks: mine.length, ...fate, dotsOnNoRowOfOtherPhotographs: { dots: others.length, withAnOwnMarkWithin100px: ou.length, medianRightOfIt_cm: r1(median(ou) * gsd * 100), medianBelowIt_cm: r1(median(ov) * gsd * 100), within6cmOfIt: ou.filter((x, q) => Math.hypot(x, ov[q]) * gsd <= 0.06).length }, nearestFieldDotOnARow: { marks: du.length, medianRight_px: median(du), medianDown_px: median(dv), medianRight_cm: r1(median(du) * gsd * 100), medianDown_cm: r1(median(dv) * gsd * 100) }, fieldDotsOnARow: fieldPx.filter(d => d.on && d.u >= x0 && d.u < x0 + w && d.v >= y0 && d.v < y0 + h).length, fieldDotsOnNoRow: fieldPx.filter(d => !d.on && d.u >= x0 && d.u < x0 + w && d.v >= y0 && d.v < y0 + h).length, ofThoseThisPhotographIsAMember: fieldPx.filter(d => !d.on && d.mine && d.u >= x0 && d.u < x0 + w && d.v >= y0 && d.v < y0 + h).length };
  });
  writeFileSync(join(OUT, `step4-${tag}.json`), JSON.stringify({ photograph: tag, groundSampleCm: r2(gsd * 100), shift: P.shifts[pi], regions: out }, null, 1));
  console.log(JSON.stringify(out));
}
