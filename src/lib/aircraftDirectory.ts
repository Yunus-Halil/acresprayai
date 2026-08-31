// The aircraft directory: which airframes SwathWise knows about, and what it
// actually knows about each one.
//
// WHY THIS IS DATA. The registration picker used to be a list literal inside a
// component, which is why it stayed at a handful of models for as long as it
// did — adding the airframe an operator actually flies meant a code change, a
// build and a deploy. The catalogue now lives in
// `src/data/aircraftDirectory.json`, versioned alongside the code but editable
// without touching a component. Adding an aircraft is adding an object.
//
// WHY SO MANY NULLS. Every figure in that file was read off the
// manufacturer's own specification page and carries the URL it came from. A
// figure the manufacturer does not publish is null — never inferred from a
// model number, a predecessor or a dealer listing. That is not tidiness: tank
// capacity is what the report reconciles logged volume against, so a guessed
// capacity would quietly pass or quietly fail a compliance check on a number
// nobody chose. A null capacity is a question the operator answers once. A
// wrong capacity is a number they never see and cannot audit.
//
// See also droneSpecs.ts, which turns these entries into planner specs.
import raw from "@/data/aircraftDirectory.json";

/** What an airframe is for. An aircraft can be both. */
export type AircraftRole = "spray" | "mapping";

export type AircraftEntry = {
  /**
   * Stable key, and the exact string stored in `drones.model`.
   *
   * Existing fleet rows resolve by this, so an id is never renamed — a rename
   * would orphan every drone registered under the old one. Corrections go in
   * `MODEL_ALIASES` in droneSpecs.ts instead.
   */
  id: string;
  make: string;
  model: string;
  roles: AircraftRole[];
  /** Whether the manufacturer still lists it. Legacy aircraft still fly. */
  status: "current" | "legacy";
  /** Spray tank capacity in litres. Null = the maker does not publish it. */
  tank_l: number | null;
  /** Default swath in metres, only when one operating figure is published. */
  swath_m: number | null;
  /** The published range [min, max] in metres, when the maker gives a range. */
  swath_published_m: [number, number] | null;
  /** Max flow, litres/min, at the highest published nozzle configuration. */
  flow_lpm: number | null;
  /** The manufacturer page the figures came from. Null = nothing to cite. */
  source: string | null;
  /** ISO date the figures were read off `source`. Null = unverified. */
  verified: string | null;
  note: string;
};

type DirectoryFile = {
  version: number;
  updated: string;
  aircraft: AircraftEntry[];
};

const directory = raw as unknown as DirectoryFile;

export const AIRCRAFT_DIRECTORY_VERSION = directory.version;
export const AIRCRAFT_DIRECTORY_UPDATED = directory.updated;

/** Every seeded airframe, in file order. */
export const AIRCRAFT: readonly AircraftEntry[] = Object.freeze(directory.aircraft);

const BY_ID = new Map(AIRCRAFT.map(a => [a.id, a]));

/** The seeded entry for an id, or null. Custom aircraft are never in here. */
export function aircraftById(id: string | null | undefined): AircraftEntry | null {
  return (id && BY_ID.get(id)) || null;
}

export const isSprayer = (a: Pick<AircraftEntry, "roles">) => a.roles.includes("spray");
export const isMapper = (a: Pick<AircraftEntry, "roles">) => a.roles.includes("mapping");

/** "Sprayer", "Survey" or "Sprayer + survey" — for a badge, not for logic. */
export function rolesLabel(roles: readonly AircraftRole[]): string {
  const spray = roles.includes("spray");
  const map = roles.includes("mapping");
  if (spray && map) return "Sprayer + survey";
  return spray ? "Sprayer" : "Survey";
}

/**
 * The directory grouped by make, makes in alphabetical order, aircraft within
 * a make in file order (which runs smallest to largest, then survey).
 *
 * The picker renders from this. Grouping is what keeps thirty-odd airframes
 * navigable without a search box on a tablet in a truck.
 */
export function aircraftByMake(): { make: string; aircraft: AircraftEntry[] }[] {
  const groups = new Map<string, AircraftEntry[]>();
  for (const a of AIRCRAFT) {
    const list = groups.get(a.make);
    if (list) list.push(a); else groups.set(a.make, [a]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([make, list]) => ({ make, aircraft: list }));
}

// ---------------------------------------------------------------------------
// Custom aircraft
// ---------------------------------------------------------------------------

/**
 * An airframe the operator described themselves.
 *
 * A first-class citizen, not a fallback: it is stored per drone (in
 * `drones.specs`), it plans, it logs and it reports exactly as a seeded entry
 * does. The only difference is where the numbers came from — and the numbers
 * come from the operator, never from a "similar" model. There is no autofill
 * here and there must never be one: the closest seeded airframe is still a
 * different aircraft, and a capacity inherited from it is a fabricated value on
 * a spray record.
 */
export type CustomAircraft = {
  kind: "custom";
  make: string;
  model: string;
  roles: AircraftRole[];
  /** Litres. Required for a sprayer, and validated as such. */
  tank_l: number | null;
  /** Metres. Optional — blank means "not stated", never a default. */
  swath_m: number | null;
};

export const EMPTY_CUSTOM_AIRCRAFT: CustomAircraft = {
  kind: "custom",
  make: "",
  model: "",
  roles: ["spray"],
  tank_l: null,
  swath_m: null,
};

/** True when `specs` is an operator-described airframe rather than a spec dump. */
export function isCustomAircraft(specs: unknown): specs is CustomAircraft {
  return !!specs && typeof specs === "object" && (specs as CustomAircraft).kind === "custom";
}

/**
 * The label a custom aircraft is stored and shown under.
 *
 * Kept identical everywhere so a custom aircraft reads the same in the fleet
 * list, the planner dropdown, the Log Flight dialog and the report header.
 */
export function customModelLabel(c: Pick<CustomAircraft, "make" | "model">): string {
  return [c.make.trim(), c.model.trim()].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Operator overrides on a seeded aircraft
// ---------------------------------------------------------------------------

/**
 * Figures the operator supplied for a SEEDED airframe whose maker publishes
 * none, or whose published figure does not match the machine they own.
 *
 * Two of the aircraft in the directory are discontinued and DJI has taken their
 * specification pages down; several Hylio airframes ship in more than one tank
 * configuration. Rather than invent a capacity for those, the directory leaves
 * them null and the operator fills them in here, per drone. Stored in
 * `drones.specs` alongside the custom-aircraft shape and distinguished by
 * `kind`, so one column serves both without either guessing at the other.
 */
export type AircraftOverride = {
  kind: "override";
  tank_l: number | null;
  swath_m: number | null;
};

export function isAircraftOverride(specs: unknown): specs is AircraftOverride {
  return !!specs && typeof specs === "object" && (specs as AircraftOverride).kind === "override";
}

/**
 * What the operator still has to state before a seeded aircraft can be flown.
 *
 * A sprayer with no capacity anywhere is the one hard stop: the Log Flight
 * dialog reconciles logged volume against capacity times refills, and without a
 * capacity that check silently passes everything.
 */
export function missingSeededFields(
  entry: AircraftEntry, override?: AircraftOverride | null,
): { tank: boolean; swath: boolean } {
  const spray = isSprayer(entry);
  return {
    tank: spray && entry.tank_l == null && (override?.tank_l ?? null) == null,
    swath: spray && entry.swath_m == null && (override?.swath_m ?? null) == null,
  };
}

/**
 * Everything wrong with a custom aircraft, in the order the form shows it.
 *
 * Tank capacity is required for a sprayer and only for a sprayer. It is not
 * bureaucracy: the Log Flight dialog reconciles the volume the pilot types
 * against capacity times refills, and the report prints that reconciliation. A
 * sprayer with no capacity is a sprayer whose spray record cannot be checked,
 * so the check happens at registration rather than being discovered later by
 * whoever reads the report.
 */
export function validateCustomAircraft(c: CustomAircraft): string[] {
  const errors: string[] = [];
  if (!c.make.trim()) errors.push("Enter the manufacturer.");
  if (!c.model.trim()) errors.push("Enter the model.");
  if (c.roles.length === 0) errors.push("Choose whether this aircraft sprays, maps, or both.");
  if (c.roles.includes("spray")) {
    if (c.tank_l == null || !Number.isFinite(c.tank_l) || c.tank_l <= 0) {
      errors.push("Enter the tank capacity in litres. Spray reports reconcile logged volume against it, so a sprayer cannot be registered without one.");
    }
  }
  if (c.swath_m != null && (!Number.isFinite(c.swath_m) || c.swath_m <= 0)) {
    errors.push("Swath width must be a positive number of metres, or left blank.");
  }
  return errors;
}
