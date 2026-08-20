// Flight physics for heavy spray multirotors — mass decay, fluid slosh, air
// density, and what all three do to current draw.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE QUOTING A NUMBER FROM HERE.
//
// This is a STRUCTURED ESTIMATE, not a validated flight-dynamics simulation,
// and the difference is not pedantry. The relationships below are real physics
// — momentum theory for hover power, the barometric formula for density
// altitude, vector decomposition for wind — but every COEFFICIENT they are fed
// is either a manufacturer figure we have not verified or a plausible guess.
// droneSpecs.ts already says its own numbers "have NOT been verified against
// current manufacturer datasheets"; this module inherits that and adds more of
// its own (slosh time constant, imbalance penalty, tank geometry).
//
// So: correct SHAPE, unverified MAGNITUDE. Good physics on guessed inputs is
// still a guess — it is simply a guess that behaves sensibly when you change
// something, which is what makes it useful for planning a day and useless as a
// compliance record. Anything user-facing must say so.
//
// What would actually raise the accuracy, in order of value:
//   1. Flight logs from real jobs — measured amp draw against known AUW is the
//      single highest-value input and would replace three guesses at once.
//   2. A manufacturer datasheet for dry weight, tank capacity and pack Ah.
//   3. Instrumented slosh behaviour, which nobody publishes and which would
//      need a test rig.
// ─────────────────────────────────────────────────────────────────────────────

/** Sea-level standard air density, kg/m³. */
export const RHO_SEA_LEVEL = 1.225;
const G = 9.80665;

/**
 * Per-airframe physical configuration.
 *
 * PLACEHOLDER VALUES — tunable, not certified. Seeded for the T40 because that
 * is the airframe this was specified against; the shape is per-model so others
 * can be added without touching the maths.
 */
export type DronePhysicsConfig = {
  model: string;
  /** Airframe with batteries fitted and an EMPTY tank, kg. */
  dryWeightKg: number;
  tankCapacityL: number;
  /** Water is 1.0. Real tank mixes run slightly heavier. */
  fluidDensityKgPerL: number;
  /** Total swept rotor disc area, m² — momentum theory needs it. */
  rotorDiscAreaM2: number;
  /** Pitch is clamped here; a spray multirotor does not fly like an FPV quad. */
  maxPitchDeg: number;
  /** Seconds for slosh to settle with a FULL tank. Scales down as it drains. */
  sloshTauFullS: number;
  /** Fore/aft travel of the fluid mass centre at full tank and max pitch, cm. */
  sloshMaxOffsetCm: number;
  /** Static fore/aft offset between a full and empty tank, cm — tank geometry. */
  staticFillOffsetCm: number;
  /** Extra amps per cm of |CoG offset|. A proxy for attitude-hold effort. */
  imbalanceAmpPerCm: number;
  /** Pack capacity, amp-hours, all packs combined. */
  batteryCapacityAh: number;
  /** Nominal pack voltage. */
  batteryNominalV: number;
  /** Electrical + propulsive efficiency, 0–1. Watts in vs useful watts out. */
  powertrainEfficiency: number;
  /** Seconds lost per 180° turnaround, on top of decel/accel. */
  turnPivotS: number;
};

/**
 * DJI Agras T40.
 *
 * UNVERIFIED. `dryWeightKg` is derived, not quoted: droneSpecs lists 65.5 kg as
 * takeoff weight LOADED and a 40 L tank, so dry ≈ 65.5 − 40 = 25.5 kg — which
 * disagrees with the ~50 kg dry weight quoted in the brief. That disagreement
 * is real and unresolved, so the figure here follows the brief (the larger,
 * more conservative number) and this comment records that the two sources
 * conflict. A datasheet settles it.
 */
export const T40_PHYSICS: DronePhysicsConfig = {
  model: "DJI Agras T40",
  dryWeightKg: 50,
  tankCapacityL: 40,
  fluidDensityKgPerL: 1.0,
  rotorDiscAreaM2: 4 * Math.PI * Math.pow(1.27 / 2, 2),  // 4 rotors, ~50" props
  maxPitchDeg: 25,
  sloshTauFullS: 1.8,
  sloshMaxOffsetCm: 12,
  staticFillOffsetCm: 4,
  imbalanceAmpPerCm: 0.9,
  batteryCapacityAh: 30,
  batteryNominalV: 52.22,
  powertrainEfficiency: 0.72,
  turnPivotS: 2.5,
};

const BY_MODEL: Record<string, DronePhysicsConfig> = { [T40_PHYSICS.model]: T40_PHYSICS };

/** Physics config for a model, falling back to the T40 shape scaled by nothing. */
export function physicsFor(model: string | null | undefined): DronePhysicsConfig {
  return (model && BY_MODEL[model]) || T40_PHYSICS;
}

// ---------------------------------------------------------------------------
// 1. Mass
// ---------------------------------------------------------------------------

/**
 * Litres left in the tank after spraying for `sprayedS` seconds.
 *
 * Flow-rate driven when the aircraft has a known rate, which is the accurate
 * path: tank mass falls with litres actually pumped, and only while the boom is
 * on. Transit and turns do not drain it.
 *
 * Clamped at zero. A tank cannot go negative, and a mission that would empty it
 * does not silently borrow — the shortfall shows up as a refill requirement
 * elsewhere.
 */
export function remainingLitres(
  startLitres: number, sprayedSeconds: number, flowLpm: number,
): number {
  if (!(flowLpm > 0)) return Math.max(0, startLitres);
  const used = (flowLpm / 60) * Math.max(0, sprayedSeconds);
  return Math.max(0, Math.min(startLitres, startLitres - used));
}

/** All-up weight. Batteries are inside `dryWeightKg`, so they are not re-added. */
export function allUpWeightKg(cfg: DronePhysicsConfig, payloadLitres: number): number {
  return cfg.dryWeightKg + Math.max(0, payloadLitres) * cfg.fluidDensityKgPerL;
}

// ---------------------------------------------------------------------------
// 2. Pitch and slosh
// ---------------------------------------------------------------------------

/**
 * Pitch from longitudinal acceleration.
 *
 * A multirotor accelerates by tilting: the thrust vector has to supply weight
 * vertically and acceleration horizontally, so tan(pitch) = a / g. Clamped to
 * the airframe's limit.
 */
export function pitchFromAccel(accelMs2: number, cfg: DronePhysicsConfig): number {
  const deg = (Math.atan2(accelMs2, G) * 180) / Math.PI;
  return Math.max(-cfg.maxPitchDeg, Math.min(cfg.maxPitchDeg, deg));
}

/**
 * Where the fluid mass would settle for a sustained pitch — the slosh TARGET.
 *
 * SIGN CONVENTION: positive is AFT (toward the tail), negative is FORWARD.
 * Pitching nose-down to accelerate throws the fluid backward, so a positive
 * pitch (nose down, accelerating) gives a positive, aft offset.
 *
 * Scales with fill fraction because an empty tank cannot slosh — there is
 * nothing in it to move.
 */
export function sloshTargetCm(
  pitchDeg: number, fillFraction: number, cfg: DronePhysicsConfig,
): number {
  const fill = Math.max(0, Math.min(1, fillFraction));
  if (fill === 0) return 0;
  const norm = Math.max(-1, Math.min(1, pitchDeg / cfg.maxPitchDeg));
  return norm * fill * cfg.sloshMaxOffsetCm;
}

/**
 * One step of slosh relaxation — a damped approach to the target, not a jump.
 *
 * Liquid has momentum: it does not teleport to its new resting place the
 * instant the aircraft tilts, and it keeps moving briefly after the tilt stops.
 * Exponential smoothing with a fill-scaled time constant captures both cheaply.
 * More liquid means more momentum means slower settling, so tau scales with
 * fill; a nearly empty tank twitches and stops.
 *
 * Deliberately NOT a fluid solver. A solver would be more precise about a thing
 * whose inputs are guessed anyway.
 */
export function stepSlosh(
  prevOffsetCm: number, targetCm: number, fillFraction: number,
  dtS: number, cfg: DronePhysicsConfig,
): number {
  const fill = Math.max(0, Math.min(1, fillFraction));
  if (fill === 0) return 0;                    // nothing left to move
  const tau = Math.max(0.15, cfg.sloshTauFullS * (0.35 + 0.65 * fill));
  const alpha = 1 - Math.exp(-Math.max(0, dtS) / tau);
  return prevOffsetCm + (targetCm - prevOffsetCm) * alpha;
}

/**
 * Static fore/aft offset from partial fill.
 *
 * A tank that is not symmetric about the aircraft's centre moves its own mass
 * centre as it drains, with no acceleration involved. Linear in fill for want
 * of a real tank geometry model — flagged as such.
 */
export function staticFillOffsetCm(fillFraction: number, cfg: DronePhysicsConfig): number {
  const fill = Math.max(0, Math.min(1, fillFraction));
  return (fill - 1) * cfg.staticFillOffsetCm;
}

/** Total fore/aft CoG offset: what the tank geometry does plus what the fluid does. */
export const totalCogOffsetCm = (staticCm: number, sloshCm: number): number => staticCm + sloshCm;

// ---------------------------------------------------------------------------
// 3. Air
// ---------------------------------------------------------------------------

/**
 * Air density from temperature, elevation and humidity.
 *
 * Barometric formula for pressure at altitude, Tetens for saturation vapour
 * pressure, then the ideal gas law over the dry and moist partial pressures.
 * This part is textbook and needs no apology — it is the one place in this file
 * where both the shape AND the constants are right.
 *
 * Humid air is LESS dense than dry air at the same temperature, which surprises
 * people: water vapour (18 g/mol) displaces nitrogen and oxygen (~29 g/mol).
 */
export function airDensity(tempC: number, elevationM: number, relHumidity = 0.5): number {
  const T = tempC + 273.15;
  const pressurePa = 101_325 * Math.pow(1 - 2.25577e-5 * Math.max(0, elevationM), 5.25588);
  const satVapPa = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const vapPa = Math.max(0, Math.min(1, relHumidity)) * satVapPa;
  const dryPa = pressurePa - vapPa;
  return dryPa / (287.058 * T) + vapPa / (461.495 * T);
}

/**
 * Power multiplier for thinner air.
 *
 * Momentum theory: induced hover power goes as T^1.5 / sqrt(2·ρ·A), so at fixed
 * thrust the power required scales with 1/sqrt(ρ). Thin air on a hot day at
 * altitude costs real endurance, which is exactly the condition a spray
 * operator flies in.
 */
export const densityPowerFactor = (rho: number): number => Math.sqrt(RHO_SEA_LEVEL / Math.max(0.3, rho));

// ---------------------------------------------------------------------------
// 4. Wind
// ---------------------------------------------------------------------------

/**
 * Wind resolved along and across a heading, m/s.
 *
 * `windFromDeg` is the meteorological convention — the direction wind blows
 * FROM. Positive `head` is a headwind.
 */
export function windComponents(windMs: number, windFromDeg: number, headingDeg: number) {
  const rel = ((windFromDeg - headingDeg + 540) % 360) - 180;
  const rad = (rel * Math.PI) / 180;
  return { head: windMs * Math.cos(rad), cross: windMs * Math.sin(rad) };
}

/** Sustained wind above this is where spray drift stops being controllable. */
export const DRIFT_CAUTION_MS = 10 * 0.44704;   // 10 mph
export const DRIFT_UNSAFE_MS = 12 * 0.44704;    // 12 mph

export type DriftVerdict = { level: "ok" | "caution" | "unsafe"; message: string };

/**
 * Drift guardrail.
 *
 * The thresholds are the widely-published 10–12 mph advisory band, not a legal
 * limit — labels vary by product and jurisdiction and the label is what
 * actually binds. Advisory, and says so.
 */
export function driftRisk(windMs: number, gustMs?: number): DriftVerdict {
  const gust = gustMs ?? windMs;
  if (windMs >= DRIFT_UNSAFE_MS || gust >= DRIFT_UNSAFE_MS + 2) {
    return { level: "unsafe", message: "Sustained wind is past the 12 mph drift advisory, spray will not stay on target." };
  }
  if (windMs >= DRIFT_CAUTION_MS) {
    return { level: "caution", message: "Wind is in the 10–12 mph drift band. Check the product label before flying." };
  }
  return { level: "ok", message: "Wind is inside the usual drift advisory." };
}

// ---------------------------------------------------------------------------
// 5. Power
// ---------------------------------------------------------------------------

/**
 * Current draw at a given weight, imbalance and air density.
 *
 * Hover power from momentum theory: P = (mg)^1.5 / sqrt(2·ρ·A), divided by a
 * powertrain efficiency to get electrical watts, then over pack voltage for
 * amps. The m^1.5 exponent is why a full tank costs disproportionately more
 * than a half one — and why a linear model understates the start of a mission.
 *
 * The imbalance term is a PROXY, not derived: an off-centre load makes opposing
 * rotors run at different RPM to hold attitude, and the pair does not cancel
 * out in power. Linear in |offset| with a guessed coefficient.
 */
export function computeAmpDraw(
  auwKg: number, cogOffsetCm: number, rho: number, cfg: DronePhysicsConfig,
): number {
  const thrustN = Math.max(1, auwKg) * G;
  const hoverW = Math.pow(thrustN, 1.5) / Math.sqrt(2 * Math.max(0.3, rho) * cfg.rotorDiscAreaM2);
  const electricalW = hoverW / Math.max(0.2, cfg.powertrainEfficiency);
  const baseAmps = electricalW / Math.max(1, cfg.batteryNominalV);
  return baseAmps + cfg.imbalanceAmpPerCm * Math.abs(cogOffsetCm);
}

// ---------------------------------------------------------------------------
// 6. Battery
// ---------------------------------------------------------------------------

/**
 * Usable amp-hours, after reserve and age.
 *
 * TWO SEPARATE HAIRCUTS, deliberately not merged:
 *
 *   - RESERVE is a hard floor. Landing below ~15–20% SOC damages cells, so that
 *     capacity is not available for planning at any price. Sizing a battery
 *     count against nameplate capacity is how an operator ends up walking into
 *     a field to retrieve an aircraft.
 *   - DEGRADATION is what age already took. Internal resistance rises with
 *     cycles and turns stored energy into heat instead of lift.
 *
 * The degradation curve is a linear approximation to a knee-shaped reality —
 * conservative early, optimistic very late. Flagged, not hidden.
 */
export function usableAh(
  cfg: DronePhysicsConfig, cycleCount = 0, reserveFraction = 0.2,
): number {
  const reserve = Math.max(0, Math.min(0.5, reserveFraction));
  const fade = Math.max(0.6, 1 - (Math.max(0, cycleCount) / 1000) * 0.2);
  return cfg.batteryCapacityAh * fade * (1 - reserve);
}

/** Minutes a pack sustains a given draw, given what is actually usable. */
export function enduranceMinutes(usableAmpHours: number, amps: number): number {
  if (!(amps > 0)) return 0;
  return (usableAmpHours / amps) * 60;
}

// ---------------------------------------------------------------------------
// 7. Turnarounds
// ---------------------------------------------------------------------------

export type TurnaroundCost = { seconds: number; ampSeconds: number };

/**
 * What the ends of the rows actually cost.
 *
 * A boustrophedon is not one long line: at the end of every swath the aircraft
 * decelerates from spray speed, pivots 180°, and accelerates back up. Treating
 * turns as free is the single largest structural error in a naive
 * distance-over-speed estimate, and it grows with field narrowness — a field
 * with many short rows is nearly all turning.
 *
 * Decel and accel time come from the aircraft's own limit; the pivot is a
 * configured constant because yaw rate is not in the spec table.
 */
export function turnaroundCost(
  turns: number, speedMs: number, ampsDuringTurn: number, cfg: DronePhysicsConfig,
  decelMs2 = 2.5,
): TurnaroundCost {
  if (turns <= 0 || speedMs <= 0) return { seconds: 0, ampSeconds: 0 };
  const rampS = (speedMs / Math.max(0.5, decelMs2)) * 2;   // decelerate then re-accelerate
  const seconds = turns * (rampS + cfg.turnPivotS);
  // A turn is not cheap in current either: the aircraft is manoeuvring, not
  // cruising. 15% over hover draw is a guess, and labelled one.
  return { seconds, ampSeconds: seconds * ampsDuringTurn * 1.15 };
}

/** Turns implied by covering an area in parallel swaths. */
export function turnCount(treatedAreaM2: number, swathM: number, rowLengthM: number): number {
  if (!(treatedAreaM2 > 0) || !(swathM > 0) || !(rowLengthM > 0)) return 0;
  const rows = Math.ceil(treatedAreaM2 / (swathM * rowLengthM));
  return Math.max(0, rows - 1);
}
