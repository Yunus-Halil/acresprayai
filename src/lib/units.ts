// Display units. One place that knows acres from hectares.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: everything is STORED in SI — square
// metres, litres, metres, metres per second, celsius, kilograms, litres per
// hectare — and converted only on the way to a screen. Nothing here writes
// anything back.
//
// That is not a stylistic preference. A stored number whose unit depends on a
// display setting is a number that silently means something different after
// somebody flips a toggle, and in this app the numbers are chemical doses and
// costs. The one setting that DOES relabel rather than convert is currency, and
// it is documented as such in farmerSettings.ts precisely because it is the
// exception.
//
// INPUT COSTS are the subtle case. The farmer types a per-ACRE price and that
// is what is stored, whatever system they are viewing in. A metric viewer sees
// the same money expressed per hectare — 2.47x the number, the identical cost
// for the identical ground. Flipping the toggle can never change what a
// treatment costs.

export type UnitSystem = "metric" | "imperial";

// --- exact conversion factors ----------------------------------------------
export const M2_PER_HECTARE = 10_000;
export const M2_PER_ACRE = 4046.8564224;          // international acre, exact
export const AC_PER_HA = M2_PER_HECTARE / M2_PER_ACRE;   // 2.471053814...
export const L_PER_US_GAL = 3.785411784;          // exact
export const M_PER_FT = 0.3048;                   // exact
export const M_PER_MILE = 1609.344;               // exact
export const KG_PER_LB = 0.45359237;              // exact

/** A quantity ready to render: the number, its unit, and the two joined. */
export type Measure = { value: number; unit: string; text: string };

/**
 * Decimals that suit the magnitude rather than a fixed count.
 *
 * A fixed 2 gives "0.00 ha" for a real quarter-acre plot and "1234.56 L" where
 * the hundredths are noise. Scaling the precision to the size keeps small
 * numbers informative and large ones readable.
 */
function decimalsFor(v: number, max = 3): number {
  const a = Math.abs(v);
  if (a === 0) return 0;
  if (a >= 1000) return 0;
  if (a >= 100) return 1;
  if (a >= 10) return Math.min(2, max);
  if (a >= 1) return Math.min(2, max);
  return max;
}

function measure(value: number, unit: string, decimals?: number): Measure {
  const d = decimals ?? decimalsFor(value);
  const shown = Number.isFinite(value) ? value : 0;
  return {
    value: shown,
    unit,
    text: `${shown.toLocaleString(undefined, {
      minimumFractionDigits: d, maximumFractionDigits: d,
    })} ${unit}`,
  };
}

// --- area -------------------------------------------------------------------

/**
 * Area from square metres.
 *
 * Small areas fall back to m²/ft² rather than showing "0.001 ha", because the
 * fields this is aimed at include plots well under a hectare — the export that
 * motivated the treatment grid was 0.105 ha.
 */
export function fmtArea(m2: number, sys: UnitSystem): Measure {
  if (sys === "metric") {
    return m2 < 1_000 ? measure(m2, "m²", 0) : measure(m2 / M2_PER_HECTARE, "ha");
  }
  const acres = m2 / M2_PER_ACRE;
  return acres < 0.1 ? measure(m2 / (M_PER_FT * M_PER_FT), "ft²", 0) : measure(acres, "ac");
}

/** Area given in hectares, which is how most of this codebase already holds it. */
export const fmtAreaHa = (ha: number, sys: UnitSystem): Measure =>
  fmtArea(ha * M2_PER_HECTARE, sys);

/** Area held in acres, which is how the reporting maths already carries it. */
export const fmtAreaAc = (ac: number, sys: UnitSystem): Measure =>
  fmtArea(ac * M2_PER_ACRE, sys);

/** An acre figure as the displayed system's number, unformatted. */
export const areaValueAc = (ac: number, sys: UnitSystem): number =>
  sys === "metric" ? ac / AC_PER_HA : ac;

/** Just the unit label, for column headers and axis labels. */
export const areaUnit = (sys: UnitSystem): string => (sys === "metric" ? "ha" : "ac");

/** Convert an area in hectares to the displayed system's number, unformatted. */
export const areaValueHa = (ha: number, sys: UnitSystem): number =>
  sys === "metric" ? ha : ha * AC_PER_HA;

// --- volume -----------------------------------------------------------------

export function fmtVolume(litres: number, sys: UnitSystem, decimals?: number): Measure {
  return sys === "metric"
    ? measure(litres, "L", decimals ?? 1)
    : measure(litres / L_PER_US_GAL, "gal", decimals ?? 1);
}

export const volumeUnit = (sys: UnitSystem): string => (sys === "metric" ? "L" : "gal");

export const volumeValue = (litres: number, sys: UnitSystem): number =>
  sys === "metric" ? litres : litres / L_PER_US_GAL;

/** Back to litres, for when a volume is TYPED in the viewer's own units. */
export const volumeToLitres = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? shown : shown * L_PER_US_GAL;

// --- application rate -------------------------------------------------------

/**
 * Rate from litres per hectare.
 *
 * This is the number that ends up on an aircraft, so the conversion is spelled
 * out: 1 L/ha spread over 2.4710538 ac is 0.4046856 L/ac, which is 0.1069064
 * US gal/ac.
 */
export function fmtRate(lha: number, sys: UnitSystem): Measure {
  return sys === "metric"
    ? measure(lha, "L/ha", 1)
    : measure(lha / L_PER_US_GAL / AC_PER_HA, "gal/ac", 2);
}

export const rateUnit = (sys: UnitSystem): string => (sys === "metric" ? "L/ha" : "gal/ac");

export const rateValue = (lha: number, sys: UnitSystem): number =>
  sys === "metric" ? lha : lha / L_PER_US_GAL / AC_PER_HA;

/** Back to L/ha, for when the operator TYPES a rate in their own units. */
export const rateToLha = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? shown : shown * L_PER_US_GAL * AC_PER_HA;

// --- distance, altitude, speed ---------------------------------------------

export function fmtDistance(m: number, sys: UnitSystem): Measure {
  if (sys === "metric") {
    return m >= 1000 ? measure(m / 1000, "km", 2) : measure(m, "m", m < 10 ? 1 : 0);
  }
  const ft = m / M_PER_FT;
  return m >= M_PER_MILE ? measure(m / M_PER_MILE, "mi", 2) : measure(ft, "ft", ft < 10 ? 1 : 0);
}

/** Altitude stays in feet for imperial — aviation's own convention. */
export function fmtAltitude(m: number, sys: UnitSystem): Measure {
  return sys === "metric" ? measure(m, "m", 0) : measure(m / M_PER_FT, "ft", 0);
}

export const altitudeUnit = (sys: UnitSystem): string => (sys === "metric" ? "m" : "ft");

export const altitudeValue = (m: number, sys: UnitSystem): number =>
  sys === "metric" ? m : m / M_PER_FT;

export const altitudeToM = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? shown : shown * M_PER_FT;

/**
 * Speed from metres per second.
 *
 * Metric keeps m/s — the planner's physics, the drone specs and the DJI
 * parameters are all m/s. Imperial gets MPH rather than ft/s: this product is
 * aimed at US operators, and mph is the number they think in.
 *
 * What is DISPLAYED and what is EXPORTED are deliberately different. Everything
 * stored and everything written into a mission file stays m/s; only the screen
 * changes. A unit conversion that reached the export would put a wrong speed on
 * an aircraft.
 */
export function fmtSpeed(ms: number, sys: UnitSystem): Measure {
  return sys === "metric" ? measure(ms, "m/s", 1) : measure(ms / MS_PER_MPH, "mph", 1);
}

/** Exactly one mile per hour, in m/s. */
export const MS_PER_MPH = M_PER_MILE / 3600;

export const speedUnit = (sys: UnitSystem): string => (sys === "metric" ? "m/s" : "mph");

export const speedValue = (ms: number, sys: UnitSystem): number =>
  sys === "metric" ? ms : ms / MS_PER_MPH;

/** Back to m/s, for a speed the operator TYPED or dragged in their own units. */
export const speedToMs = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? shown : shown * MS_PER_MPH;

/** Wind and ground speed, where mph is what an imperial user expects. */
export function fmtWindSpeed(ms: number, sys: UnitSystem): Measure {
  return sys === "metric"
    ? measure(ms * 3.6, "km/h", 0)
    : measure((ms / M_PER_MILE) * 3600, "mph", 0);
}

// --- temperature, mass ------------------------------------------------------

export function fmtTemp(celsius: number, sys: UnitSystem): Measure {
  return sys === "metric"
    ? measure(celsius, "°C", 0)
    : measure(celsius * 9 / 5 + 32, "°F", 0);
}

/**
 * A short length held in centimetres — centre-of-gravity offsets and the like.
 *
 * Inches for imperial. The physics works in cm; that is no reason to make a
 * grower in Iowa do the conversion in their head.
 */
export function fmtLengthCm(cm: number, sys: UnitSystem): Measure {
  return sys === "metric"
    ? measure(cm, "cm", 1)
    : measure(cm / 2.54, "in", 1);
}

export const lengthCmUnit = (sys: UnitSystem): string => (sys === "metric" ? "cm" : "in");

export function fmtMass(kg: number, sys: UnitSystem): Measure {
  return sys === "metric" ? measure(kg, "kg", 1) : measure(kg / KG_PER_LB, "lb", 1);
}

// --- money per area ---------------------------------------------------------

/**
 * A per-acre price shown in the viewer's units.
 *
 * The STORED number is always per acre — that is what the farmer typed and it
 * is never rewritten. Metric viewers see the same money over a hectare, which
 * is a bigger area and therefore a bigger number. The cost of treating a given
 * piece of ground is identical either way; only the denominator moves.
 */
export const costPerAreaValue = (perAcre: number, sys: UnitSystem): number =>
  sys === "metric" ? perAcre * AC_PER_HA : perAcre;

export const costPerAreaUnit = (sys: UnitSystem): string => (sys === "metric" ? "/ha" : "/ac");

/**
 * Back to the stored per-acre price, for when a metric farmer TYPES a
 * per-hectare one.
 *
 * The inverse of `costPerAreaValue`, and it has to exist: the cost field is an
 * input, not a readout. Showing per-hectare while storing whatever was typed
 * would multiply every price by 2.47 the moment a metric user edited one.
 */
export const costPerAreaToPerAcre = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? shown / AC_PER_HA : shown;

/** Total cost of an area, from a per-acre price. System-independent by design. */
export const costOfAreaHa = (ha: number, perAcre: number): number => ha * AC_PER_HA * perAcre;
