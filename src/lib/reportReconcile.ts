// The report argues with itself before it argues with anyone else.
//
// A real generated report once claimed "91% less chemical, 2.5 gal planned"
// while its own application record showed 10.6 gal applied — four times the
// plan — at a computed rate 5.5× the stated baseline, with two different
// treated acreages on two pages and 97 °F / 11 mph printed without comment.
// Every one of those was checkable from data already on the page.
//
// This module is the check: every derived figure compared against every other
// BEFORE the document renders. Findings never block generation and never
// silently pick a winner between two conflicting numbers — they surface, in
// plain language, in the body. A report read by someone who did not fly the
// mission must carry its own doubts with it.
//
// Thresholds are tunable starting points, not agronomy. Condition limits in
// particular are NOT label compliance — labels vary by product and this
// system does not know the label; it flags and the applicator decides.
import { AC_PER_HA } from "./units";

/** ±20% between applied and planned volume before the variance is surfaced. */
export const VOLUME_PLAN_TOLERANCE = 0.2;
/** Computed rate at or beyond this multiple of the baseline gets flagged. */
export const RATE_BASELINE_RATIO = 2;
/** Marked vs logged treated area divergence tolerated at full completion. */
export const AREA_TOLERANCE = 0.15;
/** Typical drift threshold; verify against the product label. */
export const WIND_LIMIT_MPH = 10;
/** Typical volatility/efficacy threshold; verify against the product label. */
export const TEMP_LIMIT_F = 85;

export type Reconciliation = {
  kind:
    | "volume-vs-plan"
    | "rate-vs-baseline"
    | "area-mismatch"
    | "zones-vs-area"
    | "time-order"
    | "conditions";
  message: string;
};

const pct = (ratio: number) => `${Math.round(Math.abs(ratio - 1) * 100)}%`;

// ---------------------------------------------------------------------------
// Individual rules — exported so the Log Flight dialog can warn AT ENTRY with
// exactly the wording the report will later print. One rule, two moments.
// ---------------------------------------------------------------------------

/** Applied vs planned volume, both in litres. `fmt` renders a display string. */
export function volumeVsPlanNote(
  appliedL: number | null,
  plannedL: number | null,
  fmt: (l: number) => string,
): string | null {
  if (appliedL == null || plannedL == null || plannedL <= 0 || appliedL < 0) return null;
  const ratio = appliedL / plannedL;
  if (Math.abs(ratio - 1) <= VOLUME_PLAN_TOLERANCE) return null;
  return ratio > 1
    ? `The logged volume (${fmt(appliedL)}) is ${pct(ratio)} ABOVE the planned ${fmt(plannedL)} — ` +
      `${ratio.toFixed(1)}× plan. Check the volume entry and the plan before relying on either.`
    : `The logged volume (${fmt(appliedL)}) is ${pct(ratio)} below the planned ${fmt(plannedL)}. ` +
      `If the mission was cut short, the zone completion list should say so.`;
}

/** Computed application rate vs the configured baseline, mixed units resolved here. */
export function rateVsBaselineNote(
  computedRateLPerAc: number | null,
  baselineLha: number,
  fmtRatePerAc: (lPerAc: number) => string,
): string | null {
  if (computedRateLPerAc == null || baselineLha <= 0) return null;
  const baselineLPerAc = baselineLha / AC_PER_HA;
  if (baselineLPerAc <= 0) return null;
  const ratio = computedRateLPerAc / baselineLPerAc;
  if (ratio < RATE_BASELINE_RATIO) return null;
  return `The computed application rate (${fmtRatePerAc(computedRateLPerAc)}) is ` +
    `${ratio.toFixed(1)}× the configured baseline (${fmtRatePerAc(baselineLPerAc)}). ` +
    `Either the logged volume or the treated area is off, or this was a deliberate ` +
    `over-application — verify before this record is relied on.`;
}

/**
 * Marked (grid) vs logged treated area. Two legitimate, DIFFERENT measures —
 * marked is the grid's clipped cell area, treated is what the pilot logged —
 * but with every zone flown they should be close.
 */
export function areaMismatchNote(
  markedAcres: number | null,
  loggedTreatedAcres: number | null,
  zonesFlown: number,
  zonesTotal: number,
  fmtAc: (ac: number) => string,
): string | null {
  if (markedAcres == null || loggedTreatedAcres == null) return null;
  if (zonesTotal === 0 || zonesFlown !== zonesTotal || markedAcres <= 0) return null;
  const ratio = loggedTreatedAcres / markedAcres;
  if (Math.abs(ratio - 1) <= AREA_TOLERANCE) return null;
  return `All ${zonesTotal} zones are logged as flown, yet the logged treated area ` +
    `(${fmtAc(loggedTreatedAcres)}) differs from the marked-for-treatment area ` +
    `(${fmtAc(markedAcres)}) by ${pct(ratio)}. These are different measurements — marked is ` +
    `the grid's cell arithmetic, treated is what was logged after flying — and they are ` +
    `never interchanged in this document's calculations, but at full completion they ` +
    `should agree. Verify the flight log.`;
}

/** Zones flown and treated area must at least agree about zero. */
export function zonesVsAreaNote(
  loggedTreatedAcres: number | null,
  zonesFlown: number,
  fmtAc: (ac: number) => string,
): string | null {
  if (loggedTreatedAcres == null) return null;
  if (zonesFlown === 0 && loggedTreatedAcres > 0) {
    return `A treated area of ${fmtAc(loggedTreatedAcres)} is logged, but no zone is marked ` +
      `flown. One of the two is wrong.`;
  }
  if (zonesFlown > 0 && loggedTreatedAcres === 0) {
    return `${zonesFlown} zone${zonesFlown === 1 ? "" : "s"} are logged as flown, but the ` +
      `treated area is zero. One of the two is wrong.`;
  }
  return null;
}

/** "HH:MM" pair, same day. */
export function endBeforeStartNote(
  startTime: string | null,
  endTime: string | null,
): string | null {
  if (!startTime || !endTime) return null;
  if (endTime > startTime) return null;
  if (endTime === startTime) {
    return "Application start and end times are identical — a zero-minute application.";
  }
  return `The application end time (${endTime}) is before its start time (${startTime}).`;
}

/** Logged volume vs what the tank could physically hold across the fills. */
export function overTankCapacityNote(
  appliedL: number | null,
  perFillL: number | null,
  refills: number,
  fmt: (l: number) => string,
): string | null {
  if (appliedL == null || perFillL == null || perFillL <= 0) return null;
  const maxL = perFillL * (refills + 1);
  if (appliedL <= maxL * 1.02) return null; // rounding headroom, not tolerance
  return `The logged volume (${fmt(appliedL)}) exceeds what ${refills + 1} tank ` +
    `load${refills === 0 ? "" : "s"} at the configured fill can hold (${fmt(maxL)}).`;
}

/**
 * Conditions outside typical application limits. A FLAG, never a judgment:
 * label limits vary by product and this system does not know the label.
 */
export function conditionFlags(
  windMph: number | null,
  tempF: number | null,
): string[] {
  const flags: string[] = [];
  if (windMph != null && windMph > WIND_LIMIT_MPH) {
    flags.push(
      `Wind ${windMph} mph — outside typical application conditions ` +
      `(above ${WIND_LIMIT_MPH} mph). Verify against the product label.`,
    );
  }
  if (tempF != null && tempF > TEMP_LIMIT_F) {
    flags.push(
      `Temperature ${tempF} °F — outside typical application conditions ` +
      `(above ${TEMP_LIMIT_F} °F). Verify against the product label.`,
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
// The full pass the report runs before rendering
// ---------------------------------------------------------------------------

export function reconcileReport(input: {
  plannedL: number | null;
  appliedL: number | null;
  baselineLha: number;
  computedRateLPerAc: number | null;
  markedAcres: number | null;
  loggedTreatedAcres: number | null;
  zonesFlown: number;
  zonesTotal: number;
  windMph: number | null;
  tempF: number | null;
  startTime: string | null;
  endTime: string | null;
  fmtVolume: (l: number) => string;
  fmtAcres: (ac: number) => string;
  fmtRatePerAc: (lPerAc: number) => string;
}): Reconciliation[] {
  const out: Reconciliation[] = [];
  const push = (kind: Reconciliation["kind"], message: string | null) => {
    if (message) out.push({ kind, message });
  };

  push("volume-vs-plan", volumeVsPlanNote(input.appliedL, input.plannedL, input.fmtVolume));
  push("rate-vs-baseline",
    rateVsBaselineNote(input.computedRateLPerAc, input.baselineLha, input.fmtRatePerAc));
  push("area-mismatch", areaMismatchNote(
    input.markedAcres, input.loggedTreatedAcres,
    input.zonesFlown, input.zonesTotal, input.fmtAcres,
  ));
  push("zones-vs-area",
    zonesVsAreaNote(input.loggedTreatedAcres, input.zonesFlown, input.fmtAcres));
  push("time-order", endBeforeStartNote(input.startTime, input.endTime));
  for (const f of conditionFlags(input.windMph, input.tempF)) push("conditions", f);

  return out;
}
