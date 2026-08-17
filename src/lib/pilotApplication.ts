// The pilot application form's shape lives with the edge function that writes
// it, so the browser and the server cannot drift apart on what the fields are
// or what counts as valid. This is the app-side door onto that one definition.
//
// The module it re-exports is pure data and pure functions - no Deno APIs - so
// it bundles for the browser unchanged.
export {
  ACREAGE_RANGES,
  AVAILABILITIES,
  BOUNDARY_ANSWERS,
  DRONE_STATUSES,
  EMPTY,
  FIELDS,
  ROLES,
  SPRAY_DRONE,
  normalise,
  showsDroneModel,
  validate,
} from "../../supabase/functions/_shared/pilotApplication";

export type {
  FieldName,
  PilotApplication,
} from "../../supabase/functions/_shared/pilotApplication";
