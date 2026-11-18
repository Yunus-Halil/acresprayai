// Development only, read-only: why the labelled plants a run did not find were left off the rows. Called by
// cornLabelScore.ts with --misses <dir>, on the same split, the same matching and the run "branch, sweep off".
// Nothing is changed and no rule is run differently: the rules' verdicts are read from the reconstruction, and the
// steps that do not come back from it (which row a dot was tried on, what it was measured against, which photographs'
// marks made a candidate) are followed again here with the rules' own exported parts. Each replay is CHECKED against
// what the rules returned, over every dot of the flight, and the number of differences is printed (it must be 0).
//
//   1  the labelled plants not found that have a dot of the stricter marks on no row within the matching distance
//   2  the labelled plants not found that have none: which photographs marked them, at which bar, and where that went
//   3  the dots on no row in the dev tiles: on a labelled plant, on an unsure label, on neither
//   4  the wrong marks on the dev tiles without a labelled plant: the row each stands on, and how it came to be there
//   5  the planted dev tiles drawn, 1 and 2 in two colours, the reason's letters beside each
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GeorefFrame, pixelToGround } from "../../src/lib/directGeoref/projection";
import type { CornFieldResult, CornPhotoRead, FieldGround } from "../../src/lib/fieldTwin/cornField";
import { type CornPlantsOptions, type PlacedDots, candidatePoints } from "../../src/lib/fieldTwin/cornPlants";
import { type Dot, PLANTS_FIRST, type PhotoShift, ROW_RECALL, type Reconstruction, type RowCourse, SEQUENCE, type Sight, bandAndAlley, courseAt, coverage, mergeDots, projectSightings, rowNumbers, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { ROW_GUIDED, bandBeatsControls } from "../../src/lib/fieldTwin/rowGuided";
import { ROW_POINTS } from "../../src/lib/rowCrop/greenPoints";
import { toEnu } from "../../src/lib/sourceFrames/odm";

type Rgb = [number, number, number];
type Canvas = { w: number; h: number; data: Uint8Array };
export type MTile = { id: string; x: number; y: number; w: number; h: number };
export type MLabel = { x: number; y: number; type: "plant" | "unsure" };
export type MMark = { u: number; v: number; e: number; n: number; tier: number; i?: number };
export type MJudged = { ms: MMark[]; state: Int8Array; plantFound: boolean[]; plantOf: Int32Array; pad: number };
export type MissCtx = {
  out: string; tag: string;
  reads: CornPhotoRead[]; frames: Map<string, GeorefFrame>; F: CornFieldResult; ground: FieldGround | null; opts: CornPlantsOptions;
  P: PlacedDots; rec: Reconstruction; pi: number;
  tiles: MTile[]; labels: Map<string, MLabel[]>; marks: MMark[]; noRow: MMark[];
  place: (u: number, v: number) => [number, number] | null; pixelOf: (e: number, n: number) => [number, number, boolean] | null;
  judge: (t: MTile, marks: MMark[], place: (u: number, v: number) => [number, number] | null, R: number) => MJudged;
  within: (t: MTile, u: number, v: number, pad?: number) => boolean;
  image: () => { width: number; height: number; data: Uint8Array };
  cut: (img: { width: number; height: number; data: Uint8Array }, x0: number, y0: number, w: number, h: number, z: number, head: number) => Canvas;
  ring: (c: Canvas, x: number, y: number, r: number, t: number, col: Rgb) => void; disc: (c: Canvas, x: number, y: number, r: number, col: Rgb) => void;
  square: (c: Canvas, x: number, y: number, r: number, t: number, col: Rgb) => void; text: (c: Canvas, x: number, y: number, s: string, sc: number, col: Rgb) => void;
  encode: (c: Canvas) => Uint8Array;
};

class Hash {
  private cells = new Map<number, number[]>();
  constructor(private xs: ArrayLike<number>, private ys: ArrayLike<number>, private size: number) { for (let i = 0; i < xs.length; i++) { const k = this.key(Math.floor(xs[i] / size), Math.floor(ys[i] / size)); (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i); } }
  private key(i: number, j: number) { return (i + 1_000_000) * 2_000_003 + (j + 1_000_000); }
  near(x: number, y: number, r: number, fn: (i: number, d: number) => void) {
    const i0 = Math.floor((x - r) / this.size), i1 = Math.floor((x + r) / this.size), j0 = Math.floor((y - r) / this.size), j1 = Math.floor((y + r) / this.size);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = this.cells.get(this.key(i, j)); if (c) for (const k of c) { const d = Math.hypot(this.xs[k] - x, this.ys[k] - y); if (d <= r) fn(k, d); } }
  }
}
/** The most pairs that can be made: `cand[i]` the right-hand items left-hand item i may take, nearest first. */
function maxMatch(cand: number[][], nRight: number, taken = new Int32Array(nRight).fill(-1)): Int32Array {
  const order = cand.map((_, i) => i);
  const tryL = (i: number, seen: Set<number>): boolean => { for (const j of cand[i]) { if (taken[j] === -2 || seen.has(j)) continue; seen.add(j); if (taken[j] < 0 || tryL(taken[j], seen)) { taken[j] = i; return true; } } return false; };
  for (const i of order) tryL(i, new Set());
  const of = new Int32Array(cand.length).fill(-1); taken.forEach((i, j) => { if (i >= 0) of[i] = j; });
  return of;
}
const cm = (m: number) => Math.round(m * 1000) / 10;
const GROUND = ["not judged", "planted", "scattered"] as const;
const TIER = ["certain", "probable", "second look, 2+ photographs", "second look, 1 photograph", "loosened"] as const;

export function diagnose(X: MissCtx) {
  const { reads, frames, F, ground, opts, P, rec, pi } = X;
  const q = opts.sequence ?? SEQUENCE, o = opts.placing ?? PLANTS_FIRST;
  const dots = P.all, n = dots.length, strict = P.strict, tier = P.tier, A = rec.a, C = rec.c, lines = rec.courses, geom = rec.geomCourses;
  const S = rec.geometry.spacingM, seed = rec.geometry.seedM; if (seed == null) throw new Error("the plant spacing is not measured");
  const R = seed / 2, onRow = o.onRowShare * S, reach = q.maxGapSeeds * seed, at = courseAt;
  const log: string[] = []; const say = (s: string) => { console.log(s); log.push(s); };
  say(`Row spacing ${S.toFixed(4)} m, plant spacing ${seed} m, matching distance ${R} m. A dot is on a row's line within ${cm(onRow)} cm of it (${o.onRowShare} of the row spacing); a row takes dots up to ${q.maxGapSeeds} plant spacings (${cm(reach)} cm) past its ends. ${lines.length} rows from the certain plants, ${geom.length} found in a free slot; ${n} dots (${strict} of the stricter marks, ${n - strict} candidates of the second look).`);

  // ---- The placement on the rows, followed again (plantsFirst.ts reconstruct, its lines 819 to 849).
  const state = (i: number): 0 | 1 | 2 => (ground ? ground.state(dots[i].e, dots[i].n) : 0);
  const scattered = new Uint8Array(n); if (q.refuseScattered && ground) for (let i = 0; i < n; i++) if (state(i) === 2) scattered[i] = 1;
  const groupOf = (i: number) => (tier?.[i] ? Math.min(3, tier[i]) : 0);
  const strips = q.alleyTest === "none" ? null : bandAndAlley(lines, A, C, Int8Array.from({ length: n }, (_, i) => groupOf(i)), 4, S, onRow, reach, { ...ROW_GUIDED, controlShare: q.alleyControlShare });
  const beatsAlley = (ri: number, i: number) => {
    if (!strips) return true;
    const s = strips.stretches[strips.stretchOf(ri, A[i])], g = groupOf(i), len = Math.max(s.a1 - s.a0, 1e-6), lo = q.alleyTest === "own" && g > 0 ? 1 : 0, hi = q.alleyTest === "all" ? 3 : g;
    let band = 0, alley = 0; for (let k = lo; k <= hi; k++) { band += s.band[k]; alley += s.alley[k]; }
    return bandBeatsControls(band, Math.round(alley * strips.controlScale), len);
  };
  const nearestRow = (i: number) => { let best = -1, bd = onRow; lines.forEach((r, ri) => { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) return; const d = Math.abs(C[i] - at(r, A[i])); if (d <= bd) { bd = d; best = ri; } }); return best; };
  const along = lines.map(r => r.dots.map(i => A[i])), alongIdx = lines.map(r => [...r.dots]), extra = lines.map(() => [] as number[]);
  // Per dot: the verdict (0 on the row), the row tried, what it was measured against there.
  const why = new Uint8Array(n), triedRow = new Int32Array(n).fill(-1), nearestM = new Float64Array(n).fill(NaN), blocker = new Int32Array(n).fill(-1), courseOf = new Int32Array(n).fill(-1), lineDot = new Uint8Array(n);
  const onCertain = new Uint8Array(n); lines.forEach((r, ri) => { for (const i of r.dots) { onCertain[i] = 1; lineDot[i] = 1; courseOf[i] = ri; } });
  const order = Array.from({ length: n }, (_, i) => i).filter(i => !onCertain[i]).sort((x, y) => (tier ? tier[x] - tier[y] : 0) || dots[y].photos - dots[x].photos);
  for (const i of order) {
    if (scattered[i]) { why[i] = 5; continue; }
    const ri = nearestRow(i); if (ri < 0) { why[i] = 1; continue; }
    triedRow[i] = ri;
    if (tier?.[i] && !beatsAlley(ri, i)) { why[i] = 6; continue; }
    let nearest = Infinity, b = -1; along[ri].forEach((a, k) => { const d = Math.abs(a - A[i]); if (d < nearest) { nearest = d; b = alongIdx[ri][k]; } });
    nearestM[i] = nearest; blocker[i] = b;
    if (nearest < 0.5 * seed) { why[i] = 2; continue; }
    const k = Math.round(nearest / seed);
    if (k < 1 || k > q.maxGapSeeds || Math.abs(nearest - k * seed) > q.probableTol * seed) { why[i] = 3; continue; }
    along[ri].push(A[i]); alongIdx[ri].push(i); extra[ri].push(i); onCertain[i] = 1; courseOf[i] = ri;
  }
  if (q.free) throw new Error("the loosened placement is on: this diagnosis follows the placement without it");
  if (q.sweepLoneMarks && tier) lines.forEach((L, ri) => {
    const company = [...L.dots, ...(q.loneMarkCompany === "located" ? extra[ri].filter(i => !tier[i]) : [])].map(i => A[i]);
    extra[ri] = extra[ri].filter(i => { if (!tier[i] || company.some(a => Math.abs(a - A[i]) <= reach)) return true; why[i] = 8; onCertain[i] = 0; return false; });
  });
  // The check: the verdict followed here against the rules' own, every dot.
  let differ = 0, cutPiece = 0, onGeom = 0;
  const cut = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const on = rec.rowOf[i] >= 0;
    if (on) { if (why[i] !== 0 || !onCertain[i]) { if (rec.rows[rec.rowOf[i]].kind === "geometry") onGeom++; else differ++; } continue; }
    if (why[i] === 0) { cut[i] = 1; cutPiece++; if (rec.why[i] !== 1 && rec.why[i] !== 4) differ++; continue; }
    if (rec.why[i] === 4) { if (!rec.between[i] || (why[i] !== 1 && why[i] !== 5)) differ++; continue; }
    if (rec.why[i] !== why[i]) differ++;
  }
  say(`CHECK 1: the placement followed again gives the rules' own verdict on every dot but ${differ} of ${n} (must be 0). ${cutPiece} dots were put on a row's line and are on no row because their piece of row was cut to under 3 plants; ${onGeom} are on a row found in a free slot.`);
  if (differ) throw new Error("the placement followed here is not the rules' placement");
  geom.forEach((L, gi) => { for (const i of L.dots) if (rec.rowOf[i] >= 0 && courseOf[i] < 0) courseOf[i] = lines.length + gi; });
  // Every row line, and the plants found without a row's help (certain or probable) that are on a row along it.
  const allLines: RowCourse[] = [...lines, ...geom];
  const located: number[][] = allLines.map(() => []);
  for (let i = 0; i < strict; i++) if (rec.rowOf[i] >= 0 && courseOf[i] >= 0) located[courseOf[i]].push(i);
  /** The row line nearest across among those that reach the dot along (as the rules ask); none reaching: the nearest held level, and how far past its end. */
  const lineNear = (a: number, c: number) => {
    let best = -1, bd = Infinity; allLines.forEach((r, ri) => { if (a < r.a0 - reach || a > r.a1 + reach) return; const d = Math.abs(c - at(r, a)); if (d < bd) { bd = d; best = ri; } });
    if (best >= 0) return { line: best, acrossM: bd, reaches: true, pastEndM: Math.max(0, allLines[best].a0 - a, a - allLines[best].a1) };
    allLines.forEach((r, ri) => { const d = Math.hypot(Math.abs(c - at(r, a)), Math.max(0, r.a0 - a, a - r.a1)); if (d < bd) { bd = d; best = ri; } });
    return best < 0 ? null : { line: best, acrossM: Math.abs(c - at(allLines[best], a)), reaches: false, pastEndM: Math.max(0, allLines[best].a0 - a, a - allLines[best].a1) };
  };
  const alongToLocated = (line: number, a: number, not = -1) => { let best = Infinity; for (const j of located[line]) if (j !== not) best = Math.min(best, Math.abs(A[j] - a)); return best; };
  const th = (rec.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), toAC = (e: number, nn: number): [number, number] => [e * ct + nn * st, -e * st + nn * ct];

  // The rule that kept a dot off a row, as one reason: [letters for the picture, the reason, file:line].
  type Reason = { code: string; reason: string; rule: string };
  const RE: Record<string, Reason> = {
    SC: { code: "SC", reason: "The ground there was judged scattered: nothing on it is read as the planting", rule: "plantsFirst.ts:839 (the judgement: plantsFirst.ts:752, cornField.ts:315 and 328)" },
    OFF: { code: "OFF", reason: `Further than ${cm(onRow)} cm (${o.onRowShare} of the row spacing) across from every row line that runs there`, rule: "plantsFirst.ts:840 (the distance: plantsFirst.ts:814 and 819)" },
    END: { code: "END", reason: `No row line runs there: more than ${q.maxGapSeeds} plant spacings past the end of every row line`, rule: "plantsFirst.ts:840 (the reach: plantsFirst.ts:814 and 819)" },
    AL: { code: "AL", reason: "A candidate on a stretch of row whose line does not hold clearly more dots than the ground between the rows", rule: "plantsFirst.ts:842 (the test: plantsFirst.ts:825-832, rowGuided.ts:473)" },
    DB: { code: "DB", reason: "On the row's line, closer along it than half a plant spacing to a plant already on the row", rule: "plantsFirst.ts:844" },
    SP: { code: "SP", reason: `On the row's line, not a whole number of plant spacings from the nearest plant on it (off by more than ${q.probableTol} of a spacing)`, rule: "plantsFirst.ts:846" },
    GAP: { code: "GAP", reason: `On the row's line, more than ${q.maxGapSeeds} plant spacings from the nearest plant on it`, rule: "plantsFirst.ts:846" },
    CUT: { code: "CUT", reason: "Put on the row's line, then its piece of row was cut and held fewer than 3 plants", rule: "plantsFirst.ts:908" },
    LONE: { code: "LONE", reason: "A candidate taken off its row by the final sweep: alone on it", rule: "plantsFirst.ts:874-875" },
  };
  const reasonOf = (i: number): Reason => {
    if (cut[i]) return RE.CUT;
    if (why[i] === 5) return RE.SC;
    if (why[i] === 1) { let any = false; for (const r of lines) if (A[i] >= r.a0 - reach && A[i] <= r.a1 + reach) { any = true; break; } return any ? RE.OFF : RE.END; }
    if (why[i] === 6) return RE.AL;
    if (why[i] === 2) return RE.DB;
    if (why[i] === 8) return RE.LONE;
    if (why[i] === 3) return Math.round(nearestM[i] / seed) > q.maxGapSeeds ? RE.GAP : RE.SP;
    throw new Error(`dot ${i}: on a row`);
  };
  const dotFacts = (i: number) => {
    const L = lineNear(A[i], C[i]), a2 = L ? alongToLocated(L.line, A[i], i) : Infinity, g = state(i);
    return {
      dot: i, photosSaw: dots[i].photos, photosLooked: P.covered[i], certainOnItsOwn: rec.certainty[i] === 0, secondLookTier: tier?.[i] ?? 0,
      acrossToNearestRowLineCm: L ? cm(L.acrossM) : null, rowLineReachesIt: L ? L.reaches : false, pastTheRowLinesEndM: L ? Math.round(L.pastEndM * 100) / 100 : null,
      alongToNearestLocatedPlantM: Number.isFinite(a2) ? Math.round(a2 * 1000) / 1000 : null, alongInSpacings: Number.isFinite(a2) ? Math.round((a2 / seed) * 100) / 100 : null,
      // What the rule itself measured when it tried the dot (the plants on the row at that moment).
      alongExactSpacings: Number.isFinite(a2) ? a2 / seed : null, ruleAlongExactSpacings: Number.isFinite(nearestM[i]) ? nearestM[i] / seed : null,
      ruleRow: triedRow[i], ruleAlongM: Number.isFinite(nearestM[i]) ? Math.round(nearestM[i] * 1000) / 1000 : null, ruleAlongInSpacings: Number.isFinite(nearestM[i]) ? Math.round((nearestM[i] / seed) * 100) / 100 : null, ruleBlocker: blocker[i],
      ground: GROUND[g], shownBetweenTwoRows: rec.between[i] === 1,
    };
  };

  // ---- The second look's candidates, followed again (plantsFirst.ts rowCandidates): which photographs' marks made each.
  const { sights, photos } = projectSightings(reads, frames, F.origin);
  if (photos.length !== P.photos.length) throw new Error("the photographs differ from those the dots were made from");
  const sx = new Float64Array(sights.length), sy = new Float64Array(sights.length), sightDot = new Int32Array(sights.length).fill(-1);
  sights.forEach((s, i) => { const [de, dn] = shiftOf(P.shifts[s.p], s.u, s.v); sx[i] = s.e + de; sy[i] = s.n + dn; });
  for (let d = 0; d < strict; d++) for (const m of dots[d].members) sightDot[m] = d;
  const RC = ROW_RECALL, pOf = new Map(photos.map((nm, i) => [nm, i]));
  const offNadir = (fr: GeorefFrame, u: number, v: number) => (Math.atan(Math.hypot((u - fr.intrinsics.cx) / fr.intrinsics.fx, (v - fr.intrinsics.cy) / fr.intrinsics.fy)) * 180) / Math.PI;
  // A candidate point: where, whose, sharp or not, from which bar; and where it went.
  //   fate 1 left out as within exclM of a dot of the stricter marks (`to`: that dot); 2 its group was one photograph outside the sharp view: dropped;
  //   3 its group became a candidate dot (`to`: the dot).
  const ce: number[] = [], cn: number[] = [], cp: number[] = [], sharp: number[] = [], bar: number[] = [], fate: number[] = [], to: number[] = [];
  const loneX: number[] = [], loneY: number[] = [], loneP: number[] = [], candOfSight = new Int32Array(sights.length).fill(-1);
  sights.forEach((s, i) => {
    if (sightDot[i] >= 0) return; const fr = frames.get(photos[s.p]); if (!fr) return;
    loneX.push(sx[i]); loneY.push(sy[i]); loneP.push(s.p); candOfSight[i] = ce.length;
    ce.push(sx[i]); cn.push(sy[i]); cp.push(s.p); sharp.push(offNadir(fr, s.u, s.v) <= RC.sharpDeg ? 1 : 0); bar.push(0);
  });
  const loneHash = new Hash(loneX, loneY, 0.1);
  // Every lower-bar point of every photograph (also those that are a stricter mark of their own photograph again), for part 2.
  const lowE: number[] = [], lowN: number[] = [], lowP: number[] = [], lowCand: number[] = [];
  const splitSeed = opts.fieldSeed === false ? ROW_POINTS.seedM : P.pre.seedM ?? ROW_POINTS.seedM;
  let lowPhotos = 0;
  for (const r of reads.filter(x => x.low?.length)) {
    const p = pOf.get(r.name), fr = frames.get(r.name); if (p == null || !fr) continue;
    lowPhotos++;
    for (const [x, y] of candidatePoints(r, fr, F.origin, splitSeed)) {
      const u = x * r.scale, v = y * r.scale, g = pixelToGround(fr, u, v); if (!g) continue;
      const [e0, n0] = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [de, dn] = shiftOf(P.shifts[p], u, v), e = e0 + de, nn = n0 + dn;
      let same = -1; loneHash.near(e, nn, RC.sameMarkM, k => { if (loneP[k] === p) same = k; });
      lowE.push(e); lowN.push(nn); lowP.push(p);
      if (same >= 0) { lowCand.push(-1); continue; }
      lowCand.push(ce.length);
      ce.push(e); cn.push(nn); cp.push(p); sharp.push(offNadir(fr, u, v) <= RC.sharpDeg ? 1 : 0); bar.push(1);
    }
  }
  const dotHash = new Hash(dots.slice(0, strict).map(d => d.e), dots.slice(0, strict).map(d => d.n), 0.1);
  const keep: number[] = [];
  for (let i = 0; i < ce.length; i++) { let nd = -1, bd = Infinity; dotHash.near(ce[i], cn[i], RC.exclM, (k, d) => { if (d < bd) { bd = d; nd = k; } }); if (nd >= 0) { fate[i] = 1; to[i] = nd; } else { fate[i] = 0; to[i] = -1; keep.push(i); } }
  {
    const dth = ((F.directionDeg ?? 0) * Math.PI) / 180, dct = Math.cos(dth), dst = Math.sin(dth), kk = RC.gateAlongM / RC.gateAcrossM;
    // plantsFirst.ts's own grouping (mergeXY, reached through mergeDots with no correction and one photograph enough).
    const fake: Sight[] = keep.map(i => ({ p: cp[i], u: 0, v: 0, e: ce[i] * dct + cn[i] * dst, n: (-ce[i] * dst + cn[i] * dct) * kk }));
    const zero: PhotoShift[] = photos.map(() => ({ e: [0, 0, 0], n: [0, 0, 0], u0: 0, v0: 0, cells: 0 }));
    const groups: Dot[] = mergeDots(fake, zero, RC.gateAlongM, 1);
    let k = 0, bad = 0;
    for (const g of groups) {
      const m = g.members.map(j => keep[j]);
      if (m.length === 1 && !sharp[m[0]]) { fate[m[0]] = 2; continue; }
      const d = strict + k++, e = m.reduce((t, i) => t + ce[i], 0) / m.length, nn = m.reduce((t, i) => t + cn[i], 0) / m.length;
      if (d >= n || Math.hypot(dots[d].e - e, dots[d].n - nn) > 1e-9 || dots[d].photos !== m.length) bad++;
      for (const i of m) { fate[i] = 3; to[i] = d; }
    }
    say(`CHECK 2: the candidates followed again are the rules' own: ${k} candidate dots against ${n - strict}, ${bad} that differ in place or photographs (must be 0). ${lowPhotos} of ${photos.length} photographs carry marks at the lower bar; ${ce.length} candidate points (${bar.filter(b => !b).length} stricter marks only one photograph made, ${bar.filter(b => b).length} marks at the lower bar), ${fate.filter(x => x === 1).length} left out as a plant the stricter marks already made, ${fate.filter(x => x === 2).length} dropped as one photograph outside its sharp view.`);
    if (bad || k !== n - strict) throw new Error("the candidates followed here are not the rules' candidates");
  }
  const sightHash = new Hash(sx, sy, 0.1), lowHash = new Hash(lowE, lowN, 0.1), allDotHash = new Hash(dots.map(d => d.e), dots.map(d => d.n), 0.1);

  // ---- The dev tiles, judged as the score judges them.
  type PlantRec = Record<string, unknown> & { tile: string; x: number; y: number; set: 1 | 2; code: string; reason: string; rule: string };
  const part1: PlantRec[] = [], part2: PlantRec[] = [], part3: Record<string, unknown>[] = [], part4: Record<string, unknown>[] = [];
  const P2: Record<string, Reason> = {
    TWO: { code: "TWO", reason: "Merged into a neighbour: its marks are in the dot of the plant beside it, which that plant's label has (two labelled plants, one dot)", rule: "plantsFirst.ts:305 and 317 (one dot of the marks within the merge gate), plantsFirst.ts:378 (a lower-bar mark near that dot is left out)" },
    FAR: { code: "FAR", reason: "Marked; the dot made of those marks stands on a row further than half a spacing from the label", rule: "plantsFirst.ts:317 and 388 (a dot stands at the mean of its photographs' marks)" },
    FARNO: { code: "FARNO", reason: "Marked; the dot made of those marks stands further than half a spacing from the label and is on no row", rule: "plantsFirst.ts:317 and 388, then the rule in the plant's row of the list" },
    NB: { code: "NB", reason: `Marked only at the lower bar, within ${cm(RC.exclM)} cm of a neighbouring plant's dot: taken as that plant again and left out`, rule: "plantsFirst.ts:378" },
    ONE: { code: "ONE", reason: `Marked by one photograph only, further than ${RC.sharpDeg} degrees from straight down in it: dropped for lack of a second photograph`, rule: "plantsFirst.ts:387" },
    NONE: { code: "NONE", reason: "No photograph marked it, at either bar, within half a spacing", rule: "seedlingGreen.ts SEEDLING_ROW (the lower bar)" },
  };
  const edgeOf = (t: MTile, k: MMark, pad: number) => k.u < t.x + pad || k.u >= t.x + t.w - pad || k.v < t.y + pad || k.v >= t.y + t.h - pad;
  const drawings: { t: MTile; items: { x: number; y: number; set: 1 | 2; code: string }[]; found: { x: number; y: number }[]; J: MJudged }[] = [];
  let noRowInTiles = 0;
  const foundMarkFromLabelCm: number[] = [];
  // Every labelled plant of the dev tiles: how far its nearest other labelled plant of the same tile stands.
  const spacing: { tile: string; found: boolean; nearestLabelCm: number; atTheEdge: boolean }[] = [];
  for (const t of X.tiles) {
    const J = X.judge(t, X.marks, X.place, R), labs = X.labels.get(t.id)!;
    const plants = labs.filter(l => l.type === "plant").map(l => { const g = X.place(l.x, l.y)!; return { ...l, e: g[0], n: g[1] }; });
    const unsure = labs.filter(l => l.type === "unsure").map(l => { const g = X.place(l.x, l.y)!; return { ...l, e: g[0], n: g[1] }; });
    const nr = X.noRow.filter(k => X.within(t, k.u, k.v, J.pad)), nrIn = nr.map(k => X.within(t, k.u, k.v));
    noRowInTiles += nrIn.filter(Boolean).length;
    const items: { x: number; y: number; set: 1 | 2; code: string }[] = [];
    // The label a mark was matched to.
    const labelOfMark = new Int32Array(J.ms.length).fill(-1); J.plantOf.forEach((j, i) => { if (j >= 0) labelOfMark[j] = i; });
    const otherLabelCm = (i: number) => { let b = Infinity; plants.forEach((p2, k) => { if (k !== i) b = Math.min(b, Math.hypot(p2.e - plants[i].e, p2.n - plants[i].n)); }); return Number.isFinite(b) ? cm(b) : null; };
    plants.forEach((pl, i) => { if (plants.length > 1) spacing.push({ tile: t.id, found: J.plantFound[i], nearestLabelCm: otherLabelCm(i)!, atTheEdge: pl.x < t.x + J.pad * 2 || pl.x >= t.x + t.w - J.pad * 2 || pl.y < t.y + J.pad * 2 || pl.y >= t.y + t.h - J.pad * 2 }); });
    plants.forEach((pl, i) => { if (J.plantFound[i]) { const k = J.ms[J.plantOf[i]]; foundMarkFromLabelCm.push(cm(Math.hypot(k.e - pl.e, k.n - pl.n))); } });
    const looked = coverage(plants.map(p => ({ e: p.e, n: p.n, members: [], photos: 0, spreadM: 0 })), frames, photos, P.shifts, F.origin);
    plants.forEach((pl, i) => {
      if (J.plantFound[i]) return;
      const near = nr.map((k, j) => [Math.hypot(k.e - pl.e, k.n - pl.n), j] as [number, number]).filter(x => x[0] <= R).sort((x, y) => x[0] - y[0]);
      const [la, lc] = toAC(pl.e, pl.n), LL = lineNear(la, lc);
      const base = { tile: t.id, x: Math.round(pl.x), y: Math.round(pl.y), nearestOtherLabelCm: otherLabelCm(i), labelAcrossToNearestRowLineCm: LL ? cm(LL.acrossM) : null, photosLookedAtTheLabel: looked[i] };
      // A mark on a row within the matching distance that another labelled plant has.
      const taken = J.ms.map((k, j) => [Math.hypot(k.e - pl.e, k.n - pl.n), j] as [number, number]).filter(x => x[0] <= R).sort((x, y) => x[0] - y[0]);
      if (near.length) {
        // 1. A dot of the stricter marks on no row within the matching distance: the nearest.
        const d = nr[near[0][1]].i!, why1 = reasonOf(d), bl = blocker[d];
        // The plant on the row the rule measured from: what it is in this tile's match.
        const bm = bl >= 0 ? J.ms.findIndex(k => k.i === bl) : -1;
        const blockerIs = bl < 0 ? null : bm < 0 ? "not in this tile's marks" : J.state[bm] === 1 ? "a mark on another labelled plant" : J.state[bm] === 2 ? "a mark on an unsure label" : J.state[bm] === 0 ? "a wrong mark" : "a mark at the tile's edge, not judged";
        const blockerLabelCm = bm >= 0 && labelOfMark[bm] >= 0 ? cm(Math.hypot(plants[labelOfMark[bm]].e - pl.e, plants[labelOfMark[bm]].n - pl.n)) : null;
        part1.push({ ...base, set: 1, ...why1, dotFromLabelCm: cm(near[0][0]), dotsOnNoRowWithinReach: near.length, aMarkOnARowWithinReachToo: taken.length > 0, ...dotFacts(d), ruleBlockerIs: blockerIs, labelOfTheRuleBlockerCm: blockerLabelCm });
        items.push({ x: pl.x, y: pl.y, set: 1, code: why1.code });
        return;
      }
      // 2. None: what the photographs marked within the matching distance of the label, and where each mark went.
      const strictPhotos = new Set<number>(), lowPhotosHere = new Set<number>(), dest = new Map<number, number>(), fates = { excl: 0, dropped: 0 }, exclTo = new Set<number>(), droppedPhotos = new Set<number>();
      const sendCand = (c: number) => { if (fate[c] === 1) { fates.excl++; exclTo.add(to[c]); } else if (fate[c] === 2) { fates.dropped++; droppedPhotos.add(cp[c]); } else dest.set(to[c], (dest.get(to[c]) ?? 0) + 1); };
      sightHash.near(pl.e, pl.n, R, k => { strictPhotos.add(sights[k].p); if (sightDot[k] >= 0) dest.set(sightDot[k], (dest.get(sightDot[k]) ?? 0) + 1); else sendCand(candOfSight[k]); });
      lowHash.near(pl.e, pl.n, R, k => { lowPhotosHere.add(lowP[k]); if (lowCand[k] >= 0) sendCand(lowCand[k]); });
      // Every dot within the matching distance of the label, of any kind.
      const dotsNear: [number, number][] = []; allDotHash.near(pl.e, pl.n, R, (k, d) => dotsNear.push([d, k])); dotsNear.sort((x, y) => x[0] - y[0]);
      const onRowNear = dotsNear.filter(([, k]) => rec.rowOf[k] >= 0), candNoRowNear = dotsNear.filter(([, k]) => rec.rowOf[k] < 0 && k >= strict);
      const dests = [...dest.keys()].map(d => ({ dot: d, marks: dest.get(d)!, fromLabelCm: cm(Math.hypot(dots[d].e - pl.e, dots[d].n - pl.n)), onARow: rec.rowOf[d] >= 0, kind: d < strict ? "stricter marks" : `second look, ${tier![d] === 1 ? "2+ photographs" : "1 photograph"}`, photos: dots[d].photos, offRowWhy: rec.rowOf[d] >= 0 ? null : reasonOf(d).code })).sort((x, y) => x.fromLabelCm - y.fromLabelCm);
      let r2: Reason, detail: Record<string, unknown> = {};
      const takenToo = taken.length || onRowNear.length ? { aNeighboursMarkWithinReachCm: taken.length ? cm(taken[0][0]) : cm(onRowNear[0][0]), thatNeighboursLabelCm: taken.length && labelOfMark[taken[0][1]] >= 0 ? cm(Math.hypot(plants[labelOfMark[taken[0][1]]].e - pl.e, plants[labelOfMark[taken[0][1]]].n - pl.n)) : null } : {};
      if (candNoRowNear.length) {
        // Its own dot of the second look, within the matching distance, on no row: the rule that refused that dot.
        const d = candNoRowNear[0][1], bl = blocker[d], bm = bl >= 0 ? J.ms.findIndex(k => k.i === bl) : -1; r2 = reasonOf(d);
        detail = { candidateDot: true, dotFromLabelCm: cm(candNoRowNear[0][0]), ...dotFacts(d), ruleBlockerIs: bl < 0 ? null : bm < 0 ? "not in this tile's marks" : J.state[bm] === 1 ? "a mark on another labelled plant" : J.state[bm] === 2 ? "a mark on an unsure label" : J.state[bm] === 0 ? "a wrong mark" : "a mark at the tile's edge, not judged", labelOfTheRuleBlockerCm: bm >= 0 && labelOfMark[bm] >= 0 ? cm(Math.hypot(plants[labelOfMark[bm]].e - pl.e, plants[labelOfMark[bm]].n - pl.n)) : null, ...takenToo };
      } else if (taken.length || onRowNear.length) {
        r2 = P2.TWO; const j = taken.length ? taken[0][1] : -1;
        detail = { ...takenToo, markTier: j >= 0 ? TIER[J.ms[j].tier] : null };
      } else if (dests.some(d => d.onARow)) {
        r2 = P2.FAR; const d = dests.find(x => x.onARow)!, m = J.ms.findIndex(k => k.i === d.dot);
        detail = { dotFromLabelCm: d.fromLabelCm, dotKind: d.kind, dotPhotos: d.photos, thatDotInTheScore: m < 0 ? "not in this tile's marks" : J.state[m] === 1 ? "the mark of another labelled plant" : J.state[m] === 2 ? "a mark on an unsure label" : J.state[m] === 0 ? "a wrong mark" : "a mark at the tile's edge, not judged" };
      }
      else if (dests.length) { r2 = P2.FARNO; const d = dests[0]; detail = { dotFromLabelCm: d.fromLabelCm, dotKind: d.kind, dotPhotos: d.photos, thatDotOffItsRowBy: d.offRowWhy }; }
      else if (fates.excl) { r2 = P2.NB; const d = [...exclTo][0]; detail = { neighbourDotFromLabelCm: cm(Math.hypot(dots[d].e - pl.e, dots[d].n - pl.n)), neighbourDotOnARow: rec.rowOf[d] >= 0 }; }
      else if (fates.dropped) { r2 = P2.ONE; detail = { photographsWhoseMarkWasDropped: droppedPhotos.size }; }
      else r2 = P2.NONE;
      part2.push({ ...base, set: 2, ...r2, photosWithAStricterMark: strictPhotos.size, photosWithALowerBarMark: lowPhotosHere.size, thisPhotoMarkedItStricter: strictPhotos.has(pi), thisPhotoMarkedItLower: lowPhotosHere.has(pi), marksLeftOutAsANeighbour: fates.excl, marksDroppedOnePhotograph: fates.dropped, whereTheMarksWent: dests, ...detail });
      items.push({ x: pl.x, y: pl.y, set: 2, code: r2.code });
    });
    // 3. The dots on no row in the tile: on a labelled plant (one a plant with no mark first), on an unsure label, on neither.
    const missed = plants.map((_, i) => i).filter(i => !J.plantFound[i]);
    const candM = missed.map(i => nr.map((k, j) => [Math.hypot(k.e - plants[i].e, k.n - plants[i].n), j] as [number, number]).filter(x => x[0] <= R).sort((x, y) => x[0] - y[0]).map(x => x[1]));
    const takenP = new Int32Array(nr.length).fill(-1); maxMatch(candM, nr.length, takenP);
    const takenU = Int32Array.from(takenP, x => (x >= 0 ? -2 : -1));
    maxMatch(unsure.map(u => nr.map((k, j) => [Math.hypot(k.e - u.e, k.n - u.n), j] as [number, number]).filter(x => x[0] <= R).sort((x, y) => x[0] - y[0]).map(x => x[1])), nr.length, takenU);
    nr.forEach((k, j) => {
      if (!nrIn[j]) return;
      const d = k.i!, L = lineNear(A[d], C[d]);
      const cls = takenP[j] >= 0 ? "plant with no mark" : takenU[j] >= 0 ? "unsure" : plants.some(p => Math.hypot(p.e - k.e, p.n - k.n) <= R) ? "plant, a second dot" : edgeOf(t, k, J.pad) ? "neither, at the edge" : "neither";
      part3.push({ tile: t.id, planted: plants.length > 0, dot: d, cls, code: reasonOf(d).code, acrossCm: L && L.reaches ? cm(L.acrossM) : null, photosSaw: dots[d].photos, photosLooked: P.covered[d], ground: GROUND[state(d)] });
    });
    // 4. The wrong marks on a tile with no labelled plant.
    if (!plants.length) J.ms.forEach((k, j) => {
      if (J.state[j] !== 0 || !X.within(t, k.u, k.v)) return;
      const d = k.i!, row = rec.rows[rec.rowOf[d]], ri = courseOf[d], pos = row.dots.indexOf(d), gs = [0, 0, 0]; for (const i of row.dots) gs[state(i)]++;
      const prev = pos > 0 ? A[d] - A[row.dots[pos - 1]] : null, next = pos + 1 < row.dots.length ? A[row.dots[pos + 1]] - A[d] : null;
      const tiers = [0, 0, 0, 0]; for (const i of row.dots) tiers[i >= strict ? (tier![i] === 1 ? 2 : 3) : rec.certainty[i] === 0 ? 0 : 1]++;
      part4.push({ tile: t.id, u: Math.round(k.u), v: Math.round(k.v), dot: d, tier: TIER[k.tier], photosSaw: dots[d].photos, photosLooked: P.covered[d], ground: GROUND[state(d)],
        row: row.id, rowKind: row.kind, rowLengthM: Math.round(row.lengthM * 100) / 100, rowPlants: row.dots.length, rowPlantsByTier: tiers, rowPlantsByGround: { notJudged: gs[0], planted: gs[1], scattered: gs[2] },
        placeOnTheRow: pos + 1, fromTheRowsStartM: Math.round((A[d] - row.a0) * 100) / 100, fromTheRowsEndM: Math.round((row.a1 - A[d]) * 100) / 100, toThePlantBeforeM: prev == null ? null : Math.round(prev * 1000) / 1000, toThePlantAfterM: next == null ? null : Math.round(next * 1000) / 1000,
        how: lineDot[d] ? "line" : ri >= lines.length ? "slot" : "placed", courseIndex: ri, placedAlongM: Number.isFinite(nearestM[d]) ? Math.round(nearestM[d] * 1000) / 1000 : null, placedInSpacings: Number.isFinite(nearestM[d]) ? Math.round((nearestM[d] / seed) * 100) / 100 : null, a: A[d], c: C[d] });
    });
    if (plants.length) drawings.push({ t, items, found: plants.filter((_, i) => J.plantFound[i]).map(p => ({ x: p.x, y: p.y })), J });
  }
  say(`Plants not found: ${part1.length + part2.length} (${part1.length} with a dot of the stricter marks on no row within the matching distance, ${part2.length} with none). Dots on no row in the dev tiles: ${noRowInTiles}. Wrong marks on tiles with no labelled plant: ${part4.length}.`);

  // 4, further: how each certain plant got its row number (plantsFirst.ts rowNumbers), for the marks the row line was fitted through.
  {
    const cellAlongM = 10, cellAcrossM = 6, minPlants = 12;
    let aMin = Infinity, cMin = Infinity, aMax = -Infinity, cMax = -Infinity; for (let i = 0; i < n; i++) { aMin = Math.min(aMin, A[i]); aMax = Math.max(aMax, A[i]); cMin = Math.min(cMin, C[i]); cMax = Math.max(cMax, C[i]); }
    const W = Math.max(1, Math.ceil((aMax - aMin) / cellAlongM)), H = Math.max(1, Math.ceil((cMax - cMin) / cellAcrossM));
    const cellAt = (a: number, c: number) => Math.min(W - 1, Math.floor((a - aMin) / cellAlongM)) * H + Math.min(H - 1, Math.floor((c - cMin) / cellAcrossM));
    const sxx = new Float64Array(W * H), syy = new Float64Array(W * H), cnt = new Int32Array(W * H);
    for (let i = 0; i < n; i++) if (rec.certainty[i] === 0 && !tier?.[i] && !scattered[i]) { const k = cellAt(A[i], C[i]), tt = (2 * Math.PI * C[i]) / S; sxx[k] += Math.cos(tt); syy[k] += Math.sin(tt); cnt[k]++; }
    // The rules' own row numbers, to check the cells counted here against.
    const isCertain = new Uint8Array(n); for (let i = 0; i < n; i++) if (rec.certainty[i] === 0 && !tier?.[i] && !scattered[i]) isCertain[i] = 1;
    const RN = rowNumbers(A, C, isCertain, S, cellAlongM, cellAcrossM, minPlants, q.patternCellsOnly && !!ground);
    let flatHere = 0, cellsDiffer = 0; for (let k = 0; k < W * H; k++) if (cnt[k] >= minPlants && Math.hypot(sxx[k], syy[k]) / cnt[k] < 0.3) flatHere++;
    for (let i = 0; i < n; i++) { const k = cellAt(A[i], C[i]), flat = cnt[k] >= minPlants && Math.hypot(sxx[k], syy[k]) / cnt[k] < 0.3; if (flat !== !Number.isFinite(RN.resid[i])) cellsDiffer++; }
    say(`CHECK 3: the cells of the row numbers counted again: ${flatHere} cells with plants and no pattern against the rules' ${rec.unplanted.flatCells}, ${cellsDiffer} dots whose cell differs (must be 0).`);
    if (flatHere !== rec.unplanted.flatCells || cellsDiffer) throw new Error("the cells counted here are not the rules' cells");
    for (const r of part4) {
      r.rowNumber = Number.isFinite(RN.resid[r.dot as number]) ? RN.j[r.dot as number] : null; r.fromItsRowNumbersLineCm = Number.isFinite(RN.resid[r.dot as number]) ? cm(Math.abs(RN.resid[r.dot as number])) : null;
      const k = cellAt(r.a as number, r.c as number), strength = cnt[k] ? Math.hypot(sxx[k], syy[k]) / cnt[k] : 0;
      r.cellIndex = k; r.cellCertainPlants = cnt[k]; r.cellPattern = Math.round(strength * 100) / 100;
      r.cell = cnt[k] >= minPlants ? (strength >= 0.3 ? "its own pattern" : "plants and no pattern") : "too few certain plants: the nearest held cell's offset";
      const L = allLines[r.courseIndex as number]; r.lineCertainPlants = L.dots.length; r.lineRowNumbers = [...new Set(L.dots.map(i => RN.j[i]))];
      r.linePlantsInThisPhotosDevTilesWithNoPlants = L.dots.filter(i => part4.some(x => x.dot === i)).length; r.lineLengthM = Math.round((L.a1 - L.a0) * 100) / 100;
      const gs = [0, 0, 0]; for (const i of L.dots) gs[state(i)]++; r.linePlantsByGround = { notJudged: gs[0], planted: gs[1], scattered: gs[2] };
      delete r.a; delete r.c;
    }
  }

  // 5. The planted dev tiles: the plants not found, the two sets in two colours, the reason's letters beside each.
  const CYAN: Rgb = [0, 230, 255], MAGENTA: Rgb = [255, 70, 230], GREEN: Rgb = [60, 255, 90], GREY: Rgb = [170, 170, 170], WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0];
  const allReasons = { ...RE, ...P2 };
  for (const D of drawings) {
    const t = D.t, Z = 2, used = [...new Set(D.items.map(i => `${i.set}${i.code}`))].sort(), HEAD = 100 + 30 * used.length;
    const c = X.cut(X.image(), t.x, t.y, t.w, t.h, Z, HEAD), pos = (u: number, v: number): [number, number] => [(u - t.x) * Z, (v - t.y) * Z + HEAD];
    for (const k of X.noRow) if (X.within(t, k.u, k.v)) { const [x, y] = pos(k.u, k.v); X.ring(c, x, y, 5, 1, GREY); }
    D.J.ms.forEach(k => { if (X.within(t, k.u, k.v)) { const [x, y] = pos(k.u, k.v); X.ring(c, x, y, 9, 1, WHITE); } });
    for (const p of D.found) { const [x, y] = pos(p.x, p.y); X.disc(c, x, y, 3, GREEN); }
    for (const it of D.items) {
      const [x, y] = pos(it.x, it.y), col = it.set === 1 ? CYAN : MAGENTA;
      X.square(c, x, y, 14, 3, col); X.disc(c, x, y, 3, col);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) X.text(c, x + 19 + dx, y - 8 + dy, it.code, 2, BLACK);
      X.text(c, x + 19, y - 8, it.code, 2, col);
    }
    for (let i = 0; i < c.w * HEAD; i++) { c.data[i * 4] = 20; c.data[i * 4 + 1] = 20; c.data[i * 4 + 2] = 20; }
    const n1 = D.items.filter(i => i.set === 1).length, n2 = D.items.length - n1;
    X.text(c, 12, 10, `TILE ${t.id} OF PHOTO ${X.tag} (X ${t.x}-${t.x + t.w}, Y ${t.y}-${t.y + t.h}): THE LABELLED PLANTS NOT FOUND, BRANCH WITH THE SWEEP OFF, HALF SPACING`, 3, WHITE);
    X.text(c, 12, 40, `BLUE SQUARE = NOT FOUND, A DOT ON NO ROW STANDS ON IT (${n1}). PINK SQUARE = NOT FOUND, NO SUCH DOT (${n2}). THE LETTERS BESIDE IT = THE REASON:`, 3, WHITE);
    X.text(c, 12, 70, `GREEN SPOT = A PLANT YOU LABELLED, FOUND. WHITE RING = A MARK ON A ROW. SMALL GREY RING = A DOT ON NO ROW.`, 3, GREY);
    used.forEach((u, li) => { const set = Number(u[0]) as 1 | 2, code = u.slice(1), cnt = D.items.filter(i => i.set === set && i.code === code).length; X.text(c, 12, 100 + li * 30, `${code} (${cnt}) = ${allReasons[code].reason.replace(/'/g, "").replace(/[:;]/g, ",")}`.slice(0, 145), 3, set === 1 ? CYAN : MAGENTA); });
    writeFileSync(join(X.out, `MISSES-${t.id}.jpg`), X.encode(c));
  }
  writeFileSync(join(X.out, "misses.json"), JSON.stringify({ rowSpacingM: S, plantSpacingM: seed, matchM: R, onRowLineM: onRow, reachM: reach, exclM: RC.exclM, sharpDeg: RC.sharpDeg, lowPhotos, photographs: photos.length, dots: n, strictDots: strict, rowLines: lines.length, slotRows: geom.length, checks: log, reasons: allReasons, part1, part2, part3, part4, spacing, foundMarkFromLabelCm }, null, 1));
  writeFileSync(join(X.out, "misses.log"), log.join("\n") + "\n");
}
