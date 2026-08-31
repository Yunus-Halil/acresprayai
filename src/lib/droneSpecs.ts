// Single source of truth for drone capability data.
//
// This used to live in two places — Fleet.tsx (display strings) and
// OrthomosaicViewer.tsx (planner numbers) — under different model keys and with
// conflicting values, so a drone registered in the fleet silently fell back to
// generic "Custom" specs in the planner. Everything now derives from the
// numeric table below: the display strings are formatted from the same fields
// the flight planner does its physics on, so the two can never disagree again.
//
// The CATALOGUE — which airframes exist, what their makers publish, and where
// that was read from — now lives in `src/data/aircraftDirectory.json` and is
// loaded through `aircraftDirectory.ts`. This file is what turns a catalogue
// entry into something the planner can fly: it layers the hand-tuned
// operational profiles below over the manufacturer figures.
//
// TWO KINDS OF NUMBER LIVE HERE AND THEY ARE NOT INTERCHANGEABLE:
//
//   1. Directory figures. Read off the manufacturer's own specification page,
//      dated, with the URL attached. Tank capacity and flow rate come from
//      here. Where the maker publishes nothing, the field is null and stays
//      null — it is never inferred from a model number or a predecessor.
//
//   2. PLANNING_PROFILES, below. Conservative operational figures for the
//      airframes SwathWise has shipped against, NOT verified against current
//      datasheets. They feed battery, tank and maneuverability estimates that a
//      pilot relies on — treat them as defaults to be confirmed per airframe.
//
// An airframe with no planning profile gets the DEFAULT_SPEC shape for the
// fields nobody has published, and `resolveDroneSpec` reports which fields
// those were so the UI can say so out loud instead of printing a placeholder as
// though it were a measurement.
import {
  AIRCRAFT, type AircraftEntry, type AircraftOverride, aircraftById,
  isAircraftOverride, isCustomAircraft, type CustomAircraft,
} from "./aircraftDirectory";

export type DroneRole = "sprayer" | "survey";

export type DroneSpec = {
  role: DroneRole;
  tank_l: number;            // spray tank capacity, litres (0 = non-sprayer)
  payload_kg: number;        // max payload including tank
  max_flight_min: number;    // realistic single-battery flight time, loaded
  max_speed_ms: number;      // max horizontal speed
  spray_swath_m: number;     // effective swath at typical AGL (0 = non-sprayer)
  spray_rate_lpm: number;    // nominal flow rate, litres/min (0 = non-sprayer)
  /**
   * Fraction of the swath that adjacent passes deliberately share, 0–0.5.
   *
   * TUNABLE STARTING GUESS, NOT A VERIFIED FIGURE. 10% is the conventional
   * rule of thumb for keeping coverage even where the edge of the spray
   * pattern thins out and where GPS wander puts the aircraft a little off the
   * line. The right number differs by nozzle, height, droplet size and wind,
   * and it is per-drone here so it can be corrected per airframe as real
   * coverage cards come back from the field.
   */
  spray_overlap: number;
  /**
   * Multiplier on the boom width, for operators who fly wider than it.
   *
   * DEFAULTS TO 1.0 AND SHOULD USUALLY STAY THERE. Rotor downwash does fan the
   * spray beyond the mechanical boom, and a pilot who knows their aircraft and
   * their conditions can genuinely cover more ground per pass. But downwash is
   * not a boom: it is uneven, it changes with height, load, speed and wind, and
   * it is widest exactly where the droplets are smallest and most prone to
   * drift. Spacing lanes on the strength of it buys fewer passes with
   * under-dosed strips between them — and an under-dosed strip is invisible
   * until the pest comes back through it weeks later, by which point nothing
   * connects the miss to the plan that caused it.
   *
   * So this is opt-in, per drone, and the coverage tests are written against
   * the MECHANICAL boom rather than this: a factor aggressive enough to open
   * gaps fails a test instead of quietly under-dosing a field. At the shipped
   * 10% overlap the arithmetic absorbs about 1.11 before gaps appear.
   *
   * TUNABLE STARTING VALUE: 1.0 is a deliberate refusal to assume anything, not
   * a measured figure.
   */
  spray_spread_factor: number;
  min_turn_radius_m: number; // tightest physically achievable horizontal turn
  climb_rate_ms: number;     // max sustained vertical climb rate
  range_m: number;           // practical command-and-control range
  weight_kg: number;         // takeoff weight, loaded
  wingspan: string;          // descriptive — no numeric consumer
  ip: string;                // ingress protection rating, "—" when unrated
};

/**
 * The shape every spec falls back into for fields nobody has published.
 *
 * Not a real aircraft and not a claim about one. It exists so the arithmetic
 * downstream has finite numbers to work with — a zero swath would divide a
 * field into infinitely many passes — and every field taken from here is
 * reported as unknown by `resolveDroneSpec` so the UI can label it.
 */
export const DEFAULT_SPEC: DroneSpec = {
  role: "sprayer",
  tank_l: 30, payload_kg: 40, max_flight_min: 20, max_speed_ms: 10,
  spray_swath_m: 6, spray_rate_lpm: 12,
  spray_overlap: 0.10,
  spray_spread_factor: 1.0,
  min_turn_radius_m: 3, climb_rate_ms: 5,
  range_m: 1000, weight_kg: 50,
  wingspan: "-", ip: "-",
};

/**
 * Hand-tuned operational profiles, keyed by directory id.
 *
 * These are the airframes SwathWise has shipped flight planning against. The
 * figures are conservative real-world values rather than marketing maxima and
 * have NOT been verified against current manufacturer datasheets — which is
 * exactly why they override the published numbers rather than the other way
 * round.
 *
 * THE T40 SWATH IS THE WORKED EXAMPLE. DJI publishes 11 m, measured at 2.5 m
 * relative altitude and 7 m/s. This plans at 9 m. That gap is deliberate: the
 * published figure is the outer edge of a pattern that is thinnest exactly
 * where it is widest, and lanes spaced on it leave under-dosed strips that
 * nobody sees until the pest comes back through them. Every profile swath here
 * sits inside its maker's published range, toward the conservative end.
 *
 * CHANGING A NUMBER HERE RE-PLANS EVERY EXISTING MISSION FOR THAT AIRFRAME —
 * pass spacing, treatment grid cell size and chemical volume all move together.
 * These seven are frozen at the values they shipped with for that reason.
 */
const PLANNING_PROFILES: Record<string, Partial<DroneSpec>> = {
  "DJI Agras T40": {
    tank_l: 40, payload_kg: 50, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 9, spray_rate_lpm: 24,
    min_turn_radius_m: 4, climb_rate_ms: 6,
    range_m: 1500, weight_kg: 65.5,
    wingspan: "2.8 m folded → 6.2 m deployed", ip: "IP67",
  },
  "DJI Agras T30": {
    tank_l: 30, payload_kg: 40, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 6.5, spray_rate_lpm: 8,
    min_turn_radius_m: 3.5, climb_rate_ms: 6,
    range_m: 1500, weight_kg: 58,
    wingspan: "2.6 m folded → 5.5 m deployed", ip: "IP67",
  },
  "DJI Agras T25": {
    tank_l: 20, payload_kg: 25, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 7, spray_rate_lpm: 16,
    min_turn_radius_m: 3, climb_rate_ms: 6,
    range_m: 1200, weight_kg: 42,
    wingspan: "2.2 m folded → 4.7 m deployed", ip: "IP67",
  },
  "XAG P100 Pro": {
    tank_l: 50, payload_kg: 50, max_flight_min: 18, max_speed_ms: 13.8,
    spray_swath_m: 10, spray_rate_lpm: 22,
    min_turn_radius_m: 4.5, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 75,
    wingspan: "3.2 m folded", ip: "IP67",
  },
  "XAG V40": {
    tank_l: 16, payload_kg: 20, max_flight_min: 18, max_speed_ms: 13.8,
    spray_swath_m: 5, spray_rate_lpm: 8,
    min_turn_radius_m: 3.5, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 40,
    wingspan: "2.6 m folded", ip: "IP67",
  },
  "DJI Mavic 3M": {
    max_flight_min: 43, max_speed_ms: 21,
    min_turn_radius_m: 1, climb_rate_ms: 8,
    range_m: 6000, weight_kg: 0.95,
    wingspan: "0.38 m unfolded", ip: "-",
  },
  "Parrot Anafi USA": {
    max_flight_min: 32, max_speed_ms: 14.7,
    min_turn_radius_m: 1, climb_rate_ms: 4,
    range_m: 4000, weight_kg: 0.5,
    wingspan: "0.24 m unfolded", ip: "IP53",
  },
};

/** Fields of a DroneSpec that can be genuinely known or genuinely not. */
export type SpecField = keyof DroneSpec;

/**
 * Turn a catalogue entry into a planner spec, and record which fields are real.
 *
 * Order of precedence, narrowest first: planning profile, then published
 * manufacturer figure, then the DEFAULT_SPEC shape. A field that only ever came
 * from DEFAULT_SPEC is absent from `known`, and the UI shows it as unpublished
 * rather than printing it.
 */
function buildSpec(entry: AircraftEntry): { spec: DroneSpec; known: Set<SpecField> } {
  const sprays = entry.roles.includes("spray");
  const known = new Set<SpecField>(["role"]);
  const spec: DroneSpec = { ...DEFAULT_SPEC, role: sprays ? "sprayer" : "survey" };

  if (!sprays) {
    // A survey airframe has no tank and no boom. Zero here is a fact about the
    // aircraft, not a missing value, so both count as known.
    spec.tank_l = 0;
    spec.spray_swath_m = 0;
    spec.spray_rate_lpm = 0;
    spec.payload_kg = 0;
    known.add("tank_l").add("spray_swath_m").add("spray_rate_lpm");
  } else {
    if (entry.tank_l != null) { spec.tank_l = entry.tank_l; known.add("tank_l"); }
    else { spec.tank_l = 0; }        // 0 = unknown for a sprayer; see effectiveTankL
    if (entry.swath_m != null) { spec.spray_swath_m = entry.swath_m; known.add("spray_swath_m"); }
    else { spec.spray_swath_m = 0; } // 0 = unknown; effectiveSwathM guards the maths
    if (entry.flow_lpm != null) { spec.spray_rate_lpm = entry.flow_lpm; known.add("spray_rate_lpm"); }
  }

  const profile = PLANNING_PROFILES[entry.id];
  if (profile) {
    for (const [k, v] of Object.entries(profile)) {
      (spec as Record<string, unknown>)[k] = v;
      known.add(k as SpecField);
    }
  }
  return { spec, known };
}

const BUILT = new Map<string, { spec: DroneSpec; known: Set<SpecField> }>(
  AIRCRAFT.map(a => [a.id, buildSpec(a)]),
);

/**
 * Every seeded airframe as a planner spec, keyed by the string stored in
 * `drones.model`. "Custom" is included as the neutral fallback shape so older
 * saved settings that reference it keep resolving.
 */
export const DRONE_SPECS: Record<string, DroneSpec> = Object.fromEntries([
  ...[...BUILT.entries()].map(([id, b]) => [id, b.spec] as const),
  ["Custom", DEFAULT_SPEC] as const,
]);

/** Which fields of each seeded spec are real figures rather than fallbacks. */
export const DRONE_SPEC_KNOWN: Record<string, Set<SpecField>> = Object.fromEntries([
  ...[...BUILT.entries()].map(([id, b]) => [id, b.known] as const),
  ["Custom", new Set<SpecField>()] as const,
]);

/**
 * Model names that have appeared in the UI or in saved rows over time.
 *
 * Never delete an entry: each one is a fleet row somewhere that would otherwise
 * stop resolving to its aircraft.
 */
const MODEL_ALIASES: Record<string, string> = {
  "DJI Agras T-40": "DJI Agras T40",
  "DJI Agras T-30": "DJI Agras T30",
  "DJI Agras T-25": "DJI Agras T25",
  "DJI Mavic 3 Multispectral": "DJI Mavic 3M",
  // "XAG P100" used to alias to "XAG P100 Pro", back when the Pro was the only
  // P100 in the table. The P100 is now its own directory entry with its own
  // 40 L tank, so the string resolves to the aircraft it actually names and the
  // alias is gone rather than pointed at a bigger machine.
};

/** Models offered in the fleet registration picker. */
export const MODEL_IDS = AIRCRAFT.map(a => a.id);

/** Canonical key for a stored/typed model name, or null when unrecognised. */
export function canonicalModel(model: string | null | undefined): string | null {
  if (!model) return null;
  if (DRONE_SPECS[model]) return model;
  const alias = MODEL_ALIASES[model];
  return alias && DRONE_SPECS[alias] ? alias : null;
}

/** A custom aircraft description, as the partial spec the planner reads. */
function customToSpec(c: CustomAircraft): { spec: Partial<DroneSpec>; known: Set<SpecField> } {
  const sprays = c.roles.includes("spray");
  const known = new Set<SpecField>(["role"]);
  const spec: Partial<DroneSpec> = { role: sprays ? "sprayer" : "survey" };
  if (!sprays) {
    spec.tank_l = 0; spec.spray_swath_m = 0; spec.spray_rate_lpm = 0;
    known.add("tank_l").add("spray_swath_m").add("spray_rate_lpm");
  } else {
    // Blank stays blank. Nothing here is inherited from a "similar" airframe:
    // the closest seeded model is still a different aircraft, and a capacity
    // borrowed from it would be a fabricated number on a spray record.
    if (c.tank_l != null) { spec.tank_l = c.tank_l; known.add("tank_l"); }
    else { spec.tank_l = 0; }
    if (c.swath_m != null) { spec.spray_swath_m = c.swath_m; known.add("spray_swath_m"); }
    else { spec.spray_swath_m = 0; }
  }
  return { spec, known };
}

export type ResolvedSpec = {
  spec: DroneSpec;
  key: string;
  isCustom: boolean;
  /** Fields backed by a real figure. Anything absent came from DEFAULT_SPEC. */
  known: Set<SpecField>;
  /** The catalogue entry, when this resolved to a seeded airframe. */
  entry: AircraftEntry | null;
};

/**
 * Resolve a fleet drone's model to a spec.
 *
 * `overrides` is whatever is stored in that drone's `drones.specs` column: a
 * `CustomAircraft` for an operator-described airframe, or a legacy partial
 * DroneSpec for rows written before custom aircraft existed. Unknown models
 * fall back to those overrides merged over the defaults, so specs saved before
 * a field was added still validate.
 */
export function resolveDroneSpec(
  model: string | null | undefined,
  overrides?: Partial<DroneSpec> | CustomAircraft | AircraftOverride | null,
): ResolvedSpec {
  const key = canonicalModel(model);
  if (key && key !== "Custom") {
    const built = BUILT.get(key);
    if (built) {
      const spec = { ...DEFAULT_SPEC, ...built.spec };
      const known = new Set(built.known);
      // An operator figure for an airframe whose maker publishes none. It wins
      // over the fallback shape and counts as known, because someone read it
      // off the machine — which is a better source than a datasheet anyway.
      if (isAircraftOverride(overrides)) {
        if (overrides.tank_l != null && overrides.tank_l > 0) {
          spec.tank_l = overrides.tank_l; known.add("tank_l");
        }
        if (overrides.swath_m != null && overrides.swath_m > 0) {
          spec.spray_swath_m = overrides.swath_m; known.add("spray_swath_m");
        }
      }
      return { spec, key, isCustom: false, known, entry: aircraftById(key) };
    }
  }
  if (isCustomAircraft(overrides)) {
    const { spec, known } = customToSpec(overrides);
    return {
      spec: { ...DEFAULT_SPEC, ...spec },
      key: model || "Custom",
      isCustom: true,
      known,
      entry: null,
    };
  }
  // Anything left is a legacy partial DroneSpec written before custom aircraft
  // had a shape of their own, or an override whose model no longer resolves.
  // Only real spec fields are taken from it, so a stray `kind` never lands in
  // the spec, and only the fields actually present count as known.
  const partial: Partial<DroneSpec> = {};
  const carried = new Set<SpecField>();
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (k in DEFAULT_SPEC && v != null) {
        (partial as Record<string, unknown>)[k] = v;
        carried.add(k as SpecField);
      }
    }
  }
  return {
    spec: { ...DEFAULT_SPEC, ...partial },
    key: model || "Custom",
    isCustom: true,
    known: carried,
    entry: null,
  };
}

/**
 * The swath to plan against, in metres.
 *
 * A non-sprayer has no swath at all, an aircraft whose maker publishes only a
 * range has none stated, and a spec loaded from an older saved profile can be
 * missing the field entirely. All three fall back to the Custom profile's width
 * rather than to zero — a zero would divide a field into infinitely many
 * passes. The Treatment Grid sizes its cells from this and the Flight Planner
 * spaces its passes from it, which is the point: the lane the aircraft flies
 * and the cell the rate is assigned to are the same width.
 *
 * A fallback here is a number the operator did not choose, so callers that
 * render a plan check `swathIsStated` and say so.
 */
export function effectiveSwathM(spec: Pick<DroneSpec, "spray_swath_m">): number {
  return spec.spray_swath_m > 0 ? spec.spray_swath_m : DEFAULT_SPEC.spray_swath_m;
}

/** True when the swath being planned with is a stated figure, not a fallback. */
export function swathIsStated(resolved: Pick<ResolvedSpec, "spec" | "known">): boolean {
  return resolved.known.has("spray_swath_m") && resolved.spec.spray_swath_m > 0;
}

/**
 * True when the tank capacity being used is a stated figure.
 *
 * Load-bearing: the Log Flight dialog and the report reconcile logged volume
 * against capacity times refills, and that check silently does nothing when the
 * capacity is zero. Callers use this to say the check did not run rather than
 * letting an unchecked volume read as a checked one.
 */
export function tankIsStated(resolved: Pick<ResolvedSpec, "spec" | "known">): boolean {
  return resolved.known.has("tank_l") && resolved.spec.tank_l > 0;
}

/**
 * Distance between adjacent parallel passes, in metres.
 *
 * One boom width, less the overlap the drone is configured to fly with. A T40
 * at 9 m and 10% therefore puts its lines 8.1 m apart: each pass covers the
 * gap the last one left, with 0.9 m of margin for wander and for the thinner
 * edge of the pattern. Spacing the lines any tighter is not extra safety, it
 * is a second dose on ground that already had one, paid for in chemical,
 * flight time and battery.
 *
 * Overlap is clamped to half a swath. Past that the passes are closer together
 * than they are wide, which is double application by construction.
 */
export function passSpacingM(
  spec: Pick<DroneSpec, "spray_swath_m" | "spray_overlap" | "spray_spread_factor">,
): number {
  const overlap = Number.isFinite(spec.spray_overlap)
    ? Math.min(0.5, Math.max(0, spec.spray_overlap))
    : DEFAULT_SPEC.spray_overlap;
  return coveredSwathM(spec) * (1 - overlap);
}

/**
 * The width one pass is being TREATED AS covering: the boom, times whatever
 * the operator has told us downwash adds.
 *
 * Kept separate from `effectiveSwathM` because the two answer different
 * questions and only one of them is a fact about the aircraft. The boom is what
 * the machine mechanically sprays, and it is what the Treatment Grid sizes its
 * cells from — a cell is the unit a rate is assigned in, and the aircraft
 * cannot vary its rate within one boom width no matter what the downwash does.
 * This is the planner's working assumption about lane width, and at the default
 * spread factor of 1.0 the two are the same number.
 */
export function coveredSwathM(
  spec: Pick<DroneSpec, "spray_swath_m" | "spray_spread_factor">,
): number {
  const spread = Number.isFinite(spec.spray_spread_factor) && spec.spray_spread_factor > 0
    ? spec.spray_spread_factor
    : DEFAULT_SPEC.spray_spread_factor;
  return effectiveSwathM(spec) * spread;
}

/**
 * Battery drain per minute, in percentage points. Derived from `max_flight_min`
 * so the fleet endurance forecast and the planner's battery estimate always
 * describe the same aircraft.
 */
export function drainPerMin(spec: DroneSpec): number {
  return 100 / Math.max(1, spec.max_flight_min);
}

/**
 * Human-readable spec sheet, formatted from the numeric fields above.
 *
 * `known` is the set from `resolveDroneSpec`. Pass it and any field nobody has
 * published prints as "Not published" instead of the DEFAULT_SPEC placeholder —
 * an operator reading a spec card should be able to tell a manufacturer figure
 * from a shape the code needed something to put in.
 */
export function specSheet(
  spec: DroneSpec, known?: Set<SpecField>,
): { k: string; v: string }[] {
  const sprayer = spec.role === "sprayer";
  const has = (f: SpecField) => !known || known.has(f);
  const show = (f: SpecField, render: () => string) => has(f) ? render() : "Not published";
  return [
    { k: "Tank", v: sprayer ? show("tank_l", () => `${spec.tank_l} L`) : "-" },
    { k: "Swath", v: sprayer ? show("spray_swath_m", () => `${spec.spray_swath_m} m`) : "-" },
    { k: "Max speed", v: show("max_speed_ms", () => `${spec.max_speed_ms} m/s`) },
    { k: "Flight time", v: show("max_flight_min", () => `${spec.max_flight_min} min${sprayer ? " (full load)" : ""}`) },
    { k: "Spray rate", v: sprayer ? show("spray_rate_lpm", () => `${spec.spray_rate_lpm} L/min`) : "-" },
    { k: "Weight", v: show("weight_kg", () => `${spec.weight_kg} kg${sprayer ? " (loaded)" : ""}`) },
    { k: "Wingspan", v: show("wingspan", () => spec.wingspan) },
    { k: "IP rating", v: show("ip", () => spec.ip) },
  ];
}

export const roleLabel = (spec: DroneSpec) => spec.role === "sprayer" ? "Sprayer" : "Survey";
