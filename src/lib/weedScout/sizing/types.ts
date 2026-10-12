// Weed size, v1: how large one plant is on the ground, measured in the
// original photograph that holds it.
//
// WHAT A MEASUREMENT IS. The canopy a plant shows from above, cut out of the
// vegetation mask of the original photo at the camera's own resolution, with
// the pixel size at that point taken from the camera pose ODM recovered. The
// area is the segmented pixels times the ground area of one pixel; the
// diameter is the circle of that area. The bounding box is carried beside
// them and never confused with them.
//
// WHAT IT IS NOT. A verdict on what the plant is, or a measurement of a
// shape the photo cannot separate: a plant merged with the crop, cut by the
// photo's edge, or too few pixels across is reported as unknown with the
// reason, never as a number. A spot with no original photo, or no camera
// pose, is unavailable. Nothing here invents a pixel size.
//
// Modular on purpose: `segment.ts` is the pure core on a window of pixels,
// `measure.ts` carries a spot into its photo and back, and the thresholds
// are a parameter so a species-specific or growth-stage-specific rule can
// replace them without touching the measurement.

/** Bumped when the measurement's meaning or method changes; older records keep their own version. */
export const MEASUREMENT_VERSION = "weed-size-v1";

export type SizeCategory = "small" | "medium" | "large";

/** Where small ends and large begins, in centimetres of canopy diameter. A setting, not a biological fact. */
export type SizeThresholds = { smallMaxCm: number; mediumMaxCm: number };

export const DEFAULT_SIZE_THRESHOLDS: SizeThresholds = { smallMaxCm: 10, mediumMaxCm: 30 };

/**
 *   measured     numbers are given and the quality says how much to trust them
 *   unknown      the photo was read but the plant could not be measured; `reason` says why
 *   unavailable  nothing could be read: no photo, no pose, no pixel size
 */
export type MeasurementStatus = "measured" | "unknown" | "unavailable";

export type MeasurementMethod = "native-photo-mask-v1";

/** What the measurement was read from. */
export type MeasurementSource = {
  /** The original photograph, by the camera's filename. */
  frame: string;
  nativeWidth: number;
  nativeHeight: number;
  /** The window cut from the photo, in its native pixels. */
  window: { x: number; y: number; width: number; height: number };
  /** Angle between the ray to the plant and straight down, degrees. */
  viewAngleDeg: number | null;
  /** The ground height the pose was intersected at, metres above sea level. */
  groundAltM: number | null;
};

/** What the segmentation looked like, so a reader can judge the number. */
export type SegmentationQuality = {
  /** The canopy's equivalent diameter in pixels: under about ten, the outline is mostly edge. */
  pixelsAcross: number | null;
  /** Otsu's class-mean separation on the pixels the threshold came from, index units; under OTSU_MIN_SPREAD there was nothing to split. */
  maskContrast: number | null;
  /** Where the soil-to-plant threshold came from: the wider context around the spot (the pass's own scale), or the window alone when the context had no contrast. */
  thresholdSource: "context" | "window";
  /** Share of the window too dark to classify (deep shadow), left out of the mask. */
  darkShare: number;
  /** The plant was cut out of a component that split into this many other plants. */
  touchingNeighbours: number;
  /** The canopy reaches a crop plant the pattern placed. */
  touchesCrop: boolean;
  /** Whether the crop's positions were known when this was measured. */
  cropContext: "known" | "unknown";
  /** The measured diameter over what the map (or the look) expected; null when nothing was expected. Far over 1 means the mask grew into something the map did not see as this plant. */
  sizeVsExpected: number | null;
  touchesWindowEdge: boolean;
  touchesPhotoEdge: boolean;
};

export type WeedMeasurement = {
  version: string;
  status: MeasurementStatus;
  /** Why there is no number, when there is none. */
  reason: string | null;
  method: MeasurementMethod | null;
  /** 0..1 from the quality indicators, by a stated rule (segment.ts). Null when not measured. */
  confidence: number | null;
  /** Equivalent-circle diameter of the segmented canopy. */
  canopyDiameterCm: number | null;
  /** Segmented canopy pixels times the ground area of a pixel. */
  canopyAreaCm2: number | null;
  /** The longest axis of the canopy (maximum Feret diameter). */
  maxExtentCm: number | null;
  /** The axis-aligned bounding box of the canopy in the photo. Not the canopy. */
  boxWidthCm: number | null;
  boxHeightCm: number | null;
  sizeCategory: SizeCategory | null;
  /** The thresholds the category was read against. */
  thresholds: SizeThresholds;
  /** Ground centimetres per native pixel at the plant. */
  gsdCmPx: number | null;
  /** The camera's filename, when a photo was read. */
  sourceFrame: string | null;
  source: MeasurementSource | null;
  quality: SegmentationQuality | null;
  /** The whole touching clump, when the plant was cut out of one: what a reader would see as one shape. */
  clump: { diameterCm: number; areaCm2: number; parts: number } | null;
  /** The canopy's outline in the photo's native pixels, thinned; for drawing. */
  outlinePx: { x: number; y: number }[] | null;
  /** Where the plant's canopy centre landed in the photo's native pixels. */
  centrePx: { x: number; y: number } | null;
  measuredAt: string;
};

/** Which bucket a diameter falls in. */
export function sizeCategoryOf(diameterCm: number, t: SizeThresholds): SizeCategory {
  if (diameterCm <= t.smallMaxCm) return "small";
  if (diameterCm <= t.mediumMaxCm) return "medium";
  return "large";
}

/** Thresholds from stored settings: each a positive number, medium above small; anything else is the default. */
export function readSizeThresholds(v: unknown, fallback: SizeThresholds = DEFAULT_SIZE_THRESHOLDS): SizeThresholds {
  const o = v as Partial<SizeThresholds> | null | undefined;
  const small = typeof o?.smallMaxCm === "number" && Number.isFinite(o.smallMaxCm) && o.smallMaxCm > 0 ? o.smallMaxCm : fallback.smallMaxCm;
  const medium = typeof o?.mediumMaxCm === "number" && Number.isFinite(o.mediumMaxCm) && o.mediumMaxCm > small ? o.mediumMaxCm : Math.max(fallback.mediumMaxCm, small * 2);
  return { smallMaxCm: small, mediumMaxCm: medium };
}

/** A measurement that could not be made at all. */
export function unavailableMeasurement(reason: string, thresholds: SizeThresholds, sourceFrame: string | null = null): WeedMeasurement {
  return {
    version: MEASUREMENT_VERSION, status: "unavailable", reason, method: null, confidence: null,
    canopyDiameterCm: null, canopyAreaCm2: null, maxExtentCm: null, boxWidthCm: null, boxHeightCm: null,
    sizeCategory: null, thresholds, gsdCmPx: null, sourceFrame, source: null, quality: null, clump: null,
    outlinePx: null, centrePx: null, measuredAt: new Date().toISOString(),
  };
}

/** Whether a stored object is a measurement this version understands. Older or foreign records read as absent. */
export function readMeasurement(v: unknown): WeedMeasurement | null {
  const m = v as Partial<WeedMeasurement> | null | undefined;
  if (!m || typeof m !== "object" || typeof m.version !== "string" || typeof m.status !== "string") return null;
  if (m.status !== "measured" && m.status !== "unknown" && m.status !== "unavailable") return null;
  return m as WeedMeasurement;
}
