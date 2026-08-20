// The numbers a mission is judged by — batteries, flight time, chemical, and
// the conditions it would fly in.
//
// ONE CALCULATION PATH. This model used to live inline inside PlannerTab. It
// now lives here because the schedule needs the same numbers: the planner shows
// them live while you set up, and the calendar stores a snapshot of them at the
// moment you press Save. Two copies of an endurance model is two copies that
// drift, and the way you find out is a pilot packing three batteries for a job
// the calendar promised needed two.
//
// SNAPSHOT, NOT REFERENCE. `computeMissionStats` is pure. What the scheduler
// persists is its OUTPUT, not its inputs — so a calendar entry keeps saying
// what was true when it was scheduled even after the field boundary is redrawn
// or the drone's battery is swapped out.
import type { DroneSpec } from "./droneSpecs";
import type { Mission } from "./mission";
import type { Forecast } from "./weather";
import { M2_PER_HECTARE } from "./units";
import {
  type DronePhysicsConfig, type DriftVerdict,
  airDensity, allUpWeightKg, computeAmpDraw, driftRisk, enduranceMinutes,
  pitchFromAccel, remainingLitres, sloshTargetCm, staticFillOffsetCm, stepSlosh,
  totalCogOffsetCm, turnCount, turnaroundCost, usableAh, windComponents,
} from "./dronePhysics";

/**
 * Weather reduced to what the endurance model actually consumes.
 *
 * Deliberately not the full forecast: the model needs three numbers, and
 * passing the whole object invites someone to reach for a fourth without
 * thinking about whether it is available at scheduling time.
 */
export type MissionWx = {
  wind_ms: number;
  /** Meteorological "from" bearing, degrees. */
  wind_dir: number;
  temp_c: number;
};

export type FlightConditions = {
  /** Human summary, e.g. "12 mph wind, 68°F, clear". */
  summary: string;
  /**
   * False when no forecast covered the scheduled moment. The UI must say so
   * rather than showing a number that was really about a different day —
   * a fabricated condition is worse than an absent one, because a pilot can
   * act on it.
   */
  available: boolean;
  /** What the summary was actually derived from. */
  basis: "forecast" | "current" | "none";
  wind_ms: number | null;
  temp_c: number | null;
};

export type MissionStats = {
  batteriesNeeded: number;
  flightTimeMinutes: number;
  pesticideAmountLiters: number;
  flightConditions: FlightConditions;
  /** Marked-zone area the chemical figure was computed over. */
  treatedAreaHa: number;
  /** Present only when physics inputs were supplied. */
  physics?: MissionPhysicsBreakdown;
  /** Diagnostic breakdown — shown live in the planner, not persisted. */
  derating: {
    baseFlightMin: number;
    windFactor: number;
    windKind: "headwind" | "crosswind" | "tailwind" | "calm";
    altitudeFactor: number;
    payloadFactor: number;
    tempFactor: number;
    batteryPercent: number;
    avgAltM: number;
    cruiseMs: number;
    recommendedTankL: number;
  };
};

/**
 * Optional physics inputs.
 *
 * Absent, computeMissionStats keeps its original behaviour — a flat
 * time-over-endurance estimate. Present, it integrates mass decay, slosh,
 * turnarounds, air density and a battery reserve over the mission.
 *
 * Optional on purpose: the simple path is still the honest answer when nobody
 * has told us the elevation or the pack's age, and inventing those to reach a
 * more impressive-looking number would be the opposite of accuracy.
 */
export type MissionPhysicsInput = {
  config: DronePhysicsConfig;
  /** Field elevation, m. Density altitude is real and this is how it gets in. */
  elevationM?: number;
  relHumidity?: number;
  /** Swath width and typical row length — what the turnaround count comes from. */
  swathM?: number;
  rowLengthM?: number;
  /** Pump rate. Drives tank drain when known; falls back to even drain. */
  flowLpm?: number;
  /** Litres actually loaded, which is not always a full tank. */
  startLitres?: number;
  batteryCycleCount?: number;
  /** Fraction of pack held back. 0.2 = land at 20%. */
  reserveFraction?: number;
  /** Dominant heading of the spray rows, degrees from north. */
  headingDeg?: number;
  gustMs?: number;
};

export type MissionPhysicsBreakdown = {
  auwStartKg: number;
  auwEndKg: number;
  /** Mean and worst current draw across the integrated mission. */
  meanAmps: number;
  peakAmps: number;
  /** Widest fore/aft CoG excursion seen, cm. Positive is aft. */
  peakCogOffsetCm: number;
  airDensityKgM3: number;
  /** Seconds spent decelerating, pivoting and re-accelerating at row ends. */
  turnaroundSeconds: number;
  turnCount: number;
  usableAh: number;
  reserveFraction: number;
  headwindMs: number;
  crosswindMs: number;
  drift: DriftVerdict;
  /** How far the estimate can be trusted. Never "high" — see dronePhysics.ts. */
  confidence: "structured-estimate";
};

export type MissionStatsInput = {
  mission: Mission | null;
  spec: DroneSpec;
  /** Altitudes the plan flies at, metres AGL. */
  sprayAltM: number;
  transitAltM: number;
  /** Tank fill for this run, 0–100. */
  tankLoadPct: number;
  /** Marked treatment zones: area and the rate each is to be treated at. */
  zones: { areaM2: number; rateLha: number }[];
  wx: MissionWx | null;
  physics?: MissionPhysicsInput;
};

/**
 * A battery is not run to zero.
 *
 * 80% is the usable fraction before a pack is swapped — landing on the reserve
 * is how a drone ends up in a ditch. Named rather than inlined so it is visible
 * that the number is a policy choice and not arithmetic.
 */
export const USABLE_BATTERY_PCT = 80;

/**
 * Bearing of the dominant spray axis, 0–180°, or null if the mission has no
 * spray leg to take it from.
 */
function passBearingOf(mission: Mission): number | null {
  const first = mission.spraySegments?.[0];
  if (!first || first.length < 2) return null;
  const a = first[0], b = first[first.length - 1];
  const dy = b.lat - a.lat;
  const dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  let deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg % 180;
}

/**
 * Chemical volume for the marked zones.
 *
 * Per zone rather than one blended rate, because the whole point of marking
 * zones separately is that they can be treated differently. Area is the zone's
 * own measured area, so a partial zone bills what it covers.
 */
export function pesticideLitres(zones: { areaM2: number; rateLha: number }[]): number {
  let litres = 0;
  for (const z of zones) {
    if (!(z.areaM2 > 0) || !(z.rateLha > 0)) continue;
    litres += (z.areaM2 / M2_PER_HECTARE) * z.rateLha;
  }
  return litres;
}

/**
 * Conditions for a specific moment, from a forecast that may not reach it.
 *
 * UNITS. Every `time` in a Forecast is UNIX SECONDS, not milliseconds — the
 * weather edge function divides by 1000 on the way out, and every other
 * consumer multiplies by 1000 on the way in. Comparing them directly against
 * `Date.getTime()` silently matches nothing, so every lookup falls through to
 * "current" and the UI reports the forecast as unavailable while cheerfully
 * displaying real wind and temperature. That is exactly the bug this comment
 * exists to stop happening twice.
 *
 * COVERAGE. The function requests `forecast_days=7` and keeps 48 hourly
 * entries. So: hourly resolution for two days, daily for a week, nothing
 * beyond. A mission past that gets `available: false` and current conditions
 * clearly labelled — rather than the last day in the array standing in for a
 * date it does not describe.
 */
export function conditionsAt(
  forecast: Forecast | null,
  scheduledAt: Date | number,
  fmt: { windText: (ms: number) => string; tempText: (c: number) => string },
): FlightConditions {
  const at = typeof scheduledAt === "number" ? scheduledAt : scheduledAt.getTime();
  if (!forecast?.current) {
    return { summary: "No weather data for this location", available: false, basis: "none", wind_ms: null, temp_c: null };
  }

  const MS = 1000;
  const HALF_HOUR = 30 * 60 * MS;

  // Hourly is the right resolution for a spray window.
  const hour = forecast.hourly?.find(h => Math.abs(h.time * MS - at) <= HALF_HOUR);
  if (hour) {
    const ms = (hour.wind_kmh ?? 0) / 3.6;
    return {
      summary: `${fmt.windText(ms)} wind, ${fmt.tempText(hour.temp_c)}, ${hour.desc}`,
      available: true, basis: "forecast", wind_ms: ms, temp_c: hour.temp_c,
    };
  }

  // Then the day. Matched on calendar DATE rather than a hours-apart window:
  // a daily entry is stamped at midnight, so "within 12 hours" mis-buckets an
  // evening mission into the following day.
  const wanted = localDate(at);
  const day = forecast.daily?.find(d => utcDate(d.time * MS) === wanted);
  if (day) {
    const ms = (day.wind_kmh ?? 0) / 3.6;
    const mid = (day.tmin_c + day.tmax_c) / 2;
    return {
      summary: `${fmt.windText(ms)} wind, ${fmt.tempText(mid)}, ${day.desc}`,
      available: true, basis: "forecast", wind_ms: ms, temp_c: mid,
    };
  }

  const cur = forecast.current;
  const ms = (cur.wind_kmh ?? 0) / 3.6;
  const past = at < Date.now();
  return {
    summary: past
      ? `That date is in the past — showing current conditions: ${fmt.windText(ms)} wind, ${fmt.tempText(cur.temp_c)}, ${cur.desc}`
      : `Beyond the 7-day forecast — showing current conditions: ${fmt.windText(ms)} wind, ${fmt.tempText(cur.temp_c)}, ${cur.desc}`,
    available: false, basis: "current", wind_ms: ms, temp_c: cur.temp_c,
  };
}

/** Local calendar date of a timestamp, YYYY-MM-DD — the day the operator picked. */
function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Calendar date a daily forecast entry stands for.
 *
 * Open-Meteo returns daily stamps as bare "YYYY-MM-DD", which the edge function
 * parses as UTC midnight — so reading it back in UTC recovers the date that was
 * meant, whatever the viewer's zone.
 */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Step the mission forward, carrying mass, slosh and current draw.
 *
 * WHY INTEGRATE RATHER THAN MULTIPLY. A single amp figure taken at takeoff is
 * wrong in a specific direction: the aircraft is at its heaviest exactly once,
 * for the first row, and hover power goes as mass^1.5. Multiplying that
 * worst-case draw across the whole mission overstates consumption badly on a
 * long job, while using an average understates the first-pack risk. Stepping it
 * gets both — and it is the only way the battery COUNT lands right, because
 * that depends on when the first pack actually runs out, not on an average.
 *
 * Fixed 240 steps: enough that mass decay resolves smoothly, few enough that
 * this stays microseconds of work on the main thread. There is no case here for
 * a Web Worker — the array is smaller than a single frame's layout.
 */
function integrate(
  input: MissionStatsInput, phys: MissionPhysicsInput, totalTimeS: number, sprayTimeS: number,
): MissionPhysicsBreakdown & { flightTimeMinutes: number; batteriesNeeded: number } {
  const cfg = phys.config;
  const STEPS = 240;

  const rho = airDensity(
    input.wx?.temp_c ?? 20,
    phys.elevationM ?? 0,
    phys.relHumidity ?? 0.5,
  );

  const startLitres = Math.max(0, Math.min(cfg.tankCapacityL,
    phys.startLitres ?? cfg.tankCapacityL * (input.tankLoadPct / 100)));

  // Flow rate: measured if given, otherwise whatever empties the load over the
  // spray time. The fallback is honest — it drains evenly rather than pretending
  // to know a pump curve.
  const flowLpm = phys.flowLpm && phys.flowLpm > 0
    ? phys.flowLpm
    : (sprayTimeS > 0 ? (startLitres / (sprayTimeS / 60)) : 0);

  const treatedAreaM2 = input.zones.reduce((a, z) => a + Math.max(0, z.areaM2), 0);
  const turns = turnCount(treatedAreaM2, phys.swathM ?? 0, phys.rowLengthM ?? 0);

  const wind = input.wx
    ? windComponents(input.wx.wind_ms, input.wx.wind_dir, phys.headingDeg ?? 0)
    : { head: 0, cross: 0 };

  const dt = totalTimeS / STEPS;
  const sprayFraction = totalTimeS > 0 ? sprayTimeS / totalTimeS : 0;

  let slosh = 0;
  let ampSeconds = 0;
  let peakAmps = 0;
  let peakCog = 0;
  let sprayedS = 0;
  let litres = startLitres;

  for (let i = 0; i < STEPS; i++) {
    const spraying = (i / STEPS) < sprayFraction;
    if (spraying) sprayedS += dt;
    litres = remainingLitres(startLitres, sprayedS, flowLpm);

    const fill = cfg.tankCapacityL > 0 ? litres / cfg.tankCapacityL : 0;
    const auw = allUpWeightKg(cfg, litres);

    // Acceleration is not modelled per-segment here, so slosh is driven by the
    // headwind the aircraft is pushing into — a steady load that tilts it the
    // same way a steady acceleration would. Transient accel/decel spikes come
    // from the live simulator, which has real per-segment speeds.
    const pitch = pitchFromAccel(wind.head * 0.15, cfg);
    slosh = stepSlosh(slosh, sloshTargetCm(pitch, fill, cfg), fill, dt, cfg);
    const cog = totalCogOffsetCm(staticFillOffsetCm(fill, cfg), slosh);

    const amps = computeAmpDraw(auw, cog, rho, cfg);
    ampSeconds += amps * dt;
    if (amps > peakAmps) peakAmps = amps;
    if (Math.abs(cog) > Math.abs(peakCog)) peakCog = cog;
  }

  const meanAmps = totalTimeS > 0 ? ampSeconds / totalTimeS : 0;
  const turn = turnaroundCost(turns, input.mission ? 6 : 0, meanAmps, cfg);

  const flightTimeMinutes = (totalTimeS + turn.seconds) / 60;
  const reserveFraction = phys.reserveFraction ?? 0.2;
  const usable = usableAh(cfg, phys.batteryCycleCount ?? 0, reserveFraction);

  // Batteries are sized on usable amp-hours actually consumed, reserve already
  // removed — not on nameplate, and not on a percentage of a flight-time spec.
  const consumedAh = (ampSeconds + turn.ampSeconds) / 3600;
  const batteriesNeeded = usable > 0 ? Math.max(1, Math.ceil(consumedAh / usable)) : 1;

  return {
    auwStartKg: allUpWeightKg(cfg, startLitres),
    auwEndKg: allUpWeightKg(cfg, litres),
    meanAmps, peakAmps, peakCogOffsetCm: peakCog,
    airDensityKgM3: rho,
    turnaroundSeconds: turn.seconds,
    turnCount: turns,
    usableAh: usable,
    reserveFraction,
    headwindMs: wind.head,
    crosswindMs: wind.cross,
    drift: driftRisk(input.wx?.wind_ms ?? 0, phys.gustMs),
    confidence: "structured-estimate",
    flightTimeMinutes,
    batteriesNeeded,
  };
}

/**
 * Everything a scheduled mission needs to know about itself.
 *
 * Pure: same inputs, same numbers, no clock and no storage. That is what lets
 * the planner and the calendar agree.
 */
export function computeMissionStats(input: MissionStatsInput): MissionStats {
  const { mission, spec, sprayAltM, transitAltM, tankLoadPct, zones, wx } = input;

  const treatedAreaM2 = zones.reduce((s, z) => s + (z.areaM2 > 0 ? z.areaM2 : 0), 0);
  const pesticideAmountLiters = pesticideLitres(zones);
  const emptyConditions: FlightConditions = {
    summary: "No weather data for this location", available: false, basis: "none",
    wind_ms: null, temp_c: null,
  };

  const totalDistM = (mission?.sprayDistM ?? 0) + (mission?.transitDistM ?? 0);
  const totalTimeS = (mission?.sprayTimeS ?? 0) + (mission?.transitTimeS ?? 0);

  if (!mission || totalDistM < 1 || totalTimeS < 1) {
    // No flyable route: the chemical figure still stands, because it comes from
    // the marked ground rather than from the plan.
    return {
      batteriesNeeded: 0,
      flightTimeMinutes: 0,
      pesticideAmountLiters,
      treatedAreaHa: treatedAreaM2 / M2_PER_HECTARE,
      flightConditions: emptyConditions,
      derating: {
        baseFlightMin: 0, windFactor: 1, windKind: "calm", altitudeFactor: 1,
        payloadFactor: 1, tempFactor: 1, batteryPercent: 0, avgAltM: 0,
        cruiseMs: 0, recommendedTankL: 0,
      },
    };
  }

  const cruiseMs = totalDistM / totalTimeS;
  const baseFlightMin = totalTimeS / 60;

  // Wind. Only the component ALONG the pass axis really costs endurance: a
  // boustrophedon flies each row in alternating directions, so head- and
  // tailwind on successive rows partly wash out, while the cross component
  // never helps. Full penalty when aligned, half on cross.
  let windFactor = 1;
  let windKind: MissionStats["derating"]["windKind"] = "calm";
  if (wx && wx.wind_ms > 0.3) {
    const bearing = passBearingOf(mission);
    const windTo = (wx.wind_dir + 180) % 360;
    const rel = bearing != null ? Math.abs(((windTo - bearing + 540) % 360) - 180) : 90;
    const alignment = Math.abs(Math.cos((rel * Math.PI) / 180));
    windFactor = 1 + wx.wind_ms * 0.02 * (0.5 + 0.5 * alignment);
    windKind = alignment > 0.7 ? "headwind" : alignment > 0.3 ? "crosswind" : "tailwind";
  }

  const avgAltM = (sprayAltM * mission.sprayTimeS + transitAltM * mission.transitTimeS) / totalTimeS;
  const altitudeFactor = 1 + avgAltM * 0.001;

  const tankLoad = Math.max(0, Math.min(100, tankLoadPct)) / 100;
  const payloadFactor = 1 + tankLoad * 0.15;

  const tempC = wx?.temp_c ?? 20;
  const tempFactor = tempC < 15 ? 1 + (15 - tempC) * 0.01 : 1.0;

  const flightTimeMinutes = baseFlightMin * windFactor * altitudeFactor * payloadFactor * tempFactor;
  const batteryPercent = (flightTimeMinutes / Math.max(1, spec.max_flight_min)) * 100;
  const batteriesNeeded = Math.max(1, Math.ceil(batteryPercent / USABLE_BATTERY_PCT));

  // With physics inputs, the integrated model supersedes the flat estimate for
  // flight time and battery count. Without them the flat estimate stands — it is
  // the honest answer when nobody has said what the elevation or pack age is.
  const integrated = input.physics
    ? integrate(input, input.physics, totalTimeS, mission.sprayTimeS)
    : null;

  return {
    batteriesNeeded: integrated?.batteriesNeeded ?? batteriesNeeded,
    flightTimeMinutes: integrated?.flightTimeMinutes ?? flightTimeMinutes,
    pesticideAmountLiters,
    treatedAreaHa: treatedAreaM2 / M2_PER_HECTARE,
    flightConditions: emptyConditions,   // filled by the caller, which has the forecast
    physics: integrated ?? undefined,
    derating: {
      baseFlightMin, windFactor, windKind, altitudeFactor, payloadFactor,
      tempFactor, batteryPercent, avgAltM, cruiseMs,
      recommendedTankL: spec.tank_l > 0 ? +(spec.tank_l * tankLoad).toFixed(1) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Refills
// ---------------------------------------------------------------------------

export type RefillPlan = {
  /** Chemical the marked zones need, litres. */
  requiredLitres: number;
  /** Usable litres per load at the configured fill. */
  perLoadLitres: number;
  /** Tank loads the job needs, including the first. */
  loads: number;
  /** Trips back to the nurse tank. `loads - 1`. */
  refills: number;
  /**
   * Fraction of SPRAYED distance at which each load runs dry, ascending.
   * Empty when one load covers the job. Fractions of sprayed distance rather
   * than of total, because the tank only empties while the boom is on.
   */
  dryFractions: number[];
  /** Litres left in the last load when the job finishes. */
  leftoverLitres: number;
};

/**
 * How many times the aircraft has to come back and refill.
 *
 * WHY THIS EXISTS. The simulator drained a tank linearly across the whole
 * mission and therefore always landed on empty exactly as the job finished —
 * which made every plan look like one tankful, whatever the chemistry said.
 * A pilot flying that plan runs dry mid-pass and sprays air over ground the
 * map is calling treated, and nothing warned them. Refills are not a nicety
 * here; an unnoticed empty tank is untreated crop that everyone believes was
 * treated.
 *
 * Pure, and deliberately independent of the flight profile: what empties a
 * tank is litres over ground, not minutes in the air.
 */
export function planRefills(
  requiredLitres: number, tankCapacityL: number, tankLoadPct: number,
): RefillPlan {
  const perLoadLitres = Math.max(0, tankCapacityL) * Math.max(0, Math.min(100, tankLoadPct)) / 100;
  const required = Math.max(0, requiredLitres);

  if (!(perLoadLitres > 0) || required <= 0) {
    return {
      requiredLitres: required, perLoadLitres, loads: required > 0 ? 0 : 1,
      refills: 0, dryFractions: [], leftoverLitres: perLoadLitres,
    };
  }

  const loads = Math.max(1, Math.ceil(required / perLoadLitres));
  const dryFractions: number[] = [];
  // Each load runs dry after it has laid down its own volume. Spray volume is
  // proportional to sprayed distance at a constant rate, so the fraction of
  // sprayed distance is the fraction of total volume.
  for (let i = 1; i < loads; i++) {
    dryFractions.push((perLoadLitres * i) / required);
  }
  return {
    requiredLitres: required,
    perLoadLitres,
    loads,
    refills: loads - 1,
    dryFractions,
    leftoverLitres: perLoadLitres * loads - required,
  };
}
