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

/**
 * Pump flow from litres per minute.
 *
 * US operators size pumps in gallons per minute; DJI publishes litres. Same
 * pump either way — only the screen moves, exactly as with every rate here.
 */
export function fmtFlow(lpm: number, sys: UnitSystem, decimals?: number): Measure {
  return sys === "metric"
    ? measure(lpm, "L/min", decimals ?? 1)
    : measure(lpm / L_PER_US_GAL, "gal/min", decimals ?? 1);
}

/** Rain depth from millimetres. Inches for imperial, two decimals — 0.5 mm is 0.02 in. */
export const MM_PER_INCH = 25.4;
export function fmtPrecip(mm: number, sys: UnitSystem): Measure {
  return sys === "metric"
    ? measure(mm, "mm", 1)
    : measure(mm / MM_PER_INCH, "in", 2);
}

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

// ---- Application-record conditions ---------------------------------------
// The record stores wind in mph and temperature in F (the column names say
// so). Display and entry follow the preference: km/h and C for metric.
export const KMH_PER_MPH = 1.609344;
export const windUnit = (sys: UnitSystem): string => (sys === "metric" ? "km/h" : "mph");
export const windMphShown = (mph: number, sys: UnitSystem): number =>
  sys === "metric" ? +(mph * KMH_PER_MPH).toFixed(1) : mph;
export const windMphFromShown = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? +(shown / KMH_PER_MPH).toFixed(2) : shown;
export const fmtWindMph = (mph: number, sys: UnitSystem): Measure =>
  measure(windMphShown(mph, sys), windUnit(sys), 1);
export const tempUnit = (sys: UnitSystem): string => (sys === "metric" ? "°C" : "°F");
export const tempFShown = (f: number, sys: UnitSystem): number =>
  sys === "metric" ? +((f - 32) * 5 / 9).toFixed(1) : f;
export const tempFFromShown = (shown: number, sys: UnitSystem): number =>
  sys === "metric" ? +(shown * 9 / 5 + 32).toFixed(1) : shown;
export const fmtTempF = (f: number, sys: UnitSystem): Measure =>
  measure(tempFShown(f, sys), tempUnit(sys), sys === "metric" ? 1 : 0);

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

// --- operating ranges held in metric ----------------------------------------

/**
 * A [min, max] operating envelope, stored in SI, rendered for the screen.
 *
 * WHY THIS EXISTS AS ONE FUNCTION. Aircraft profiles are stored in metres and
 * metres per second because that is how DJI publishes them, and the panel that
 * reads them is imperial. Every place that printed a range hand-wrote the SI
 * numbers next to a field the operator was typing feet into — "9 to 11 m" over
 * an input reading 32.81 ft. The numbers were right and the label was a lie
 * about them, which is the worst of the two failures: a wrong number gets
 * questioned, a wrong unit gets believed.
 *
 * `keepMetric` is for the two ranges an operator will cross-check against DJI's
 * own manual — swath and speed. There the metric stays visible and the display
 * unit follows in brackets, because the point is to be able to hold this label
 * next to the printed spec. Everything else converts outright.
 */
export type MetricRangeKind = "length" | "speed";

const rangeNum = (v: number): string => String(+v.toFixed(1));

export function fmtMetricRange(
  range: readonly [number, number],
  sys: UnitSystem,
  kind: MetricRangeKind,
  opts: { keepMetric?: boolean } = {},
): string {
  const siUnit = kind === "speed" ? "m/s" : "m";
  const metric = `${rangeNum(range[0])} to ${rangeNum(range[1])} ${siUnit}`;
  if (sys === "metric") return metric;

  const toShown = kind === "speed"
    ? (v: number) => v / MS_PER_MPH
    : (v: number) => v / M_PER_FT;
  const unit = kind === "speed" ? "mph" : "ft";
  const shown = `${rangeNum(toShown(range[0]))} to ${rangeNum(toShown(range[1]))} ${unit}`;
  return opts.keepMetric ? `${metric} (${shown})` : shown;
}

/** One end of such a range as the display system's number, unformatted. */
export const metricRangeValue = (
  m: number, sys: UnitSystem, kind: MetricRangeKind,
): number =>
  kind === "speed" ? speedValue(m, sys) : altitudeValue(m, sys);

/** The unit a `MetricRangeKind` renders in. */
export const metricRangeUnit = (sys: UnitSystem, kind: MetricRangeKind): string =>
  kind === "speed" ? speedUnit(sys) : altitudeUnit(sys);

// --- a ratio of two distances ----------------------------------------------

/**
 * Two distances rendered against each other, in ONE unit.
 *
 * WHAT THIS FIXES. `fmtDistance` picks its unit from the magnitude it is given,
 * which is right for a lone figure and wrong for a pair: 1239 m came out as
 * "4064.52" feet and the 1915 m it was being measured against came out as
 * "1.19 mi", and the panel printed "4064.52 / 1.19 mi". Both halves were
 * correct and the ratio between them was nonsense.
 *
 * The DENOMINATOR chooses the unit, because it is the fixed one — the total
 * does not change as the aircraft flies, so the row does not switch units
 * halfway through a playback.
 *
 * Precision is the other half of the fix. Centimetres on a GPS-planned path is
 * a precision nobody has: whole feet and metres, one decimal on miles and
 * kilometres.
 */
export function fmtDistancePair(
  partM: number, totalM: number, sys: UnitSystem,
): { part: string; total: string; unit: string; text: string } {
  const big = sys === "metric" ? totalM >= 1000 : totalM >= M_PER_MILE;
  const unit = sys === "metric" ? (big ? "km" : "m") : (big ? "mi" : "ft");
  const per = sys === "metric" ? (big ? 1000 : 1) : (big ? M_PER_MILE : M_PER_FT);
  const decimals = big ? 1 : 0;
  const show = (m: number) =>
    (Number.isFinite(m) ? m / per : 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
  const part = show(partM);
  const total = show(totalM);
  return { part, total, unit, text: `${part} / ${total} ${unit}` };
}
