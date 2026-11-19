// L5 Field profile: what the field is, learned from L4's certain plants (2026-11-18, the rows part moved out of
// plantsFirst.ts reconstruct, unchanged).
//
//   in:   the field's dots (L3), L4's certain plants, the rows' direction and spacing guessed from the field
//         (cornField.ts), the placing options, the sequence options, a first reading of the rows through the certain
//         dots (L3's `pre`, from the same certain dots), and the field's judgement of the ground (cornField.ts)
//   out:  the rows' frame (direction, row spacing), every dot's place in it (along, across), the row number each dot
//         stands at (the planter's pattern), the row lines the certain plants make, the plant spacing (or null: not
//         measured), whether the rules counted in plant spacings may run, the gaps between neighbouring certain
//         plants on the row lines, the too-close limit, and the ground each dot stands on (scattered or not)
//
// Everything here comes from L4's certain plants, except the ground: that is cornField.ts's judgement, made from
// every photograph's marks before the dots are placed (cornField.ts plantedGround). `profileOf` writes the record
// with each value marked measured or not.
import { type CornPhotoRead, FIELD, plantedGround } from "../cornField";
import { type Dot, type GroundJudge, PLANTS_FIRST, type PlantsFirstOptions, type Reconstruction, type RowCourse, type RowsFromDots, SEQUENCE, type Sight, courseAt, rowNumbers, rowsFromDots } from "../plantsFirst";
import type { ObviousPlants } from "./l4Obvious";
import { LAYERS, type LayerOptions } from "./options";

/** Quartiles (and the count) of a list of numbers; nulls with none. */
export function quartiles(xs: ArrayLike<number>): { q1: number | null; q2: number | null; q3: number | null; n: number } {
  const t = Array.from(xs).filter(Number.isFinite).sort((a, b) => a - b), at = (f: number) => (t.length ? t[Math.min(t.length - 1, Math.floor(f * t.length))] : null);
  return { q1: at(0.25), q2: at(0.5), q3: at(0.75), n: t.length };
}
/** The gaps between neighbouring plants along each row line, metres (`A`: each dot's place along the rows). */
export function gapsOnLines(lines: { dots: number[] }[], A: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (const r of lines) { const as = r.dots.map(i => A[i]).sort((x, y) => x - y); for (let k = 1; k < as.length; k++) out.push(as[k] - as[k - 1]); }
  return out.sort((x, y) => x - y);
}
/** The plant spacing's spread: the quartiles of every gap between neighbouring certain plants on the row lines, and of
 * the gaps that are one plant spacing (the nearest whole number of spacings is 1); the single ones' lower fence
 * Q1 - fence x (Q3 - Q1) and upper fence Q3 + fence x (Q3 - Q1). Null single quartiles where the spacing is not measured. */
export function spacingSpread(gapsM: number[], seedM: number | null, fence = LAYERS.tooCloseFence) {
  const single = seedM ? quartiles(gapsM.filter(g => Math.round(g / seedM) === 1)) : { q1: null, q2: null, q3: null, n: 0 };
  const iqr = single.q1 != null && single.q3 != null ? single.q3 - single.q1 : null;
  return { all: quartiles(gapsM), single, lowerFenceM: iqr != null ? single.q1! - fence * iqr : null, upperFenceM: iqr != null ? single.q3! + fence * iqr : null };
}

/**
 * The ground judged from L4's certain plants only (LAYERS.groundFromObvious, phase 2a): cornField.ts plantedGround,
 * with the same options (FIELD.planted) and in the rows' frame, over the certain dots, each counted as many times as
 * photographs made it (so a square holds about as many as it holds sightings of those plants). Null where the
 * certain plants are too few or show the planting on too little of the ground.
 */
export function groundFromObvious(dots: Dot[], certainIdx: number[], directionDeg: number, pitchM: number, o = FIELD.planted): (GroundJudge & { judged: { planted: number; scattered: number; judged: number; spacingM: number; valid: boolean; points: number } }) | null {
  if (!o) return null;
  const th = (directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), pts: [number, number][] = [];
  for (const i of certainIdx) { const d = dots[i], a = d.e * ct + d.n * st, c = -d.e * st + d.n * ct; for (let k = 0; k < d.photos; k++) pts.push([a, c]); }
  const pg = plantedGround(pts, pitchM, o);
  if (!pg || !pg.valid) return null;
  return { state: (e, n) => pg.at(e * ct + n * st, -e * st + n * ct), dotState: null, judged: { planted: pg.planted, scattered: pg.scattered, judged: pg.judged, spacingM: pg.spacingM, valid: pg.valid, points: pts.length } };
}

export type RowProfile = ReturnType<typeof rowProfile>;

export function rowProfile(dots: Dot[], L4: ObviousPlants, directionDeg: number, spacingGuessM: number, o: PlantsFirstOptions = PLANTS_FIRST, q = SEQUENCE, pre: RowsFromDots | null = null, ground: GroundJudge | null = null, layers: LayerOptions = LAYERS) {
  const n = dots.length, cIdx = L4.certainIdx;
  // Phase 2a (off by default): the ground from L4's certain plants only, in place of the field's (every mark's).
  const groundL4 = layers.groundFromObvious ? groundFromObvious(dots, cIdx, directionDeg, spacingGuessM) : null;
  if (layers.groundFromObvious) ground = groundL4;
  const R1 = pre ?? rowsFromDots(cIdx.map(i => dots[i]), directionDeg, spacingGuessM, o);
  const th = (R1.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th), S = R1.spacingM;
  const A = new Float64Array(n), C = new Float64Array(n);
  for (let i = 0; i < n; i++) { A[i] = dots[i].e * ct + dots[i].n * st; C[i] = -dots[i].e * st + dots[i].n * ct; }
  // Ground the field's plants show as scattered: nothing there is the planting (q.refuseScattered).
  const judge = q.refuseScattered ? ground : null, scattered = new Uint8Array(n);
  if (judge) for (let i = 0; i < n; i++) if ((judge.dotState ? judge.dotState[i] : judge.state(dots[i].e, dots[i].n)) === 2) scattered[i] = 1;
  const overScattered = (L: RowCourse, a0: number, a1: number) => { if (!judge) return false; for (let a = a0 + 0.25; a < a1; a += 0.5) { const c = courseAt(L, a); if (judge.state(a * ct - c * st, a * st + c * ct) === 2) return true; } return false; };
  // A planter drives straight, but the ground the photographs are placed on is not rigid over a whole flight (cameras
  // without RTK drift by tens of centimetres over a hundred metres): a row is straight over a stretch and follows that
  // slow drift. Its course is a line fitted locally (tricube weights within `localM` either way), every 2 m along it,
  // robustly: plants further than `fitTol` of a spacing from the course are dropped and it is fitted again.
  type Line = RowCourse;
  const at = courseAt;
  const course = (use: number[], a0: number, a1: number): { ka: Float64Array; kc: Float64Array } => {
    const sorted = [...use].sort((x, y) => A[x] - A[y]), ka: number[] = [], kc: number[] = [], h = q.localM;
    for (let a = a0; ; a = Math.min(a1, a + 2)) {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const i of sorted) { const d = A[i] - a; if (d < -h) continue; if (d > h) break; const w = (1 - Math.abs(d / h) ** 3) ** 3; sw += w; sx += w * d; sy += w * C[i]; sxx += w * d * d; sxy += w * d * C[i]; }
      if (sw > 0) { const det = sw * sxx - sx * sx; const c = Math.abs(det) > 1e-9 && sw >= 3 ? (sy * sxx - sx * sxy) / det : sy / sw; ka.push(a); kc.push(c); }
      if (a >= a1) break;
    }
    return { ka: Float64Array.from(ka), kc: Float64Array.from(kc) };
  };
  const fit = (idx: number[]): Line | null => {
    if (idx.length < 2) return null;
    let use = idx, L: Line | null = null;
    for (let it = 0; it < 4; it++) {
      const a0 = Math.min(...use.map(i => A[i])), a1 = Math.max(...use.map(i => A[i]));
      const k = course(use, a0, a1); if (k.ka.length < 1) break;
      L = { ...k, a0, a1, dots: use };
      const keep = idx.filter(i => Math.abs(C[i] - at(L!, A[i])) <= q.fitTol * S);
      if (keep.length === use.length || keep.length < 2) break;
      use = keep;
    }
    return L;
  };
  // Each certain plant's row number from the planter's pattern (rowNumbers), and one straight line per row number.
  const isCertain = new Uint8Array(n); for (const i of cIdx) if (!scattered[i]) isCertain[i] = 1;
  // Only on a flight whose ground the field's plants judged: where they show the planting nowhere (a canopy, where one
  // dot is not one plant), a cell without the pattern says nothing about the ground (measured 2026-11-16 on a flight
  // 45 days after planting, not judged: one cell of a planted field lost its rows, 35 m of them).
  const RN = rowNumbers(A, C, isCertain, S, undefined, undefined, undefined, q.patternCellsOnly && !!ground);
  const byJ = new Map<number, number[]>();
  for (const i of cIdx) if (!scattered[i] && Math.abs(RN.resid[i]) <= 0.2 * S) (byJ.get(RN.j[i]) ?? byJ.set(RN.j[i], []).get(RN.j[i])!).push(i);
  let lines = [...byJ.values()].filter(g => g.length >= 5).map(fit).filter((L): L is Line => !!L && L.a1 - L.a0 >= q.minCertainRowM);
  // Pieces of one row joined: two lines that agree (within `joinTol` of a spacing) where one ends and the other begins.
  for (let changed = true; changed;) {
    changed = false;
    lines.sort((x, y) => x.a0 - y.a0);
    outer: for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j], mid = (Math.min(a.a1, b.a1) + Math.max(a.a0, b.a0)) / 2;
      if (Math.abs(at(a, mid) - at(b, mid)) > q.joinTol * S) continue;
      // Not two neighbouring rows overlapping: where both hold plants, they must be the same line all along.
      const ov0 = Math.max(a.a0, b.a0), ov1 = Math.min(a.a1, b.a1);
      if (ov1 > ov0 && (Math.abs(at(a, ov0) - at(b, ov0)) > q.joinTol * S || Math.abs(at(a, ov1) - at(b, ov1)) > q.joinTol * S)) continue;
      const m = fit([...a.dots, ...b.dots]); if (!m) continue;
      lines = lines.filter((_, k) => k !== i && k !== j); lines.push(m); changed = true; break outer;
    }
  }
  // 3. The field's own geometry, from the certain rows.
  const med = (xs: number[]) => { const t = [...xs].sort((x, y) => x - y); return t.length ? t[t.length >> 1] : NaN; };
  // The plant spacing, and whether the rules counted in spacings may run (q.spacingRulesNeedASpacing): where it is
  // not measured they do not; without that option 0.18 m stands in for it, as before.
  const seedM = R1.seedM, seed = seedM ?? 0.18, spacingRules = seedM != null || !q.spacingRulesNeedASpacing;
  const geometry = { spacingM: S, directionDeg: R1.directionDeg, seedM, rowLengthMedianM: med(lines.map(r => r.a1 - r.a0)), perMMedian: med(lines.map(r => r.dots.length / Math.max(1e-6, r.a1 - r.a0))), certainDots: cIdx.length, certainRows: lines.length };
  // How close to a plant on its row is a double: half a plant spacing, or (q.tooCloseFromField) the distance under
  // which the lowest `tooCloseQuantile` of the gaps between neighbouring certain plants on the row lines fall.
  const certainGapsM: number[] = [];
  for (const r of lines) { const as = r.dots.map(i => A[i]).sort((x, y) => x - y); for (let k = 1; k < as.length; k++) certainGapsM.push(as[k] - as[k - 1]); }
  certainGapsM.sort((x, y) => x - y);
  // The spacing's spread (recorded; read by L6 only with LAYERS.tooCloseFromSpread): the single-spacing gaps' quartiles.
  const spread = spacingSpread(certainGapsM, seedM, layers.tooCloseFence);
  let tooClose = q.tooCloseFromField && certainGapsM.length ? certainGapsM[Math.min(certainGapsM.length - 1, Math.floor(q.tooCloseQuantile * certainGapsM.length))] : 0.5 * seed;
  // Phase 3b (off by default): the lower fence of the single spacings, held between two shares of the spacing.
  if (layers.tooCloseFromSpread && seedM != null && spread.lowerFenceM != null) tooClose = Math.min(layers.tooCloseMaxShare * seedM, Math.max(layers.tooCloseMinShare * seedM, spread.lowerFenceM));
  return { R1, th, ct, st, S, A, C, scattered, overScattered, course, fit, at, RN, lines, geometry, seedM, seed, spacingRules, certainGapsM, tooClose, spread, groundL4: groundL4 ? groundL4.judged : null };
}

/** A value of the profile: what it is, and whether the field measured it or it stands in. */
export type Measured<T> = { value: T; measured: boolean; note?: string };
const med = (xs: number[]) => { const t = xs.filter(Number.isFinite).sort((a, b) => a - b); return t.length ? t[t.length >> 1] : null; };
const rnd = (x: number | null | undefined, k = 1000) => (x == null || !Number.isFinite(x) ? null : Math.round(x * k) / k);
const qr = (Q: ReturnType<typeof quartiles>, k = 1000) => ({ q1: rnd(Q.q1, k), q2: rnd(Q.q2, k), q3: rnd(Q.q3, k), n: Q.n });

/**
 * The field profile as a record (2026-11-18; for the inspector's L5 step and the reports; nothing reads it back): every
 * value says measured or not measured. Learned from L4's certain plants (the dots `rec.certainty` 0: L6 never makes a
 * dot certain, so they are exactly L4's), except where a value says otherwise:
 *   rows               spacing, direction, the certain row lines, their lengths (mean and median)
 *   plant spacing      its value, and its spread (quartiles of every gap between neighbouring certain plants on a row
 *                      line, and of the single-spacing ones), the too-close limit the judge used
 *   typical plant      per photograph, from the sightings of the certain plants in it: size (photo pixels, the square
 *                      root of the green's area), green ((2g - r - b) / (r + g + b)), shape (outline solidity, lone
 *                      plants only); beside it, the same over ALL the photograph's marks, to show what L4 changes
 *   ground             the field's (cornField.ts, from every photograph's marks: NOT from L4) and, with phase 2a on, L4's
 *   misreads           the photographs whose row spacing the guard called misread, and by how much
 *   cores reference    per photograph, what a vivid core was measured against (CORN_CORES.reference) and the bar it set:
 *                      recorded from the read (not from L4: the read makes it before any flight exists)
 */
export function fieldProfile(P: { all: Dot[]; strict: number; photos: string[]; sights?: Sight[] }, rec: Reconstruction, reads: CornPhotoRead[], ground: { judged: boolean; plantedM2: number; scatteredM2: number; why: string | null } | null,
  guard: { medianSpacingM: number | null; withheld: { name: string; reason: string; ratio: number | null }[] } | null, misreadMessage: string | null, extra: { spread?: ReturnType<typeof spacingSpread>; groundL4?: unknown } = {}) {
  const G = rec.geometry, lines = rec.courses, seedM = G.seedM;
  const gaps = gapsOnLines(lines, rec.a), spread = extra.spread ?? spacingSpread(gaps, seedM);
  const lens = lines.map(r => r.a1 - r.a0);
  // Per photograph: the looks of the certain plants' sightings in it, and of all its marks.
  const readOf = new Map(reads.map(r => [r.name, r])), perPhoto: Record<string, unknown>[] = [];
  const certainOf = new Map<number, number[]>(); // photo index -> the read's plant indices that are sightings of certain dots
  if (P.sights) for (let i = 0; i < P.strict; i++) if (rec.certainty[i] === 0) for (const m of P.all[i].members) { const s = P.sights[m]; if (s.k != null) (certainOf.get(s.p) ?? certainOf.set(s.p, []).get(s.p)!).push(s.k); }
  const allSize: number[] = [], allGreen: number[] = [], allSol: number[] = [], lookRecorded = { photos: 0, of: P.photos.length };
  const pick = (arr: (number | null)[], idx: number[]) => idx.map(k => arr[k]).filter((x): x is number => x != null);
  P.photos.forEach((name, p) => {
    const r = readOf.get(name), L = r?.look, ks = certainOf.get(p) ?? [];
    if (!r || !L || L.size.length !== r.plants.length) { perPhoto.push({ name, certainSightings: ks.length, look: null }); return; }
    lookRecorded.photos++;
    const size = pick(L.size, ks), green = pick(L.green, ks), sol = pick(L.solidity, ks);
    allSize.push(...size); allGreen.push(...green); allSol.push(...sol);
    const every = Array.from({ length: L.size.length }, (_, k) => k);
    perPhoto.push({ name, certainSightings: ks.length,
      sizePx: rnd(med(size), 10), green: rnd(med(green)), solidity: rnd(med(sol), 100), solidityMeasured: sol.length,
      allMarks: { n: L.size.length, sizePx: rnd(med(pick(L.size, every)), 10), green: rnd(med(pick(L.green, every))), solidity: rnd(med(pick(L.solidity, every)), 100) },
      typicalPieceByTheRead: L.typicalPx, cores: L.cores });
  });
  const coresRows = reads.filter(r => r.look?.cores).map(r => r.look!.cores!);
  const misread = guard ? guard.withheld.filter(w => misreadMessage != null && w.reason === misreadMessage) : [];
  return {
    rowSpacingM: { value: rnd(G.spacingM), measured: lines.length > 0 } as Measured<number | null>,
    rowDirectionDeg: { value: rnd(G.directionDeg, 100), measured: lines.length > 0 } as Measured<number | null>,
    rowLines: { value: lines.length, measured: lines.length > 0 } as Measured<number>,
    rowLengthM: { value: { mean: rnd(lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : null, 100), median: rnd(med(lens), 100), n: lens.length }, measured: lens.length > 0, note: "the certain row lines (L5), each from its first certain plant to its last" } as Measured<{ mean: number | null; median: number | null; n: number }>,
    plantSpacingM: { value: rnd(seedM), measured: seedM != null, ...(seedM == null ? { note: "not measured: the rules counted in plant spacings do not run" } : {}) } as Measured<number | null>,
    plantSpacingSpreadM: { value: { all: qr(spread.all), single: qr(spread.single), lowerFenceM: rnd(spread.lowerFenceM), upperFenceM: rnd(spread.upperFenceM) }, measured: spread.single.n >= 20, note: "gaps between neighbouring certain plants on the row lines; 'single': those nearest one plant spacing" } as Measured<unknown>,
    tooCloseM: { value: rnd(rec.tooCloseM), measured: seedM != null, note: "the limit the judge used: half the plant spacing (default), the certain gaps' lowest share (SEQUENCE.tooCloseFromField), or the spread's lower fence (LAYERS.tooCloseFromSpread)" } as Measured<number | null>,
    typicalPlant: { value: { sizePx: rnd(med(allSize), 10), green: rnd(med(allGreen)), solidity: rnd(med(allSol), 100), sightings: allSize.length, solidityMeasured: allSol.length }, measured: allSize.length > 0,
      note: lookRecorded.photos ? `from the sightings of L4's certain plants; ${lookRecorded.photos} of ${lookRecorded.of} photographs' reads carry the look; sizes are photo pixels, so they differ photograph to photograph with height` : "not measured: the reads were made before the read recorded what its plants look like" } as Measured<unknown>,
    perPhoto,
    ground: { value: ground, measured: !!ground?.judged, note: ground && !ground.judged ? ground.why ?? "not judged" : "the field's judgement, from every photograph's marks (cornField.ts plantedGround): not from L4" } as Measured<typeof ground>,
    groundFromObvious: { value: extra.groundL4 ?? null, measured: extra.groundL4 != null, note: "phase 2a (LAYERS.groundFromObvious): the same judgement over L4's certain plants only; null when the option is off or they could not judge it" } as Measured<unknown>,
    misreads: { value: { medianSpacingM: rnd(guard?.medianSpacingM ?? null), photographs: misread.map(w => ({ name: w.name, ratio: rnd(w.ratio, 100) })), count: misread.length }, measured: !!guard && guard.medianSpacingM != null, note: guard ? "photographs whose row spacing in metres was over CORN_COUNT_GUARD.misreadRatio times the flight's median (cornField.ts cornFlightGuard)" : "the guard did not run on these reads" } as Measured<unknown>,
    coresReference: { value: coresRows.length ? { reference: coresRows[0].reference, photographs: coresRows.length, threshold: qr(quartiles(coresRows.map(c => c.threshold ?? NaN)), 1e5), medianOnMarks: qr(quartiles(coresRows.map(c => c.medianOnMarks ?? NaN)), 1e5), finePx: qr(quartiles(coresRows.map(c => c.finePx)), 100), widePx: qr(quartiles(coresRows.map(c => c.widePx)), 100) } : null,
      measured: coresRows.length > 0, note: coresRows.length ? "per photograph at L1 (the read), recorded here; per photograph values under perPhoto[].cores" : "not recorded: the cores were not asked, or the reads were made before the read recorded it" } as Measured<unknown>,
  };
}

/**
 * What the reads alone say (2026-11-18): for a single photograph, or a flight whose photographs made no dot, where no
 * L4 exists. Per photograph its marks' look (all of them: NOT L4's), the cores' reference, and over the flight the
 * misreads. Every value says measured or not.
 */
export function readsProfile(reads: CornPhotoRead[], guard: { medianSpacingM: number | null; withheld: { name: string; reason: string; ratio: number | null }[] } | null, misreadMessage: string | null) {
  const pick = (arr: (number | null)[]) => arr.filter((x): x is number => x != null);
  const perPhoto = reads.map(r => {
    const L = r.look;
    if (!L || L.size.length !== r.plants.length) return { name: r.name, marks: r.plants.length, look: null, withheld: r.countReason ?? null };
    return { name: r.name, marks: r.plants.length, sizePx: rnd(med(pick(L.size)), 10), green: rnd(med(pick(L.green))), solidity: rnd(med(pick(L.solidity)), 100), solidityMeasured: pick(L.solidity).length, typicalPieceByTheRead: L.typicalPx, cores: L.cores, withheld: r.countReason ?? null };
  });
  const sizes = reads.flatMap(r => (r.look && r.look.size.length === r.plants.length ? pick(r.look.size) : []));
  const greens = reads.flatMap(r => (r.look && r.look.size.length === r.plants.length ? pick(r.look.green) : []));
  const sols = reads.flatMap(r => (r.look && r.look.size.length === r.plants.length ? pick(r.look.solidity) : []));
  const coresRows = reads.filter(r => r.look?.cores).map(r => r.look!.cores!);
  const misread = guard ? guard.withheld.filter(w => misreadMessage != null && w.reason === misreadMessage) : [];
  return {
    marksLook: { value: { sizePx: rnd(med(sizes), 10), green: rnd(med(greens)), solidity: rnd(med(sols), 100), marks: sizes.length, solidityMeasured: sols.length }, measured: sizes.length > 0, note: "every mark of the reads (not L4's certain plants: none here)" } as Measured<unknown>,
    perPhoto,
    misreads: { value: { medianSpacingM: rnd(guard?.medianSpacingM ?? null), photographs: misread.map(w => ({ name: w.name, ratio: rnd(w.ratio, 100) })), count: misread.length }, measured: !!guard && guard.medianSpacingM != null } as Measured<unknown>,
    coresReference: { value: coresRows.length ? { reference: coresRows[0].reference, photographs: coresRows.length, threshold: qr(quartiles(coresRows.map(c => c.threshold ?? NaN)), 1e5), medianOnMarks: qr(quartiles(coresRows.map(c => c.medianOnMarks ?? NaN)), 1e5), finePx: qr(quartiles(coresRows.map(c => c.finePx)), 100), widePx: qr(quartiles(coresRows.map(c => c.widePx)), 100) } : null, measured: coresRows.length > 0 } as Measured<unknown>,
  };
}
