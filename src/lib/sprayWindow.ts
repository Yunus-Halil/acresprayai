// When it is safe to spray, and when it is not.
//
// This was inline in the per-scan Weather tab. It moved here because the
// dashboard has to answer the same question across every field at once, and
// two copies of a spray-safety rule is two copies that drift.
//
// THE LIMITS ARE AGRONOMY, NOT ARITHMETIC. They are conventional
// small-droplet-drift thresholds, not label law: a specific product's label may
// be stricter, and the operator is the one who has to comply with it. They are
// exported and overridable for that reason, and the UI states them rather than
// hiding them behind a green tick.
//
// Reasons come back STRUCTURED, not as finished sentences. The old inline
// version compared in mph and °F and baked those units into its strings, so an
// imperial reading was rounded twice before anyone saw it and a metric operator
// could not be shown metric at all. Comparison happens once, in the units the
// forecast actually carries; formatting happens at the edge, in whichever units
// the operator chose.
import type { WxHour } from "./weather";
import { fmtPrecip, type UnitSystem, fmtTemp, fmtWindSpeed } from "./units";

export type SprayLimits = {
  /** Sustained wind above this is a hard stop, km/h. */
  windMaxKmh: number;
  /** Gusts above this are a hard stop, km/h. */
  gustMaxKmh: number;
  /** Rain in the next 6 hours above this washes the application off, mm. */
  rainNext6hMaxMm: number;
  /** Below this the chemical will not work as labelled, °C. */
  tempMinC: number;
  /** Above this, evaporation and drift risk climb, °C. */
  tempWarnC: number;
  /** Below this wind it is marginal rather than good, km/h. */
  windWarnKmh: number;
  /** Outside this band droplets evaporate or run off, %. */
  humidityMin: number;
  humidityMax: number;
};

/** Conventional defaults, in the units the forecast returns. */
export const DEFAULT_SPRAY_LIMITS: SprayLimits = {
  windMaxKmh: 16,        // ~10 mph
  gustMaxKmh: 24,        // ~15 mph
  rainNext6hMaxMm: 0.5,
  tempMinC: 10,          // 50 °F
  tempWarnC: 29,         // ~85 °F
  windWarnKmh: 13,       // ~8 mph
  humidityMin: 40,
  humidityMax: 70,
};

export type Verdict = "green" | "yellow" | "red";

export type ReasonKind =
  | "wind" | "gust" | "rain" | "cold" | "hot" | "humidity-low" | "humidity-high";

export type Reason = {
  kind: ReasonKind;
  /** "hard" stops the flight; "soft" is a caution. */
  severity: "hard" | "soft";
  /** The measured value, in the model's units: km/h, °C, mm or %. */
  value: number;
  /** The threshold it was compared against, same units. */
  limit: number;
};

/** The minimum an hour needs for a verdict. Keeps the tab's older row type usable. */
export type SprayHour = Pick<
  WxHour, "time" | "temp_c" | "humidity" | "wind_kmh" | "gust_kmh" | "precip_mm"
> & Partial<Pick<WxHour, "wind_dir" | "precip_prob" | "code" | "icon" | "desc" | "clouds">>;

export type VerdictResult = {
  verdict: Verdict;
  /** Worst first. Empty when everything is in range. */
  reasons: Reason[];
  /** The one that actually decided it, for a single-line summary. */
  headline: Reason | null;
};

const KMH_PER_MS = 3.6;

/**
 * Judge one hour.
 *
 * Reasons are ordered so the first is the one that decided the verdict. A row
 * that leads with "humidity a little low" while a 30 km/h gust is the real
 * problem teaches operators to stop reading the list.
 */
export function sprayVerdict(
  h: SprayHour,
  rainNext6hMm: number,
  limits: SprayLimits = DEFAULT_SPRAY_LIMITS,
): VerdictResult {
  const hard: Reason[] = [];
  const soft: Reason[] = [];
  const R = (kind: ReasonKind, severity: "hard" | "soft", value: number, limit: number): Reason =>
    ({ kind, severity, value, limit });

  if (h.wind_kmh > limits.windMaxKmh) hard.push(R("wind", "hard", h.wind_kmh, limits.windMaxKmh));
  if (h.gust_kmh > limits.gustMaxKmh) hard.push(R("gust", "hard", h.gust_kmh, limits.gustMaxKmh));
  if (rainNext6hMm > limits.rainNext6hMaxMm) hard.push(R("rain", "hard", rainNext6hMm, limits.rainNext6hMaxMm));
  if (h.temp_c < limits.tempMinC) hard.push(R("cold", "hard", h.temp_c, limits.tempMinC));

  // Once it is a no, the marginal notes are noise.
  if (!hard.length) {
    if (h.wind_kmh > limits.windWarnKmh) soft.push(R("wind", "soft", h.wind_kmh, limits.windMaxKmh));
    if (h.temp_c > limits.tempWarnC) soft.push(R("hot", "soft", h.temp_c, limits.tempWarnC));
    if (h.humidity < limits.humidityMin) soft.push(R("humidity-low", "soft", h.humidity, limits.humidityMin));
    if (h.humidity > limits.humidityMax) soft.push(R("humidity-high", "soft", h.humidity, limits.humidityMax));
  }

  const reasons = [...hard, ...soft];
  return {
    verdict: hard.length ? "red" : soft.length ? "yellow" : "green",
    reasons,
    headline: reasons[0] ?? null,
  };
}

/** One reason as a sentence, in the operator's units. */
export function formatReason(r: Reason, sys: UnitSystem): string {
  const wind = (v: number) => fmtWindSpeed(v / KMH_PER_MS, sys).text;
  const temp = (v: number) => fmtTemp(v, sys).text;
  switch (r.kind) {
    case "wind":
      return r.severity === "hard"
        ? `Wind ${wind(r.value)}, over the ${wind(r.limit)} limit`
        : `Wind ${wind(r.value)}, close to the ${wind(r.limit)} limit`;
    case "gust":
      return `Gusts ${wind(r.value)}, over the ${wind(r.limit)} limit`;
    case "rain":
      return `${fmtPrecip(r.value, sys).text} of rain due within 6 hours`;
    case "cold":
      return `Too cold at ${temp(r.value)}, minimum ${temp(r.limit)}`;
    case "hot":
      return `Warm at ${temp(r.value)}, evaporation and drift risk`;
    case "humidity-low":
      return `Humidity ${Math.round(r.value)}%, below the ${r.limit}% target`;
    case "humidity-high":
      return `Humidity ${Math.round(r.value)}%, above the ${r.limit}% target`;
  }
}

/** A few words for a badge or a table cell, where a sentence will not fit. */
export function shortReason(r: Reason, sys: UnitSystem): string {
  const wind = (v: number) => fmtWindSpeed(v / KMH_PER_MS, sys).text;
  switch (r.kind) {
    case "wind": return `Wind ${wind(r.value)}`;
    case "gust": return `Gusts ${wind(r.value)}`;
    case "rain": return `Rain ${fmtPrecip(r.value, sys).text}`;
    case "cold": return `Cold ${fmtTemp(r.value, sys).text}`;
    case "hot": return `Warm ${fmtTemp(r.value, sys).text}`;
    case "humidity-low": return `Dry air ${Math.round(r.value)}%`;
    case "humidity-high": return `Damp air ${Math.round(r.value)}%`;
  }
}

/** Rain expected in the `hours` after index `i`. */
export function rainAhead(hourly: SprayHour[], i: number, hours = 6): number {
  return hourly.slice(i, i + hours).reduce((a, h) => a + (h.precip_mm || 0), 0);
}

export type SprayWindow = {
  startTs: number;
  endTs: number;
  /** Whole hours in the window. */
  hours: number;
  /** True when the window has already begun. */
  active: boolean;
};

/**
 * Runs of consecutive sprayable hours.
 *
 * `minHours` defaults to 2 because a one-hour window is not a window: by the
 * time the tank is mixed and the aircraft is in the air it has closed. That is
 * the difference between a forecast and a plan.
 */
export function findSprayWindows(
  hourly: SprayHour[],
  opts: { minHours?: number; horizon?: number; limits?: SprayLimits; now?: number } = {},
): SprayWindow[] {
  const minHours = opts.minHours ?? 2;
  const horizon = Math.min(opts.horizon ?? 72, hourly.length);
  const nowSec = (opts.now ?? Date.now()) / 1000;
  const out: SprayWindow[] = [];
  let start = -1;

  for (let i = 0; i < horizon; i++) {
    const ok = sprayVerdict(hourly[i], rainAhead(hourly, i), opts.limits).verdict === "green";
    if (ok && start < 0) start = i;
    const last = i === horizon - 1;
    if ((!ok || last) && start >= 0) {
      const end = ok && last ? i : i - 1;
      const hours = end - start + 1;
      if (hours >= minHours) {
        out.push({
          startTs: hourly[start].time,
          endTs: hourly[end].time,
          hours,
          active: hourly[start].time <= nowSec && hourly[end].time >= nowSec,
        });
      }
      start = -1;
    }
  }
  return out;
}

/**
 * The verdict for a specific moment, or null when the forecast does not reach
 * it.
 *
 * Null rather than a guess. A mission ten days out cannot be checked, and
 * saying so is the only honest answer; judging it against the nearest available
 * hour would put a green tick on a day nobody has a forecast for.
 */
export function verdictAtTime(
  hourly: SprayHour[],
  whenMs: number,
  limits: SprayLimits = DEFAULT_SPRAY_LIMITS,
): VerdictResult | null {
  const whenSec = whenMs / 1000;
  const HALF_HOUR = 1800;
  const i = hourly.findIndex(h => Math.abs(h.time - whenSec) <= HALF_HOUR);
  if (i < 0) return null;
  return sprayVerdict(hourly[i], rainAhead(hourly, i), limits);
}

/** Rank for sorting: sprayable first, then marginal, then not. */
export const verdictRank = (v: Verdict): number =>
  v === "green" ? 0 : v === "yellow" ? 1 : 2;

export const VERDICT_LABEL: Record<Verdict, string> = {
  green: "Go",
  yellow: "Marginal",
  red: "No go",
};
