// Corn V1 (2026-11-04): the production corn read. One photograph in; rows, crop identity and findings out, each with
// the evidence behind it.
//
// Two independent reads of where the rows run:
//   - the green read (adaptive.ts: the frame judged region by region, each region read by the stage reader it calls
//     for; bands, weed candidates, gaps, field edges, the seedling layer);
//   - the plant read (greenPoints.ts -> plantRows.ts rowsFromPoints: individual plants located on the soil, rows only
//     where many of them line up in parallel, evenly spaced lines). It needs no model; a plant detector's positions
//     (MaSC, a server tier not shipped in V1) can be passed in its place.
// Measured 2026-11-04 on hand-labelled maize from other people's fields (docs/research/corn-v1-2026-11-04.md): the green
// read alone draws about half its rows on the soil between the maize rows on unfamiliar frames; the plant read puts
// them on the plants. On our own flights the two agree.
//
// Fusion (the plant read leads where it holds rows, the green read stands where the plants cannot be told apart):
//   - a plant row is drawn where it stands; it is "agreed" when the green read has a row on it too;
//   - a green row is kept only where no plant row lies closer than a neighbouring row would (canopy, rows past the plant read);
//     where a plant row lies beside it, off its line, the green row is dropped: the plants contradict it.
// Confidence per row (measured on labelled maize, 2026-11-04): high when both reads agree; when a plant DETECTOR's rows
// alone hold it in the main planting (false 2-4 %); or when the green read alone holds it well where the green is the
// right instrument (rows grown into bands, a late canopy with no plants located). Medium otherwise: plants located on
// the green alone (false 17-30 %: the same pixels as the green read), a green row alone over seedlings.
//
// Crop identity (three classes, never more than the evidence holds):
//   - corn: the field was entered as corn, the row is high confidence in the main planting, and, when the pixel size is
//     known, the planting's spacing is one corn is planted at. Nothing in V1 tells corn from another row crop by its
//     look: MaSC boxes sugar beet and soybean seedlings as corn, the shape of a lone plant does not separate maize from
//     beet (measured), so "corn" rests on the operator's entry and the geometry agreeing;
//   - probable crop: any other planted row (one read only, a second planting, a spacing corn is not planted at);
//   - unknown vegetation: green on no row that is not a confident weed candidate.
// Findings never come from a questionable row:
//   - a weed candidate is reported only between the rows beside a corn row: on a row's line it is the crop, on the line
//     where the planting's next row runs (a row neither read held) or anywhere else it is unknown vegetation;
//   - a stand gap is reported only where both reads see nothing: a gap in a green row the plant read agrees with (or a
//     corn row the green holds alone), with no plant position on the row's line inside it; every other gap is withheld.
// Decision support only: nothing here decides a treatment.
import { CORN_CORES, coresAsked, photoViews } from "../fieldTwin/layers/l1Views";
import { findMarks } from "../fieldTwin/layers/l2Find";
import { type LearnedRecord, learnedGreenView } from "../fieldTwin/layers/l1Learned";
import { LAYERS } from "../fieldTwin/layers/options";
import type { PhotoPixels } from "../photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive, type AdaptiveRead, type AdaptiveRow } from "./adaptive";
import { type CoresAsked, GREEN_POINTS, ROW_POINTS, plantPointsFromGreen, rowPlantPoints } from "./greenPoints";
import { SEEDLING_GREEN, SEEDLING_ROW, SEEDLING_V1, type SeedlingCache, seedlingCache, seedlingMask, sharedSeedlingMask, sharedSoilLevels } from "./seedlingGreen";
import { distToLine, rowsFromPoints, type PlantPoint, type PlantRowsResult } from "./plantRows";
import type { RowCropGap, RowCropOptions, RowCropParams, RowCropRead, RowCropRow, RowCropStage, RowCropWeed } from "./readRowCrop";

export const CORN_V1_VERSION = 1;

export const CORN_V1 = {
  /** A plant row and a green row are the same row where they lie within this share of the row spacing ... */
  sameRowShare: 0.25,
  /** ... over at least this share of the plant row's length. */
  agreeShare: 0.5,
  /** A green row is contradicted where a plant row lies closer to it than this share of the spacing (a neighbouring row
   * lies a whole spacing away; the green read's false rows on other people's frames lay half a spacing off the plants). */
  contradictShare: 0.6,
  /** A green row piece kept beside the plant rows is at least this many row spacings long. */
  minPiecePitches: 1.5,
  /** A green row alone is high confidence at establishment or mid with at least this share of its strips on green
   * (labelled maize, MatchPlant + MSDD: at 0.7 and over right 67 times in 77, 0.6-0.7 right 9 in 14, under 0.6 3 in 14) ... */
  bandSupport: 0.7,
  /** ... and on a late canopy with at least this share (our closed-canopy rows: 0.90 at the 10th percentile; MSDD's
   * dark seedling tiles misjudged as canopy: 0.5, false 66 times in 67); ... */
  canopySupport: 0.85,
  /** ... in both cases at least this many row spacings long, ... */
  greenAloneMinPitches: 4,
  /** ... and, where the plants line up in rows, within this many degrees of their direction. */
  maxDirectionOffDeg: 12,
  /** A green row alone on the lattice of agreed rows: within this share of a spacing of one or two spacings from one, ... */
  latticeTol: 0.15,
  /** ... and within this many degrees of its direction. */
  latticeAngleDeg: 5,
  /** A weed candidate within this share of the spacing of a row's line stands on the row: the crop. */
  onRowShare: 0.2,
  /** A weed candidate is a finding only with a corn row within this many row spacings, ... */
  weedRowReachPitches: 1.5,
  /** ... and not within this share of the spacing of where the planting's next row runs (a row not read: on the
   * French plots 130 of 179 such candidates were maize, 2026-11-04). */
  slotShare: 0.2,
  /** A gap is withheld when a plant position lies within this share of the spacing of the row's line inside it (its
   * first and last tenth left out: the plants that bound it). */
  gapPlantShare: 0.15,
  /** A neighbouring plant row at a planting's spacing within this share of it. */
  pitchTol: 0.2,
  /** With a known pixel size the planting's spacing is checked against the crop's planted spacings: within the
   * profile's tolerance (never less than this share) it fits; outside it a note says so ... */
  minSpacingTol: 0.08,
  /** ... and below the first share of the narrowest or above the second of the widest it is a spacing corn is never
   * planted at: no row is corn (drilled soybean, cereals). Weak evidence by nature: corn is planted at 38 to 91 cm. */
  spacingOutside: [0.75, 1.25] as [number, number],
  /** A photograph is read as bands or a canopy when establishment, mid and late plans own at least this share of it
   * (see cornV1PlantPoints: the dark-leaf rule is kept from its plant read). One photograph of the first flight judged
   * held an establishment plan over 3 % of a frame of dark seedlings. */
  bandedShare: 0.2,
};

// The vivid cores (CORN_CORES): an L1 option, defined in fieldTwin/layers/l1Views.ts (2026-11-18), re-exported here.
export { CORN_CORES } from "../fieldTwin/layers/l1Views";

/**
 * The emergence guard (2026-11-18): OFF. A per-plant count is for emergence, where a plant is a piece of green of its
 * own. How far along a photograph is, is read from its rows: the share of their length that has green on it
 * (`rowGreenCover`: green within `bandShare` of the row spacing either side of the row's line, the seedling mask).
 * Past `cut` the read withholds the plant count and says so (`message`); its rows, gaps and weed candidates are
 * reported as before. With no row, or no row spacing, nothing is withheld.
 * The cut is halfway between the highest share measured on emergence photographs and the lowest on later ones
 * (corn-benchmark FINAL-1.md).
 */
export const CORN_COUNT_GUARD = {
  on: false,
  bandShare: 0.1,
  cut: 0.642,
  message: "too late for a per-plant count",
  /** Over a flight (fieldTwin/cornField.ts cornFlightGuard, 2026-11-18): a photograph whose row spacing is more than
   * this many times the flight's median, or less than its inverse, is a misread, not a late photograph. Its marks are
   * dropped as above and it says `misreadMessage`. null: the guard as it stood (the cut alone). Measured on the private
   * flight: one photograph read its rows at 949 px apart where the flight's others read about 152 px, and the cut took
   * it for a late photograph. A photograph alone (Photo Scout) has no flight: the cut alone. */
  misreadRatio: 1.5 as number | null,
  /** Also a misread under 1 / misreadRatio of the median (the rule as first written, FINAL-3.md): off, because on
   * the private flight 14 of 123 emergence photographs read their rows at about half the spacing (0.40 to 0.65 of the
   * median) with their marks on the plants; withholding them cost the dev tiles 4 plants and added 15 wrong marks. */
  misreadBelow: false,
  misreadMessage: "row spacing misread",
};

/** The share of each row's length that has green on it: along every row's line, pixel by pixel, whether the mask is
 * green anywhere within `halfBandPx` across it. `share` is over all rows together (by length); null with no row. */
export function rowGreenCover(mask: Uint8Array, W: number, H: number, rows: { points: [number, number][] }[], halfBandPx: number): { share: number | null; perRow: number[]; lengthPx: number } {
  const hb = Math.max(0, Math.round(halfBandPx)), perRow: number[] = []; let all = 0, on = 0;
  for (const r of rows) {
    let n = 0, c = 0;
    for (let k = 1; k < r.points.length; k++) {
      const [ax, ay] = r.points[k - 1], [bx, by] = r.points[k], L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      for (let t = 0; t < L; t++) {
        const x = ax + ux * t, y = ay + uy * t; if (x < 0 || y < 0 || x >= W || y >= H) continue;
        let green = false;
        for (let s = -hb; s <= hb && !green; s++) { const xx = Math.round(x - uy * s), yy = Math.round(y + ux * s); if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) green = true; }
        n++; if (green) c++;
      }
    }
    if (n) { perRow.push(c / n); all += n; on += c; }
  }
  return { share: all ? on / all : null, perRow, lengthPx: all };
}
/** `rowGreenCover` for a read: the photograph's shared seedling mask, the band from the read's row spacing. */
export function cornV1RowCover(px: PhotoPixels, v: CornV1Read, seedlings?: SeedlingCache | null): { share: number | null; perRow: number[]; lengthPx: number; pitchPx: number | null } {
  const pitch = v.identity.mainPitchPx ?? greenPitchPx(v.green) ?? v.plants.rows.pitchPx ?? null;
  if (!pitch || !v.rows.length) return { share: null, perRow: [], lengthPx: 0, pitchPx: pitch };
  return { ...rowGreenCover(sharedSeedlingMask(seedlings, px), px.width, px.height, v.rows, CORN_COUNT_GUARD.bandShare * pitch), pitchPx: pitch };
}

export type CornIdentity = "corn" | "probable crop";
export type CornRowEvidence = "both reads agree" | "plant read only" | "green read only";
export type CornV1Row = {
  points: [number, number][];
  evidence: CornRowEvidence;
  confidence: "high" | "medium";
  identity: CornIdentity;
  /** Why the identity is what it is (shown beside the row). */
  why: string;
  /** The green read's row behind it (an index into green.rows), when there is one. */
  greenRow: number | null;
  /** Plants the plant read placed on it; null where the plant count is withheld (CORN_COUNT_GUARD). */
  plants: number | null;
  stage: RowCropStage | null;
  /** In the photo's main planting (not a second planting beside it). */
  mainPlanting: boolean;
  /** A green row alone that may stand on the planting's lattice (held on green, long, along the plants). */
  latticeCandidate?: boolean;
  /** Made high confidence by lying on the lattice of the rows both reads agree on. */
  onLattice?: boolean;
};
export type CornV1WeedVerdict = "weed candidate" | "crop on a row" | "unknown vegetation";
export type CornV1Gap = RowCropGap & { greenRow: number; verdict: "stand gap" | "withheld"; why?: string };

export type CornV1Read = {
  version: number;
  green: AdaptiveRead;
  plants: { source: "green" | "detector"; points: PlantPoint[]; rows: PlantRowsResult; ms: number;
    /** Candidates for the field's rows at the lower bar (greenPoints.ts rowPlantPoints): only on a photograph of
     * seedlings on soil, where the dark-leaf rule applies; never weeds, never used alone. */
    low?: PlantPoint[]; lowMs?: number;
    /** Read only (L2): per point, which views found it (bit 1 the green, bit 2 a vivid core). */
    foundBy?: Uint8Array;
    /** Read only (2026-11-18, for the field profile): per point what it looks like (greenPoints.ts GreenPoints.look),
     * the photograph's typical plant piece (greenPoints.ts typicalPx, photo pixels), and the cores' reference as this
     * photograph measured it (null where the cores were not asked or the read holds no row spacing). */
    look?: { sizePx: Float32Array; green: Float32Array; solidity: Float32Array }; typicalPx?: number; plantMask?: "seedlings" | "v1" | "learned";
    /** With the learned green view (LAYERS.learnedGreen, L1): what it learned of this photograph (layers/l1Learned.ts). */
    learned?: LearnedRecord | null;
    coresRef?: { reference: "strongest" | "marks"; strongest: number; medianOnMarks: number | null; onMarks: number | null; threshold: number | null; finePx: number; widePx: number } | null;
    /** With `rowSpans`: per candidate, how far its green reaches along the photograph's rows either way of it (pixels,
     * back and forward), and the rows' direction in the photograph (unit vector). Absent when the photograph made no row. */
    lowSpan?: [number, number][]; lowAxis?: [number, number] };
  rows: CornV1Row[];
  /** Every green-read weed candidate with what V1 makes of it (index matches green.weeds). */
  weedVerdicts: { index: number; verdict: CornV1WeedVerdict; why: string }[];
  gaps: CornV1Gap[];
  /** The emergence guard, when it ran (CORN_COUNT_GUARD): the share of the rows' length with green on it, the cut,
   * and whether the plant count is withheld (then `plants.points` is empty, no candidates are made, and a note says so). */
  count?: { rowGreenShare: number | null; cut: number; withheld: boolean; /** The row spacing the measure was read with, photo pixels (cornV1RowCover). */ rowSpacingPx?: number | null };
  /** Whether "corn" could be said at all, and why not. */
  identity: { entered: string | null; spacingChecked: boolean; spacingFits: boolean | null; spacingImpossible: boolean; spacingM: number | null; mainPitchPx: number | null };
  summary: {
    cornRows: number; probableRows: number; agreedRows: number; plantOnlyRows: number; greenOnlyRows: number; greenRowsDropped: number;
    weeds: number; cropOnRow: number; unknownVegetation: number;
    gaps: number; gapsWithheld: number; gapLengthM: number;
    ms: { green: number; plants: number; fusion: number; total: number };
  };
  notes: string[];
};

export type CornV1Options = RowCropOptions & {
  /** The crop the operator entered for the field ("corn" makes corn rows possible; anything else gives planted rows only). */
  enteredCrop?: string | null;
  /** Plant positions from a detector (photo pixels) in place of the plants read from the green. */
  detectorPoints?: PlantPoint[] | null;
  /** The shipped corn-v1.0 seedling mask (no rule for leaves darker than their soil): only to compare against it. */
  baselineSeedlings?: boolean;
  /** false: no candidates for the field's rows at the lower bar (`plants.low`); the read is then exactly as before 2026-11-16. */
  rowCandidates?: boolean;
  /** true: a candidate is never split at the plant spacing assumed in one photograph (greenPoints.ts ROW_POINTS.seedM);
   * it carries its extent along the rows (`plants.lowSpan`) and the field splits it at the spacing it measured. */
  rowSpans?: boolean;
  /** The vivid cores (CORN_CORES): true or false for this read, whatever CORN_CORES.on says. */
  cores?: boolean;
  /** What a core is measured against for this read (CORN_CORES.reference when not given). */
  coresReference?: "strongest" | "marks";
  /** Phase 3a (LAYERS.coresBySize; development, off unless given): the cores' blurs from the typical plant's size in
   * photo pixels, in place of the row spacing; "self": the median size of this photograph's own first-pass marks. */
  coresSizePx?: number | "self" | null;
  /** The emergence guard (CORN_COUNT_GUARD): true or false for this read, whatever CORN_COUNT_GUARD.on says. */
  countGuard?: boolean;
  /** The learned green view (L1, LAYERS.learnedGreen when not given): L2 reads its mask in place of the fixed one. */
  learnedGreen?: boolean;
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const densify = (l: [number, number][], step: number): [number, number][] => {
  if (l.length < 2) return l;
  const out: [number, number][] = [l[0]];
  for (let i = 1; i < l.length; i++) { const [ax, ay] = l[i - 1], [bx, by] = l[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); }
  return out;
};
/** A polyline's direction from its ends, degrees [0, 180) (photo coordinates, y down). */
const dirOf = (l: [number, number][]) => { const [ax, ay] = l[0], [bx, by] = l[l.length - 1]; return ((Math.atan2(by - ay, bx - ax) * 180) / Math.PI + 180) % 180; };
const angleOff = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
const lengthOf = (l: [number, number][]) => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };

/** The green read's main row spacing, photo pixels: its largest plan's measured pitch, else the plan's prior. */
export function greenPitchPx(ad: AdaptiveRead): number | null {
  const p = ad.plans.filter(q => q.read).sort((u, v) => v.ownedShare - u.ownedShare)[0];
  if (!p) return null;
  const r = p.read!;
  return r.pitchM && Number.isFinite(r.gsdM) && r.gsdM > 0 ? r.pitchM / r.gsdM : p.pitchPx;
}

/** Fuse a green read with plant positions (the pure part of readCornV1, for tests and the bench). */
export function fuseCornV1(ad: AdaptiveRead, points: PlantPoint[], params: Pick<RowCropParams, "gsdM" | "spacingsM" | "pitchToleranceShare">, o: { enteredCrop?: string | null; source?: "green" | "detector"; plantsMs?: number; greenMs?: number } = {}): CornV1Read {
  const t0 = Date.now(), notes: string[] = [];
  const B = rowsFromPoints(points);
  const pr = greenPitchPx(ad), p = B.pitchPx ?? pr ?? null;
  const mainPlan = ad.plans.filter(q => q.read).sort((u, v) => v.ownedShare - u.ownedShare)[0]?.id ?? null;
  const planStage = (plan: number) => ad.plans.find(q => q.id === plan)?.stage ?? null;

  // Spacing check: only with a known pixel size (an assumed scale is the spacing itself).
  const entered = o.enteredCrop ?? null;
  const gsd = ad.scaleBasis === "given" ? ad.gsdM : null;
  // The main planting's spacing: the green read's (measured over the whole field's periodicity) before the plant
  // read's (a few plant rows can show twice the spacing: on a Utah frame three plant rows gave 216 cm for 76 cm rows).
  const mainPitchPx = pr && ad.rows.length ? pr : B.rows.length ? B.pitchPx : null;
  const spacingM = gsd && mainPitchPx ? mainPitchPx * gsd : null;
  const spacingFits = spacingM != null ? params.spacingsM.some(sp => Math.abs(spacingM - sp) <= Math.max(params.pitchToleranceShare, CORN_V1.minSpacingTol) * sp) : null;
  // Only a spacing corn is never planted at rules corn out: the pixel size from a flight height is rarely better than
  // 10-20 % (the Utah set's stated pixel puts its 76 cm rows at 109 cm), so a spacing between corn's own is only noted.
  const spacingImpossible = spacingM != null && params.spacingsM.length > 0 && (spacingM < CORN_V1.spacingOutside[0] * Math.min(...params.spacingsM) || spacingM > CORN_V1.spacingOutside[1] * Math.max(...params.spacingsM));

  const rows: CornV1Row[] = [];
  const greenRows: AdaptiveRow[] = ad.rows;
  // Plant rows: agreed when a green row lies on them over half their length.
  const agreedGreen = new Set<number>();
  const plantRowGreen: (number | null)[] = [];
  if (p) for (const r of B.rows) {
    const s = densify(r.points, Math.max(4, p / 4));
    let best: number | null = null, bestShare = 0;
    greenRows.forEach((g, gi) => {
      if (g.points.length < 2) return;
      const share = s.filter(([x, y]) => distToLine(g.points, x, y) <= CORN_V1.sameRowShare * p).length / s.length;
      if (share > bestShare) { bestShare = share; best = gi; }
    });
    const agreed = bestShare >= CORN_V1.agreeShare ? best : null;
    if (agreed != null) agreedGreen.add(agreed);
    plantRowGreen.push(agreed);
  }
  // A plant row belongs to the main planting when a neighbouring plant row lies one or two of the main spacings away.
  const p0 = B.pitchesPx[0] ?? B.pitchPx;
  const acrossOffset = (a: [number, number][], b: [number, number][]) => { const m = a[a.length >> 1]; return distToLine(b, m[0], m[1]); };
  const inMainPlanting = (i: number) => !!p0 && B.rows.some((q, j) => { if (j === i) return false; const o = acrossOffset(B.rows[i].points, q.points), k = Math.round(o / p0); return k >= 1 && k <= 2 && Math.abs(o / p0 - k) <= CORN_V1.pitchTol; });
  B.rows.forEach((r, i) => {
    const gi = plantRowGreen[i];
    const stage = gi != null ? planStage(greenRows[gi].plan) : null;
    const main = inMainPlanting(i);
    // Plant rows alone are trusted from a detector (MaSC's rows were false 2-4 % of the time on MatchPlant and MSDD),
    // not from plants located on the green (17-30 %: the same pixels the green read sees, its specks included).
    const high = gi != null || (main && o.source === "detector");
    rows.push({ points: r.points, evidence: gi != null ? "both reads agree" : "plant read only", confidence: high ? "high" : "medium", identity: "probable crop", why: "", greenRow: gi, plants: r.members.length, stage, mainPlanting: gi != null ? greenRows[gi].plan === mainPlan : main, latticeCandidate: !high && main && lengthOf(r.points) >= CORN_V1.greenAloneMinPitches * (pr ?? p ?? 0) });
  });
  // Green rows: pieces where no plant row lies closer than a neighbouring row would (CORN_V1.contradictShare of the
  // spacing). Only a parallel plant row contradicts, and only when the plant read runs the way the green read does (or
  // comes from a detector): on a weedy Utah frame plants located on the green lined weeds up across the corn and cut
  // every true green row where they crossed it.
  const plantsTrustedEarly = o.source === "detector" || (B.directionDeg != null && ad.directionDeg != null && angleOff(B.directionDeg, ad.directionDeg) <= CORN_V1.maxDirectionOffDeg);
  let dropped = 0;
  greenRows.forEach((g, gi) => {
    if (g.points.length < 2) return;
    if (agreedGreen.has(gi)) return; // drawn as the plant row it agrees with
    const pieces: [number, number][][] = [];
    if (!p || !B.rows.length) pieces.push(g.points);
    else {
      const d = densify(g.points, p / 2); let run: [number, number][] = [];
      const flush = () => { if (run.length >= 2 && lengthOf(run) >= CORN_V1.minPiecePitches * (pr ?? p)) pieces.push(run); run = []; };
      const gDir = dirOf(g.points);
      const cutting = plantsTrustedEarly ? B.rows.filter(r => angleOff(dirOf(r.points), gDir) <= CORN_V1.maxDirectionOffDeg) : [];
      for (const q of d) { if (cutting.some(r => distToLine(r.points, q[0], q[1]) <= CORN_V1.contradictShare * p)) flush(); else run.push(q); }
      flush();
    }
    if (!pieces.length) { dropped++; return; }
    // Alone, a green row stands as high confidence only where the green read is the right instrument and holds it well
    // (measured on labelled maize, 2026-11-04, green rows no plant row confirms): rows grown into bands (establishment,
    // mid: the plants touch and cannot be located one by one) on green over CORN_V1.bandSupport of their strips, right
    // 67 times in 77; a late canopy only where its rows stand on green almost all along (seedling frames misjudged as
    // canopy hold their rows on half their length). Never an emergence row alone: there the plants
    // are what the read is about, and its lines on other people's seedling frames were right 47 times in 211.
    // And never a short piece, nor one across the rows the plants show: the French plots' false green rows were short
    // diagonal pieces across rows the plants ran along (2026-11-04).
    const stage = planStage(g.plan);
    const longEnough = lengthOf(g.points) >= CORN_V1.greenAloneMinPitches * (pr ?? p ?? 0);
    // The plants' direction overrules the green only where the plant read has shown itself right in this photo (a row
    // both reads agree on, or a detector): on a weedy Utah frame plants located on the green lined weeds up across the
    // corn rows and would have vetoed every true green row.
    const plantsTrusted = plantsTrustedEarly;
    const alongPlants = !plantsTrusted || B.directionDeg == null || !B.rows.length || angleOff(dirOf(g.points), B.directionDeg) <= CORN_V1.maxDirectionOffDeg;
    const held = ((stage === "establishment" || stage === "mid") && g.supportShare >= CORN_V1.bandSupport) || (stage === "late" && g.supportShare >= CORN_V1.canopySupport);
    const high = held && longEnough && alongPlants;
    for (const piece of pieces) rows.push({ points: piece, evidence: "green read only", confidence: high ? "high" : "medium", identity: "probable crop", why: alongPlants ? "" : "it runs across the rows the plants line up in", greenRow: gi, plants: 0, stage, mainPlanting: g.plan === mainPlan, latticeCandidate: !high && alongPlants && longEnough && g.supportShare >= CORN_V1.bandSupport });
  });
  // On the planting's lattice: a green row the plants missed (fainter seedlings, a tyre track along it), or a plant row
  // the green read missed, lying one spacing from rows both reads agree on, on each side of it (parallel, long and
  // held), is that row (Yunus's photos 20, 21, 35, 45, 2026-11-04).
  const lp = pr ?? p;
  if (lp) {
    // Agreed rows only (no chain: on MatchPlant promoted rows spreading from a wrong agreed row were false 18 times in
    // 24), and one on each side, a spacing away: the row the plants or the green missed between two they agree on.
    const anchors = rows.filter(r => r.evidence === "both reads agree");
    for (const r of rows) {
      if (!r.latticeCandidate || r.confidence === "high") continue;
      const plan = r.greenRow != null ? greenRows[r.greenRow].plan : mainPlan;
      const mid = r.points[r.points.length >> 1];
      const sides = new Set<number>();
      for (const a of anchors) {
        if (a.greenRow == null || greenRows[a.greenRow].plan !== plan) continue;
        if (angleOff(dirOf(a.points), dirOf(r.points)) > CORN_V1.latticeAngleDeg) continue;
        const o = acrossOffset(r.points, a.points);
        if (Math.abs(o / lp - 1) > CORN_V1.latticeTol) continue;
        // Which side: the sign of the anchor's middle across the candidate's direction.
        const t = (dirOf(r.points) * Math.PI) / 180, am = a.points[a.points.length >> 1];
        sides.add(Math.sign(-(am[0] - mid[0]) * Math.sin(t) + (am[1] - mid[1]) * Math.cos(t)));
      }
      if (sides.has(1) && sides.has(-1)) { r.confidence = "high"; r.onLattice = true; }
    }
  }


  // Identity.
  for (const r of rows) {
    if (entered !== "corn") { r.why = entered ? `the field is entered as ${entered}` : "no crop entered for the field"; continue; }
    if (!r.mainPlanting) { r.why = "a second planting beside the main one: its crop is not confirmed"; continue; }
    if (r.confidence !== "high") { if (r.why) continue; r.why = r.evidence === "plant read only" ? (o.source === "detector" ? "plants line up here but not at the planting's spacing" : "plants located on the green line up here, but the green read holds no row on them") : "the green read alone, where it is not the right instrument (seedlings) or holds the row weakly"; continue; }
    if (spacingImpossible) { r.why = `the row spacing (${Math.round(spacingM! * 100)} cm) is not one corn is ever planted at`; continue; }
    r.identity = "corn";
    r.why = r.evidence === "both reads agree" ? "entered as corn; the plants and the green agree on the row" : r.evidence === "plant read only" ? (r.onLattice ? "entered as corn; the plants line up where the corn rows beside it say the next row runs (the green read missed it)" : "entered as corn; the plants line up at the planting's spacing (the green read missed the row)") : r.onLattice ? "entered as corn; the green holds the row where the corn rows beside it say the next row runs (the plants were not located on it)" : "entered as corn; the green holds the row well and nothing contradicts it";
  }
  const cornRows = rows.filter(r => r.identity === "corn");

  // Weed candidates.
  const weedVerdicts: CornV1Read["weedVerdicts"] = [];
  ad.weeds.forEach((w, i) => {
    if (w.verdict !== "weed candidate") return;
    if (w.tier === "small green") { weedVerdicts.push({ index: i, verdict: "unknown vegetation", why: "smaller than nearly all the crop's own seedlings" }); return; }
    const tolOn = p ? CORN_V1.onRowShare * p : 0;
    // Only a row held with confidence makes green on its line the crop: plants located on the green also line weeds up.
    if (p && rows.some(r => r.confidence === "high" && distToLine(r.points, w.x, w.y) <= tolOn)) { weedVerdicts.push({ index: i, verdict: "crop on a row", why: "on a planted row's line" }); return; }
    if (p && rows.some(r => distToLine(r.points, w.x, w.y) <= tolOn)) { weedVerdicts.push({ index: i, verdict: "unknown vegetation", why: "on the line of a row held by one read only" }); return; }
    const pp = p ?? pr ?? 0, reach = pp * CORN_V1.weedRowReachPitches;
    const dCorn = cornRows.length ? Math.min(...cornRows.map(r => distToLine(r.points, w.x, w.y))) : Infinity;
    if (reach && dCorn <= reach) {
      // On the line where the planting's next row runs (a row neither read held): the crop as likely as a weed.
      const k = Math.round(dCorn / pp);
      if (k >= 1 && Math.abs(dCorn - k * pp) <= CORN_V1.slotShare * pp) { weedVerdicts.push({ index: i, verdict: "unknown vegetation", why: "on the line where a row of the planting runs, a row not read: crop as likely as weed" }); return; }
      weedVerdicts.push({ index: i, verdict: "weed candidate", why: "between the rows, beside a corn row" }); return;
    }
    weedVerdicts.push({ index: i, verdict: "unknown vegetation", why: rows.some(r => distToLine(r.points, w.x, w.y) <= reach) ? "beside rows whose crop or line is not confirmed" : "no row in reach" });
  });

  // Gaps: only on green rows the plant read agrees with (or a canopy row standing as corn), with no plant inside.
  const gaps: CornV1Gap[] = [];
  const tolGap = p ? CORN_V1.gapPlantShare * p : 0;
  greenRows.forEach((g, gi) => {
    for (const gap of g.gaps) {
      const agreed = rows.some(r => r.greenRow === gi && r.evidence === "both reads agree" && r.identity === "corn");
      const canopyCorn = rows.some(r => r.greenRow === gi && r.evidence === "green read only" && r.identity === "corn");
      if (gap.kind === "uncertain") { gaps.push({ ...gap, greenRow: gi, verdict: "withheld", why: "the photo cannot tell here (dim, rim or noisy)" }); continue; }
      if (!agreed && !canopyCorn) { gaps.push({ ...gap, greenRow: gi, verdict: "withheld", why: "not a corn row both reads support" }); continue; }
      const L = Math.hypot(gap.x2 - gap.x1, gap.y2 - gap.y1);
      const inside = points.some(q => {
        const t = ((q.x - gap.x1) * (gap.x2 - gap.x1) + (q.y - gap.y1) * (gap.y2 - gap.y1)) / (L * L || 1);
        if (t < 0.1 || t > 0.9) return false;
        return Math.hypot(q.x - gap.x1 - t * (gap.x2 - gap.x1), q.y - gap.y1 - t * (gap.y2 - gap.y1)) <= tolGap;
      });
      if (inside) { gaps.push({ ...gap, greenRow: gi, verdict: "withheld", why: "a plant stands on the row's line inside it" }); continue; }
      gaps.push({ ...gap, greenRow: gi, verdict: "stand gap" });
    }
  });

  const kept = gaps.filter(g => g.verdict === "stand gap");
  if (entered === "corn" && spacingImpossible) notes.push(`The rows are ${Math.round(spacingM! * 100)} cm apart, a spacing corn is never planted at: every row is a planted row with its crop not confirmed, and no weeds or gaps are reported. Check the crop entered, or the flight height if the spacing looks wrong.`);
  else if (entered === "corn" && spacingFits === false) notes.push(`The rows measure ${Math.round(spacingM! * 100)} cm apart at the pixel size used, not one of corn's usual spacings: check the flight height (or the crop entered). Rows are still called corn.`);
  if (!B.rows.length) notes.push(points.length ? "The plants located on the soil do not line up in rows here (a canopy, or too few): the green read's rows stand alone." : "No plants could be located on the soil: the green read's rows stand alone.");
  notes.push("Corn is said only where the field is entered as corn and the plants and the green agree on the row: nothing in this read tells corn from another row crop by its look.");
  const fusionMs = Date.now() - t0;
  return {
    version: CORN_V1_VERSION, green: ad,
    plants: { source: o.source ?? "green", points, rows: B, ms: o.plantsMs ?? 0 },
    rows, weedVerdicts, gaps,
    identity: { entered, spacingChecked: spacingFits != null, spacingFits, spacingImpossible, spacingM, mainPitchPx: mainPitchPx ?? null },
    summary: {
      cornRows: cornRows.length, probableRows: rows.length - cornRows.length,
      agreedRows: rows.filter(r => r.evidence === "both reads agree").length, plantOnlyRows: rows.filter(r => r.evidence === "plant read only").length, greenOnlyRows: rows.filter(r => r.evidence === "green read only").length, greenRowsDropped: dropped,
      weeds: weedVerdicts.filter(v => v.verdict === "weed candidate").length, cropOnRow: weedVerdicts.filter(v => v.verdict === "crop on a row").length, unknownVegetation: weedVerdicts.filter(v => v.verdict === "unknown vegetation").length,
      gaps: kept.length, gapsWithheld: gaps.length - kept.length, gapLengthM: Math.round(kept.reduce((s, g) => s + g.lengthM, 0) * 1000) / 1000,
      ms: { green: o.greenMs ?? 0, plants: o.plantsMs ?? 0, fusion: fusionMs, total: (o.greenMs ?? 0) + (o.plantsMs ?? 0) + fusionMs },
    },
    notes,
  };
}

/**
 * The plant read's positions for a photograph whose green read has been made (`seedlings`: the cache that read used).
 * The rule for leaves darker than their soil (seedlingGreen.ts) is for small plants on bare soil that the shipped
 * mask cannot see. Where the green read itself reads the photograph as bands or a canopy (establishment, mid or late
 * plans over CORN_V1.bandedShare of the frame) and finds no seedling stand, the shipped mask is seeing the plants, and
 * the dark green there is leaf in shade: the plant read keeps corn-v1.0's mask and the photograph reads exactly as
 * corn-v1.0 read it. Measured 2026-11-12 on the three test flights checked by eye: with the rule on those frames a
 * shaded corn leaf gained its second weed vote on the mid-stage flight, and one of seven real weeds lost its
 * confirmation on the day-23 flight. Everywhere else the rule applies: on a seedling stand, and on a frame the green
 * read took for bare soil, which is where dark seedlings go unseen (15 of the 123 photographs of the first flight
 * judged held no plan at all).
 */
export function cornV1PlantPoints(px: PhotoPixels, ad: AdaptiveRead, seedlings: SeedlingCache, cores: boolean = CORN_CORES.on, reference: "strongest" | "marks" = CORN_CORES.reference): PlantPoint[] {
  return findMarks(px, photoViews(px, { seedlings, plant: cornV1PlantCache(px, ad, seedlings), pitchPx: greenPitchPx(ad) }, cores, reference)).points;
}
/** The vivid cores as asked of a photograph whose green read is made: the blurs from its row spacing; null with none. */
export function cornV1CoresAsked(ad: AdaptiveRead, reference: "strongest" | "marks" = CORN_CORES.reference): CoresAsked | null {
  return coresAsked(greenPitchPx(ad), reference);
}
/** The mask the plant read uses on this photograph (see cornV1PlantPoints above). */
export function cornV1PlantCache(px: PhotoPixels, ad: AdaptiveRead, seedlings: SeedlingCache): SeedlingCache {
  const seedlingStand = ad.plans.some(p => p.stage === "emergence");
  const banded = ad.plans.reduce((s, p) => s + (p.stage === "establishment" || p.stage === "mid" || p.stage === "late" ? p.ownedShare : 0), 0) >= CORN_V1.bandedShare;
  const dark = (seedlings.options ?? SEEDLING_GREEN).dark != null;
  return dark && banded && !seedlingStand ? { ...seedlingCache(px, SEEDLING_V1), levels: seedlings.levels } : seedlings;
}

/** Corn V1 over one photograph. */
export function readCornV1(px: PhotoPixels, params: RowCropParams, opts: CornV1Options = {}): CornV1Read {
  const t0 = Date.now();
  // One seedling mask per photograph, shared by the green read's emergence reader and the plant read.
  const seedlings = seedlingCache(px, opts.baselineSeedlings ? SEEDLING_V1 : SEEDLING_GREEN);
  const ad = readCornAdaptive(px, params, { ...opts, seedlings });
  const t1 = Date.now();
  // L1 the photograph's views, L2 the marks found in them (fieldTwin/layers): unless a detector gives the points.
  const fixedCache = opts.detectorPoints ? null : cornV1PlantCache(px, ad, seedlings);
  // The learned green view (L1, off by default): learned from the strict pass over the fixed mask; L2 reads its mask.
  const learned = fixedCache && !opts.baselineSeedlings && (opts.learnedGreen ?? LAYERS.learnedGreen) ? learnedGreenView(px, fixedCache) : null;
  const plantCache = learned ? learned.cache : fixedCache;
  let sizePx = typeof opts.coresSizePx === "number" ? opts.coresSizePx : null;
  if (opts.coresSizePx === "self" && plantCache) { const s = Array.from(findMarks(px, photoViews(px, { seedlings, plant: plantCache, pitchPx: greenPitchPx(ad) }, false)).look?.sizePx ?? []).filter(Number.isFinite).sort((a, b) => a - b); sizePx = s.length ? s[s.length >> 1] : null; }
  const views = plantCache ? photoViews(px, { seedlings, plant: plantCache, pitchPx: greenPitchPx(ad), sizePx }, opts.baselineSeedlings ? false : opts.cores ?? CORN_CORES.on, opts.coresReference ?? CORN_CORES.reference) : null;
  const found = views ? findMarks(px, views) : null;
  const points = opts.detectorPoints ?? found!.points;
  const t2 = Date.now();
  const v = fuseCornV1(ad, points, params, { enteredCrop: opts.enteredCrop ?? params.crop?.id ?? null, source: opts.detectorPoints ? "detector" : "green", greenMs: t1 - t0, plantsMs: t2 - t1 });
  if (found?.foundBy) v.plants.foundBy = found.foundBy;
  if (found) { v.plants.look = found.look; v.plants.typicalPx = found.typicalPx; v.plants.plantMask = learned ? "learned" : views!.plant === seedlings ? "seedlings" : "v1"; if (fixedCache && !opts.baselineSeedlings && (opts.learnedGreen ?? LAYERS.learnedGreen)) v.plants.learned = learned?.record ?? null; v.plants.coresRef = found.coresInfo && views?.cores ? { reference: found.coresInfo.reference, strongest: found.coresInfo.strongest, medianOnMarks: found.coresInfo.medianOnMarks ?? null, onMarks: found.coresInfo.onMarks ?? null, threshold: found.coresInfo.threshold, finePx: views.cores.asked.finePx, widePx: views.cores.asked.widePx } : null; }
  // The emergence guard: past the cut the plant count is withheld; the rows, gaps and weed candidates above stand.
  if (opts.baselineSeedlings ? false : opts.countGuard ?? CORN_COUNT_GUARD.on) {
    const c = cornV1RowCover(px, v, seedlings), withheld = c.share != null && c.share > CORN_COUNT_GUARD.cut;
    v.count = { rowGreenShare: c.share, cut: CORN_COUNT_GUARD.cut, withheld, rowSpacingPx: c.pitchPx };
    if (withheld) {
      v.plants.points = []; for (const r of v.rows) r.plants = null;
      v.notes.unshift(`Plant count withheld: ${CORN_COUNT_GUARD.message}. Green stands on ${Math.round(c.share! * 100)} % of the rows' length; plants are counted one by one up to ${Math.round(CORN_COUNT_GUARD.cut * 100)} %. Rows, gaps and weed candidates are reported as before.`);
      return v;
    }
  }
  if (!opts.detectorPoints && !opts.baselineSeedlings && opts.rowCandidates !== false && darkRuleApplies(ad, seedlings)) {
    const t3 = Date.now();
    const defer = opts.rowSpans ? { span: [] as [number, number][], axis: null as [number, number] | null } : null;
    v.plants.low = cornV1RowCandidates(px, seedlings, v.rows, params.gsdM ?? null, defer);
    if (defer?.axis) { v.plants.lowSpan = defer.span; v.plants.lowAxis = defer.axis; }
    v.plants.lowMs = Date.now() - t3;
  }
  return v;
}

/** Whether the plant read used the dark-leaf rule on this photograph (see cornV1PlantPoints): seedlings on soil. */
export function darkRuleApplies(ad: AdaptiveRead, seedlings: SeedlingCache): boolean {
  const seedlingStand = ad.plans.some(p => p.stage === "emergence");
  const banded = ad.plans.reduce((s, p) => s + (p.stage === "establishment" || p.stage === "mid" || p.stage === "late" ? p.ownedShare : 0), 0) >= CORN_V1.bandedShare;
  return (seedlings.options ?? SEEDLING_GREEN).dark != null && !(banded && !seedlingStand);
}

/** The direction the photograph's rows run in (radians in the photo; null with no row): the median over its rows. */
export function rowAngleOf(rows: { points: [number, number][] }[]): number | null {
  const a: number[] = [];
  for (const r of rows) {
    const p = r.points; if (p.length < 2) continue;
    const dx = p[p.length - 1][0] - p[0][0], dy = p[p.length - 1][1] - p[0][1]; if (Math.hypot(dx, dy) < 50) continue;
    let t = Math.atan2(dy, dx); if (t < 0) t += Math.PI; if (t >= Math.PI) t -= Math.PI; a.push(t);
  }
  if (!a.length) return null;
  // Directions are modulo a half turn: the median about the first one.
  const ref = a[0], rel = a.map(t => { let d = t - ref; while (d > Math.PI / 2) d -= Math.PI; while (d < -Math.PI / 2) d += Math.PI; return d; }).sort((x, y) => x - y);
  return ref + rel[rel.length >> 1];
}

/**
 * Candidates for the field's rows (2026-11-16): the plants the lower bar shows (SEEDLING_ROW), at the photo's own
 * pixel, split along the photograph's rows. The soil levels are the photograph's shared ones; nothing else is read again.
 */
export function cornV1RowCandidates(px: PhotoPixels, seedlings: SeedlingCache, rows: { points: [number, number][] }[], gsdM: number | null, defer: { span: [number, number][]; axis: [number, number] | null } | null = null): PlantPoint[] {
  const mask = seedlingMask(px, SEEDLING_ROW, sharedSoilLevels(seedlings, px)), angle = rowAngleOf(rows);
  // `defer`: the candidates' extents along the rows instead of a split at the assumed spacing (only with a row direction).
  if (defer && angle != null) defer.axis = [Math.cos(angle), Math.sin(angle)];
  return rowPlantPoints(mask, px.width, px.height, angle, gsdM, ROW_POINTS, defer && angle != null ? defer : null);
}

/**
 * Corn V1 as one RowCropRead for Photo Scout's overlay and summary: corn rows as rows, planted rows whose crop is not
 * confirmed in `probableRows`; weed candidates only where V1 reports them; everything withheld drawn grey (not judged).
 * Bands, plants, field edges and the seedling layer are the green read's.
 */
export function cornV1AsRead(v: CornV1Read): RowCropRead {
  const base = adaptiveAsRead(v.green);
  const gsd = Number.isFinite(base.gsdM) && base.gsdM > 0 ? base.gsdM : null;
  const verdictOf = new Map(v.weedVerdicts.map(w => [w.index, w]));
  const weeds: RowCropWeed[] = [];
  const withheld: RowCropRead["excluded"] = [];
  v.green.weeds.forEach((w, i) => {
    const vd = verdictOf.get(i);
    if (!vd) return; // not a candidate in the green read: already drawn by adaptiveAsRead as excluded
    const { plan: _p, verdict: _v, ...rest } = w;
    if (vd.verdict === "weed candidate" || (vd.verdict === "unknown vegetation" && w.tier === "small green")) weeds.push({ ...rest, id: weeds.length + 1 });
    else withheld.push({ hull: w.hull, areaM2: w.areaM2, reason: vd.verdict === "crop on a row" ? "on a planted row's line: the crop, not a weed" : `unknown vegetation: ${vd.why}` });
  });
  const gapsByRow = new Map<number, RowCropGap[]>();
  for (const g of v.gaps) if (g.verdict === "stand gap") { const { greenRow, verdict: _v, why: _w, ...gap } = g; gapsByRow.set(greenRow, [...(gapsByRow.get(greenRow) ?? []), gap]); }
  const withheldGaps = v.gaps.filter(g => g.verdict === "withheld");
  // The plant count withheld (CORN_COUNT_GUARD): no count and no plant position is carried, on any row.
  const hold = !!v.count?.withheld;
  const toRow = (r: CornV1Row, id: number): RowCropRow => {
    const g = r.greenRow != null ? v.green.rows[r.greenRow] : null;
    const lengthM = gsd ? Math.round(lengthOf(r.points) * gsd * 1000) / 1000 : 0;
    return {
      id, k: g?.k ?? id, points: r.points, lengthM, supportShare: g?.supportShare ?? 1, bandHalfWidthM: g?.bandHalfWidthM ?? 0, greenShare: g?.greenShare ?? 0,
      gaps: r.greenRow != null && r.identity === "corn" ? gapsByRow.get(r.greenRow) ?? [] : [],
      plants: hold ? null : g?.plants ?? null, plantPoints: hold ? null : g?.plantPoints ?? null,
      ...(g?.possiblePoints && !hold ? { possiblePoints: g.possiblePoints } : {}), ...(g?.uncertainPoints && !hold ? { uncertainPoints: g.uncertainPoints } : {}), ...(g?.missingPoints && r.identity === "corn" && !hold ? { missingPoints: g.missingPoints } : {}),
      identity: r.identity, evidence: r.evidence,
    };
  };
  // A green row drawn in pieces shares its gaps once: only its first piece carries them.
  const seen = new Set<number>();
  const rows = v.rows.map((r, i) => { const row = toRow(r, i + 1); if (r.greenRow != null) { if (seen.has(r.greenRow)) { row.gaps = []; row.missingPoints = undefined; } seen.add(r.greenRow); } return row; });
  const reported = weeds.filter(w => w.tier !== "small green");
  return {
    ...base,
    rows,
    weeds,
    excluded: [...base.excluded, ...withheld],
    cornV1: {
      version: v.version, plantSource: v.plants.source, plants: hold ? null : v.plants.points.length, ...(hold ? { countWithheld: CORN_COUNT_GUARD.message } : {}),
      cornRows: v.summary.cornRows, probableRows: v.summary.probableRows, agreedRows: v.summary.agreedRows, plantOnlyRows: v.summary.plantOnlyRows, greenOnlyRows: v.summary.greenOnlyRows, greenRowsDropped: v.summary.greenRowsDropped,
      cropOnRow: v.summary.cropOnRow, unknownVegetation: v.summary.unknownVegetation, gapsWithheld: withheldGaps.length,
      withheldGaps: withheldGaps.map(({ greenRow: _g, verdict: _v, ...g }) => g),
      spacingFits: v.identity.spacingFits, spacingImpossible: v.identity.spacingImpossible, entered: v.identity.entered,
    },
    summary: {
      ...base.summary,
      rows: rows.length, totalRowLengthM: Math.round(rows.reduce((s, r) => s + r.lengthM, 0) * 1000) / 1000,
      weeds: reported.length, weedAreaM2: Math.round(reported.reduce((s, w) => s + w.areaM2, 0) * 1000) / 1000,
      ...(base.summary.escapes != null ? { escapes: reported.filter(w => w.sizeClass === "escape").length } : {}),
      gaps: v.summary.gaps, gapLengthM: v.summary.gapLengthM,
      ...(hold ? { plants: null } : {}),
      ms: base.summary.ms + v.summary.ms.plants + v.summary.ms.fusion,
    },
    notes: [...v.notes, ...base.notes],
  };
}
