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
    min_turn_radius_m: 4, climb_rate_ms: 6,
    range_m: 1500, weight_kg: 65.5,
    wingspan: "2.8 m folded → 6.2 m deployed", ip: "IP67",
  },
  "DJI Agras T30": {
    role: "sprayer",
    tank_l: 30, payload_kg: 40, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 6.5, spray_rate_lpm: 8,
    min_turn_radius_m: 3.5, climb_rate_ms: 6,
    range_m: 1500, weight_kg: 58,
    wingspan: "2.6 m folded → 5.5 m deployed", ip: "IP67",
  },
  "DJI Agras T25": {
    role: "sprayer",
    tank_l: 20, payload_kg: 25, max_flight_min: 18, max_speed_ms: 10,
    spray_swath_m: 7, spray_rate_lpm: 16,
    min_turn_radius_m: 3, climb_rate_ms: 6,
    range_m: 1200, weight_kg: 42,
    wingspan: "2.2 m folded → 4.7 m deployed", ip: "IP67",
  },
  "XAG P100 Pro": {
    role: "sprayer",
    tank_l: 50, payload_kg: 50, max_flight_min: 18, max_speed_ms: 13.8,
    spray_swath_m: 10, spray_rate_lpm: 22,
    min_turn_radius_m: 4.5, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 75,
    wingspan: "3.2 m folded", ip: "IP67",
  },
  "XAG V40": {
    role: "sprayer",
    tank_l: 16, payload_kg: 20, max_flight_min: 18, max_speed_ms: 13.8,
    spray_swath_m: 5, spray_rate_lpm: 8,
    min_turn_radius_m: 3.5, climb_rate_ms: 5,
    range_m: 1000, weight_kg: 40,
    wingspan: "2.6 m folded", ip: "IP67",
  },
  "DJI Mavic 3M": {
    role: "survey",
    tank_l: 0, payload_kg: 0, max_flight_min: 43, max_speed_ms: 21,
    spray_swath_m: 0, spray_rate_lpm: 0,
    min_turn_radius_m: 1, climb_rate_ms: 8,
    range_m: 6000, weight_kg: 0.95,
    wingspan: "0.38 m unfolded", ip: "-",
  },
  "Parrot Anafi USA": {
    role: "survey",
    tank_l: 0, payload_kg: 0, max_flight_min: 32, max_speed_ms: 14.7,
    spray_swath_m: 0, spray_rate_lpm: 0,
    min_turn_radius_m: 1, climb_rate_ms: 4,
    range_m: 4000, weight_kg: 0.5,
    wingspan: "0.24 m unfolded", ip: "IP53",
  },
  "Custom": {
    role: "sprayer",
    tank_l: 30, payload_kg: 40, max_flight_min: 20, max_speed_ms: 10,
    spray_swath_m: 6, spray_rate_lpm: 12,
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
