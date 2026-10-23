// Crop profile to engine inputs: the only place the run-time profile is turned into the parameters each analysis
// takes. One universal engine, crop-specific configuration: every function returns null (or the engine's own
// default) for a crop with no profile, and the analysis then runs exactly as it did before profiles existed.
import type { PatternPrior } from "../photoScout/pattern";
import { cropProfileFor } from "./registry";
import type { RuntimeCropProfile } from "./runtime";

/** The pattern pass's prior for a crop: spacings to search, window size, vegetation floor, brightness check. */
export function patternPriorFor(p: RuntimeCropProfile | null | undefined): PatternPrior | null {
  if (!p) return null;
  return {
    cropId: p.id,
    profileVersion: p.version,
    spacingCandidatesM: [...p.rowReader.candidatesM],
    defaultSpacingM: p.rowReader.defaultSpacingM,
    windowRows: p.rowReader.windowRows,
    vegetationIndexFloor: p.vegetation.indexFloor,
    vegetationExgrGate: p.vegetation.exgrGate,
    verifyBrightness: p.rowReader.verifyBrightnessAgainstVegetation,
    plantedSpacingsM: p.plantedSpacingsM.map(s => s.m),
    spacingToleranceShare: p.spacingToleranceShare,
  };
}

/** The same, from the field's crop setting. */
export const patternPriorForCrop = (crop: string | null | undefined): PatternPrior | null => patternPriorFor(cropProfileFor(crop));

/** The cover classes for a crop with a profile, or null (the grade then uses its crop-group scheme). */
export function pressureSchemeFor(p: RuntimeCropProfile | null | undefined): { low: number; moderate: number; action: number; high: number; source: string; basis: "cover" | "provisional" } | null {
  return p ? { ...p.pressure.scheme } : null;
}

/** The crop's weed-size classes for the sizer (sizing/types.ts DEFAULT_SIZE_THRESHOLDS shape), or null. */
export function sizeThresholdsFor(p: RuntimeCropProfile | null | undefined): { smallMaxCm: number; mediumMaxCm: number } | null {
  return p ? { smallMaxCm: p.weedMeasurement.sizeThresholdsCm.small, mediumMaxCm: p.weedMeasurement.sizeThresholdsCm.medium } : null;
}
