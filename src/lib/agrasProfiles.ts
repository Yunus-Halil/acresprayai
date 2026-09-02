// Model-aware operating profiles for DJI Agras airframes.
//
// WHAT THIS IS FOR. The job estimator needs to answer "how long will this take
// and how many times do I refill" the night before, with nothing powered on.
// Answering that from one generic set of defaults gets the same number for a
// T10 carrying 8 L and a T100 carrying 100 L, which is not an estimate, it is a
// placeholder. This layer makes the answer depend on the aircraft the operator
// actually flies.
//
// THREE KINDS OF NUMBER, AND THEY ARE NOT INTERCHANGEABLE:
//
//   1. Directory figures (aircraftDirectory.json). Read off DJI's own page,
//      dated, with the URL attached. Tank capacity comes from here first.
//   2. Operating ranges (agrasProfiles.json). Field-derived envelopes for
//      swath, height and speed, plus the spec-sheet extras the estimator needs.
//      A range defaults to its MIDPOINT. Never its maximum: see the file header.
//   3. The GENERIC profile below, for an airframe that is in neither. It is a
//      shape the arithmetic can run on, and every consumer is told it is one so
//      the UI can say "we do not have a profile for this aircraft" instead of
//      quietly presenting a number nobody chose.
//
// DJI ONLY, DELIBERATELY. XAG and Hylio airframes resolve to the generic
// profile and are labelled as such. An XAG P100 given DJI-derived envelopes
// would be a fabricated number wearing the right model name, which is worse
// than an honest fallback.
import raw from "@/data/agrasProfiles.json";
import { canonicalModel } from "./droneSpecs";

/** A [min, max] operating envelope. Defaults come from the midpoint. */
export type Range = [number, number];

/** Max flow by nozzle count. Null where DJI publishes only one of the two. */
export type FlowSpec = { nozzles_2: number | null; nozzles_4: number | null };

export type BatterySpec = { mah: number; volts: number };

/**
 * Hover endurance at max takeoff weight.
 *
 * The worst minute of the load, not the average one: the aircraft is at MTOW
 * exactly once, at the start, and lightens from there. That is precisely why
 * this is the figure to size batteries from — see jobEstimate.ts.
 */
export type HoverSpec = { minutes: number; at_kg: number | null };

export type AgrasProfile = {
  /** Directory id, and the string stored in `drones.model`. */
  id: string;
  /** Short name for a label: "T50". */
  model: string;
  tank_l: number;
  /** Dry spreader capacity, kg. Null where the airframe has no spreader. */
  dry_spread_kg: number | null;
  swath_m: Range;
  height_m: Range;
  speed_ms: Range;
  flow_lpm: FlowSpec | null;
  battery: BatterySpec | null;
  hover: HoverSpec | null;
  wind_limit_ms: number | null;
  /** Where the operating ranges came from. */
  source: "field-derived" | "dji-spec";
  /** Fields nobody has checked. Dotted paths allowed, e.g. "hover.at_kg". */
  unverified: string[];
  note: string;
};

type ProfileFile = { version: number; updated: string; profiles: AgrasProfile[] };

const file = raw as unknown as ProfileFile;

export const AGRAS_PROFILE_VERSION = file.version;
export const AGRAS_PROFILE_UPDATED = file.updated;

export const AGRAS_PROFILES: readonly AgrasProfile[] = Object.freeze(file.profiles);

const BY_ID = new Map(AGRAS_PROFILES.map(p => [p.id, p]));

/**
 * Payload lost per 1000 m of field elevation, kg.
 *
 * Thin air, so the rotors carry less. Global rather than per-model because DJI
 * states it as one rule across the Agras line. Applied to the dry/liquid load
 * an operator can plan on, not to the tank the aircraft physically has.
 */
export const PAYLOAD_DERATE_KG_PER_1000M = 10;

/**
 * Fraction of advertised swath that actually gets treated, per Purdue Extension
 * calibration guidance: 65 to 75 percent.
 *
 * WHY THIS IS NOT OPTIONAL. An advertised swath is the outer edge of a pattern
 * that is thinnest exactly where it is widest. Planning at the advertised width
 * spaces the lanes on ground that received a fraction of the label rate, and
 * the resulting under-dosed strips are invisible until the pest comes back
 * through them. 0.70 is the midpoint of the published range and it is exposed
 * to the operator, because the right number depends on their nozzles, their
 * height and their wind, and they are the ones who can measure it with cards.
 */
export const EFFECTIVE_SWATH_FACTOR_DEFAULT = 0.70;
export const EFFECTIVE_SWATH_FACTOR_RANGE: Range = [0.5, 1.0];
/** The band Purdue actually publishes. Outside it the UI says so. */
export const EFFECTIVE_SWATH_FACTOR_PUBLISHED: Range = [0.65, 0.75];

/**
 * Hard ceiling on effective swath for in-canopy work, metres.
 *
 * Sprayers101 measured this on T50-class aircraft doing in-canopy fungicide
 * passes: no more than 7 m, against an advertised 11 m. It is a cap and not a
 * factor, because the number did not scale with the advertised width — the
 * canopy, not the boom, is what limits it.
 */
export const IN_CANOPY_SWATH_CAP_M = 7;

/**
 * The shape used when an airframe has no profile.
 *
 * Not a DJI aircraft and not a claim about one. Every consumer gets
 * `matched: false` alongside it so the estimate can be labelled rather than
 * presented as model-aware when it is not. The figures are the low end of the
 * smallest profiled Agras, so a generic estimate errs slow and short rather
 * than promising a day that cannot be flown.
 */
export const GENERIC_PROFILE: AgrasProfile = {
  id: "Generic",
  model: "Generic sprayer",
  tank_l: 20,
  dry_spread_kg: null,
  swath_m: [4, 7],
  height_m: [2, 3],
  speed_ms: [4, 7],
  flow_lpm: null,
  battery: null,
  hover: null,
  wind_limit_ms: null,
  source: "field-derived",
  unverified: ["tank_l", "swath_m", "height_m", "speed_ms", "flow_lpm", "battery", "hover", "wind_limit_ms"],
  note: "No operating profile for this aircraft. Every figure is a placeholder the estimate is labelled with, not a specification.",
};

export type ResolvedProfile = {
  profile: AgrasProfile;
  /** False when this fell through to GENERIC_PROFILE. */
  matched: boolean;
  /** The model string that was looked up, for the "no profile for X" line. */
  requested: string | null;
};

/**
 * The operating profile for a fleet model string.
 *
 * Goes through `canonicalModel` first, so the same aliases that keep old fleet
 * rows resolving in the planner keep them resolving here. An unmatched model
 * returns the generic profile with `matched: false` — never a silent guess at
 * the nearest Agras, because "nearest" across this line spans 8 L to 100 L.
 */
export function resolveAgrasProfile(model: string | null | undefined): ResolvedProfile {
  const requested = model ?? null;
  const key = canonicalModel(model) ?? model ?? null;
  const hit = key ? BY_ID.get(key) : undefined;
  if (hit) return { profile: hit, matched: true, requested };
  return { profile: GENERIC_PROFILE, matched: false, requested };
}

/** Every profiled model id, for a picker or a test. */
export const AGRAS_PROFILE_IDS = AGRAS_PROFILES.map(p => p.id);

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/**
 * The default value for a range: its MIDPOINT.
 *
 * The one-line version of the argument in the JSON header. A maximum is
 * reachable in ideal conditions only, so defaulting every range to its top
 * under-estimates every job in the same direction. Consistent optimism is worse
 * than noise, because nobody corrects for it.
 */
export const midpoint = (r: Range): number => (r[0] + r[1]) / 2;

export const clampToRange = (v: number, r: Range): number =>
  Math.min(r[1], Math.max(r[0], v));

/** Where `v` sits in `r`, 0 at the bottom and 1 at the top. */
export function rangeFraction(v: number, r: Range): number {
  const span = r[1] - r[0];
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (v - r[0]) / span));
}

/** The value at fraction `f` of a range. Inverse of `rangeFraction`. */
export const atFraction = (f: number, r: Range): number =>
  r[0] + Math.min(1, Math.max(0, f)) * (r[1] - r[0]);

// ---------------------------------------------------------------------------
// The envelope: swath, speed and height are not independent
// ---------------------------------------------------------------------------

/**
 * The widest advertised swath this aircraft can actually reach at a given speed
 * and height.
 *
 * THE RELATIONSHIP THE TABLE SHOWS. On the T100, 13 m appears at 20 m/s and
 * about 5 m of altitude. It is not available at 8.5 m/s and 3 m, and no setting
 * makes it so: the wide pattern is the rotor wash spreading the droplets at
 * speed and height, and a slow low pass simply lays a narrower band. The three
 * ranges are one envelope quoted three ways, and letting an operator pick the
 * top of one against the bottom of the others produces a job estimate for an
 * aircraft that does not exist.
 *
 * The model is deliberately the simplest thing that respects that: swath
 * tracks the LOWER of the speed and height positions in their own ranges. It is
 * linear because nobody has published the curve, and a fitted curve would be a
 * fabricated precision on top of a real constraint. The direction is what
 * matters, and the direction is certain.
 */
export function maxSwathAt(profile: AgrasProfile, speedMs: number, heightM: number): number {
  const f = Math.min(
    rangeFraction(speedMs, profile.speed_ms),
    rangeFraction(heightM, profile.height_m),
  );
  return atFraction(f, profile.swath_m);
}

export type SwathConstraint = {
  /** The advertised swath after the envelope has had its say, metres. */
  swathM: number;
  /** What the operator asked for, before clamping. */
  requestedM: number;
  /** True when the request was wider than the envelope allows. */
  clamped: boolean;
  /** Why, in a sentence the panel can print. Empty when nothing was clamped. */
  reason: string;
};

/**
 * Hold a requested swath against the speed and height it was requested at.
 *
 * Returns the clamped width plus the sentence explaining it, because a number
 * that silently moved is exactly the kind of thing that makes an operator stop
 * trusting the tool. They asked for 13 m; they should be told they are getting
 * 9 m and which input to change to get the rest.
 */
export function constrainSwath(
  profile: AgrasProfile, requestedM: number, speedMs: number, heightM: number,
): SwathConstraint {
  const ceiling = maxSwathAt(profile, speedMs, heightM);
  const inRange = clampToRange(requestedM, profile.swath_m);
  if (inRange <= ceiling + 1e-9) {
    return { swathM: inRange, requestedM, clamped: inRange !== requestedM, reason: inRange !== requestedM
      ? `${profile.model} swath is ${profile.swath_m[0]} to ${profile.swath_m[1]} m.`
      : "" };
  }
  const speedF = rangeFraction(speedMs, profile.speed_ms);
  const heightF = rangeFraction(heightM, profile.height_m);
  const limiter = speedF <= heightF ? "speed" : "height";
  const needed = rangeFraction(inRange, profile.swath_m);
  const needSpeed = atFraction(needed, profile.speed_ms);
  const needHeight = atFraction(needed, profile.height_m);
  return {
    swathM: ceiling,
    requestedM,
    clamped: true,
    reason:
      `${round2(inRange)} m of swath needs about ${round2(needSpeed)} m/s at ` +
      `${round2(needHeight)} m. At ${round2(speedMs)} m/s and ${round2(heightM)} m ` +
      `this aircraft lays ${round2(ceiling)} m, and ${limiter} is what is holding it back.`,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** True when a profile field has not been checked against a spec sheet. */
export function isUnverified(profile: AgrasProfile, field: string): boolean {
  return profile.unverified.includes(field);
}

/**
 * Max flow the pump can deliver, litres/min, at the nozzle count in use.
 *
 * Null means nobody has verified one. Callers must treat null as "no ceiling
 * known" and say so, rather than falling back to a number: an unchecked rate
 * ceiling that silently passes is how an operator finds out mid-field that the
 * pump cannot deliver the rate at the speed they planned.
 */
export function maxFlowLpm(profile: AgrasProfile, nozzles: 2 | 4): number | null {
  const f = profile.flow_lpm;
  if (!f) return null;
  const v = nozzles === 2 ? f.nozzles_2 : f.nozzles_4;
  return v != null && v > 0 ? v : null;
}

/** Nozzle counts this profile publishes a flow figure for. */
export function availableNozzleCounts(profile: AgrasProfile): (2 | 4)[] {
  const out: (2 | 4)[] = [];
  if (profile.flow_lpm?.nozzles_2 != null) out.push(2);
  if (profile.flow_lpm?.nozzles_4 != null) out.push(4);
  return out;
}

/**
 * Usable payload at a field elevation, kg, from the tank the aircraft carries.
 *
 * Only meaningful for the liquid load, and only as a planning bound: this is
 * the DJI derate rule, not a lift model. Payload and centre-of-gravity work
 * proper lives in dronePhysics.ts and is not duplicated here.
 */
export function payloadDerateKg(elevationM: number): number {
  return Math.max(0, elevationM) / 1000 * PAYLOAD_DERATE_KG_PER_1000M;
}

/**
 * Litres of tank an operator can plan on filling at a given field elevation.
 *
 * One litre of water is one kilogram, near enough for a planning figure, and
 * every product an Agras carries is close to water by density. Never more than
 * the tank, never less than nothing.
 */
export function usableTankAtElevationL(profile: AgrasProfile, elevationM: number): number {
  return Math.max(0, profile.tank_l - payloadDerateKg(elevationM));
}
