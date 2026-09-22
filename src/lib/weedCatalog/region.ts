// Where a field is, for the purpose of narrowing the weed reference list.
//
// TESTING ASSUMPTION, ON PURPOSE AND OUT LOUD. There is no per-field state
// on the field row (`fields.location` is free text a person typed, and a
// boundary centroid could be reverse-geocoded but is not yet). Until one of
// those exists, every field is taken to be in Virginia, because Virginia is
// the one state with a sourced catalog and the fields being tested on are
// there. Every surface that uses this says so: the Fields page carries a
// banner, the scout's identification panel names the assumption, and the
// Weed Library states it in its header. Remove the assumption by making
// `fieldRegion` read a real source and deleting the banner; nothing else
// depends on the constant.
//
// Narrowing by state and crop is a ranking of the reference list, never
// evidence: being on Virginia's list is not proof a plant is in this field.
import type { CropContext, FieldRegion } from "./types";

export const ASSUMED_FIELD_REGION: FieldRegion = {
  state: "VA",
  stateName: "Virginia",
  basis: "assumed for testing",
};

/** The region a field is treated as being in. Today: always the assumption above. */
export function fieldRegion(_field?: { location?: string | null } | null): FieldRegion {
  return ASSUMED_FIELD_REGION;
}

/** The banner text, in one place so the Fields page and the docs agree. */
export const ASSUMED_REGION_WARNING =
  `Testing assumption: every field is treated as being in ${ASSUMED_FIELD_REGION.stateName}. ` +
  `Weed Scout's reference list and the Weed Library are narrowed to ${ASSUMED_FIELD_REGION.stateName} ` +
  "no matter where a field actually is. Remove this before anyone outside the test uses it.";

/**
 * The catalog crop context for the field's crop setting (SettingsTab's
 * CROP_OPTIONS), or null when the guide tables have no column for it. Cotton,
 * rice and sorghum are real crops with no table in the Virginia field-crop
 * guide captured here, so they narrow by state only.
 */
export function cropContextFor(cropType: string | null | undefined): CropContext | null {
  const c = (cropType ?? "").trim().toLowerCase();
  if (!c) return null;
  if (c === "corn" || c === "maize") return "corn";
  if (c === "soybeans" || c === "soybean" || c === "soy") return "soybean";
  if (c === "wheat" || c === "barley" || c === "oats" || c === "rye" || c === "small grains") return "small_grains";
  if (c === "pasture" || c === "hay" || c === "grass" || c === "forage") return "pasture_hay";
  return null;
}
