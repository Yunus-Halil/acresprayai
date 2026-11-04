// The continuous-row reader's parameters from a crop profile: the profile is the prior (planted spacings, the band
// floor, the seed spacing, the pixel the stand needs); the imagery's own measurements outrank it.
import type { RuntimeCropProfile } from "../cropProfiles/runtime";
import { cropProfileFor } from "../cropProfiles/registry";
import { DEFAULT_ROW_CROP_PARAMS, type RowCropParams, type RowCropStage } from "./readRowCrop";

/** Whether a crop's rows are read by the continuous-row reader (its profile says so). */
export function readsContinuousRows(crop: string | null | undefined): boolean {
  return cropProfileFor(crop)?.rowReader.strategy === "continuous-row";
}

export function rowCropParamsFor(p: RuntimeCropProfile | null | undefined, gsdM: number | null, stage: RowCropStage = "establishment"): RowCropParams {
  if (!p) return { ...DEFAULT_ROW_CROP_PARAMS, gsdM, stage };
  return {
    gsdM,
    stage,
    spacingsM: p.rowReader.candidatesM.length ? [...p.rowReader.candidatesM] : [p.rowReader.defaultSpacingM],
    defaultSpacingM: p.rowReader.defaultSpacingM,
    pitchToleranceShare: p.rowReader.pitchToleranceShare,
    bandMinHalfWidthM: Math.min(p.rowReader.bandHalfWidthM ?? DEFAULT_ROW_CROP_PARAMS.bandMinHalfWidthM, DEFAULT_ROW_CROP_PARAMS.bandMinHalfWidthM),
    seedSpacingM: p.plantingPositions?.alongRangeM?.typical ?? null,
    maxStandGsdCm: p.plantingPositions?.maxGsdCm ?? DEFAULT_ROW_CROP_PARAMS.maxStandGsdCm,
    minWeedAreaCm2: DEFAULT_ROW_CROP_PARAMS.minWeedAreaCm2,
    crop: { id: p.id, version: p.version },
  };
}
