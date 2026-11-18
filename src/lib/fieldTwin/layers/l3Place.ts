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
import { type Dot, PLANTS_FIRST, type PhotoShift, type PlantsFirstOptions, ROW_RECALL, type RowsFromDots, SEQUENCE, certainEvidence, coverage, mergeDots, projectSightings, registerPhotos, rowCandidates, rowsFromDots, type Sight } from "../plantsFirst";

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
  sights?: Sight[]; /** Read only: the merging gate used, metres. */ gateM?: number; candidates?: { from: { p: number; u: number; v: number; sight: number }[]; members: number[][] } | null };

/** Steps 1 to 3 of plantsFirst.ts and the candidates for the rows; null when the photographs make no dot. */
export function placeDots(reads: CornPhotoRead[], frames: Map<string, GeorefFrame>, F: CornFieldResult, opts: CornPlantsOptions = {}): PlacedDots | null {
  const { sights, photos } = projectSightings(reads, frames, F.origin);
  if (photos.length < 2 || sights.length < 50) return null;
  const o = opts.placing ?? PLANTS_FIRST;
  const reg = registerPhotos(sights, photos.length, o);
  const gateM = Math.min(o.gateMax, Math.max(o.gateMin, o.gateTimes * reg.repeatM));
  const dots = mergeDots(sights, reg.shifts, gateM);
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
    if (C.dots.length) {
      all = [...dots, ...C.dots]; tier = new Uint8Array(all.length); tier.set(C.tier, strict);
      covered = new Int32Array(all.length); covered.set(coveredStrict); covered.set(coverage(C.dots, frames, photos, reg.shifts, F.origin), strict);
      candidates = { from: C.from, members: C.members };
    }
  }
  return { photos, shifts: reg.shifts, repeatM: reg.repeatM, all, strict, tier, covered, pre, sights, gateM, candidates };
}

