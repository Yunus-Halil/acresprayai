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
 * Open-Meteo returns a bounded window — typically about a fortnight of daily
 * entries and a few days of hourly. A mission scheduled past the end of it gets
 * `available: false` and the CURRENT conditions clearly labelled as such,
 * rather than the last day in the array silently standing in for a date three
 * weeks out.
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

  // Hourly is the right resolution for a spray window; fall back to the day.
  const HOUR = 3_600_000;
  const hour = forecast.hourly?.find(h => Math.abs(h.time - at) <= HOUR / 2);
  if (hour) {
    const ms = (hour.wind_kmh ?? 0) / 3.6;
    return {
      summary: `${fmt.windText(ms)} wind, ${fmt.tempText(hour.temp_c)}, ${hour.desc}`,
      available: true, basis: "forecast", wind_ms: ms, temp_c: hour.temp_c,
    };
  }

  const DAY = 86_400_000;
  const day = forecast.daily?.find(d => Math.abs(d.time - at) < DAY / 2);
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
  return {
    summary: `Forecast unavailable for this date — currently ${fmt.windText(ms)} wind, ${fmt.tempText(cur.temp_c)}, ${cur.desc}`,
    available: false, basis: "current", wind_ms: ms, temp_c: cur.temp_c,
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

  return {
    batteriesNeeded,
    flightTimeMinutes,
    pesticideAmountLiters,
    treatedAreaHa: treatedAreaM2 / M2_PER_HECTARE,
    flightConditions: emptyConditions,   // filled by the caller, which has the forecast
    derating: {
      baseFlightMin, windFactor, windKind, altitudeFactor, payloadFactor,
      tempFactor, batteryPercent, avgAltM, cruiseMs,
      recommendedTankL: spec.tank_l > 0 ? +(spec.tank_l * tankLoad).toFixed(1) : 0,
    },
  };
}
