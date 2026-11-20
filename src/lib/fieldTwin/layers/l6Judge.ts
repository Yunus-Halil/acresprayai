// L6 Judge: every dot that is not on a certain row, tested against L5's profile (2026-11-18, moved out of
// plantsFirst.ts reconstruct, unchanged).
//
//   in:   the field's dots (L3), their tiers (the lower bar's candidates), L4's certain plants, L5's profile (the rows'
//         frame and lines, the row numbers, the plant spacing, the too-close limit, the ground), the placing options,
//         the sequence options (the spacing option and its variants, the alley test, the loosened placement, the sweep)
//   out:  plantsFirst.ts Reconstruction: per dot its row (or none), its certainty after judging (0 certain, 1 probable,
//         2 uncertain), why it is on no row, and which test settled it (`settled`, read only); the rows built with
//         their confirmed and not confirmed stretches; the gap rule as measured; the alley test's refusals; the sweep
//
// Every dot is tried strongest first (the lower bar's candidates after the stricter marks, then by photographs): on a
// row's line, not on ground judged scattered, its band beating the alley (a candidate), not closer to a plant on the
// row than the too-close limit, within reach, at a whole number of plant spacings (unless the spacing option says
// otherwise). Then the loosened placement (off by default), the final sweep, the rows found in a free slot of the
// planter's pattern, the rows built and cut, and the dots between two rows.
import { type Dot, PLANTS_FIRST, type PlantsFirstOptions, type Reconstruction, type RowCourse, type RowSegment, SEQUENCE, SETTLED, type SeqRow, bandAndAlley } from "../plantsFirst";
import { ROW_GUIDED, bandBeatsControls } from "../rowGuided";
import type { ObviousPlants } from "./l4Obvious";
import type { RowProfile } from "./l5Profile";

export function judgeDots(dots: Dot[], L4: ObviousPlants, L5: RowProfile, o: PlantsFirstOptions = PLANTS_FIRST, q = SEQUENCE, tier: Uint8Array | null = null): Reconstruction {
  const n = dots.length, cIdx = L4.certainIdx, certainty = Uint8Array.from(L4.certainty);
  const { ct, st, S, A, C, scattered, overScattered, course, fit, at, RN, lines, geometry, seed, spacingRules, certainGapsM, tooClose } = L5;
  type Line = RowCourse;
  // 4-5. Every other dot again, strongest first: on a certain row's line (within its reach past the ends), at a whole
  // number of plant spacings from the nearest plant on it, it is probable; between the rows it is not the crop.
  const onRow = o.onRowShare * S, reach = spacingRules ? q.maxGapSeeds * seed : 0;
  // Why a dot is on no row (diagnostics): 0 on a row, 1 no row reaches it, 2 as close to a plant on the row as a
  // double, 3 not a whole number of plant spacings from the row's plants, 4 between two rows (set at the end), 5 on
  // ground the field's plants show as scattered.
  const why = new Uint8Array(n), settled = new Uint8Array(n);
  const nearestRow = (i: number, list: Line[]) => { let best = -1, bd = onRow; list.forEach((r, ri) => { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) return; const d = Math.abs(C[i] - at(r, A[i])); if (d <= bd) { bd = d; best = ri; } }); return best; };
  // Where a row's band beats the ground between the rows (q.alleyTest), per stretch and per group of dots. Counted
  // before anything is placed: what stands where, not what was made of it.
  // Groups: 0 the stricter marks' dots, 1 to 3 the candidates by tier.
  const groupOf = (i: number) => (tier?.[i] ? Math.min(3, tier[i]) : 0);
  const strips = q.alleyTest === "none" ? null : bandAndAlley(lines, A, C, Int8Array.from({ length: n }, (_, i) => groupOf(i)), 4, S, onRow, reach, { ...ROW_GUIDED, controlShare: q.alleyControlShare });
  const beatsAlley = (ri: number, i: number) => {
    if (!strips) return true;
    const s = strips.stretches[strips.stretchOf(ri, A[i])], g = groupOf(i), len = Math.max(s.a1 - s.a0, 1e-6);
    // Counted: the groups from `lo` to `hi` (see SEQUENCE.alleyTest).
    const lo = q.alleyTest === "own" && g > 0 ? 1 : 0, hi = q.alleyTest === "all" ? 3 : g;
    let band = 0, alley = 0; for (let k = lo; k <= hi; k++) { band += s.band[k]; alley += s.alley[k]; }
    return bandBeatsControls(band, Math.round(alley * strips.controlScale), len);
  };
  let alleyRefused = 0;
  const offSpacing = new Uint8Array(n);
  const along = lines.map(r => r.dots.map(i => A[i]));
  const extra = lines.map(() => [] as number[]);
  const onCertain = new Uint8Array(n); for (const r of lines) for (const i of r.dots) { onCertain[i] = 1; settled[i] = SETTLED.certainRow; }
  const order = Array.from({ length: n }, (_, i) => i).filter(i => !onCertain[i]).sort((x, y) => (tier ? tier[x] - tier[y] : 0) || dots[y].photos - dots[x].photos);
  for (const i of order) {
    if (scattered[i]) { why[i] = 5; settled[i] = SETTLED.scattered; continue; }
    const ri = nearestRow(i, lines); if (ri < 0) { why[i] = 1; settled[i] = SETTLED.noRow; continue; }
    if (!spacingRules) { why[i] = 7; settled[i] = SETTLED.noSpacing; continue; }
    if (tier?.[i] && !beatsAlley(ri, i)) { why[i] = 6; alleyRefused++; settled[i] = SETTLED.alley; continue; }
    let nearest = Infinity; for (const a of along[ri]) nearest = Math.min(nearest, Math.abs(a - A[i]));
    if (nearest < tooClose) { why[i] = 2; settled[i] = SETTLED.tooClose; continue; } // as close as a double, or the same plant twice: not taken on geometry
    const k = Math.round(nearest / seed);
    if (k > q.maxGapSeeds) { why[i] = 3; settled[i] = SETTLED.tooFar; continue; }
    // Not a whole number of plant spacings from that plant (under one spacing only where a learned limit lets a dot
    // closer than half of one): refused, unless the spacing is not asked (q.placeOffSpacing; with
    // q.offSpacingStricterOnly, not asked of the stricter marks' dots only).
    if (k < 1 || Math.abs(nearest - k * seed) > q.probableTol * seed) { if (!q.placeOffSpacing || (q.offSpacingStricterOnly && tier?.[i])) { why[i] = 3; settled[i] = SETTLED.offSpacing; continue; } offSpacing[i] = 1; }
    if (certainty[i] === 2) certainty[i] = 1;
    along[ri].push(A[i]); extra[ri].push(i); onCertain[i] = 1; settled[i] = offSpacing[i] ? SETTLED.placedOffSpacing : SETTLED.placedAtSpacing;
  }
  // Again (q.retryTooFar): the stricter marks' dots refused as too far, now that the plants around them are placed;
  // strongest first, until nothing more joins, by the main pass's own tests. One now as close as a double to a plant
  // placed since is a double. A candidate of the second look is not tried again (it is kept only on a row, so a retry
  // would add plants never drawn or counted before, not put back ones that were).
  if (q.retryTooFar && spacingRules) for (let changed = true; changed;) {
    changed = false;
    for (const i of order) {
      if (onCertain[i] || settled[i] !== SETTLED.tooFar || tier?.[i]) continue;
      const ri = nearestRow(i, lines); if (ri < 0) continue;
      let nearest = Infinity; for (const a of along[ri]) nearest = Math.min(nearest, Math.abs(a - A[i]));
      if (nearest < tooClose) { why[i] = 2; settled[i] = SETTLED.tooClose; continue; }
      const k = Math.round(nearest / seed);
      if (k > q.maxGapSeeds) continue;
      if (k < 1 || Math.abs(nearest - k * seed) > q.probableTol * seed) { if (!q.placeOffSpacing) { why[i] = 3; settled[i] = SETTLED.offSpacing; continue; } offSpacing[i] = 1; }
      if (certainty[i] === 2) certainty[i] = 1;
      along[ri].push(A[i]); extra[ri].push(i); onCertain[i] = 1; why[i] = 0; settled[i] = SETTLED.placedOnRetry; changed = true;
    }
  }
  // Loosened (q.free): what the spacing left out, again, strongest first and until nothing more joins: on a row's
  // course (tighter across than above), not a double, within reach of a plant on it. No distance to its neighbours is asked.
  const loose = new Uint8Array(n);
  if (q.free && spacingRules) for (let changed = true; changed;) {
    changed = false;
    for (const i of order) {
      if (onCertain[i] || why[i] !== 3) continue;
      let ri = -1, bd = q.freeAcrossShare * S;
      lines.forEach((r, k) => { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) return; const d = Math.abs(C[i] - at(r, A[i])); if (d <= bd) { bd = d; ri = k; } });
      if (ri < 0) continue;
      if (!beatsAlley(ri, i)) { why[i] = 6; alleyRefused++; settled[i] = SETTLED.freeAlley; continue; }
      let nearest = Infinity; for (const a of along[ri]) nearest = Math.min(nearest, Math.abs(a - A[i]));
      if (nearest < q.freeMinSeeds * seed) { why[i] = 2; settled[i] = SETTLED.freeTooClose; continue; }
      if (nearest > q.maxGapSeeds * seed) continue;
      if (certainty[i] === 2) certainty[i] = 1;
      along[ri].push(A[i]); extra[ri].push(i); onCertain[i] = 1; loose[i] = 1; why[i] = 0; settled[i] = SETTLED.freePlaced; changed = true;
    }
  }
  // The final sweep (q.sweepLoneMarks): a candidate on a row with no plant found without a row within `reach` of it
  // along that row, on either side, is alone there: off the row, why 8. Other candidates are not company.
  const alone = { dot: [] as number[], course: [] as number[] };
  if (q.sweepLoneMarks && tier) lines.forEach((L, ri) => {
    const company = [...L.dots, ...(q.loneMarkCompany === "located" ? extra[ri].filter(i => !tier[i]) : [])].map(i => A[i]);
    extra[ri] = extra[ri].filter(i => {
      if (!tier[i] || company.some(a => Math.abs(a - A[i]) <= reach)) return true;
      why[i] = 8; onCertain[i] = 0; loose[i] = 0; offSpacing[i] = 0; if (certainty[i] === 1) certainty[i] = 2; settled[i] = SETTLED.alone;
      alone.dot.push(i); alone.course.push(ri);
      return false;
    });
  });
  // TEMPORARY PATCH (q.secondLookAcrossMaxM, plantsFirst.ts SEQUENCE): a candidate on a row over that far across from
  // the line through the stricter marks' plants beside it on the row is off the row: why 9.
  if (q.secondLookAcrossMaxM > 0 && tier && spacingRules) lines.forEach((L, ri) => {
    const st = [...L.dots, ...extra[ri].filter(i => !tier[i])].sort((x, y) => A[x] - A[y]);
    if (!st.length) return;
    extra[ri] = extra[ri].filter(i => {
      if (!tier[i]) return true;
      let b = 0, e = st.length; while (b < e) { const m = (b + e) >> 1; if (A[st[m]] < A[i]) b = m + 1; else e = m; }
      const lo = b > 0 ? st[b - 1] : -1, hi = b < st.length ? st[b] : -1;
      const okLo = lo >= 0 && A[i] - A[lo] <= 3 * seed, okHi = hi >= 0 && A[hi] - A[i] <= 3 * seed;
      const line = okLo && okHi ? C[lo] + ((A[i] - A[lo]) / Math.max(1e-6, A[hi] - A[lo])) * (C[hi] - C[lo]) : okLo ? C[lo] : okHi ? C[hi] : null;
      if (line == null || Math.abs(C[i] - line) <= q.secondLookAcrossMaxM) return true;
      why[i] = 9; onCertain[i] = 0; loose[i] = 0; offSpacing[i] = 0; if (certainty[i] === 1) certainty[i] = 2; settled[i] = SETTLED.offLine;
      return false;
    });
  });
  // New rows from what is left, only in a row slot of the planter's pattern that no certain row holds there, as dense
  // as the certain rows are, straight.
  const restByJ = new Map<number, number[]>();
  // A candidate of the second look (any tier) never makes a row: rows come from the plants found first (2026-11-16).
  for (let i = 0; i < n; i++) if (!onCertain[i] && !tier?.[i] && !scattered[i] && Math.abs(RN.resid[i]) <= onRow) (restByJ.get(RN.j[i]) ?? restByJ.set(RN.j[i], []).get(RN.j[i])!).push(i);
  const geomLines: Line[] = [];
  for (const g of restByJ.values()) {
    if (g.length < 5) continue;
    const L = fit(g); if (!L || L.a1 - L.a0 < q.minCertainRowM) continue;
    // Not where a certain row already runs: the slot must be free over this stretch.
    const mid = (L.a0 + L.a1) / 2;
    if (lines.some(cr => mid >= cr.a0 - 2 && mid <= cr.a1 + 2 && Math.abs(at(cr, mid) - at(L, mid)) < 0.5 * S)) continue;
    if (L.dots.length / Math.max(1e-6, L.a1 - L.a0) < q.minRowDensityShare * geometry.perMMedian) continue;
    geomLines.push(L);
  }
  // How full the certain rows are, and so how long a run of missed plants is still ordinary there.
  // (Counted in plant spacings: where the spacing is not measured no gap is called long, gapM is without end.)
  const filled = spacingRules ? Math.min(0.95, Math.max(0.15, geometry.perMMedian * seed)) : NaN;
  const gapK = Math.max(q.gapSeeds, Math.ceil(Math.log(q.gapRisk) / Math.log(1 - filled))), gapM = spacingRules ? gapK * seed : Infinity;
  const breaks = { bridged: 0, notConfirmedStretches: 0, cutOverMaxBridge: 0, cutLengthM: 0, cutOverScattered: 0 };
  // Rows with their stretches: plants confirmed, or a gap of over `gapM` ("the row probably
  // continues here; plants not confirmed").
  const rows: SeqRow[] = [], rowOf = new Int32Array(n).fill(-1);
  // q.runReachSeeds (plantsFirst.ts SEQUENCE): only the plants in a run stay on the row. Asked until nothing more goes.
  const inRuns = (sorted: number[]): number[] => {
    if (!(q.runReachSeeds > 0) || !spacingRules) return sorted;
    const reach = q.runReachSeeds * seed + 1e-9;
    let alive = sorted;
    for (let changed = true; changed;) {
      changed = false;
      const next: number[] = [];
      for (let k = 0; k < alive.length; k++) {
        const i = alive[k], left = k > 0 && A[i] - A[alive[k - 1]] <= reach, right = k + 1 < alive.length && A[alive[k + 1]] - A[i] <= reach;
        if (dots[i].photos <= 1 ? left && right : left || right) next.push(i);
        else { settled[i] = SETTLED.notInARun; changed = true; }
      }
      alive = next;
    }
    return alive;
  };
  const build = (kind: SeqRow["kind"], ds: number[], L: Line) => {
    const all = inRuns([...new Set(ds)].sort((x, y) => A[x] - A[y]));
    // Cut where no plant stands for over maxBridgeM, and where a stretch with no plant confirmed would cross ground
    // judged scattered; each piece with 3 or more plants is a row of its own.
    const tooFar = (i0: number, i1: number) => A[i1] - A[i0] > q.maxBridgeM, unplanted = (i0: number, i1: number) => (!spacingRules || A[i1] - A[i0] > gapM) && overScattered(L, A[i0], A[i1]);
    for (let s0 = 0; s0 < all.length;) { let e0 = s0; while (e0 + 1 < all.length && !tooFar(all[e0], all[e0 + 1]) && !unplanted(all[e0], all[e0 + 1])) e0++; if (e0 - s0 + 1 >= 3) piece(kind, all.slice(s0, e0 + 1), L); if (e0 + 1 < all.length) { if (tooFar(all[e0], all[e0 + 1])) { breaks.cutOverMaxBridge++; breaks.cutLengthM += A[all[e0 + 1]] - A[all[e0]]; } else breaks.cutOverScattered++; } s0 = e0 + 1; }
  };
  const piece = (kind: SeqRow["kind"], sorted: number[], L: Line) => {
    if (sorted.length < 2) return;
    const a0 = A[sorted[0]], a1 = A[sorted[sorted.length - 1]], segs: RowSegment[] = [];
    let s0 = a0;
    for (let k = 1; k < sorted.length; k++) { const g0 = A[sorted[k - 1]], g1 = A[sorted[k]]; if (g1 - g0 > gapM) { if (g0 > s0) segs.push({ a0: s0, a1: g0, confirmed: true }); segs.push({ a0: g0, a1: g1, confirmed: false }); s0 = g1; breaks.notConfirmedStretches++; } else if (spacingRules && g1 - g0 > 1.5 * seed) breaks.bridged++; }
    if (a1 > s0) segs.push({ a0: s0, a1, confirmed: true });
    // The drawn course: refitted through all its plants (the certain ones and those the second look added), less the
    // dots that are on the row only because the spacing was not asked of them (q.placeOffSpacing).
    const k = course(q.placeOffSpacing ? sorted.filter(i => !offSpacing[i]) : sorted, a0, a1), LL: Line = { ...k, a0, a1, dots: sorted };
    const line: [number, number][] = []; for (let a = a0; ; a = Math.min(a1, a + 1)) { const c = at(k.ka.length ? LL : L, a); line.push([a * ct - c * st, a * st + c * ct]); if (a >= a1) break; }
    for (const i of sorted) rowOf[i] = rows.length;
    rows.push({ id: rows.length + 1, kind, line, dots: sorted, a0, a1, lengthM: a1 - a0, perM: sorted.length / Math.max(1e-6, a1 - a0), segments: segs });
  };
  lines.forEach((L, ri) => build("certain", [...L.dots, ...extra[ri]], L));
  for (const L of geomLines) { for (const i of L.dots) { if (certainty[i] === 2) certainty[i] = 1; settled[i] = SETTLED.geometryRow; } build("geometry", L.dots, L); }
  // A probable dot that ended on no row is uncertain again.
  for (let i = 0; i < n; i++) if (certainty[i] === 1 && rowOf[i] < 0) certainty[i] = 2;
  // (Read only.) A dot placed on a row that `build` above left on no row.
  for (let i = 0; i < n; i++) if (rowOf[i] < 0 && (settled[i] === SETTLED.certainRow || settled[i] === SETTLED.placedAtSpacing || settled[i] === SETTLED.placedOffSpacing || settled[i] === SETTLED.freePlaced || settled[i] === SETTLED.geometryRow || settled[i] === SETTLED.placedOnRetry)) settled[i] = SETTLED.cutFromRow;
  // Between the rows: a dot on no row, with a row on either side of it within a spacing, is not the crop. A dot that
  // stands on a row's line (within the band a row's plants are taken in) is not between two rows: that row is the one
  // it stands on, and why it was left off it is already said (q.betweenOffLines).
  const between = new Uint8Array(n);
  const all = [...lines, ...geomLines];
  for (let i = 0; i < n; i++) {
    if (rowOf[i] >= 0) continue;
    let below = false, above = false, onLine = false;
    for (const r of all) { if (A[i] < r.a0 - reach || A[i] > r.a1 + reach) continue; const d = C[i] - at(r, A[i]); if (q.betweenOffLines && Math.abs(d) <= onRow) { onLine = true; break; } if (d > 0 && d < 1.2 * S) below = true; if (d < 0 && d > -1.2 * S) above = true; }
    if (!onLine && below && above) { between[i] = 1; if (why[i] !== 8) why[i] = 4; }
  }
  for (let i = 0; i < n; i++) if (rowOf[i] >= 0) why[i] = 0; else if (!why[i]) why[i] = 1;
  const unplantedGround = { dotsOnScattered: scattered.reduce((t, x) => t + x, 0), certainOnScattered: cIdx.reduce((t, i) => t + scattered[i], 0), flatCells: RN.flat };
  return { certainty, rows, rowOf, between, why, gaps: { filled, gapM, ...breaks }, unplanted: unplantedGround, alleyRefused, spacingRules, alone, geometry, a: A, c: C, loose, courses: lines, geomCourses: geomLines, offSpacing, tooCloseM: tooClose, certainGaps: certainGapsM.length, settled };
}
