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
import { type Dot, type GroundJudge, PLANTS_FIRST, type PlantsFirstOptions, type RowCourse, type RowsFromDots, SEQUENCE, courseAt, rowNumbers, rowsFromDots } from "../plantsFirst";
import type { ObviousPlants } from "./l4Obvious";

export type RowProfile = ReturnType<typeof rowProfile>;

export function rowProfile(dots: Dot[], L4: ObviousPlants, directionDeg: number, spacingGuessM: number, o: PlantsFirstOptions = PLANTS_FIRST, q = SEQUENCE, pre: RowsFromDots | null = null, ground: GroundJudge | null = null) {
  const n = dots.length, cIdx = L4.certainIdx;
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
  const tooClose = q.tooCloseFromField && certainGapsM.length ? certainGapsM[Math.min(certainGapsM.length - 1, Math.floor(q.tooCloseQuantile * certainGapsM.length))] : 0.5 * seed;
  return { R1, th, ct, st, S, A, C, scattered, overScattered, course, fit, at, RN, lines, geometry, seedM, seed, spacingRules, certainGapsM, tooClose };
}

/** A value of the profile: what it is, and whether the field measured it or it stands in. */
export type Measured<T> = { value: T; measured: boolean; note?: string };
/** The field profile as a record (for the inspector and the reports): every value says measured or not measured. */
export function profileOf(P: RowProfile, ground: { judged: boolean; plantedM2: number; scatteredM2: number; why: string | null } | null) {
  return {
    rowSpacingM: { value: P.S, measured: P.lines.length > 0 } as Measured<number>,
    rowDirectionDeg: { value: P.geometry.directionDeg, measured: P.lines.length > 0 } as Measured<number>,
    rowLines: { value: P.lines.length, measured: P.lines.length > 0 } as Measured<number>,
    plantSpacingM: { value: P.seedM, measured: P.seedM != null, ...(P.seedM == null ? { note: "not measured: the rules counted in plant spacings do not run" } : {}) } as Measured<number | null>,
    tooCloseM: { value: P.tooClose, measured: P.seedM != null, note: "half the plant spacing (SEQUENCE.tooCloseFromField off), or the lowest share of the certain plants' gaps (on)" } as Measured<number>,
    certainGaps: { value: P.certainGapsM.length, measured: P.certainGapsM.length > 0 } as Measured<number>,
    ground: { value: ground, measured: !!ground?.judged, ...(ground && !ground.judged ? { note: ground.why ?? "not judged" } : {}) } as Measured<typeof ground>,
  };
}
