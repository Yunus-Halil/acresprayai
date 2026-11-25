// L3 Place: every photograph's marks on the ground, the photographs registered against each other, the marks merged
// into dots, and the lower bar's candidates beside them (2026-11-18, moved out of cornPlants.ts, unchanged).
//
//   in:   every photograph's read (rowCrop/cornV1.ts through cornField.ts compactCornRead: its marks, and where it
//         carries them the lower bar's candidates), the photographs' cameras, the field (cornField.ts: its origin, the
//         rows' direction and spacing guessed from the reads), and the options (placing, sequence, free, fieldSeed)
//   out:  PlacedDots: the photographs, each one's registration shift, the repeat distance, the dots (the stricter
//         marks' first, then the candidates), how many photographs looked at each, the candidates' tiers, a first
//         reading of the rows through the certain dots (`pre`, for L5), and read only: the sightings, the merging
//         gate and the candidates' own sightings
import { type GeorefFrame, pixelToGround } from "@/lib/directGeoref/projection";
import { ROW_POINTS } from "@/lib/rowCrop/greenPoints";
import { type LatLngAlt, fromEnu, toEnu } from "@/lib/sourceFrames/odm";
import type { CornFieldResult, CornPhotoRead, FieldGround } from "../cornField";
import type { LayerOptions } from "./options";
import { ALIGN_TOGETHER, type AlignReport, type AlignTogetherOptions, alignTogether, repeatSpread } from "../alignTogether";
import { type Dot, PLANTS_FIRST, type PhotoShift, type PlantsFirstOptions, ROW_RECALL, type RowsFromDots, SEQUENCE, certainEvidence, coverage, mergeDots, projectSightings, registerPhotos, rowCandidates, rowsFromDots, shiftOf, type Sight } from "../plantsFirst";

export type CornPlantsOptions = {
  /** Development: the loosened placement on a row (plantsFirst.ts SEQUENCE.free, ROW_RECALL.anyView). */
  free?: boolean;
  /** The rules the rows are read by (default: SEQUENCE). */
  sequence?: typeof SEQUENCE;
  /** How the photographs are registered, the dots made and the first rows read (default: PLANTS_FIRST). */
  placing?: PlantsFirstOptions;
  /** The field's planted / scattered judgement of the ground (cornField.ts cornFieldAndGround): with it, nothing on
   * ground judged scattered is read as the planting (SEQUENCE.refuseScattered). Without it the ground is not asked. */
  ground?: FieldGround | null;
  /** false: a candidate that carries its extent along the rows (Corn V1 `rowSpans`) is split at the plant spacing one
   * photograph assumes (greenPoints.ts ROW_POINTS.seedM). Default: at the spacing the field's certain plants show,
   * and at the assumed one only where they show none. */
  fieldSeed?: boolean;
  /** The layers' own options (layers/options.ts LAYERS, every one off by default): only those given are changed. */
  layers?: Partial<LayerOptions>;
  /** After the registration, the photographs aligned to each other all together by their plants (alignTogether.ts,
   * 2026-11-25). Off unless asked: true for its own defaults, or the options that differ. `gate`: "repeat" (default)
   * takes the merge gate from how tightly the same plant repeats once aligned, as the registration's is taken; "kept"
   * keeps the gate the registration alone would have given. */
  together?: boolean | (Partial<AlignTogetherOptions> & { gate?: "repeat" | "kept";
    /** Off unless given (2026-11-25). A photograph the others do not agree with (alignTogether.ts `photoOn` under this)
     * cannot place a plant on its own: a dot, or a candidate for the rows, all of whose marks come from such photographs
     * is not made. Its marks still count where a photograph the others agree with marked the same place. Measured on
     * a held-out flight at 0.6: 1,896 of the 6,059 dots few photographs agreed on were made only by such photographs,
     * and none of the 24,522 dots most photographs agreed on. */
    trustMin?: number });
};

/**
 * A read's candidates for the rows as points: one per candidate, or, where a candidate's green runs along the
 * photograph's rows for more than `splitFrom` plant spacings (plants touching), one per plant spacing along it.
 * `seedM` is the plant spacing on the ground. Reads without extents (`lowSpan`) are returned as they are.
 */
export function candidatePoints(r: CornPhotoRead, f: GeorefFrame | undefined, origin: LatLngAlt, seedM: number, o: Pick<typeof ROW_POINTS, "splitFrom" | "maxSplit"> = ROW_POINTS): [number, number][] {
  const low = r.low ?? [], span = r.lowSpan, ax = r.lowAxis;
  if (!f || !span || !ax) return low;
  const out: [number, number][] = [];
  low.forEach(([x, y], i) => {
    const [lo, hi] = span[i] ?? [0, 0];
    const x0 = x + lo * ax[0], y0 = y + lo * ax[1], x1 = x + hi * ax[0], y1 = y + hi * ax[1];
    const g0 = hi > lo ? pixelToGround(f, x0 * r.scale, y0 * r.scale) : null, g1 = g0 ? pixelToGround(f, x1 * r.scale, y1 * r.scale) : null;
    if (!g0 || !g1) { out.push([x, y]); return; }
    const p0 = toEnu({ lat: g0.lat, lng: g0.lng, altM: 0 }, origin), p1 = toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, origin), L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (L <= o.splitFrom * seedM) { out.push([x, y]); return; }
    const k = Math.min(o.maxSplit, Math.max(2, Math.round(L / seedM)));
    for (let b = 0; b < k; b++) { const t = (b + 0.5) / k; out.push([x0 + t * (x1 - x0), y0 + t * (y1 - y0)]); }
  });
  return out;
}

export type PlacedDots = { photos: string[]; shifts: PhotoShift[]; repeatM: number; all: Dot[]; strict: number; tier: Uint8Array | null; covered: Int32Array; pre: RowsFromDots;
  /** Per dot, the ground's judgement where a caller made it itself (a script that moves the dots); else asked of `ground`. */
  groundState?: Uint8Array;
  /** Read only, for the corn inspector: the sightings the dots were merged from (`Dot.members` index them), and the
   * candidates' own sightings (plantsFirst.ts rowCandidates `from`, `members`; candidate i is dot `strict + i`). */
  sights?: Sight[]; /** Read only: the merging gate used, metres. */ gateM?: number; /** Read only: what aligning the photographs together measured, where it was asked (alignTogether.ts). */ together?: AlignReport; candidates?: { from: { p: number; u: number; v: number; sight: number }[]; members: number[][] } | null };

/** Steps 1 to 3 of plantsFirst.ts and the candidates for the rows; null when the photographs make no dot. */
export function placeDots(reads: CornPhotoRead[], frames: Map<string, GeorefFrame>, F: CornFieldResult, opts: CornPlantsOptions = {}): PlacedDots | null {
  const { sights, photos } = projectSightings(reads, frames, F.origin);
  if (photos.length < 2 || sights.length < 50) return null;
  const o = opts.placing ?? PLANTS_FIRST;
  let reg = registerPhotos(sights, photos.length, o);
  let gateM = Math.min(o.gateMax, Math.max(o.gateMin, o.gateTimes * reg.repeatM));
  // The photographs aligned all together by their plants, where asked; kept only where its own check passes.
  let together: AlignReport | undefined;
  if (opts.together) {
    const { gate, trustMin: _t, ...own } = opts.together === true ? ({} as { gate?: "repeat" | "kept"; trustMin?: number }) : opts.together, T = alignTogether(sights, photos.length, reg.shifts, gateM, { ...ALIGN_TOGETHER, ...own });
    together = T.report;
    if (T.report.applied) {
      const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length);
      sights.forEach((s, i) => { const [de, dn] = shiftOf(T.shifts[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; });
      reg = { ...reg, shifts: T.shifts, repeatM: repeatSpread(sights, xs, ys, o.reachM) };
      if (gate !== "kept") gateM = Math.min(o.gateMax, Math.max(o.gateMin, o.gateTimes * reg.repeatM));
    }
  }
  // Photographs the others do not agree with place nothing on their own (opts.together.trustMin).
  const trustMin = typeof opts.together === "object" ? opts.together.trustMin : undefined, photoOn = together?.photoOn;
  const lone = (ps: number[]) => trustMin != null && !!photoOn && ps.length > 0 && ps.every(p => photoOn[p] < trustMin);
  const merged = mergeDots(sights, reg.shifts, gateM), dots = merged.filter(d => !lone(d.members.map(m => sights[m].p)));
  if (!dots.length) return null;
  const q = opts.sequence ?? SEQUENCE;
  // The first reading of rows, through the certain dots alone (reconstruct takes it as given).
  const coveredStrict = coverage(dots, frames, photos, reg.shifts, F.origin);
  const pre = rowsFromDots(dots.filter((d, i) => certainEvidence(d, coveredStrict[i], q)), F.directionDeg ?? 0, F.pitchM ?? 0.76, o);
  // Plants along the rows the stricter marks left out (plantsFirst.ts rowCandidates): only where a photograph carried
  // candidates (seedlings on soil). The dots above stay as they are, first; a candidate is kept only on a row.
  const strict = dots.length;
  // A candidate long along the rows is plants touching: split at the plant spacing the certain plants show (the first
  // reading above), not at the one a single photograph assumes, where the read carries the candidates' extents.
  const seedM = opts.fieldSeed === false ? ROW_POINTS.seedM : pre.seedM ?? ROW_POINTS.seedM;
  const lowReads = reads.filter(r => r.low?.length).map(r => ({ name: r.name, scale: r.scale, plants: candidatePoints(r, frames.get(r.name), F.origin, seedM) }));
  let all = dots, tier: Uint8Array | null = null, covered = coveredStrict, candidates: PlacedDots["candidates"] = null;
  if (lowReads.length) {
    const C = rowCandidates(lowReads, frames, F.origin, photos, reg.shifts, sights, dots, F.directionDeg ?? 0, opts.free ? { ...ROW_RECALL, anyView: true } : ROW_RECALL);
    const keepC = C.dots.map((_, k) => !lone(C.members[k].map(m => C.from[m].p))), cDots = C.dots.filter((_, k) => keepC[k]), cTier = Uint8Array.from(Array.from(C.tier).filter((_, k) => keepC[k])), cMembers = C.members.filter((_, k) => keepC[k]);
    if (cDots.length) {
      all = [...dots, ...cDots]; tier = new Uint8Array(all.length); tier.set(cTier, strict);
      covered = new Int32Array(all.length); covered.set(coveredStrict); covered.set(coverage(cDots, frames, photos, reg.shifts, F.origin), strict);
      candidates = { from: C.from, members: cMembers };
    }
  }
  return { photos, shifts: reg.shifts, repeatM: reg.repeatM, all, strict, tier, covered, pre, sights, gateM, candidates, ...(together ? { together } : {}) };
}

