// Ruler-referenced canopy measurement: the close-range experiment. A photo
// taken straight down over one weed with a measuring tape beside it; the tape
// gives the scale, the canopy is cut out of the picture, and the span, the
// width across it and the area come out in centimetres with their caveats.
//
// Isolated from the production detector on purpose (nothing in src/lib/weedScout
// imports this). Pure types and arithmetic here; the runner under
// scripts/rwmeasure does the files.

export const CM_PER_INCH = 2.54;
export const RW_VERSION = "rw-measure-v1";

export type Pt = { x: number; y: number };

export type TapeAxis = {
  /** Centre of the tape's yellow body, native pixels. */
  centre: Pt;
  /** Unit vector along the tape. */
  dir: Pt;
  /** Half-extent along the axis and across it, native pixels. */
  halfLength: number;
  halfWidth: number;
  /** Yellow pixels in the body, at the detection scale. */
  pixels: number;
};

export type Calibration = {
  status: "ok" | "uncertain" | "failed";
  method: "tick-periodicity" | "manual-points" | "none";
  units: "inch" | "unknown";
  /** Native pixels per centimetre along the tape. Null when failed. */
  pixelsPerCm: number | null;
  /** Relative uncertainty, 0..1: the spread of the inch spacings and the disagreement between the fine and coarse estimates. Null when failed. */
  relativeUncertainty: number | null;
  /** The inch in native pixels, from the long ticks, and from sixteen fine ticks. */
  inchPxFromLongTicks: number | null;
  inchPxFromFineTicks: number | null;
  /** Long ticks found along the axis, and their positions along it (native pixels from the axis centre). */
  longTicks: number[];
  /** The inch in pixels between consecutive tracked inch ticks, at the midpoint `t` along the tape (native pixels from its centre). */
  localInchPx: { t: number; inchPx: number }[];
  /** Spread of the local inch along the tape over its median: foreshortening when the camera is off nadir. */
  driftAlongTape: number | null;
  /** The yellow body's width across the straightened tape, native pixels. */
  bodyWidthPx: number | null;
  /** Which edge of the straightened tape the ticks were read on, and which way the tape ran. */
  edge: "top" | "bottom" | null;
  reason: string | null;
};

export type TargetSelection = {
  status: "selected" | "review" | "none";
  /** The chosen plant's seed centroid and its core area at the working scale, native pixels. */
  centre: Pt | null;
  /** Other plausible targets, strongest first. */
  alternatives: { centre: Pt; areaPx: number }[];
  /** How it was chosen. */
  method: "centre-weighted-core" | "manual";
  reason: string | null;
};

export type SegmentationQuality = {
  status: "isolated" | "touching-vegetation" | "merged" | "edge-cut" | "uncertain" | "failed";
  /** Share of the final mask that came from the smooth broadleaf core, before growing back to the leaf edges; low means thin material (grass) was taken in. */
  coreShare: number | null;
  touchesImageEdge: boolean;
  /** A second plausible target's core lies inside the grown mask. */
  mergedWithAlternative: boolean;
  /** Native pixels in the final mask. */
  maskPixels: number;
  pieces: number;
  /** How many opened leaf cores were chained into the canopy; more than one means a person should confirm they are one plant. */
  joinedCores: number;
  /** Opened leaf cores within NEAR_CORE_CM of the canopy that were not joined. */
  nearbyCores: number;
  reason: string | null;
};

export type Measurement = {
  status: "measured" | "refused";
  reason: string | null;
  /** Greatest distance between two boundary points. */
  maxSpanCm: number | null;
  /** The canopy's extent perpendicular to the max-span axis. */
  perpendicularSpanCm: number | null;
  /** Mask pixels over pixels per cm squared. Only under a justified two-dimensional scale. */
  canopyAreaCm2: number | null;
  /** 2 sqrt(A / pi). Not the max span. */
  equivalentDiameterCm: number | null;
  /** The endpoints the span and the perpendicular were read between, native pixels. */
  spanEndpoints: [Pt, Pt] | null;
  perpendicularEndpoints: [Pt, Pt] | null;
  /** Whether a uniform scale over the plant was assumed, and why that is or is not justified. */
  scaleAssumption: string;
};

export type GroundTruth = {
  maxSpanCm: number | null;
  perpendicularSpanCm: number | null;
  measuredInField: boolean;
  notes?: string | null;
};

/** The person's corrections for one image, kept apart from the predictions. */
export type Review = {
  /** Accept or reject the automatic result; pending until looked at. */
  status: "pending" | "accepted" | "rejected";
  /** The plant to measure, native pixels; overrides the automatic choice. */
  targetOverride?: Pt | null;
  /** Two or more points on the tape with their reading in inches; used instead of the tick calibration. */
  rulerPoints?: { x: number; y: number; inches: number }[] | null;
  /** Discs to erase from the canopy mask (grass, a neighbour), native pixels. */
  maskErase?: { x: number; y: number; r: number }[] | null;
  groundTruth?: GroundTruth | null;
  notes?: string | null;
};

export type ImageResult = {
  version: string;
  file: string;
  widthPx: number;
  heightPx: number;
  exif: { model: string | null; focalMm: number | null; focal35Mm: number | null; relativeAltitudeM: number | null; gimbalPitchDeg: number | null };
  tape: TapeAxis | null;
  calibration: Calibration;
  target: TargetSelection;
  segmentation: SegmentationQuality;
  measurement: Measurement;
  review: Review;
  comparison: { absoluteErrorCm: number | null; signedErrorCm: number | null; percentError: number | null; available: boolean };
  /** The canopy outline, native pixels, thinned, for the overlays and a later map. */
  outlinePx: Pt[] | null;
};
