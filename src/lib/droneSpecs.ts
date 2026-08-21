// Single source of truth for drone capability data.
//
// This used to live in two places — Fleet.tsx (display strings) and
// OrthomosaicViewer.tsx (planner numbers) — under different model keys and with
// conflicting values, so a drone registered in the fleet silently fell back to
// generic "Custom" specs in the planner. Everything now derives from the numeric
// table below: the display strings are formatted from the same fields the flight
// planner does its physics on, so the two can never disagree again.
//
// ACCURACY: these are conservative real-world figures, not marketing maxima, and
// they have NOT been verified against current manufacturer datasheets. They feed
// battery, tank and maneuverability estimates that a pilot relies on — treat them
// as defaults to be confirmed per airframe, and let operators override via the
// "Custom" profile.

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

// Canonical keys are the strings already persisted in `drones.model`, so
// existing fleet rows keep resolving after this consolidation.
export const DRONE_SPECS: Record<string, DroneSpec> = {
  "DJI Agras T40": {
    role: "sprayer",
    tank_l: 40, payload_kg: 50, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 9, spray_rate_lpm: 24,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 4, climb_rate_ms: 6,
    range_m: 1500, weight_kg: 65.5,
    wingspan: "2.8 m folded → 6.2 m deployed", ip: "IP67",
  },
  "DJI Agras T30": {
    role: "sprayer",
    tank_l: 30, payload_kg: 40, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 6.5, spray_rate_lpm: 8,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 3.5, climb_rate_ms: 6,
    range_m: 1500, weight_kg: 58,
    wingspan: "2.6 m folded → 5.5 m deployed", ip: "IP67",
  },
  "DJI Agras T25": {
    role: "sprayer",
    tank_l: 20, payload_kg: 25, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 7, spray_rate_lpm: 16,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 3, climb_rate_ms: 6,
    range_m: 1200, weight_kg: 42,
    wingspan: "2.2 m folded → 4.7 m deployed", ip: "IP67",
  },
  "XAG P100 Pro": {
    role: "sprayer",
    tank_l: 50, payload_kg: 50, max_flight_min: 18, max_speed_ms: 13.8,
    spray_swath_m: 10, spray_rate_lpm: 22,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 4.5, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 75,
    wingspan: "3.2 m folded", ip: "IP67",
  },
  "XAG V40": {
    role: "sprayer",
    tank_l: 16, payload_kg: 20, max_flight_min: 18, max_speed_ms: 13.8,
    spray_swath_m: 5, spray_rate_lpm: 8,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 3.5, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 40,
    wingspan: "2.6 m folded", ip: "IP67",
  },
  "DJI Mavic 3M": {
    role: "survey",
    tank_l: 0, payload_kg: 0, max_flight_min: 43, max_speed_ms: 21,
    spray_swath_m: 0, spray_rate_lpm: 0,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 1, climb_rate_ms: 8,
    range_m: 6000, weight_kg: 0.95,
    wingspan: "0.38 m unfolded", ip: "-",
  },
  "Parrot Anafi USA": {
    role: "survey",
    tank_l: 0, payload_kg: 0, max_flight_min: 32, max_speed_ms: 14.7,
    spray_swath_m: 0, spray_rate_lpm: 0,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 1, climb_rate_ms: 4,
    range_m: 4000, weight_kg: 0.5,
    wingspan: "0.24 m unfolded", ip: "IP53",
  },
  "Custom": {
    role: "sprayer",
    tank_l: 30, payload_kg: 40, max_flight_min: 20, max_speed_ms: 10,
    spray_swath_m: 6, spray_rate_lpm: 12,
    spray_overlap: 0.10,
    spray_spread_factor: 1.0,
    min_turn_radius_m: 3, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 50,
    wingspan: "-", ip: "-",
  },
};

/** Model names that have appeared in the UI or in saved rows over time. */
const MODEL_ALIASES: Record<string, string> = {
  "XAG P100": "XAG P100 Pro",
  "DJI Agras T-40": "DJI Agras T40",
  "DJI Agras T-30": "DJI Agras T30",
  "DJI Agras T-25": "DJI Agras T25",
  "DJI Mavic 3 Multispectral": "DJI Mavic 3M",
};

/** Models offered in the fleet registration picker, sprayers first. */
export const MODEL_IDS = Object.keys(DRONE_SPECS).filter(k => k !== "Custom");

export const DEFAULT_SPEC: DroneSpec = DRONE_SPECS["Custom"];

/** Canonical key for a stored/typed model name, or null when unrecognised. */
export function canonicalModel(model: string | null | undefined): string | null {
  if (!model) return null;
  if (DRONE_SPECS[model]) return model;
  const alias = MODEL_ALIASES[model];
  return alias && DRONE_SPECS[alias] ? alias : null;
}

/**
 * Resolve a fleet drone's model to a spec. Unknown models (and the explicit
 * "Custom" profile) fall back to the operator's own overrides merged over the
 * defaults, so specs saved before a field was added still validate.
 */
export function resolveDroneSpec(
  model: string | null | undefined,
  customSpec?: Partial<DroneSpec> | null,
): { spec: DroneSpec; key: string; isCustom: boolean } {
  const key = canonicalModel(model);
  if (key && key !== "Custom") {
    return { spec: { ...DEFAULT_SPEC, ...DRONE_SPECS[key] }, key, isCustom: false };
  }
  return {
    spec: { ...DEFAULT_SPEC, ...(customSpec ?? {}) },
    key: model || "Custom",
    isCustom: true,
  };
}

/**
 * The swath to plan against, in metres.
 *
 * A non-sprayer has no swath at all, and a spec loaded from an older saved
 * profile can be missing the field entirely, so both fall back to the Custom
 * profile's width rather than to zero — a zero would divide a field into
 * infinitely many passes. The Treatment Grid sizes its cells from this and the
 * Flight Planner spaces its passes from it, which is the point: the lane the
 * aircraft flies and the cell the rate is assigned to are the same width.
 */
export function effectiveSwathM(spec: Pick<DroneSpec, "spray_swath_m">): number {
  return spec.spray_swath_m > 0 ? spec.spray_swath_m : DEFAULT_SPEC.spray_swath_m;
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

/** Human-readable spec sheet, formatted from the numeric fields above. */
export function specSheet(spec: DroneSpec): { k: string; v: string }[] {
  const sprayer = spec.role === "sprayer";
  return [
    { k: "Tank", v: sprayer ? `${spec.tank_l} L` : "-" },
    { k: "Swath", v: sprayer ? `${spec.spray_swath_m} m` : "-" },
    { k: "Max speed", v: `${spec.max_speed_ms} m/s` },
    { k: "Flight time", v: `${spec.max_flight_min} min${sprayer ? " (full load)" : ""}` },
    { k: "Spray rate", v: sprayer ? `${spec.spray_rate_lpm} L/min` : "-" },
    { k: "Weight", v: `${spec.weight_kg} kg${sprayer ? " (loaded)" : ""}` },
    { k: "Wingspan", v: spec.wingspan },
    { k: "IP rating", v: spec.ip },
  ];
}

export const roleLabel = (spec: DroneSpec) => spec.role === "sprayer" ? "Sprayer" : "Survey";
