// Continuous-row crops (corn first): the rows are traced on the green itself, the whole row is the crop, and only
// green standing clear of every row band is a weed candidate.
//
// Why a reader of its own. The planting-pattern pass (photoScout/pattern.ts) was built for plants on a lattice: trees
// and vines at a spacing along rows, where a green blob at no lattice position is the finding. Corn is not that. From
// about V4 the plants of a row merge into one ragged line of leaves, the leaves reach a third of the way into the
// alley, and every one of them is crop. Read as a lattice, a corn row becomes hundreds of "off-row" circles; read by
// brightness, the lines land on the straw stripe between the rows. Here nothing on a row is ever a finding, phase is
// taken from the green only (never from brightness, so never from straw), and each row is a polyline traced strip by
// strip so that lens distortion and planter drift do not pull a straight line off the row at the frame's edges.
//
// Steps, each a function below: work raster (about 1 cm a pixel) -> soil-relative ExGR green mask -> row direction
// (projection variance) -> pitch (autocorrelation, checked against the crop's planted spacings, never assumed) ->
// strips half a metre long along the rows, the green peaks across each strip settled on the strip's lattice and
// chained strip to strip into rows -> a crop band per row from the row's own green -> green components: on a band
// they are crop, clear of every band they are weed candidates -> gaps along each row, and (fine pixels only) a stand
// estimate from the green peaks along the row.
//
// Scale. With a known pixel size the pitch is measured and compared with the planted spacings. Without one (no EXIF)
// the pitch in pixels gives the scale from the profile's default spacing, and the result says so: every metre in it
// then rests on that assumption.
import { type GreenOptions, GREEN_DEFAULTS, greenMaskWithExcess } from "../directGeoref/green";
import type { PhotoPixels } from "../photoScout/pattern";
import { readEmergence } from "./emergence";
import { FINE, fineSeedlings } from "./fineSeedlings";

export const ROW_CROP_READ_VERSION = 2;

/**
 * The growth stage the reader is tuned for. Each stage is its own variant with its own rules, kept apart so that
 * tuning one never moves the other (Yunus, 2026-10-29):
 * - "emergence": VE to about V2, bare soil and seedlings on the planter's line; each seedling a point, a row the line
 *   the points stand on (emergence.ts), plants counted along it, green off every row a weed candidate.
 * - "establishment": V2 to about V7, plants in a line with soil between the rows; rows traced on the green peaks,
 *   weeds are green clear of every row's band.
 * - "mid": V8 to tasselling, the canopy nearly meeting over narrow alleys; rows traced from the alley troughs
 *   (the soil stripes), the band reaches the alley edge, weeds are green standing on the alley floor.
 * A closed canopy (late) is refused by both with the reason; automatic stage detection is a later step.
 */
export type RowCropStage = "emergence" | "establishment" | "mid" | "late";

/** Target pixel size of the work raster, metres. Corn leaves are 2 cm and wider; finer buys nothing here. */
export const WORK_GSD_M = 0.01;
/** Strip length along the rows, metres. */
export const STRIP_M = 0.5;
/** Gaps along a row shorter than this are not reported, metres. */
export const MIN_GAP_M = 0.3;
/** A row must stand on green in at least this many strips, and this share of its span. */
export const MIN_ROW_STRIPS = 3;
export const MIN_ROW_SUPPORT_SHARE = 0.3;
/** Each row is carried this many strips past its last green for judging nearby patches (a row leaves the frame, it does not stop). */
export const END_EXTRAPOLATION_STRIPS = 2;
/** A row absent from more strips than this is ended (and may start again as another row). */
export const MAX_BRIDGE_STRIPS = 6;
/** Band half-width bounds as shares of the pitch. */
export const BAND_MIN_SHARE = 0.1;
export const BAND_MAX_SHARE = 0.45;
/** Vegetation between rows wider across than this many pitches is a border or cover, not a weed. */
export const BORDER_ACROSS_PITCHES = 1.5;
/** Vegetation between rows over this area is reported apart from the weeds, square metres. */
export const LARGE_PATCH_M2 = 1.0;
/** A strip peak must carry at least this many times the green of its alleys to be a row. */
export const PEAK_OVER_ALLEY = 3;
/** Green components under this area must stand clearly above their soil (mean excess over the margin) to count. */
export const SMALL_PATCH_CM2 = 50;
export const SMALL_PATCH_EXCESS = 0.1;
/** The band ends where the row's green density has fallen this close to the alley's floor: the tails of the leaves. */
export const BAND_FALL_SHARE = 0.1;
/** A patch no larger than this, within half a band beyond the band, elongated and pointing at the row, is a leaf tip. */
export const LEAF_TIP_MAX_CM2 = 80;
export const LEAF_TIP_REACH_SHARE = 0.6;
export const LEAF_TIP_ASPECT = 1.8;
export const LEAF_TIP_ANGLE_DEG = 40;

/**
 * Establishment: where the field ends (Yunus, 2026-11-02: "it just doesn't know where the field ends"). Rows are
 * traced on green peaks and a mown verge has green peaks too, so a trace ran on across the headland, the verge and the
 * road. Each row is now judged strip by strip from the ground around it (his rule: look at the surroundings; grass on
 * both sides of the line, or no green at all, is not the field).
 */
export const EDGE = {
  /** The row's band for this test, as a share of the pitch either side of the centreline. */
  bandShare: 0.2,
  /** Its alleys: from this share of the pitch out to half the pitch, on each side. */
  alleyFromShare: 0.3,
  /** A row stands where its band holds at least this share of the field's typical row green (the median over every
   * row's traced strips; a V2 row at 0.3 cm is 1 to 2 % green, a V6 row 30 to 50 %). Low on purpose: in a frame's dim,
   * vignetted corner the same corn is a fraction as green, and the contrast with its alleys does the real work ... */
  bandShareOfTypical: 0.1,
  /** ... and never less than this green (a road, a bare headland: nothing). */
  minBandGreen: 0.005,
  /** ... and at least this many times greener than the softer of its two alleys where the ground is green all over
   * (EDGE.greenGround: a verge, band and alleys alike) ... */
  bandOverAlley: 2,
  /** ... and this many times elsewhere (a dry-grass or weedy headland is as green in the band as beside it; a V2 stand
   * under weeds larger than its plants still clears it, its weeds being scattered). */
  bandOverAlleyBare: 1.5,
  /** Ground this green (band and alleys together) is grass or cover, never a gap in the field. */
  greenGround: 0.3,
  /** On green ground a row does not stand where both its alleys are at least this green: the line has run into the
   * verge, whose edge left one side part soil (photograph 34, 2026-11-02: a row kept two strips into the grass, its
   * softer alley 24 %). A corn row along a verge keeps one soil alley and still stands. */
  bothAlleysGreen: 0.2,
  /** ... unless its band is this many times greener than the greener of the two: corn growing on into the verge's
   * grass (photograph 42: band 77 to 87 % against 24 to 47 %), where grass alone reads as green as the band or less
   * (photograph 34: 59 % against 60 %, 83 % against 96 %). */
  overGreenerAlley: 1.5,
  /** An empty stretch running out to a row's end at the field's edge is the headland, not a gap; the row is drawn to its
   * last corn (validation 2026-11-02). Off: as before. */
  headlandNotGap: true,
  /** A strip where the row does not stand is still the field when its ground is not green and this many of the rows
   * one and two pitches either side stand there (a gap in one row; a headland or a road stops every row together). */
  standingNeighbours: 2,
  /** Strips (half a metre each) looked at beyond a row's traced ends, to see what lies there, and to see whether a
   * row running on is alone (its neighbours' ground looked at as far). */
  beyondStrips: 8,
  /** A row's first or last run shorter than this many strips, cut off from the rest by ground that is not the field, is
   * dropped (a one-strip "stand" at a verge's edge is not the row going on). */
  minRunBeyondBridge: 4,
  /** Row ends on one side join into one drawn field edge when their rows are neighbours and their ends this many strips apart at most. */
  chainStrips: 4,
};

export type RowCropParams = {
  /** Metres per pixel of the photo, or null when unknown. */
  gsdM: number | null;
  /** The crop's planted row spacings, metres, preferred when the measured pitch is within the tolerance of one. */
  spacingsM: number[];
  /** The spacing assumed for the scale when the pixel size is unknown. */
  defaultSpacingM: number;
  pitchToleranceShare: number;
  /** Half-width floor of a row's crop band, metres (a V2 row is a thin line). */
  bandMinHalfWidthM: number;
  /** Typical seed spacing along the row, metres; null disables gaps by spacing and the stand estimate. */
  seedSpacingM: number | null;
  /** The stand is estimated only when the work pixel is at most this, centimetres. */
  maxStandGsdCm: number;
  /** Green components under this area are specks, square centimetres. */
  minWeedAreaCm2: number;
  crop: { id: string; version: string } | null;
  stage: RowCropStage;
  /**
   * The row geometry decided before the reader runs (the adaptive reader, assess.ts: one direction for the field, a
   * pitch per planting), photo pixels. With it the reader traces, bands and judges as before but measures neither; a
   * region read with it cannot contradict its neighbours about where the rows run. Absent (every reader of its own): the
   * reader measures both, as it always did.
   */
  geometry?: RowCropGeometry | null;
};

/**
 * Row direction in degrees [0, 180) (image coordinates, y down) and the row pitch in photo pixels. The reader refines
 * both near the given values (the direction within GEOMETRY_DIRECTION_TOL_DEG, the pitch within GEOMETRY_PITCH_TOL):
 * the field's geometry is a prior that keeps a verge or a second planting from deciding it, not a value imposed to the
 * pixel (a degree off over a 4,000-pixel row is a third of a pitch).
 */
export type RowCropGeometry = {
  directionDeg: number; pitchPx: number;
  /** Without a pixel size: the field's assumed scale, metres per photo pixel (a second planting at another spacing is
   * measured in the main planting's metres, not assumed to be the default spacing itself). Absent: assumed from the pitch. */
  gsdM?: number | null;
};
/** With a geometry given, the reader's own direction is searched within this many degrees of the given one. */
export const GEOMETRY_DIRECTION_TOL_DEG = 3;
/** With a geometry given, the reader's own pitch is measured within this share of the given one. */
export const GEOMETRY_PITCH_TOL = 0.12;

export const DEFAULT_ROW_CROP_PARAMS: RowCropParams = {
  gsdM: null, spacingsM: [0.381, 0.508, 0.70, 0.762, 0.914], defaultSpacingM: 0.762, pitchToleranceShare: 0.08,
  bandMinHalfWidthM: 0.08, seedSpacingM: 0.16, maxStandGsdCm: 1.5, minWeedAreaCm2: 4, crop: null, stage: "establishment",
};

/** Late-stage constants: the mask is a pixel greener than the canopy within this share of the long side (about two
 * row spacings on these photographs). minLuma: no pixel darker than this is green, at any stage the reader reads
 * (the lens's black corners). */
/** A late row is drawn over a run of at least this share of the photo's longest (a corn field's rows cross the frame; lodged grass in a verge reads as short streaks: photographs 9, 10 and 21, 2026-11-02). */
export const LATE = { windowShare: 1 / 40, minLuma: 20, cornerRadius: 0.8, margin: 0.005, minRowRunShare: 0.5 };

/** Late stage: 1 where a work pixel is greener (ExGR excess) than the mean over a (2r+1)^2 window around it. */
export function localGreenMask(v: Float32Array, rgba: Uint8ClampedArray, W: number, H: number, r: number): Uint8Array {
  const ok = new Uint8Array(W * H), I = new Float64Array((W + 1) * (H + 1)), C = new Float64Array((W + 1) * (H + 1));
  for (let i = 0; i < W * H; i++) { const q = i * 4; ok[i] = 0.3 * rgba[q] + 0.59 * rgba[q + 1] + 0.11 * rgba[q + 2] >= LATE.minLuma && Number.isFinite(v[i]) ? 1 : 0; }
  for (let y = 0; y < H; y++) { let s = 0, c = 0; for (let x = 0; x < W; x++) { const i = y * W + x; if (ok[i]) { s += v[i]; c++; } I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + s; C[(y + 1) * (W + 1) + x + 1] = C[y * (W + 1) + x + 1] + c; } }
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!ok[i]) continue;
    const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    const n = C[y1 * (W + 1) + x1] - C[y0 * (W + 1) + x1] - C[y1 * (W + 1) + x0] + C[y0 * (W + 1) + x0];
    const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    if (n && v[i] > s / n + LATE.margin) m[i] = 1;
  }
  return m;
}

/** Mid-stage constants (never read by the establishment variant). */
export const MID = {
  /** Green components under this area between the rows are leaf flakes, not weeds, square centimetres. */
  minWeedAreaCm2: 20,
  /** A leaf tip at mid stage can be this large. */
  leafTipMaxCm2: 150,
  /** A strip's alley trough must sit this far below the mean of its two plateaus (share of the plateau). */
  troughDepthShare: 0.25,
  /** Windows (3 m) whose coherence at the pitch is under this hold no readable rows: not traced, not judged. */
  minCoherence: 0.2,
  /** Under this share of coherent windows the canopy is closed or the rows unreadable: the read is refused. */
  minCoherentShare: 0.15,
  /**
   * Late-flush seedlings: small plants on the soil, found at the photo's own pixel by fineSeedlings.ts (FINE holds its
   * sizes), wherever the rows stand, counted as a layer, never as individual findings. At V8 and after, weeds that emerge under the closing
   * canopy matter for next year's seed, not this year's yield (docs/research/crops/corn/weed-ecology.md: "After V8 new
   * emergence matters for seed, not yield"; Steckel and Sprague 2004: waterhemp emerging after V8 did not reduce yield;
   * Iowa State: the later a weed emerges after the crop, the less it affects yield).
   */
  /** Seedlings kept as points for drawing, at most. */
  maxSeedlingPoints: 6000,
  /**
   * A between-row plant this wide or wider (equivalent diameter) is an escape: it came through the post pass and is
   * now large, the plant worth a look at mid season (corn profile pressure.grade.smallDiameterM is 0.15 m).
   */
  escapeDiameterM: 0.15,
  /**
   * A between-row patch is judged only where the alley around it is mostly soil: over this share of green on the
   * between-band ground of its neighbourhood (MID.alleyCellM cells, 3 x 3) the alley is a verge, a lawn or cover the
   * rows were traced into, and nothing there is a weed finding. A 30 cm escape in a soil alley covers under a tenth.
   */
  greenAlleyShare: 0.3,
  /**
   * ... and only where a real corn row is nearby: the crop bands of the neighbourhood must be at least this many times
   * as green as its alleys, and at least MID.minBandGreen green. In a verge or lawn the rows were traced into, band and
   * alley look alike (pale grass flecks both); in the field the band is dense leaf and the alley mostly soil.
   */
  bandOverAlley: 3,
  minBandGreen: 0.25,
  /** Looser, for drawing a row at all: its band green and at least this many times its alleys (a dense V10 stand still passes; a lawn does not). */
  rowBandOverAlley: 1.5,
  /** A mid-stage row is drawn only over a run of at least this many metres where it stands, and at least
   * minRowRunShare of the photo's longest such run (stubs in a verge are not rows; a close-up keeps its short rows). */
  minRowRunM: 3,
  minRowRunShare: 0.25,
  alleyCellM: 0.5,
};

export type RowCropGap = { x1: number; y1: number; x2: number; y2: number; lengthM: number; /** Emergence V2: what the stretch's expected plant positions showed (a missing plant the photo supports, or uncertain). */ kind?: "supported missing" | "uncertain" };

export type RowCropRow = {
  id: number;
  /** Lattice index across the field (0 at the first row seen; consecutive rows differ by one). */
  k: number;
  /** Centreline, photo pixels, one point per strip from the first to the last strip with green. */
  points: [number, number][];
  lengthM: number;
  /** Share of the row's strips that stand on green of their own (the rest are bridged). */
  supportShare: number;
  bandHalfWidthM: number;
  /** Green pixels within the band over the band's area. */
  greenShare: number;
  gaps: RowCropGap[];
  /** Plants estimated from the green peaks along the row, or null when the pixel is too coarse. Unverified. */
  plants: number | null;
  plantPoints: [number, number][] | null;
  /** Emergence V2, at expected positions in long stretches: weak evidence on the planter's line (possible seedlings), no
   * evidence where the photo is good enough to say so (supported missing plants), and too dim or noisy to tell. */
  possiblePoints?: [number, number][];
  uncertainPoints?: [number, number][];
  missingPoints?: [number, number][];
  /** Corn V1 (cornV1.ts): what the row is (corn, or a planted row whose crop is not confirmed) and the reads behind it. */
  identity?: "corn" | "probable crop";
  evidence?: "both reads agree" | "plant read only" | "green read only";
};

export type RowCropWeedStatus = "between rows" | "no rows here";

export type RowCropWeed = {
  id: number;
  x: number;
  y: number;
  areaM2: number;
  equivDiameterM: number;
  /** Convex outline, photo pixels. */
  hull: [number, number][];
  /** Nearest distance from the patch to a row centreline, metres (null with no rows in reach). */
  distToRowM: number | null;
  /** The band of the nearest row at that point, metres. */
  bandHalfWidthM: number | null;
  touchesEdge: boolean;
  status: RowCropWeedStatus;
  /** Emergence only: "larger than the crop" (over the stand's 90th-percentile seedling: a weed candidate) or "small green"
   * (counted apart, never called a weed). Absent elsewhere, and at emergence when the stand is too small to measure. */
  tier?: "larger than the crop" | "small green";
  /** Mid stage only: "escape" when the plant is MID.escapeDiameterM across or wider, else "small". Absent at establishment. */
  sizeClass?: "small" | "escape";
};

/** Mid stage: the late-flush seedling layer on the alley floor (never individual findings). */
export type RowCropSeedlings = { count: number; areaM2: number; /** Seedling area over the between-band area. */ cover: number | null; points: [number, number][] };

export type RowCropExcluded = { hull: [number, number][]; areaM2: number; reason: string };

/** Emergence V2: the plantings read, the observation classes, and the read's own consistency. */
export type EmergenceV2 = {
  /** A later planting beside the rows, barely emerged: its ground is set apart (an excluded outline) and its green counted here, not as weeds. */
  laterPlanting: { greenPatches: number } | null;
  /** Plants with strong direct evidence (the strict seedling test), including strictFound. */
  confirmed: number;
  /** Of those, plants the strict test sees on the line at an expected position that V1 never made a point (a large
   * seedling over the point size, or one in a crowded cell): V1 drew gaps through them. */
  strictFound: number;
  /** Expected positions with weak evidence on the planter's line. */
  possible: number;
  /** Expected positions too dim, at the rim, or on soil that fools the test. */
  uncertain: number;
  /** Expected positions with good light, a quiet alley beside and nothing there. */
  missing: number;
  searched: number;
  /** The relaxed test's hits per window in the alleys (the control): its false-find rate on this soil. */
  controlRate: number | null;
  /** The gaps before recovery (V1's), for the comparison. */
  gapsBefore: number;
  gapLengthBeforeM: number;
  /** The main rows' neighbouring spacing at their common middle, and its coefficient of variation. */
  rowSpacingM: number | null;
  rowSpacingCv: number | null;
  lensK1: number;
  /** The stand's own seedlings (the green points on the rows), square centimetres at the read's scale: median and 90th percentile. */
  seedlingAreaCm2: { p50: number; p90: number } | null;
  /** Off-row green smaller than the stand's 90th-percentile seedling: counted apart, not weed candidates (in `weeds` with tier "small green"). */
  smallGreen: number;
  /** Plants found past the rows' last strict point when the ends were followed on (EMERGENCE.extendEnds). */
  rowEndsFollowed: { strict: number; possible: number };
};

/** Establishment: a row's end inside the photo where the field stops, and what lies beyond it. */
export type RowCropFieldEnd = { row: number; x: number; y: number; beyond: "grass or cover" | "bare ground" };

export type RowCropSummary = {
  rows: number;
  rowsDropped: number;
  totalRowLengthM: number;
  medianBandHalfWidthM: number | null;
  medianRowGreenShare: number | null;
  weeds: number;
  weedAreaM2: number;
  /** Green area between the bands over the between-band area, the field's weed cover. */
  betweenRowCover: number | null;
  cropComponents: number;
  /** Green patches where no rows were read (a border, a headland): not judged. */
  noRowsPatches: number;
  /** Small patches just beyond a band, elongated toward the row, counted as the crop (a leaf tip cut off by shadow). */
  leafTips: number;
  /** Mid stage: between-row plants MID.escapeDiameterM across or wider. */
  escapes?: number;
  specks: number;
  gaps: number;
  gapLengthM: number;
  plants: number | null;
  /** Mean autocorrelation at the pitch over 3 m windows with green: how row-like the field reads. */
  coherence: number | null;
  vegetationFraction: number;
  ms: number;
};

export type RowCropRead = {
  version: number;
  stage: RowCropStage;
  width: number;
  height: number;
  /** Metres per photo pixel used by every metre in this read. */
  gsdM: number;
  scaleBasis: "given" | "assumed spacing";
  workFactor: number;
  /** Row direction in the photo, degrees counterclockwise from +x in image coordinates (y down), [0, 180). */
  directionDeg: number | null;
  pitchM: number | null;
  /** The planted spacing the pitch matched, or null when none did (the measured pitch stands). */
  matchedSpacingM: number | null;
  rows: RowCropRow[];
  weeds: RowCropWeed[];
  excluded: RowCropExcluded[];
  /** Mid stage only: the late-flush seedling layer; null at establishment. */
  seedlings: RowCropSeedlings | null;
  /** Emergence only: V2's plantings, observation classes and consistency. */
  emergence?: EmergenceV2;
  /** Establishment only: the row ends where the field stops inside the photo, and those ends joined into edge lines (photo pixels). */
  fieldEdge?: { ends: RowCropFieldEnd[]; lines: [number, number][][] };
  summary: RowCropSummary;
  notes: string[];
  crop: { id: string; version: string } | null;
  /** Corn V1 (cornV1.ts): the fused read's own counts; absent on a stage or adaptive read. */
  cornV1?: CornV1Summary;
};

/** Corn V1's counts and withheld findings, carried on the RowCropRead Photo Scout draws. */
export type CornV1Summary = {
  version: number;
  plantSource: "green" | "detector";
  plants: number;
  cornRows: number; probableRows: number; agreedRows: number; plantOnlyRows: number; greenOnlyRows: number; greenRowsDropped: number;
  cropOnRow: number; unknownVegetation: number; gapsWithheld: number;
  withheldGaps: RowCropGap[];
  spacingFits: boolean | null;
  /** A spacing corn is never planted at (no row called corn). */
  spacingImpossible: boolean;
  entered: string | null;
};

type Work = { W: number; H: number; rgba: Uint8ClampedArray };

/** Box-average downsample by an integer factor. */
export function downsample(px: PhotoPixels, f: number): Work {
  if (f <= 1) return { W: px.width, H: px.height, rgba: px.rgba };
  const W = Math.floor(px.width / f), H = Math.floor(px.height / f);
  const out = new Uint8ClampedArray(W * H * 4);
  const n = f * f;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < f; yy++) { let o = ((y * f + yy) * px.width + x * f) * 4; for (let xx = 0; xx < f; xx++, o += 4) { r += px.rgba[o]; g += px.rgba[o + 1]; b += px.rgba[o + 2]; } }
    const q = (y * W + x) * 4; out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
  }
  return { W, H, rgba: out };
}

const quantile = (xs: number[], q: number): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Green density on a coarse grid, and where it is saturated: cells whose neighbourhood (radius `R` cells) is more than
 * SATURATED_SHARE green are a lawn, a hedge or a closed canopy, not rows, and are left out of the direction, the
 * pitch and the tracing. The density returned is high-passed (the neighbourhood mean removed) so that a bright field
 * next to a dark road does not swamp the row periodicity.
 */
export const SATURATED_SHARE = 0.45;
/** Over this share of green a neighbourhood is solid whatever its periodicity (a lawn, a hedge, closed canopy). */
export const SOLID_SHARE = 0.6;
/** Between the two shares, a neighbourhood is solid only where the rows' periodicity is weak (a dense V7 row stand keeps it). */
export const SOLID_MIN_COHERENCE = 0.25;
export function coarseDensity(mask: Uint8Array, W: number, H: number, coarse: number, R: number, gate = true): { d: Float32Array; mean: Float32Array; sat: Uint8Array; w: number; h: number; satShare: number } {
  const w = Math.max(1, Math.floor(W / coarse)), h = Math.max(1, Math.floor(H / coarse));
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let n = 0; for (let yy = 0; yy < coarse; yy++) for (let xx = 0; xx < coarse; xx++) n += mask[(y * coarse + yy) * W + x * coarse + xx]; d[y * w + x] = n / (coarse * coarse); }
  // Box mean over (2R+1)^2 cells through a summed-area table.
  const sat = new Uint8Array(w * h), hp = new Float32Array(w * h), mean = new Float32Array(w * h);
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = d[y * w + x] + S[y * (w + 1) + x + 1] + S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
  let satN = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R);
    const m = (S[(y1 + 1) * (w + 1) + x1 + 1] - S[y0 * (w + 1) + x1 + 1] - S[(y1 + 1) * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0 + 1) * (y1 - y0 + 1));
    mean[y * w + x] = m;
    if (gate && m > SATURATED_SHARE) { sat[y * w + x] = 1; satN++; hp[y * w + x] = 0; } else hp[y * w + x] = d[y * w + x] - m;
  }
  return { d: hp, mean, sat, w, h, satShare: satN / (w * h) };
}

/** Projection of a density raster along the axis at `alpha`, detrended; its periodicity: the strongest autocorrelation between the lags, times the profile's standard deviation. */
function periodicity(d: Float32Array, W: number, H: number, alpha: number, minLag: number, maxLag: number): number {
  const c = Math.cos(alpha), s = Math.sin(alpha), D = Math.ceil(Math.hypot(W, H));
  const bins = new Float64Array(2 * D + 2), counts = new Int32Array(2 * D + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = Math.round(x * c + y * s) + D; bins[b] += d[y * W + x]; counts[b]++; }
  let lo = -1, hi = -1; for (let b = 0; b < bins.length; b++) if (counts[b] > 0) { if (lo < 0) lo = b; hi = b; bins[b] /= counts[b]; }
  if (hi - lo < 4 * minLag) return 0;
  const p = boxSmooth(bins.slice(lo, hi + 1), Math.round(maxLag));
  const q = new Float64Array(hi - lo + 1); for (let i = 0; i < q.length; i++) q[i] = bins[lo + i] - p[i];
  let m = 0; for (const v of q) m += v; m /= q.length;
  const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < q.length; i++) a += (q[i] - m) * (q[i + lag] - m); return a / Math.max(1, q.length - lag); };
  const a0 = ac(0); if (!(a0 > 0)) return 0;
  let best = 0; for (let lag = Math.max(2, Math.round(minLag)); lag <= Math.min(q.length / 3, maxLag); lag++) best = Math.max(best, ac(lag) / a0);
  // The periodicity itself, weighted by the profile's spread so an empty direction cannot win on noise alone; a sparse
  // V2 stand has little variance in any direction but a clear comb across its rows.
  return best * Math.sqrt(a0);
}

/** The row direction: the axis whose projection of the density is most periodic is across the rows. Lags in cells. Returns the row angle, radians. */
export function rowDirection(d: Float32Array, w: number, h: number, minLag: number, maxLag: number, around?: { rowDeg: number; halfDeg: number }, coarse?: { stepDeg: number; fineStepDeg: number }): number {
  let best = 0, bv = -1;
  // With `around` (a row direction decided for the field) only the axes within halfDeg of it are tried. With `coarse`
  // (the field assessment, which needs a direction to a degree or so, not to a tenth) the search steps are wider.
  const step = coarse?.stepDeg ?? 1, fineStep = coarse?.fineStepDeg ?? 0.1;
  const axis0 = around ? around.rowDeg - 90 - around.halfDeg : 0, axis1 = around ? around.rowDeg - 90 + around.halfDeg : 180 - step;
  for (let deg = Math.round(axis0); deg <= axis1; deg += step) { const v = periodicity(d, w, h, (deg * Math.PI) / 180, minLag, maxLag); if (v > bv) { bv = v; best = deg; } }
  let fine = best;
  const half = Math.max(1.5, step / 2);
  for (let t = best - half; t <= best + half; t += fineStep) { const v = periodicity(d, w, h, (t * Math.PI) / 180, minLag, maxLag); if (v > bv) { bv = v; fine = t; } }
  // The projection axis is across the rows; the rows run perpendicular to it.
  return ((((fine + 90) % 180) + 180) % 180) * (Math.PI / 180);
}

/** Across-row profile of the mask at the row angle, one bin per pixel, without the saturated pixels, detrended over `trendR` bins. */
export function acrossProfile(mask: Uint8Array, skip: Uint8Array, W: number, H: number, rowAngle: number, trendR: number): { profile: Float64Array; aMin: number } {
  const sn = -Math.sin(rowAngle), cs = Math.cos(rowAngle);
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => x * sn + y * cs);
  const aMin = Math.floor(Math.min(...corners)), aMax = Math.ceil(Math.max(...corners));
  const profile = new Float64Array(aMax - aMin + 2), counts = new Int32Array(aMax - aMin + 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (skip[i]) continue; const b = Math.round(x * sn + y * cs) - aMin; counts[b]++; if (mask[i]) profile[b]++; }
  for (let b = 0; b < profile.length; b++) if (counts[b]) profile[b] /= counts[b];
  const trend = boxSmooth(profile, trendR);
  for (let b = 0; b < profile.length; b++) profile[b] = counts[b] ? Math.max(0, profile[b] - trend[b]) : 0;
  return { profile, aMin };
}

/**
 * The pitch from the across profile's autocorrelation between minLag and maxLag, pixels; null when none. Every local
 * maximum at least half the strongest is a candidate. With `prefer` (planted spacings in pixels, and a tolerance share)
 * the strongest candidate near a planted spacing wins; otherwise the strongest, unless a candidate at a half or a
 * third of its lag is nearly as strong (the fundamental under a harmonic).
 */
export function pitchFromProfile(profile: Float64Array, minLag: number, maxLag: number, prefer?: { lagsPx: number[]; tolerance: number }): number | null {
  const n = profile.length;
  let m = 0, cnt = 0; for (let i = 0; i < n; i++) if (profile[i] > 0) { m += profile[i]; cnt++; }
  if (cnt < 10) return null;
  m /= cnt;
  const ac = (lag: number) => { let a = 0; for (let i = 0; i + lag < n; i++) a += (profile[i] - m) * (profile[i + lag] - m); return a / Math.max(1, n - lag); };
  const a0 = ac(0);
  if (!(a0 > 0)) return null;
  const lo = Math.max(2, Math.floor(minLag)), hi = Math.max(lo + 2, Math.floor(maxLag));
  const vals = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) vals[lag] = ac(lag) / a0;
  let gmax = -1; for (let lag = lo; lag <= hi; lag++) if (vals[lag] > gmax) gmax = vals[lag];
  if (gmax < 0.1) return null;
  const cands: { lag: number; v: number }[] = [];
  for (let lag = lo; lag <= hi; lag++) {
    if (vals[lag] > vals[lag - 1] && vals[lag] >= vals[lag + 1] && vals[lag] >= 0.5 * gmax) {
      const d = (vals[lag - 1] - vals[lag + 1]) / (2 * (vals[lag - 1] - 2 * vals[lag] + vals[lag + 1]) || 1);
      cands.push({ lag: lag + (Number.isFinite(d) ? Math.max(-0.5, Math.min(0.5, d)) : 0), v: vals[lag] });
    }
  }
  if (!cands.length) return null;
  if (prefer) {
    const near = cands.filter(c => prefer.lagsPx.some(L => Math.abs(c.lag - L) / L <= prefer.tolerance)).sort((a, b) => b.v - a.v);
    if (near.length) return near[0].lag;
  }
  // The harmonics of a comb are all about as strong as its fundamental; the fundamental is the shortest of them.
  const vmax = Math.max(...cands.map(c => c.v));
  return cands.filter(c => c.v >= 0.8 * vmax).reduce((a, b) => (b.lag < a.lag ? b : a)).lag;
}

type StripPeak = { a: number; mass: number };
type RowTrack = { k: number; pts: Map<number, { a: number; mass: number; support: boolean }>; lastStrip: number; lastA: number };

/** Local maxima of a smoothed strip profile, at least `minSep` apart, with at least `minMass`. */
function peaks(profile: Float64Array, minSep: number, minMass: number): StripPeak[] {
  const out: StripPeak[] = [];
  for (let i = 1; i + 1 < profile.length; i++) {
    if (profile[i] < minMass || profile[i] < profile[i - 1] || profile[i] < profile[i + 1]) continue;
    if (out.length && i - out[out.length - 1].a < minSep) { if (profile[i] > out[out.length - 1].mass) out[out.length - 1] = { a: i, mass: profile[i] }; continue; }
    out.push({ a: i, mass: profile[i] });
  }
  return out;
}

function boxSmooth(src: Float64Array, r: number): Float64Array {
  const n = src.length, out = new Float64Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); }
  return out;
}

/**
 * Mid stage: the alleys are the sharp feature (narrow soil troughs between broad canopy plateaus), so the rows are
 * put midway between consecutive troughs a pitch apart. A trough must fall MID.troughDepthShare below the mean of
 * the plateaus either side (the maxima within half a pitch), on ground the strip covers.
 */
function midRowPeaks(sm: Float64Array, counts: Int32Array, pitchPx: number, stripPx: number): StripPeak[] {
  const n = sm.length, half = Math.max(2, Math.round(pitchPx / 2)), minSep = Math.max(2, 0.5 * pitchPx);
  const troughs: number[] = [];
  for (let i = 1; i + 1 < n; i++) {
    if (counts[i] < 0.5 * stripPx || sm[i] > sm[i - 1] || sm[i] > sm[i + 1]) continue;
    let left = 0, right = 0;
    for (let d = 1; d <= half; d++) { if (i - d >= 0) left = Math.max(left, sm[i - d]); if (i + d < n) right = Math.max(right, sm[i + d]); }
    const plateau = (left + right) / 2;
    if (!(plateau > 0) || sm[i] > (1 - MID.troughDepthShare) * plateau) continue;
    if (troughs.length && i - troughs[troughs.length - 1] < minSep) { if (sm[i] < sm[troughs[troughs.length - 1]]) troughs[troughs.length - 1] = i; continue; }
    troughs.push(i);
  }
  const out: StripPeak[] = [];
  for (let k = 0; k + 1 < troughs.length; k++) {
    const d = troughs[k + 1] - troughs[k];
    if (d < 0.6 * pitchPx || d > 1.4 * pitchPx) continue;
    const a = (troughs[k] + troughs[k + 1]) / 2;
    let mass = 0; for (let j = Math.round(a - pitchPx / 4); j <= Math.round(a + pitchPx / 4); j++) if (j >= 0 && j < n) mass += sm[j];
    out.push({ a, mass });
  }
  return out;
}

/** Phase of a set of peaks against a lattice of pitch P: the mass-weighted circular mean of (a mod P). */
function latticePhase(ps: StripPeak[], P: number): number {
  let sx = 0, sy = 0;
  for (const p of ps) { const t = ((p.a % P) / P) * 2 * Math.PI; sx += p.mass * Math.cos(t); sy += p.mass * Math.sin(t); }
  const t = Math.atan2(sy, sx);
  return (((t / (2 * Math.PI)) * P) % P + P) % P;
}

export type RowCropOptions = { onProgress?: (done: number, total: number) => void; signal?: AbortSignal; /** Diagnostic lines (the bench prints them). */ debug?: (line: string) => void };

/**
 * Read one photograph of a continuous-row crop. Coordinates in the result are photo pixels; metres rest on `gsdM`
 * (given, or assumed from the pitch and the default spacing when null).
 */
export function readRowCrop(px: PhotoPixels, params: Partial<RowCropParams> = {}, opts: RowCropOptions = {}): RowCropRead {
  const t0 = Date.now();
  const P: RowCropParams = { ...DEFAULT_ROW_CROP_PARAMS, ...params };
  if (P.stage === "emergence") return readEmergence(px, P, opts);
  const notes: string[] = [];
  const given = P.gsdM != null && P.gsdM > 0 ? P.gsdM : null;
  const f = given ? Math.max(1, Math.round(WORK_GSD_M / given)) : Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
  const work = downsample(px, f);
  const { W, H } = work;
  let gsdW = given ? given * f : NaN; // metres per work pixel; set from the pitch when the scale is assumed
  const empty = (gsdM: number, scaleBasis: RowCropRead["scaleBasis"], why: string, vegetationFraction: number): RowCropRead => ({
    version: ROW_CROP_READ_VERSION, stage: P.stage, width: px.width, height: px.height, gsdM, scaleBasis, workFactor: f, directionDeg: null, pitchM: null, matchedSpacingM: null, rows: [], weeds: [], excluded: [], seedlings: null,
    summary: { rows: 0, rowsDropped: 0, totalRowLengthM: 0, medianBandHalfWidthM: null, medianRowGreenShare: null, weeds: 0, weedAreaM2: 0, betweenRowCover: null, cropComponents: 0, noRowsPatches: 0, leafTips: 0, specks: 0, gaps: 0, gapLengthM: 0, plants: null, coherence: null, vegetationFraction, ms: Date.now() - t0 },
    notes: [...notes, why], crop: P.crop,
  });

  // 1. Green, relative to the soil around it (straw and red soil stay out; a yellowing leaf still counts if it stands above its soil).
  const soilTilePx = given ? Math.max(16, Math.min(256, Math.round(0.64 / gsdW))) : 64;
  const gopts: GreenOptions = { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx, cellPx: 1, soilCapAboveGlobal: 0.05 };
  const green0 = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, gopts);
  // The lens's black corners are never green (validation 2026-11-02: six of 23 sampled establishment weed candidates
  // sat in them, the colour test reading noise in near-black pixels).
  // Only toward the frame's corners (beyond LATE.cornerRadius of the half-diagonal): a leaf's shadow inside the frame is
  // as dark, and taking it out of the mask split the mid canopy into hundreds of false between-row patches. Establishment
  // only: on mid photograph 17 (rows on the diagonal) it took the corners' row signal and the pitch was lost (benchmark
  // at 0562003); mid already leaves patches cut by the frame unjudged.
  if (P.stage === "establishment") {
    const cx = (W - 1) / 2, cy = (H - 1) / 2, R2 = (LATE.cornerRadius ** 2) * (cx * cx + cy * cy);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 < R2) continue;
      const q = (y * W + x) * 4;
      if (0.3 * work.rgba[q] + 0.59 * work.rgba[q + 1] + 0.11 * work.rgba[q + 2] < LATE.minLuma) green0.mask[y * W + x] = 0;
    }
  }
  const late = P.stage === "late";
  // Late (closed canopy, 2026-11-02): green is everywhere, but the rows still carry a strong periodic signal in how
  // green the canopy is (the corn stage benchmark: autocorrelation 0.76 to 0.89 at the 76 cm pitch on all five late
  // photographs probed). The mask becomes "greener than the canopy around it" (LATE.windowShare of the photo's long
  // side): the ridges of the rows in, the shaded alleys out. A lawn or a verge read so is noise, not rows, and the mid
  // variant's periodicity test leaves it out. Then the mid variant reads the rows; nothing between them is judged.
  const mask = late ? localGreenMask(green0.excess, work.rgba, W, H, Math.max(4, Math.round(Math.max(W, H) * LATE.windowShare))) : green0.mask;
  const excess = green0.excess;
  let greenN = 0; for (let i = 0; i < W * H; i++) greenN += green0.mask[i];
  const vegetationFraction = greenN / (W * H);
  if (vegetationFraction < 0.002) return empty(given ?? NaN, given ? "given" : "assumed spacing", "Almost no green in the photo: no rows to read.", vegetationFraction);

  // 2. Direction, on a coarse density raster (about 4 cm a cell when the scale is known), saturated green left out.
  const coarse = given ? Math.max(1, Math.round(0.04 / gsdW)) : Math.max(1, Math.round(Math.max(W, H) / 500));
  const satR = given ? Math.max(2, Math.round(0.75 / gsdW / coarse)) : Math.max(2, Math.round(Math.max(W, H) / coarse / 25));
  const mid = P.stage === "mid" || late; // the late variant reads its rows as the mid one does
  const cd = coarseDensity(mask, W, H, coarse, satR, !mid);
  // Per work pixel: inside a saturated cell (left out of the direction and the pitch; re-judged below once the pitch is known).
  const skip = new Uint8Array(W * H);
  const skipFrom = (sat: Uint8Array) => { skip.fill(0); for (let y = 0; y < H; y++) { const cy = Math.min(cd.h - 1, Math.floor(y / coarse)); for (let x = 0; x < W; x++) if (sat[cy * cd.w + Math.min(cd.w - 1, Math.floor(x / coarse))]) skip[y * W + x] = 1; } };
  skipFrom(cd.sat);
  const minPitchM = 0.8 * Math.min(...P.spacingsM, P.defaultSpacingM);
  const G = P.geometry ?? null;
  const rowAngle = rowDirection(cd.d, cd.w, cd.h, given ? minPitchM / gsdW / coarse : 2, given ? 2.0 / gsdW / coarse : Math.max(cd.w, cd.h) / 6, G ? { rowDeg: G.directionDeg, halfDeg: GEOMETRY_DIRECTION_TOL_DEG } : undefined);
  checkStop(opts);

  // 3. Pitch from the across profile's autocorrelation (or the one decided for the region, in work pixels).
  const minLag = given ? minPitchM / gsdW : 8, maxLagRaw = given ? 2.0 / gsdW : Math.max(W, H) / 3;
  const { profile, aMin } = acrossProfile(mask, skip, W, H, rowAngle, Math.round(maxLagRaw));
  const maxLag = Math.min(profile.length / 3, maxLagRaw);
  // A given pitch names the planting; the exact value is the reader's own measurement near it (the assessment measures
  // on the frame as the lens bends it, a few percent off the lattice a reader straightens or traces).
  const pitchPx = G ? pitchFromProfile(profile, (G.pitchPx / f) * (1 - GEOMETRY_PITCH_TOL), (G.pitchPx / f) * (1 + GEOMETRY_PITCH_TOL)) ?? G.pitchPx / f : pitchFromProfile(profile, minLag, maxLag, given ? { lagsPx: P.spacingsM.map(m => m / gsdW), tolerance: P.pitchToleranceShare } : undefined);
  opts.debug?.(`direction ${((rowAngle * 180) / Math.PI).toFixed(1)} deg, pitch ${pitchPx == null ? "none" : pitchPx.toFixed(1)} work px, saturated by density ${(cd.satShare * 100).toFixed(1)}%`);
  if (pitchPx == null) return empty(given ?? NaN, given ? "given" : "assumed spacing", "No periodic rows across the green: the field may be bare, closed, or the photo may not show rows.", vegetationFraction);
  let matchedSpacingM: number | null = null;
  let scaleBasis: RowCropRead["scaleBasis"] = "given";
  if (given) {
    const pitchM = pitchPx * gsdW;
    const near = P.spacingsM.filter(s => Math.abs(s - pitchM) / s <= P.pitchToleranceShare).sort((a, b) => Math.abs(a - pitchM) - Math.abs(b - pitchM));
    matchedSpacingM = near[0] ?? null;
    if (!matchedSpacingM) notes.push(`The measured row pitch, ${(pitchM * 100).toFixed(1)} cm, matches no planted spacing of the crop; the measurement stands.`);
  } else {
    gsdW = G?.gsdM ? G.gsdM * f : P.defaultSpacingM / pitchPx;
    scaleBasis = "assumed spacing";
    notes.push(G?.gsdM ? `No pixel size: the scale is the field's main planting's, which assumes a ${(P.defaultSpacingM * 100).toFixed(1)} cm row spacing there; these rows measure ${(pitchPx * gsdW * 100).toFixed(0)} cm at that scale.` : `No pixel size: the scale assumes a ${(P.defaultSpacingM * 100).toFixed(1)} cm row spacing, so every metre here rests on that.`);
  }
  const gsdM = gsdW / f;
  const pitchM = pitchPx * gsdW;
  const mPx = (m: number) => m / gsdW; // metres to work pixels

  // Solid green, now that the pitch is known: a neighbourhood over SOLID_SHARE green, or over SATURATED_SHARE with no
  // row periodicity around it (3 m windows). A dense V7 stand is green and periodic; a lawn is green and not.
  const cs0 = Math.cos(rowAngle), sn0 = Math.sin(rowAngle);
  const cohWin = Math.max(coarse * 4, Math.round(mPx(3)));
  const cohW = Math.ceil(W / cohWin), cohH = Math.ceil(H / cohWin);
  const cohMap = new Float32Array(cohW * cohH).fill(1);
  for (let y0 = 0; y0 < H; y0 += cohWin) for (let x0 = 0; x0 < W; x0 += cohWin) {
    const prof = new Float64Array(Math.ceil(cohWin * 1.5) + 2); let g = 0;
    for (let y = y0; y < Math.min(H, y0 + cohWin); y++) for (let x = x0; x < Math.min(W, x0 + cohWin); x++) { const i = y * W + x; if (!mask[i]) continue; g++; const b = Math.round(-(x - x0) * sn0 + (y - y0) * cs0 + cohWin * 0.75); if (b >= 0 && b < prof.length) prof[b]++; }
    let c = 1;
    if (g > 0.005 * cohWin * cohWin) { let m = 0; for (const v of prof) m += v; m /= prof.length; let a0 = 0, aP = 0; const lag = Math.round(pitchPx); for (let i = 0; i < prof.length; i++) { a0 += (prof[i] - m) ** 2; if (i + lag < prof.length) aP += (prof[i] - m) * (prof[i + lag] - m); } c = a0 > 0 ? aP / a0 : 0; }
    cohMap[Math.floor(y0 / cohWin) * cohW + Math.floor(x0 / cohWin)] = c;
  }
  const sat2 = new Uint8Array(cd.w * cd.h); let satN2 = 0;
  for (let cy = 0; cy < cd.h; cy++) for (let cx = 0; cx < cd.w; cx++) {
    const m = cd.mean[cy * cd.w + cx];
    const c = cohMap[Math.min(cohH - 1, Math.floor((cy * coarse) / cohWin)) * cohW + Math.min(cohW - 1, Math.floor((cx * coarse) / cohWin))];
    if (mid) { if (c < MID.minCoherence) { sat2[cy * cd.w + cx] = 1; satN2++; } continue; } // mid: readable rows are periodic, whatever the green share
    if (m <= SATURATED_SHARE) continue;
    if (m > SOLID_SHARE || c < SOLID_MIN_COHERENCE) { sat2[cy * cd.w + cx] = 1; satN2++; }
  }
  skipFrom(sat2);
  const satShare = satN2 / (cd.w * cd.h);
  if (mid) {
    const withGreen = cohMap.filter(c => c !== 1).length; // windows that had green (the rest kept the default 1)
    let coherent = 0; for (const c of cohMap) if (c !== 1 && c >= MID.minCoherence) coherent++;
    if (withGreen && coherent / withGreen < MID.minCoherentShare) return empty(gsdM, scaleBasis, `The rows are not readable: only ${Math.round((100 * coherent) / withGreen)}% of the photo shows a row pattern at the measured pitch (a closed canopy, or no rows). Nothing between the rows can be judged.`, vegetationFraction);
    if (satShare > 0.02) notes.push(`${Math.round(satShare * 100)}% of the photo shows no row pattern (a verge, a lawn or closed canopy) and is not judged.`);
  } else if (satShare > 0.02) notes.push(`${Math.round(satShare * 100)}% of the photo is solid green (a border, a lawn or a closed canopy) and is left out of the rows.`);

  // 4. Strips along the rows; the green peaks across each strip, settled on the strip's lattice, chained into rows.
  const cs = Math.cos(rowAngle), sn = Math.sin(rowAngle);
  const along = (x: number, y: number) => x * cs + y * sn, across = (x: number, y: number) => -x * sn + y * cs;
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  const lMin = Math.floor(Math.min(...corners.map(([x, y]) => along(x, y)))), lMax = Math.ceil(Math.max(...corners.map(([x, y]) => along(x, y))));
  const stripPx = Math.max(8, Math.round(mPx(STRIP_M)));
  const nStrips = Math.ceil((lMax - lMin) / stripPx);
  const nA = profile.length;
  const stripProfiles: Float64Array[] = Array.from({ length: nStrips }, () => new Float64Array(nA));
  const stripCounts: Int32Array[] = Array.from({ length: nStrips }, () => new Int32Array(nA));
  // Per work pixel: its strip and across bin (kept for the band and the components).
  const pxStrip = new Int32Array(W * H), pxA = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, s = Math.min(nStrips - 1, Math.floor((along(x, y) - lMin) / stripPx)), b = Math.max(0, Math.min(nA - 1, Math.round(across(x, y)) - aMin));
    pxStrip[i] = s; pxA[i] = b; stripCounts[s][b]++; if (mask[i] && !skip[i]) stripProfiles[s][b]++;
  }
  const smoothR = Math.max(1, Math.round(Math.min(pitchPx / 8, mPx(0.04))));
  const minSep = Math.max(2, 0.5 * pitchPx);
  // Minimum mass for a peak: green along at least this share of the strip's length (a smoothed bin is an average of pixels across).
  const minPeakMass = 0.03 * stripPx;
  const tracks: RowTrack[] = [];
  let nextK = 0;
  for (let s = 0; s < nStrips; s++) {
    checkStop(opts);
    const pr = stripProfiles[s];
    // Bins the strip does not cover (outside the photo's rotated corners) stay zero.
    const sm = boxSmooth(pr, smoothR);
    // A row's peak stands over its alleys: the mean a quarter to half a pitch either side. A lawn's peaks do not.
    const alley = (a: number) => { let m = 0, n = 0; for (const sgn of [-1, 1]) for (let d = Math.round(pitchPx / 4); d <= Math.round(pitchPx / 2); d++) { const j = a + sgn * d; if (j >= 0 && j < sm.length) { m += sm[j]; n++; } } return n ? m / n : 0; };
    const ps = mid ? midRowPeaks(sm, stripCounts[s], pitchPx, stripPx) : peaks(sm, minSep, minPeakMass).filter(p => p.mass >= PEAK_OVER_ALLEY * alley(p.a));
    if (ps.length) {
      const phase = latticePhase(ps, pitchPx);
      // Local pitch from the accepted peaks' spacings (lens distortion and drift change it by a few percent).
      const sorted = [...ps].sort((u, v) => u.a - v.a);
      const onLattice = (p: StripPeak) => Math.abs(((p.a - phase) % pitchPx + pitchPx * 1.5) % pitchPx - pitchPx / 2) <= pitchPx / 4;
      const chained = (i: number) => [i - 1, i + 1].some(j => j >= 0 && j < sorted.length && Math.abs(Math.abs(sorted[j].a - sorted[i].a) - pitchPx) <= 0.2 * pitchPx);
      // Two peaks with bare soil between them are two rows, however close: in a frame's corner the camera's tilt and the
      // lens squeeze the rows to two thirds of their spacing (photograph 72's bottom-left), where the lattice and the
      // spacing tests below lose the outer rows. One row's leaves can show two peaks too, but with green between them.
      const soilBetween = (u: StripPeak, v: StripPeak) => {
        if (mid || Math.abs(v.a - u.a) < 0.5 * pitchPx) return false;
        let lo = Infinity; for (let b = Math.min(u.a, v.a) + 1; b < Math.max(u.a, v.a); b++) lo = Math.min(lo, sm[b]);
        return lo < 0.3 * Math.min(u.mass, v.mass);
      };
      const ok = sorted.map((p, i) => onLattice(p) || chained(i));
      // A squeezed row is taken from an accepted neighbour outward: 0.6 to 1.2 pitches away with soil between.
      if (!mid) for (let pass = 0; pass < 4; pass++) {
        let grew = false;
        for (let i = 0; i < sorted.length; i++) {
          if (ok[i]) continue;
          for (const j of [i - 1, i + 1]) {
            if (j < 0 || j >= sorted.length || !ok[j]) continue;
            const d = Math.abs(sorted[j].a - sorted[i].a);
            if (d >= 0.6 * pitchPx && d <= 1.2 * pitchPx && soilBetween(sorted[Math.min(i, j)], sorted[Math.max(i, j)])) { ok[i] = true; grew = true; break; }
          }
        }
        if (!grew) break;
      }
      const accRaw = sorted.filter((_, i) => ok[i]);
      const acc: StripPeak[] = [];
      for (const p of accRaw) { const last = acc[acc.length - 1]; if (last && p.a - last.a < 0.75 * pitchPx && !soilBetween(last, p)) { if (p.mass > last.mass) acc[acc.length - 1] = p; } else acc.push(p); }
      let Ps = pitchPx;
      if (acc.length >= 3) {
        const diffs: number[] = [];
        for (let i = 1; i < acc.length; i++) { const d = acc[i].a - acc[i - 1].a, n = Math.round(d / pitchPx); if (n >= 1) diffs.push(d / n); }
        const med = quantile(diffs, 0.5);
        if (med != null) Ps = Math.max(0.9 * pitchPx, Math.min(1.1 * pitchPx, med));
      }
      // Assign accepted peaks to rows: a row seen within MAX_BRIDGE_STRIPS strips at a position within a third of a pitch.
      const assignedThisStrip: { k: number; a: number }[] = [];
      for (const p of acc.sort((u, v) => u.a - v.a)) {
        let best: RowTrack | null = null, bd = Ps / 3;
        for (const t of tracks) { if (s - t.lastStrip > MAX_BRIDGE_STRIPS || t.pts.has(s)) continue; const d = Math.abs(p.a - t.lastA); if (d < bd) { bd = d; best = t; } }
        if (!best) {
          // A new row: its index from the nearest row already placed in this strip, else from the last rows seen, else fresh.
          let k: number | null = null;
          if (assignedThisStrip.length) { const n = assignedThisStrip.reduce((u, v) => (Math.abs(v.a - p.a) < Math.abs(u.a - p.a) ? v : u)); k = n.k + Math.round((p.a - n.a) / Ps); }
          else { const recent = tracks.filter(t => s - t.lastStrip <= MAX_BRIDGE_STRIPS); if (recent.length) { const n = recent.reduce((u, v) => (Math.abs(v.lastA - p.a) < Math.abs(u.lastA - p.a) ? v : u)); k = n.k + Math.round((p.a - n.lastA) / Ps); } }
          if (k == null) k = nextK++;
          // Two tracks may share an index for a while (a row lost and found again, or the index chain slipped at the edge);
          // the indices are settled from position once the rows are known.
          best = { k, pts: new Map(), lastStrip: s, lastA: p.a };
          tracks.push(best);
        }
        best.pts.set(s, { a: p.a, mass: p.mass, support: true });
        best.lastStrip = s; best.lastA = p.a;
        assignedThisStrip.push({ k: best.k, a: p.a });
      }
    }
    opts.onProgress?.(s + 1, nStrips + 2);
  }

  // Rows: trimmed to their supported span, bridged inside it, dropped when too short or thin.
  type RowW = FieldRow;
  const rowsW: RowW[] = [];
  let rowsDropped = 0;
  for (const t of tracks) {
    const ss = [...t.pts.keys()].sort((u, v) => u - v);
    const s0 = ss[0], s1 = ss[ss.length - 1], n = s1 - s0 + 1;
    const supported = ss.length;
    if (supported < MIN_ROW_STRIPS || supported / n < MIN_ROW_SUPPORT_SHARE) { rowsDropped++; continue; }
    const a = new Float64Array(n), support = new Uint8Array(n);
    for (const s of ss) { a[s - s0] = t.pts.get(s)!.a; support[s - s0] = 1; }
    // Linear bridge over the gaps.
    for (let i = 0; i < n; i++) if (!support[i]) { let lo = i - 1; while (lo >= 0 && !support[lo]) lo--; let hi = i + 1; while (hi < n && !support[hi]) hi++; a[i] = lo >= 0 && hi < n ? a[lo] + ((a[hi] - a[lo]) * (i - lo)) / (hi - lo) : lo >= 0 ? a[lo] : a[hi]; }
    rowsW.push({ k: t.k, s0, s1, a: smoothRow(a), support });
  }
  // Settle the lattice indices from position: the rows' mean across positions, sorted, divided by the pitch.
  for (const r of rowsW) { let m = 0; for (let i = 0; i < r.a.length; i++) m += r.a[i]; r.k = m / r.a.length; }
  rowsW.sort((u, v) => u.k - v.k);
  // Indices in order of position: the next row's index steps by its distance in pitches, at least one unless the two
  // traces are the same row (overlapping in strips and within a third of a pitch, or one after the other within half).
  // Two traces are compared where they are: over the strips they share, or end to end. Their mean positions are not
  // comparable at a frame's corner, where the lens bends every row and squeezes them together (photograph 72: a corner
  // row a third of a pitch from its neighbour's mean was joined to it, the joined line zig-zagged between the two, and
  // the corner corn became weeds and the field "ended" there).
  const meanA = rowsW.map(r => r.k); // the mean across positions, before k becomes an index
  const apart = (u: RowW, v: RowW): { d: number; overlap: boolean } => {
    const lo = Math.max(u.s0, v.s0), hi = Math.min(u.s1, v.s1);
    if (lo <= hi) { const ds: number[] = []; for (let s = lo; s <= hi; s++) ds.push(Math.abs(v.a[s - v.s0] - u.a[s - u.s0])); return { d: quantile(ds, 0.5) ?? 0, overlap: true }; }
    const [first, second] = u.s1 < v.s0 ? [u, v] : [v, u];
    return { d: Math.abs(second.a[0] - first.a[first.a.length - 1]), overlap: false };
  };
  for (let i = 0; i < rowsW.length; i++) {
    if (i === 0) { rowsW[i].k = 0; continue; }
    const prev = rowsW[i - 1], cur = rowsW[i], { d, overlap } = apart(prev, cur);
    const same = overlap ? d < pitchPx / 3 : d < pitchPx / 2;
    cur.k = same ? prev.k : prev.k + Math.max(1, Math.round(d / pitchPx));
  }
  void meanA;
  // One row per lattice slot: two traces of the same row (lost and found again, or found twice) are joined, a supported
  // point winning over a bridged one where they overlap.
  for (let i = rowsW.length - 1; i > 0; i--) {
    const a = rowsW[i], b = rowsW[i - 1];
    if (a.k !== b.k) continue;
    if (Math.max(a.s0, b.s0) - Math.min(a.s1, b.s1) > MAX_BRIDGE_STRIPS) continue; // too far apart along the row to be one
    const s0 = Math.min(a.s0, b.s0), s1 = Math.max(a.s1, b.s1), n = s1 - s0 + 1;
    const pos = new Float64Array(n), sup = new Uint8Array(n), has = new Uint8Array(n);
    for (const r of [b, a]) for (let j = 0; j < r.a.length; j++) { const t = r.s0 + j - s0; if (!has[t] || (r.support[j] && !sup[t])) { pos[t] = r.a[j]; sup[t] = r.support[j]; has[t] = 1; } }
    for (let t = 0; t < n; t++) if (!has[t]) { let lo = t - 1; while (lo >= 0 && !has[lo]) lo--; let hi = t + 1; while (hi < n && !has[hi]) hi++; pos[t] = lo >= 0 && hi < n ? pos[lo] + ((pos[hi] - pos[lo]) * (t - lo)) / (hi - lo) : lo >= 0 ? pos[lo] : pos[hi]; }
    rowsW.splice(i - 1, 2, { k: a.k, s0, s1, a: smoothRow(pos), support: sup });
  }
  // Row ends are not trimmed by the periodicity around them: on the test photographs that cut real rows short where a
  // lawn shares their 3 m window. At establishment they are cut by the ground around each row instead (EDGE).
  const kMin = 0;
  if (!rowsW.length) return empty(gsdM, scaleBasis, "Rows were periodic across the photo but none could be traced along it.", vegetationFraction);
  const fieldEnds: RowCropFieldEnd[] = [];
  const edgeLines: [number, number][][] = [];
  if (!mid) {
    const cut = fieldExtent(rowsW, mask, W, H, pxStrip, pxA, nStrips, pitchPx, opts.debug);
    rowsDropped += cut.dropped;
    rowsW.splice(0, rowsW.length, ...cut.rows);
    if (!rowsW.length) return empty(gsdM, scaleBasis, "Rows were traced, but nowhere does a row stand on soil with its alleys clear: grass, cover or bare ground, not a field of corn rows.", vegetationFraction);
    // The ends in photo pixels; one side's ends of neighbouring rows joined into the field's edge.
    const cE = Math.cos(rowAngle), sE = Math.sin(rowAngle);
    // Drawn where the field stops (the first strip past the row that is not the field), not at the row's last plant:
    // rows end staggered on a headland, the ground they end against does not.
    const endPoint = (e: { stopL: number; stopA: number }): [number, number] => {
      const l = lMin + e.stopL * stripPx, a = e.stopA + aMin;
      return [r3((l * cE - a * sE + 0.5) * f), r3((l * sE + a * cE + 0.5) * f)];
    };
    for (const side of [0, 1] as const) {
      const ends = cut.ends.filter(e => e.side === side).sort((u, v) => u.row.k - v.row.k);
      for (const e of ends) { const p = endPoint(e); fieldEnds.push({ row: e.row.k, x: p[0], y: p[1], beyond: e.beyond }); }
      // Chains of neighbouring rows; each drawn point at the median stop of itself and its two neighbours, so one row
      // whose ground reads differently does not spike the line.
      const chains: (typeof ends)[] = [];
      for (const e of ends) {
        const c = chains[chains.length - 1], last = c?.[c.length - 1];
        if (last && e.row.k - last.row.k === 1 && Math.abs(e.stopL - last.stopL) <= EDGE.chainStrips) c.push(e); else chains.push([e]);
      }
      for (const c of chains) {
        if (c.length < 2) continue;
        edgeLines.push(c.map((e, i) => {
          const nb = c.slice(Math.max(0, i - 1), i + 2).map(q => q.stopL).sort((u, v) => u - v);
          const stopL = c.length >= 3 ? nb[nb.length >> 1] : e.stopL;
          return endPoint({ stopL, stopA: e.stopA }); // the row's line barely drifts over a strip or two
        }));
      }
    }
    if (fieldEnds.length) {
      const g = fieldEnds.filter(e => e.beyond === "grass or cover").length;
      notes.push(`The field ends inside the photo: ${fieldEnds.length} row end${fieldEnds.length === 1 ? "" : "s"}, ${g} against grass or cover and ${fieldEnds.length - g} against bare ground (a headland, a track or a road). Rows stop there and nothing beyond is judged.`);
    }
  }

  // Row position per strip, for nearest-row lookups.
  const rowsByStrip: { r: number; a: number }[][] = Array.from({ length: nStrips }, () => []);
  rowsW.forEach((r, ri) => {
    for (let s = r.s0; s <= r.s1; s++) rowsByStrip[s].push({ r: ri, a: r.a[s - r.s0] });
    // Carried on past both ends along the row's own drift, for judging patches there (not drawn, not counted as length).
    const n = r.a.length, slope = n >= 4 ? (r.a[n - 1] - r.a[Math.max(0, n - 4)]) / Math.min(3, n - 1) : 0, slope0 = n >= 4 ? (r.a[Math.min(n - 1, 3)] - r.a[0]) / Math.min(3, n - 1) : 0;
    for (let e = 1; e <= END_EXTRAPOLATION_STRIPS; e++) {
      if (!r.edge1 && r.s1 + e < nStrips) rowsByStrip[r.s1 + e].push({ r: ri, a: r.a[n - 1] + slope * e });
      if (!r.edge0 && r.s0 - e >= 0) rowsByStrip[r.s0 - e].push({ r: ri, a: r.a[0] - slope0 * e });
    }
  });
  for (const lst of rowsByStrip) lst.sort((u, v) => u.a - v.a);
  // Establishment: the ground past a row's cut end, along its line, is past the field: green there is not judged (a
  // row cut in a dim corner by mistake must never turn its own plants into weeds of the rows beside it).
  const beyondByStrip: [number, number][][] = Array.from({ length: nStrips }, () => []);
  for (const r of rowsW) {
    const n = r.a.length, slope = n >= 4 ? (r.a[n - 1] - r.a[n - 4]) / 3 : 0, slope0 = n >= 4 ? (r.a[3] - r.a[0]) / 3 : 0;
    for (let e = 1; e <= EDGE.beyondStrips; e++) {
      if (r.edge1 && r.s1 + e < nStrips) { const a = r.a[n - 1] + slope * e; beyondByStrip[r.s1 + e].push([a - pitchPx / 2, a + pitchPx / 2]); }
      if (r.edge0 && r.s0 - e >= 0) { const a = r.a[0] - slope0 * e; beyondByStrip[r.s0 - e].push([a - pitchPx / 2, a + pitchPx / 2]); }
    }
  }
  const beyondEdge = (s: number, b: number) => { for (const [lo, hi] of beyondByStrip[s]) if (b >= lo && b <= hi) return true; return false; };
  const nearestRow = (s: number, b: number): { r: number; d: number } | null => {
    const lst = rowsByStrip[s]; if (!lst.length) return null;
    if (b < lst[0].a - pitchPx / 2 || b > lst[lst.length - 1].a + pitchPx / 2) return null; // beyond the outermost rows
    let best = lst[0], bd = Math.abs(b - lst[0].a);
    for (let i = 1; i < lst.length; i++) { const d = Math.abs(b - lst[i].a); if (d < bd) { bd = d; best = lst[i]; } }
    return { r: best.r, d: bd };
  };

  // 5. The crop band of each row from its own green: the density of green by distance from the centreline falls
  // from the row's peak to the alley's floor; the band ends where it has fallen three quarters of the way.
  const halfP = Math.ceil(pitchPx / 2) + 1;
  const dens: Float64Array[] = rowsW.map(() => new Float64Array(halfP)), cnts: Float64Array[] = rowsW.map(() => new Float64Array(halfP));
  for (let i = 0; i < W * H; i++) {
    if (skip[i]) continue;
    const nr = nearestRow(pxStrip[i], pxA[i]);
    if (!nr || nr.d > pitchPx / 2) continue;
    const b = Math.round(nr.d); cnts[nr.r][b]++; if (mask[i]) dens[nr.r][b]++;
  }
  const bandMin = Math.max(mPx(P.bandMinHalfWidthM), BAND_MIN_SHARE * pitchPx), bandMax = BAND_MAX_SHARE * pitchPx;
  const bandRaw = rowsW.map((_, ri) => {
    const d = new Float64Array(halfP); for (let b = 0; b < halfP; b++) d[b] = cnts[ri][b] ? dens[ri][b] / cnts[ri][b] : 0;
    const sm = boxSmooth(d, 2);
    let peak = 0; for (let b = 0; b <= Math.min(halfP - 1, Math.round(bandMax)); b++) peak = Math.max(peak, sm[b]);
    let floor = 0, n = 0; for (let b = Math.round(0.35 * pitchPx); b < halfP; b++) { floor += sm[b]; n++; } floor = n ? floor / n : 0;
    if (!(peak > floor)) return bandMin;
    const thr = floor + BAND_FALL_SHARE * (peak - floor);
    // The outermost offset still above the threshold: the leaves' tails (a twin row's second line keeps the density up too).
    let b = Math.min(halfP - 1, Math.round(bandMax)); while (b > bandMin && sm[b] < thr) b--;
    return Math.max(bandMin, Math.min(bandMax, b + 3));
  });
  const bandMed = quantile(bandRaw, 0.5) ?? bandMin;
  const band = bandRaw.map(b => Math.max(bandMin, Math.min(bandMax, Math.max(0.6 * bandMed, Math.min(1.5 * bandMed, b)))));

  // 6. Components of the green: on a band they are crop; clear of every band they are weed candidates.
  const labels = new Int32Array(W * H);
  const minWeedPx = Math.max(2, Math.round(((mid ? Math.max(P.minWeedAreaCm2, MID.minWeedAreaCm2) : P.minWeedAreaCm2) / 1e4) / (gsdW * gsdW)));
  const leafTipMaxM2 = (mid ? MID.leafTipMaxCm2 : LEAF_TIP_MAX_CM2) / 1e4;
  // Mid stage: the green share of the between-band ground per cell, to tell a soil alley from a verge the rows ran into.
  const cellPx = Math.max(4, Math.round(mPx(MID.alleyCellM))), cW = Math.ceil(W / cellPx), cH = Math.ceil(H / cellPx);
  const alleyG = mid ? new Float32Array(cW * cH) : null, alleyN = mid ? new Float32Array(cW * cH) : null;
  const bandG = mid ? new Float32Array(cW * cH) : null, bandN = mid ? new Float32Array(cW * cH) : null;
  if (mid) for (let i = 0; i < W * H; i++) {
    if (skip[i]) continue;
    const nr = nearestRow(pxStrip[i], pxA[i]);
    if (!nr || nr.d > pitchPx) continue;
    const x = i % W, c = Math.floor((i - x) / W / cellPx) * cW + Math.floor(x / cellPx);
    if (nr.d <= band[nr.r]) { bandN![c]++; if (mask[i]) bandG![c]++; } else { alleyN![c]++; if (mask[i]) alleyG![c]++; }
  }
  /** Mid: whether a corn row stands at a work pixel (looser than judging a patch there). */
  const rowStandsAt = (x: number, y: number): boolean => {
    const cx = Math.floor(x / cellPx), cy = Math.floor(y / cellPx); let ag = 0, an = 0, bg = 0, bn = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= cW || yy >= cH) continue; const c = yy * cW + xx; ag += alleyG![c]; an += alleyN![c]; bg += bandG![c]; bn += bandN![c]; }
    if (!bn) return false;
    const b = bg / bn, a = an ? ag / an : 0;
    return b >= MID.minBandGreen && b >= MID.rowBandOverAlley * a;
  };
  /** Mid: 1 when the ground around a work pixel is not a soil alley beside a corn row (a verge, a lawn, cover), else 0. */
  const alleyGreenAt = (x: number, y: number): number => {
    const cx = Math.floor(x / cellPx), cy = Math.floor(y / cellPx); let ag = 0, an = 0, bg = 0, bn = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= cW || yy >= cH) continue; const c = yy * cW + xx; ag += alleyG![c]; an += alleyN![c]; bg += bandG![c]; bn += bandN![c]; }
    if (!an || !bn) return 1;
    const a = ag / an, b = bg / bn;
    return a > MID.greenAlleyShare || b < MID.minBandGreen || b < MID.bandOverAlley * a ? 1 : 0;
  };
  let greenAlley = 0, edgeCut = 0;
  const weeds: RowCropWeed[] = [];
  const excluded: RowCropExcluded[] = [];
  let cropComponents = 0, specks = 0, betweenGreen = 0, noRowsPatches = 0, noRowsAreaM2 = 0, leafTips = 0;
  const stack = new Int32Array(W * H);
  const smallPx = Math.round((SMALL_PATCH_CM2 / 1e4) / (gsdW * gsdW));
  let label = 0, faint = 0;
  const weedLabels = new Set<number>();
  const toPhoto = (x: number, y: number): [number, number] => [(x + 0.5) * f, (y + 0.5) * f];
  // A large patch left out is drawn as its own outline on quarter-metre cells: a convex hull of an L-shaped verge ran
  // straight across the crop.
  const outlineCell = Math.max(2, Math.round(mPx(0.25)));
  const outlineOf = (pix: number[]): [number, number][] => cellOutline(pix, W, outlineCell).map(([x, y]) => [r3(x * f), r3(y * f)] as [number, number]);
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mask[i0] || labels[i0]) continue;
    label++;
    let top = 0; stack[top++] = i0; labels[i0] = label;
    const pix: number[] = [];
    let minD = Infinity, minBand = 0, noRows = 0, touchesEdge = false, aLo = Infinity, aHi = -Infinity, exc = 0, satN = 0, beyond = 0;
    let mL = 0, mA = 0, mLL = 0, mAA = 0, mLA = 0; // moments in the (along, across) frame for the leaf-tip test
    while (top) {
      const i = stack[--top]; pix.push(i); exc += excess[i]; satN += skip[i]; if (beyondEdge(pxStrip[i], pxA[i])) beyond++;
      const x = i % W, y = (i - x) / W;
      { const l = along(x, y), a = across(x, y); mL += l; mA += a; mLL += l * l; mAA += a * a; mLA += l * a; }
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
      const nr = nearestRow(pxStrip[i], pxA[i]);
      if (!nr || nr.d > pitchPx) noRows++; else { const rel = nr.d - band[nr.r]; if (rel < minD) { minD = rel; minBand = band[nr.r]; } }
      if (pxA[i] < aLo) aLo = pxA[i]; if (pxA[i] > aHi) aHi = pxA[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (mask[j] && !labels[j]) { labels[j] = label; stack[top++] = j; }
      }
    }
    const n = pix.length;
    if (n < minWeedPx) { specks++; continue; }
    if (n < smallPx && exc / n < gopts.soilMargin + SMALL_PATCH_EXCESS) { faint++; continue; }
    const areaM2 = n * gsdW * gsdW;
    if (satN > n / 2) { // solid green: a border, a lawn, a closed canopy
      // Outlined over its solid ground only: the corn rows that touch a lawn belong to its component, not to the lawn.
      if (areaM2 >= LARGE_PATCH_M2) excluded.push({ hull: outlineOf(pix.filter(i => skip[i])), areaM2: r3(areaM2), reason: "solid green (a border, a lawn or a closed canopy), not plants between rows" });
      continue;
    }
    if (noRows < n && minD <= 0) { cropComponents++; continue; } // touches a row's band: crop
    if (noRows < n && areaM2 <= leafTipMaxM2 && minD <= LEAF_TIP_REACH_SHARE * minBand) {
      // A leaf tip cut off from its row by shadow or a pale midrib: small, close, elongated across the rows (toward the row).
      const cl = mL / n, ca = mA / n, vLL = mLL / n - cl * cl, vAA = mAA / n - ca * ca, vLA = mLA / n - cl * ca;
      const tr = vLL + vAA, det = vLL * vAA - vLA * vLA, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const e1 = tr / 2 + disc, e2 = Math.max(1e-9, tr / 2 - disc);
      // Principal axis angle from the across direction: 0 means pointing straight at the row.
      const theta = Math.abs(Math.atan2(2 * vLA, vAA - vLL) / 2) * (180 / Math.PI);
      if (Math.sqrt(e1 / e2) >= LEAF_TIP_ASPECT && theta <= LEAF_TIP_ANGLE_DEG) { cropComponents++; leafTips++; continue; }
    }
    const hullPts: [number, number][] = [];
    const step = Math.max(1, Math.floor(n / 400));
    for (let q = 0; q < n; q += step) { const i = pix[q], x = i % W, y = (i - x) / W; hullPts.push(toPhoto(x, y)); }
    const hull = convexHull(hullPts);
    let sx = 0, sy = 0; for (const i of pix) { const x = i % W; sx += x; sy += (i - x) / W; }
    const [cx, cy] = toPhoto(sx / n, sy / n);
    if (beyond * 2 > n) { noRowsPatches++; noRowsAreaM2 += areaM2; continue; } // past a row's cut end: past the field
    if (noRows === n) { noRowsPatches++; noRowsAreaM2 += areaM2; if (areaM2 > LARGE_PATCH_M2) excluded.push({ hull: outlineOf(pix), areaM2: r3(areaM2), reason: "vegetation where no rows were read (a border, a headland, cover)" }); continue; }
    if ((aHi - aLo) > BORDER_ACROSS_PITCHES * pitchPx) { excluded.push({ hull: outlineOf(pix), areaM2: r3(areaM2), reason: "vegetation wider than the rows' spacing across them (a border or cover, not a plant between rows)" }); continue; }
    // Cut by the frame: its row may be outside the photo. At establishment too since the 2026-11-02 validation: every
    // candidate there it could not decide stood at the frame's rim, and most it could were corn of an untraced row.
    if (touchesEdge) { edgeCut++; continue; }
    if (mid && alleyGreenAt(sx / n, sy / n) === 1) { greenAlley++; continue; } // a verge or cover, not an alley
    if (late) continue; // under a closed canopy nothing between the rows can be seen, so nothing there is judged
    betweenGreen += n; weedLabels.add(label);
    const eqD = 2 * Math.sqrt(areaM2 / Math.PI);
    weeds.push({ ...(mid ? { sizeClass: eqD >= MID.escapeDiameterM ? "escape" as const : "small" as const } : {}), id: weeds.length + 1, x: r3(cx), y: r3(cy), areaM2: r3(areaM2), equivDiameterM: r3(2 * Math.sqrt(areaM2 / Math.PI)), hull, distToRowM: noRows === n ? null : r3((minD + minBand) * gsdW), bandHalfWidthM: noRows === n ? null : r3(minBand * gsdW), touchesEdge, status: noRows === n ? "no rows here" : "between rows" });
  }
  checkStop(opts);
  // Mid stage: small plants on the soil, found at the photo's own pixel (fineSeedlings.ts), wherever the rows stand:
  // between the plants of a row as well as in the alley. The work raster is too coarse for a grass seedling's blades.
  let seedlingN = 0, seedlingM2 = 0, judgedPx = 0; const seedlingPts: [number, number][] = [];
  let fineFound: { x: number; y: number; areaPx: number }[] = [];
  if (mid && !late) {
    const judgeWork = (wx: number, wy: number): boolean => {
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) return false;
      const i = wy * W + wx; if (skip[i]) return false;
      const nr = nearestRow(pxStrip[i], pxA[i]); if (!nr || nr.d > pitchPx) return false;
      return alleyGreenAt(wx, wy) === 0;
    };
    const fine = fineSeedlings(px, gsdM, (x, y) => { const wx = Math.floor(x / f), wy = Math.floor(y / f); return judgeWork(wx, wy) && !weedLabels.has(labels[wy * W + wx]); });
    fineFound = fine.seedlings;
    for (let wy = 0; wy < H; wy++) for (let wx = 0; wx < W; wx++) if (judgeWork(wx, wy)) judgedPx++;
    checkStop(opts);
  }
  opts.debug?.(`rows ${rowsW.length} (dropped ${rowsDropped}; k ${rowsW.map(r => r.k - kMin).join(",")}), band px ${band.map(b => b.toFixed(0)).join(",")}, components: crop ${cropComponents} (leaf tips ${leafTips}), weeds ${weeds.length}, specks ${specks}, faint ${faint}, excluded ${excluded.length}`);

  // 7. Along each row: green share inside the band, gaps, and (fine pixels only) the stand from the green peaks.
  const binPx = Math.max(1, Math.round(mPx(0.1)));
  const standBin = Math.max(1, Math.round(mPx(0.02)));
  const standOk = !late && P.seedSpacingM != null && gsdW * 100 <= P.maxStandGsdCm;
  const rowGreen: number[][] = rowsW.map(r => new Array(Math.ceil(((r.s1 - r.s0 + 1) * stripPx) / binPx) + 1).fill(0));
  const rowBandPx: number[][] = rowsW.map(r => new Array(Math.ceil(((r.s1 - r.s0 + 1) * stripPx) / binPx) + 1).fill(0));
  const rowStand: Float64Array[] = rowsW.map(r => new Float64Array(Math.ceil(((r.s1 - r.s0 + 1) * stripPx) / standBin) + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, s = pxStrip[i];
    const nr = nearestRow(s, pxA[i]);
    if (!nr || nr.d > band[nr.r]) continue;
    const r = rowsW[nr.r];
    const l = along(x, y) - lMin - r.s0 * stripPx;
    if (l < 0) continue;
    const b = Math.floor(l / binPx);
    if (b >= rowGreen[nr.r].length) continue;
    rowBandPx[nr.r][b]++;
    if (mask[i]) { rowGreen[nr.r][b]++; if (standOk) rowStand[nr.r][Math.min(rowStand[nr.r].length - 1, Math.floor(l / standBin))]++; }
  }
  const minGapBins = Math.max(1, Math.round(Math.max(MIN_GAP_M, P.seedSpacingM != null ? 2 * P.seedSpacingM : 0) / (binPx * gsdW)));
  const rows: RowCropRow[] = rowsW.map((r, ri) => {
    const n = r.s1 - r.s0 + 1;
    const pts: [number, number][] = [];
    for (let s = 0; s < n; s++) { const l = lMin + (r.s0 + s + 0.5) * stripPx, a = r.a[s] + aMin; pts.push(toPhoto(l * cs - a * sn, l * sn + a * cs)); }
    const g = rowGreen[ri], bp = rowBandPx[ri];
    const shares = g.map((v, b) => (bp[b] > 0 ? v / bp[b] : NaN)).filter(Number.isFinite);
    const med = quantile(shares, 0.5) ?? 0;
    const gaps: RowCropGap[] = [];
    let run = -1;
    const lastBin = Math.floor((n * stripPx - 1) / binPx);
    // A gap has corn on both sides. An empty stretch running out to a row's end where the field stops is the headland
    // (validation 2026-11-02: five "gaps" on photographs 34, 63 and 64 were the stubble strip before the verge): it is
    // no gap, and the row is drawn only as far as its corn.
    // Corn is a tenth of a metre with at least half the row's median green (a fleck of stubble is not).
    let keepFromL = -Infinity, keepToL = Infinity, firstCorn = Infinity, lastCorn = -1;
    for (let b = 0; b <= lastBin; b++) if (bp[b] > 0.5 * band[ri] * 2 * binPx && g[b] / bp[b] >= 0.5 * med) { firstCorn = Math.min(firstCorn, b); lastCorn = b; }
    const endRun = (b: number) => {
      if (run < 0) return; const len = b - run;
      // Open: no corn on its far side, or under one strip of anything before the field stops (the verge's own fringe).
      const open0 = EDGE.headlandNotGap && !!r.edge0 && (firstCorn >= b || run * binPx <= stripPx), open1 = EDGE.headlandNotGap && !!r.edge1 && (lastCorn < run || (lastBin + 1 - b) * binPx <= stripPx);
      if (open0 || open1) {
        if (open0) keepFromL = Math.max(keepFromL, lMin + r.s0 * stripPx + b * binPx); else keepToL = Math.min(keepToL, lMin + r.s0 * stripPx + run * binPx);
        run = -1; return;
      }
      if (len >= minGapBins) {
        const l1 = lMin + r.s0 * stripPx + run * binPx, l2 = lMin + r.s0 * stripPx + b * binPx;
        const aAt = (l: number) => { const s = Math.max(0, Math.min(n - 1, Math.floor((l - lMin) / stripPx) - r.s0)); return r.a[s] + aMin; };
        const p1 = toPhoto(l1 * cs - aAt(l1) * sn, l1 * sn + aAt(l1) * cs), p2 = toPhoto(l2 * cs - aAt(l2) * sn, l2 * sn + aAt(l2) * cs);
        gaps.push({ x1: r3(p1[0]), y1: r3(p1[1]), x2: r3(p2[0]), y2: r3(p2[1]), lengthM: r3(len * binPx * gsdW) });
      } run = -1;
    };
    for (let b = 0; b <= lastBin; b++) {
      const covered = bp[b] > 0.5 * band[ri] * 2 * binPx; // the band is inside the photo here
      const share = bp[b] > 0 ? g[b] / bp[b] : 0;
      if (covered && share < 0.15 * med) { if (run < 0) run = b; } else endRun(b);
    }
    endRun(lastBin + 1);
    let plants: number | null = null, plantPoints: [number, number][] | null = null;
    if (standOk && P.seedSpacingM) {
      const seedPx = mPx(P.seedSpacingM) / standBin;
      const sm = boxSmooth(rowStand[ri], Math.max(1, Math.round(seedPx / 4)));
      const q = quantile([...sm].filter(v => v > 0), 0.75) ?? 0;
      const pk = peaks(sm, Math.max(1, 0.6 * seedPx), 0.3 * q);
      plantPoints = pk.map(p => { const l = lMin + r.s0 * stripPx + (p.a + 0.5) * standBin, s = Math.max(0, Math.min(n - 1, Math.floor((p.a * standBin) / stripPx))), a = r.a[s] + aMin; const [x, y] = toPhoto(l * cs - a * sn, l * sn + a * cs); return [r3(x), r3(y)]; });
      plants = plantPoints.length;
    }
    let support = 0; for (let s = 0; s < n; s++) support += r.support[s];
    const bandArea = bp.reduce((u, v) => u + v, 0), greenIn = g.reduce((u, v) => u + v, 0);
    const keptPts = pts.filter((_, s) => { const l = lMin + (r.s0 + s + 0.5) * stripPx; return l >= keepFromL - stripPx / 2 && l <= keepToL + stripPx / 2; });
    const drawn = keptPts.length >= 2 ? keptPts : pts;
    return { id: ri + 1, k: r.k - kMin, points: drawn.map(([x, y]) => [r3(x), r3(y)]), lengthM: r3(drawn.length * stripPx * gsdW), supportShare: r3(support / n), bandHalfWidthM: r3(band[ri] * gsdW), greenShare: r3(bandArea ? greenIn / bandArea : 0), gaps, plants, plantPoints };
  });

  // 8. Coherence: autocorrelation at the pitch of 3 m windows' across profiles, where there is green.
  const winPx = Math.max(stripPx * 2, Math.round(mPx(3)));
  const cohs: number[] = [];
  for (let y0 = 0; y0 + winPx <= H; y0 += winPx) for (let x0 = 0; x0 + winPx <= W; x0 += winPx) {
    const prof = new Float64Array(Math.ceil(winPx * 1.5) + 2); let g = 0;
    for (let y = y0; y < y0 + winPx; y++) for (let x = x0; x < x0 + winPx; x++) { const i = y * W + x; if (!mask[i]) continue; g++; const b = Math.round(across(x - x0, y - y0) + winPx * 0.75); if (b >= 0 && b < prof.length) prof[b]++; }
    if (g < 0.01 * winPx * winPx) continue;
    let m = 0; for (const v of prof) m += v; m /= prof.length;
    let a0 = 0, aP = 0; const lag = Math.round(pitchPx);
    for (let i = 0; i < prof.length; i++) { a0 += (prof[i] - m) ** 2; if (i + lag < prof.length) aP += (prof[i] - m) * (prof[i + lag] - m); }
    if (a0 > 0) cohs.push(Math.max(-1, Math.min(1, aP / a0)));
  }
  const coherence = cohs.length ? cohs.reduce((u, v) => u + v, 0) / cohs.length : null;

  // Between-row cover: green clear of every band over the area clear of every band, where rows were read.
  let betweenArea = 0;
  for (let i = 0; i < W * H; i++) { const nr = nearestRow(pxStrip[i], pxA[i]); if (nr && nr.d > band[nr.r] && nr.d <= pitchPx) betweenArea++; }
  const weedAreaM2 = weeds.reduce((u, w) => u + w.areaM2, 0);
  const totalsOf = (rs: RowCropRow[]) => ({ gapsN: rs.reduce((u, r) => u + r.gaps.length, 0), gapLen: rs.reduce((u, r) => u + r.gaps.reduce((a, g) => a + g.lengthM, 0), 0), plantsTotal: standOk ? rs.reduce((u, r) => u + (r.plants ?? 0), 0) : null });
  let { gapsN, gapLen, plantsTotal } = totalsOf(rows);
  if (!standOk) notes.push(P.seedSpacingM == null ? "No seed spacing for the crop: no gaps by spacing and no stand estimate." : `The pixel is coarser than ${P.maxStandGsdCm} cm: no stand estimate.`);
  else notes.push("The stand is an estimate from the green peaks along each row; it has not been verified against counted plants.");
  if (excluded.length) notes.push(`${excluded.length} patch${excluded.length === 1 ? "" : "es"} of vegetation left out as border or cover, not weeds.`);
  if (noRowsPatches) notes.push(`${noRowsPatches} green patch${noRowsPatches === 1 ? "" : "es"} (${noRowsAreaM2.toFixed(1)} m²) lie where no rows were read and are not judged.`);
  // Mid stage: rows are drawn and counted only where a real corn row stands (the same test that judges the patches);
  // each row keeps its longest run of such points, and a row with fewer than MIN_ROW_STRIPS of them is dropped. A row
  // traced on into a lawn or verge is not a row there.
  let rowsOut = rows;
  if (mid) {
    rowsOut = [];
    const runs = rows.map(r => {
      const ok = r.points.map(([x, y]) => rowStandsAt(x / f, y / f));
      let best = [0, -1], i = 0;
      while (i < ok.length) { if (!ok[i]) { i++; continue; } let j = i; while (j + 1 < ok.length && ok[j + 1]) j++; if (j - i > best[1] - best[0]) best = [i, j]; i = j + 1; }
      return best;
    });
    const longest = Math.max(0, ...runs.map(b => b[1] - b[0] + 1));
    const minRun = Math.max(MIN_ROW_STRIPS, Math.ceil(MID.minRowRunM / STRIP_M), Math.ceil((late ? LATE.minRowRunShare : MID.minRowRunShare) * longest));
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri], best = runs[ri];
      if (best[1] - best[0] + 1 < minRun) { rowsDropped++; continue; }
      const pts = r.points.slice(best[0], best[1] + 1);
      const inside = (x: number, y: number) => rowStandsAt(x / f, y / f);
      rowsOut.push({ ...r, points: pts, lengthM: r3((r.lengthM * pts.length) / r.points.length), gaps: r.gaps.filter(g => inside((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2)), plantPoints: r.plantPoints ? r.plantPoints.filter(([x, y]) => inside(x, y)) : null, plants: r.plantPoints ? r.plantPoints.filter(([x, y]) => inside(x, y)).length : r.plants });
    }
    rowsOut.forEach((r, k) => { r.id = k + 1; });
  }
  if (mid) ({ gapsN, gapLen, plantsTotal } = totalsOf(rowsOut));
  if (mid) {
    // Seedlings count only beside a drawn row (within three quarters of a pitch of one of its points): a row traced on
    // into a lawn is not drawn there, and nothing there is judged.
    const reach = 0.75 * pitchPx * f, cell = Math.max(1, Math.round(reach)), grid = new Map<number, [number, number][]>();
    const key = (gx: number, gy: number) => gy * 100003 + gx;
    for (const r of rowsOut) for (const [x, y] of r.points) { const k = key(Math.floor(x / cell), Math.floor(y / cell)); const l = grid.get(k); if (l) l.push([x, y]); else grid.set(k, [[x, y]]); }
    const beside = (x: number, y: number) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const [px0, py0] of grid.get(key(gx + dx, gy + dy)) ?? []) if (Math.hypot(px0 - x, py0 - y) <= reach) return true; return false; };
    for (const sd of fineFound) {
      if (!beside(sd.x, sd.y)) continue;
      seedlingN++; seedlingM2 += sd.areaPx * gsdM * gsdM;
      if (seedlingPts.length < MID.maxSeedlingPoints) seedlingPts.push([r3(sd.x), r3(sd.y)]);
    }
  }
  const escapes = mid ? weeds.filter(w => w.sizeClass === "escape").length : 0;
  const seedlings: RowCropSeedlings | null = mid && !late ? { count: seedlingN, areaM2: r3(seedlingM2), cover: judgedPx ? r3(seedlingM2 / (judgedPx * gsdW * gsdW)) : null, points: seedlingPts } : null;
  if (!mid && edgeCut) notes.push(`Not judged: ${edgeCut} green patch${edgeCut === 1 ? "" : "es"} between the rows cut by the photo's edge (its row may lie outside the photo).`);
  if (late) notes.push("Late stage (closed canopy): rows read from how green the canopy is, ridges against the shaded alleys. The ground cannot be seen, so nothing between the rows is judged: no weeds, no seedlings. A break in a row is a stretch where its canopy is thinner than its alleys (lodging, a missing stretch, a shadow), never a plant count.");
  if (mid && !late && (greenAlley || edgeCut)) notes.push(`Not judged: ${greenAlley} patch${greenAlley === 1 ? "" : "es"} where the ground between the rows is mostly green (a verge or cover the rows run into), ${edgeCut} cut by the photo's edge.`);
  if (mid && !late) {
    notes.push(`Mid stage: ${seedlingN} small plant${seedlingN === 1 ? "" : "s"} on the soil, standing alone clear of the corn (${(seedlings!.areaM2 * 1e4).toFixed(0)} cm², ${seedlings!.cover == null ? "-" : (seedlings!.cover * 100).toFixed(2)}% of the field ground read), a late flush of seedlings drawn as a layer, not as findings. Within about ${FINE.nearCornCm} cm of a corn leaf a seedling and a leaf piece look alike, so those are not counted. Weeds that emerge after about V8 under a closing canopy rarely reduce this year's yield; they matter for next year's seed.`);
    notes.push(escapes ? `${escapes} between-row plant${escapes === 1 ? "" : "s"} ${Math.round(MID.escapeDiameterM * 100)} cm or more across: escapes from earlier control, the plants worth a look.` : `No between-row plant ${Math.round(MID.escapeDiameterM * 100)} cm or more across: no escapes seen.`);
    notes.push("The broadcast post window on most corn labels closes at V8 or 30 in; after that, directed sprays and next season's plan are what remain. Check the label and your local guidance.");
  }
  opts.onProgress?.(nStrips + 2, nStrips + 2);
  return {
    version: ROW_CROP_READ_VERSION, stage: P.stage, width: px.width, height: px.height, gsdM, scaleBasis, workFactor: f,
    directionDeg: r3(((rowAngle * 180) / Math.PI + 180) % 180), pitchM: r3(pitchM), matchedSpacingM,
    rows: rowsOut, weeds, excluded, seedlings,
    ...(mid ? {} : { fieldEdge: { ends: fieldEnds, lines: edgeLines } }),
    summary: {
      rows: rowsOut.length, rowsDropped, totalRowLengthM: r3(rowsOut.reduce((u, r) => u + r.lengthM, 0)),
      medianBandHalfWidthM: quantile(rowsOut.map(r => r.bandHalfWidthM), 0.5), medianRowGreenShare: quantile(rowsOut.map(r => r.greenShare), 0.5),
      weeds: weeds.length, weedAreaM2: r3(weedAreaM2), betweenRowCover: betweenArea ? r3(betweenGreen / betweenArea) : null,
      cropComponents, noRowsPatches, leafTips, ...(mid ? { escapes } : {}), specks, gaps: gapsN, gapLengthM: r3(gapLen), plants: plantsTotal, coherence: coherence == null ? null : r3(coherence), vegetationFraction: r3(vegetationFraction), ms: Date.now() - t0,
    },
    notes, crop: P.crop,
  };
}

/** Leaf clusters alternate sides of a row while the row itself bends slowly: a three-point mean, twice. */
function smoothRow(a: Float64Array): Float64Array {
  let cur = a;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(cur.length);
    for (let i = 0; i < cur.length; i++) { const lo = Math.max(0, i - 1), hi = Math.min(cur.length - 1, i + 1); let sum = 0; for (let j = lo; j <= hi; j++) sum += cur[j]; out[i] = sum / (hi - lo + 1); }
    cur = out;
  }
  return cur;
}

function checkStop(opts: RowCropOptions) { if (opts.signal?.aborted) throw new Error("cancelled"); }

export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => [r3(x), r3(y)]);
}

/** Everything to draw, in photo pixels: rows, each row's band edges, weeds, gaps, plants, excluded patches. */
export function rowCropOverlay(read: RowCropRead): { rows: [number, number][][]; /** Corn V1: planted rows whose crop is not confirmed (drawn apart from corn rows). */ probableRows: [number, number][][]; bands: [number, number][][]; weeds: [number, number][][]; smallGreen: [number, number][][]; escapes: [number, number][][]; seedlings: [number, number][]; gaps: RowCropGap[]; plants: [number, number][]; excluded: [number, number][][]; fieldEdges: [number, number][][]; possible: [number, number][]; missing: [number, number][]; uncertain: [number, number][] } {
  const bands: [number, number][][] = [];
  for (const r of read.rows) {
    const half = r.bandHalfWidthM / read.gsdM;
    if (!(half > 0)) continue;
    const left: [number, number][] = [], right: [number, number][] = [];
    for (let i = 0; i < r.points.length; i++) {
      const [x, y] = r.points[i];
      const [x2, y2] = r.points[Math.min(r.points.length - 1, i + 1)], [x1, y1] = r.points[Math.max(0, i - 1)];
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      left.push([x + nx * half, y + ny * half]); right.push([x - nx * half, y - ny * half]);
    }
    bands.push(left, right);
  }
  return { rows: read.rows.filter(r => r.identity !== "probable crop").map(r => r.points), probableRows: read.rows.filter(r => r.identity === "probable crop").map(r => r.points), bands, weeds: read.weeds.filter(w => w.sizeClass !== "escape" && w.tier !== "small green").map(w => w.hull), smallGreen: read.weeds.filter(w => w.tier === "small green").map(w => w.hull), escapes: read.weeds.filter(w => w.sizeClass === "escape").map(w => w.hull), seedlings: read.seedlings?.points ?? [], gaps: read.rows.flatMap(r => r.gaps), plants: read.rows.flatMap(r => r.plantPoints ?? []), excluded: read.excluded.map(e => e.hull), fieldEdges: read.fieldEdge?.lines ?? [],
    possible: read.rows.flatMap(r => r.possiblePoints ?? []), missing: read.rows.flatMap(r => r.missingPoints ?? []), uncertain: read.rows.flatMap(r => r.uncertainPoints ?? []) };
}

/** A traced row in strips: its lattice index, its first and last strip, its across position per strip, which strips stood on green of their own. */
type FieldRow = { k: number; s0: number; s1: number; a: Float64Array; support: Uint8Array; /** The start / end is the field's edge (not carried on past it). */ edge0?: boolean; edge1?: boolean };

/**
 * Establishment: each traced row cut to the field (EDGE). For every row, strip by strip over its trace and
 * EDGE.beyondStrips past both ends, the green share of its band (EDGE.bandShare of the pitch either side) and of each
 * alley (EDGE.alleyFromShare to half the pitch); the row stands where the band is green and clearly greener than the
 * softer alley. A strip is the field where the row stands, or where the ground is not green and the neighbouring rows
 * stand. Each row keeps its runs of field (stretches up to MAX_BRIDGE_STRIPS bridged, runs under MIN_ROW_STRIPS
 * dropped); an end is the field's edge when the strip beyond it is inside the photo and not the field.
 */
type FieldEndW = { row: FieldRow; side: 0 | 1; beyond: RowCropFieldEnd["beyond"]; /** Where the field stops: the strip boundary and the row's line there (across, work bins). */ stopL: number; stopA: number };
function fieldExtent(rows: FieldRow[], mask: Uint8Array, W: number, H: number, pxStrip: Int32Array, pxA: Int32Array, nStrips: number, pitchPx: number, debug?: (line: string) => void): { rows: FieldRow[]; dropped: number; ends: FieldEndW[] } {
  const X = EDGE.beyondStrips;
  const e0 = rows.map(r => Math.max(0, r.s0 - X)), e1 = rows.map(r => Math.min(nStrips - 1, r.s1 + X));
  const off: number[] = []; let tot = 0;
  rows.forEach((_, ri) => { off.push(tot); tot += e1[ri] - e0[ri] + 1; });
  const bG = new Float64Array(tot), bN = new Float64Array(tot), lG = new Float64Array(tot), lN = new Float64Array(tot), rG = new Float64Array(tot), rN = new Float64Array(tot);
  // Row positions per strip, carried straight on past the ends along the row's own drift.
  const posAt = (r: FieldRow, s: number): number => {
    const n = r.a.length;
    if (s >= r.s0 && s <= r.s1) return r.a[s - r.s0];
    if (s > r.s1) { const sl = n >= 4 ? (r.a[n - 1] - r.a[n - 4]) / 3 : 0; return r.a[n - 1] + sl * (s - r.s1); }
    const sl = n >= 4 ? (r.a[3] - r.a[0]) / 3 : 0; return r.a[0] - sl * (r.s0 - s);
  };
  const cover: { ri: number; a: number }[][] = Array.from({ length: nStrips }, () => []);
  rows.forEach((r, ri) => { for (let s = e0[ri]; s <= e1[ri]; s++) cover[s].push({ ri, a: posAt(r, s) }); });
  const bandR = EDGE.bandShare * pitchPx, alleyIn = EDGE.alleyFromShare * pitchPx, alleyOut = 0.5 * pitchPx;
  for (let i = 0; i < W * H; i++) {
    const s = pxStrip[i], lst = cover[s]; if (!lst.length) continue;
    const b = pxA[i];
    let best = -1, bd = Infinity, sd = 0;
    for (const c of lst) { const d = b - c.a, ad = Math.abs(d); if (ad < bd) { bd = ad; best = c.ri; sd = d; } }
    if (bd > alleyOut) continue;
    const j = off[best] + s - e0[best], g = mask[i];
    if (bd <= bandR) { bN[j]++; bG[j] += g; }
    else if (bd >= alleyIn) { if (sd < 0) { lN[j]++; lG[j] += g; } else { rN[j]++; rG[j] += g; } }
  }
  // The field's typical row green: the median band green over every row's traced strips.
  const typical: number[] = [];
  rows.forEach((r, ri) => { for (let s = r.s0; s <= r.s1; s++) { const j = off[ri] + s - e0[ri]; if (bN[j] > 0) typical.push(bG[j] / bN[j]); } });
  typical.sort((u, v) => u - v);
  const minBand = Math.max(EDGE.minBandGreen, EDGE.bandShareOfTypical * (typical[typical.length >> 1] ?? 0));
  debug?.(`edge: typical row green ${((typical[typical.length >> 1] ?? 0) * 100).toFixed(1)} %, a row stands from ${(minBand * 100).toFixed(1)} %`);
  // Per row and strip, each half metre on its own (averaged with its neighbours, a green verge leaked into the bare
  // strip before it and carried rows across the headland): stands, green ground, inside the photo.
  const stand: Uint8Array[] = [], green: Uint8Array[] = [], inside: Uint8Array[] = [];
  rows.forEach((r, ri) => {
    const n = e1[ri] - e0[ri] + 1, o = off[ri];
    const st = new Uint8Array(n), gr = new Uint8Array(n), ins = new Uint8Array(n);
    const own: number[] = []; for (let s = r.s0; s <= r.s1; s++) own.push(bN[o + s - e0[ri]]);
    own.sort((u, v) => u - v);
    const full = own[own.length >> 1] || 1;
    for (let t = 0; t < n; t++) {
      let BG = 0, BN = 0, LG = 0, LN = 0, RG = 0, RN = 0;
      BG = bG[o + t]; BN = bN[o + t]; LG = lG[o + t]; LN = lN[o + t]; RG = rG[o + t]; RN = rN[o + t];
      ins[t] = bN[o + t] >= 0.5 * full ? 1 : 0;
      if (!BN) continue;
      const band = BG / BN, left = LN ? LG / LN : NaN, right = RN ? RG / RN : NaN;
      const alley = Number.isFinite(left) && Number.isFinite(right) ? Math.min(left, right) : Number.isFinite(left) ? left : Number.isFinite(right) ? right : 0;
      gr[t] = (BG + LG + RG) / (BN + LN + RN) >= EDGE.greenGround ? 1 : 0;
      // A row fails where its band is empty (a road, a bare headland) or where it stands out from nothing around it:
      // a verge or a lawn (green all over), a dry-grass or weedy headland (as green in the band as beside it).
      const bothGreen = gr[t] && Number.isFinite(left) && Number.isFinite(right) && left >= EDGE.bothAlleysGreen && right >= EDGE.bothAlleysGreen && band < EDGE.overGreenerAlley * Math.max(left, right);
      st[t] = !bothGreen && band >= minBand && band >= (gr[t] ? EDGE.bandOverAlley : EDGE.bandOverAlleyBare) * alley ? 1 : 0;
    }
    stand.push(st); green.push(gr); inside.push(ins);
    if (debug) {
      const cell = (t: number) => { const j = o + t; const b = bN[j] ? bG[j] / bN[j] : NaN, l = lN[j] ? lG[j] / lN[j] : NaN, rr = rN[j] ? rG[j] / rN[j] : NaN; return `${(b * 100).toFixed(0)}/${(l * 100).toFixed(0)}/${(rr * 100).toFixed(0)}${st[t] ? "S" : ""}${gr[t] ? "G" : ""}${ins[t] ? "" : "x"}`; };
      debug(`edge row k ${r.k} strips ${e0[ri]}..${e1[ri]} (trace ${r.s0}..${r.s1}): ${Array.from({ length: n }, (_, t) => cell(t)).join(" ")}`);
    }
  });
  const byK = new Map<number, number[]>();
  rows.forEach((r, ri) => (byK.get(r.k) ?? byK.set(r.k, []).get(r.k)!).push(ri));
  const standsAt = (k: number, s: number) => (byK.get(k) ?? []).some(ri => s >= e0[ri] && s <= e1[ri] && stand[ri][s - e0[ri]] === 1);
  /** A neighbour's ground was looked at in this strip (its band inside the photo). */
  const seenAt = (k: number, s: number) => (byK.get(k) ?? []).some(ri => s >= e0[ri] && s <= e1[ri] && inside[ri][s - e0[ri]] === 1);
  const fieldAt = (ri: number, s: number): boolean => {
    if (s < e0[ri] || s > e1[ri]) return false;
    const t = s - e0[ri];
    // Half out of the frame: on its own trace the row keeps the strip (the frame cut it, not the field); beyond the
    // trace there is no telling.
    if (!inside[ri][t]) return s >= rows[ri].s0 && s <= rows[ri].s1;
    const k = rows[ri].k;
    let nb = 0, near = 0, looked = 0;
    for (const dk of [-2, -1, 1, 2]) {
      if (standsAt(k + dk, s)) nb++;
      if (seenAt(k + dk, s)) looked++;
      for (let q = -2; q <= 2; q++) if (standsAt(k + dk, s + q)) { near++; break; }
    }
    // A row standing where no neighbour looked at stands within a metre along is past the field (a trace across a
    // verge on its own); a field's outermost row has neighbours on one side only, and they stand.
    if (stand[ri][t]) return near > 0 || looked < 2;
    if (green[ri][t]) return false;
    return nb >= EDGE.standingNeighbours;
  };
  const out: FieldRow[] = [], ends: FieldEndW[] = [];
  let dropped = 0;
  const beyondOf = (ri: number, from: number, step: 1 | -1): RowCropFieldEnd["beyond"] => {
    let g = 0, n = 0;
    for (let q = 1; q <= 2; q++) { const s = from + step * q; if (s < e0[ri] || s > e1[ri]) continue; n++; g += green[ri][s - e0[ri]]; }
    return n && g * 2 >= n ? "grass or cover" : "bare ground";
  };
  rows.forEach((r, ri) => {
    const n = r.s1 - r.s0 + 1, fld = new Uint8Array(n);
    for (let t = 0; t < n; t++) fld[t] = fieldAt(ri, r.s0 + t) ? 1 : 0;
    // A short last run at either end, beyond a stretch that is not the field, is not the row going on (a one-strip
    // "stand" at a verge's edge): dropped before bridging.
    for (const dir of [1, -1] as const) {
      const at = (i: number) => (dir === 1 ? n - 1 - i : i); // walk inward from the end (dir 1) or the start (dir -1)
      let i = 0; while (i < n && !fld[at(i)]) i++;
      let j = i; while (j < n && fld[at(j)]) j++;
      let m = j; while (m < n && !fld[at(m)]) m++;
      if (j - i < EDGE.minRunBeyondBridge && j > i && m > j && m < n) for (let q = i; q < j; q++) fld[at(q)] = 0;
    }
    // Bridge short stretches between two runs of field (a gap in the row, not where the field stops).
    for (let t = 0; t < n;) {
      if (fld[t]) { t++; continue; }
      let u = t; while (u < n && !fld[u]) u++;
      if (t > 0 && u < n && u - t <= MAX_BRIDGE_STRIPS) fld.fill(1, t, u);
      t = u;
    }
    debug?.(`edge field k ${r.k} trace ${r.s0}..${r.s1}: ${Array.from(fld).join("")}`);
    let kept = 0;
    for (let t = 0; t < n;) {
      if (!fld[t]) { t++; continue; }
      let u = t; while (u + 1 < n && fld[u + 1]) u++;
      if (u - t + 1 >= MIN_ROW_STRIPS) {
        const s0 = r.s0 + t, s1 = r.s0 + u;
        const piece: FieldRow = { k: r.k, s0, s1, a: r.a.slice(t, u + 1), support: r.support.slice(t, u + 1) };
        // An end is the field's edge when ground that is not the field follows it within EDGE.beyondStrips, before the
        // frame cuts the row off (a trace often stops at its last plant, a metre of bare headland before the verge).
        const stopAt = (from: number, step: 1 | -1): number | null => {
          for (let q = 1; q <= EDGE.beyondStrips; q++) {
            const s = from + step * q;
            if (s < e0[ri] || s > e1[ri] || !inside[ri][s - e0[ri]]) return null;
            if (!fieldAt(ri, s)) return s;
          }
          return null;
        };
        const before = stopAt(s0, -1), after = stopAt(s1, 1);
        if (before != null) { piece.edge0 = true; ends.push({ row: piece, side: 0, beyond: beyondOf(ri, before + 1, -1), stopL: before + 1, stopA: posAt(r, before + 1) }); }
        if (after != null) { piece.edge1 = true; ends.push({ row: piece, side: 1, beyond: beyondOf(ri, after - 1, 1), stopL: after, stopA: posAt(r, after) }); }
        out.push(piece); kept++;
        debug?.(`edge piece k ${r.k} ${s0}..${s1} (trace ${r.s0}..${r.s1}): field stops ${before ?? "-"} before, ${after ?? "-"} after`);
      }
      t = u + 1;
    }
    if (!kept) dropped++;
  });
  return { rows: out, dropped, ends };
}

/**
 * The outer outline of a set of work pixels on cells of `cell` pixels: the boundary of the cells they touch, traced as
 * rings and the longest kept (a hole's edge is not the outline), straight runs merged. Work-pixel corners.
 */
export function cellOutline(pix: ArrayLike<number>, W: number, cell: number): [number, number][] {
  if (!pix.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let q = 0; q < pix.length; q++) { const i = pix[q], x = Math.floor((i % W) / cell), y = Math.floor(Math.floor(i / W) / cell); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const gw = x1 - x0 + 3, gh = y1 - y0 + 3, g = new Uint8Array(gw * gh);
  for (let q = 0; q < pix.length; q++) { const i = pix[q], x = Math.floor((i % W) / cell) - x0 + 1, y = Math.floor(Math.floor(i / W) / cell) - y0 + 1; g[y * gw + x] = 1; }
  // Directed boundary edges, clockwise around filled cells (y down): corner to corner.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (gw + 1) + x;
  const add = (ax: number, ay: number, bx: number, by: number) => { const k = key(ax, ay); (next.get(k) ?? next.set(k, []).get(k)!).push(key(bx, by)); };
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    if (!g[y * gw + x]) continue;
    if (!g[(y - 1) * gw + x]) add(x, y, x + 1, y);
    if (!g[y * gw + x + 1]) add(x + 1, y, x + 1, y + 1);
    if (!g[(y + 1) * gw + x]) add(x + 1, y + 1, x, y + 1);
    if (!g[y * gw + x - 1]) add(x, y + 1, x, y);
  }
  let best: number[] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: number[] = [start];
      let cur = next.get(start)!.pop()!;
      while (cur !== start) { ring.push(cur); const l = next.get(cur); if (!l || !l.length) break; cur = l.pop()!; }
      if (ring.length > best.length) best = ring;
    }
  }
  const pts = best.map(k => [k % (gw + 1), Math.floor(k / (gw + 1))] as [number, number]);
  const kept: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) kept.push(b);
  }
  return kept.map(([x, y]) => [(x + x0 - 1) * cell, (y + y0 - 1) * cell]);
}
