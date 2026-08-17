// The pilot application form: fields, options, and validation.
//
// This is the single definition of the form. The React page imports it through
// src/lib/pilotApplication.ts, the `pilot-apply` edge function imports it
// directly, and the migration's CHECK constraints mirror the option lists. A
// field added here has to be added in exactly one place, and a value the form
// cannot produce is one the database will not store.
//
// Deliberately small. Every extra field costs completion rate, and this set is
// already enough to triage and prioritise an applicant.

export const ROLES = [
  "Farm owner",
  "Farm manager",
  "Agronomist or consultant",
  "Extension agent referring someone",
  "Spray operator",
  "Other",
] as const;

export const ACREAGE_RANGES = ["Under 20", "20–100", "100–500", "500+"] as const;

export const BOUNDARY_ANSWERS = ["Yes", "No", "Not sure"] as const;

/** The one option that means the applicant already has spraying hardware. */
export const SPRAY_DRONE = "Have a spray drone";

export const DRONE_STATUSES = [
  "No drone yet",
  "RGB drone (regular camera)",
  "Multispectral drone",
  SPRAY_DRONE,
] as const;

export const AVAILABILITIES = [
  "This fall (Aug–Oct)",
  "This winter",
  "Spring 2027",
  "Not sure yet",
] as const;

export type PilotApplication = {
  full_name: string;
  email: string;
  phone: string;
  farm_name: string;
  role: string;
  location: string;
  acreage_range: string;
  crops: string;
  has_boundary_survey: string;
  drone_status: string;
  drone_model: string;
  availability: string;
  referral_source: string;
  notes: string;
};

export type FieldName = keyof PilotApplication;

/** Every field, in submission order. Also the column list the insert writes. */
export const FIELDS: FieldName[] = [
  "full_name", "email", "phone", "farm_name", "role",
  "location", "acreage_range", "crops", "has_boundary_survey",
  "drone_status", "drone_model", "availability", "referral_source", "notes",
];

export const EMPTY: PilotApplication = {
  full_name: "", email: "", phone: "", farm_name: "", role: "",
  location: "", acreage_range: "", crops: "", has_boundary_survey: "",
  drone_status: "", drone_model: "", availability: "", referral_source: "", notes: "",
};

/** Free-text length ceilings. Generous for humans, closed to essay-length spam. */
const MAX: Partial<Record<FieldName, number>> = {
  full_name: 120, email: 320, phone: 40, farm_name: 160,
  location: 160, crops: 400, drone_model: 120, referral_source: 300, notes: 2000,
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The drone model question only exists for applicants who said they have a
 * spray drone. Asking a farmer with no drone for its model is noise, and a
 * model string attached to "No drone yet" is data we would have to distrust.
 */
export function showsDroneModel(droneStatus: string): boolean {
  return droneStatus === SPRAY_DRONE;
}

type Values = Record<string, string | undefined>;

/**
 * Per-field error messages, keyed by field name. Empty object means valid.
 *
 * Returning a map rather than a single message is what lets the form show an
 * error the moment one field is wrong, instead of dumping every failure at the
 * user after they press submit.
 */
export function validate(values: Values): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  const get = (k: string) => (values[k] ?? "").trim();

  const requireText = (k: FieldName, label: string) => {
    if (!get(k)) errors[k] = `${label} is required`;
  };

  requireText("full_name", "Your name");
  requireText("farm_name", "Farm or operation name");
  requireText("location", "Location");
  requireText("crops", "Primary crops");

  const email = get("email");
  if (!email) errors.email = "Email is required";
  else if (!EMAIL_RE.test(email)) errors.email = "That doesn't look like an email address";

  const oneOf = (k: string, options: readonly string[], label: string) => {
    const v = get(k);
    if (!v) errors[k] = `${label} is required`;
    else if (!options.includes(v)) errors[k] = `Pick one of the listed options`;
  };

  oneOf("role", ROLES, "Your role");
  oneOf("acreage_range", ACREAGE_RANGES, "Approximate acreage");
  oneOf("drone_status", DRONE_STATUSES, "Drone ownership");
  oneOf("availability", AVAILABILITIES, "Availability");

  // Optional selects still have to be one of the listed values when answered.
  const boundary = get("has_boundary_survey");
  if (boundary && !BOUNDARY_ANSWERS.includes(boundary as never)) {
    errors.has_boundary_survey = "Pick one of the listed options";
  }

  for (const [field, limit] of Object.entries(MAX)) {
    if (get(field).length > (limit as number)) {
      errors[field] = `Keep this under ${limit} characters`;
    }
  }

  return errors;
}

/**
 * Trim everything, blank the conditional field when it does not apply, and turn
 * empty optional fields into null so the row does not carry empty strings.
 */
export function normalise(values: Values): Record<string, string | null> {
  const get = (k: string) => (values[k] ?? "").trim();
  const orNull = (k: string) => get(k) || null;

  return {
    full_name: get("full_name"),
    email: get("email").toLowerCase(),
    phone: orNull("phone"),
    farm_name: get("farm_name"),
    role: get("role"),
    location: get("location"),
    acreage_range: get("acreage_range"),
    crops: get("crops"),
    has_boundary_survey: orNull("has_boundary_survey"),
    drone_status: get("drone_status"),
    // Dropped unless the answer above warrants it, so a stale value left in the
    // form state after someone changes their mind never reaches the database.
    drone_model: showsDroneModel(get("drone_status")) ? orNull("drone_model") : null,
    availability: get("availability"),
    referral_source: orNull("referral_source"),
    notes: orNull("notes"),
  };
}
