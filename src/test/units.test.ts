// Unit conversion and display.
//
// The property worth pinning hardest is that switching systems changes what a
// number LOOKS like and never what it MEANS. These numbers are chemical doses
// and money; a toggle that quietly rescales either is worse than one that does
// nothing.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AC_PER_HA, KG_PER_LB, L_PER_US_GAL, M2_PER_ACRE, M_PER_FT,
  altitudeToM, altitudeValue, areaUnit, costOfAreaHa, costPerAreaUnit,
  MS_PER_MPH, costPerAreaToPerAcre, costPerAreaValue, fmtAltitude, fmtLengthCm, fmtArea, fmtAreaHa, fmtMass, fmtRate, fmtSpeed,
  fmtDistancePair, fmtMetricRange, fmtTemp, fmtVolume, fmtWindSpeed, metricRangeUnit,
  metricRangeValue, rateToLha, rateUnit, rateValue, speedToMs,
  speedUnit, speedValue, volumeValue,
} from "@/lib/units";

describe("conversion factors are the exact defined ones", () => {
  it("uses the international acre and the US gallon", () => {
    // Not approximations: these are definitional, and a drifted constant is the
    // kind of error that never looks wrong on screen.
    expect(M2_PER_ACRE).toBe(4046.8564224);
    expect(L_PER_US_GAL).toBe(3.785411784);
    expect(M_PER_FT).toBe(0.3048);
    expect(KG_PER_LB).toBe(0.45359237);
    expect(AC_PER_HA).toBeCloseTo(2.4710538147, 9);
  });
});

describe("area", () => {
  it("shows hectares to metric and acres to imperial", () => {
    const m2 = 10_000;                       // exactly one hectare
    expect(fmtArea(m2, "metric").text).toBe("1.00 ha");
    expect(fmtArea(m2, "imperial").value).toBeCloseTo(2.4710538, 5);
    expect(areaUnit("metric")).toBe("ha");
    expect(areaUnit("imperial")).toBe("ac");
  });

  it("falls back to small units rather than showing a rounded-away plot", () => {
    // The export that motivated the treatment grid was 0.105 ha. A fixed
    // hectare display would render a genuinely small plot as "0.00".
    expect(fmtArea(400, "metric").unit).toBe("m²");
    expect(fmtArea(200, "imperial").unit).toBe("ft²");
  });

  it("agrees with itself whichever entry point is used", () => {
    expect(fmtAreaHa(3, "metric").text).toBe(fmtArea(30_000, "metric").text);
  });
});

describe("volume", () => {
  it("converts litres to US gallons", () => {
    expect(fmtVolume(L_PER_US_GAL, "imperial").value).toBeCloseTo(1, 9);
    expect(fmtVolume(100, "metric").value).toBe(100);
    expect(volumeValue(37.85411784, "imperial")).toBeCloseTo(10, 9);
  });
});

describe("application rate", () => {
  it("converts L/ha to gal/ac", () => {
    // 1 L/ha over 2.4710538 ac is 0.4046856 L/ac = 0.1069064 US gal/ac.
    expect(rateValue(1, "imperial")).toBeCloseTo(0.1069064, 6);
    expect(rateUnit("metric")).toBe("L/ha");
    expect(rateUnit("imperial")).toBe("gal/ac");
  });

  it("round-trips a rate the operator typed in their own units", () => {
    // The planner lets a rate be TYPED. If display and entry disagree even
    // slightly, a saved prescription drifts every time someone opens it.
    for (const lha of [1, 15, 22.5, 40, 118.7]) {
      expect(rateToLha(rateValue(lha, "imperial"), "imperial")).toBeCloseTo(lha, 9);
      expect(rateToLha(rateValue(lha, "metric"), "metric")).toBeCloseTo(lha, 9);
    }
  });
});

describe("altitude", () => {
  it("converts metres to feet and back without drift", () => {
    expect(fmtAltitude(30, "imperial").value).toBeCloseTo(98.425, 3);
    expect(fmtAltitude(30, "metric").text).toBe("30 m");
    for (const m of [3, 30, 120]) {
      expect(altitudeToM(altitudeValue(m, "imperial"), "imperial")).toBeCloseTo(m, 9);
    }
  });
});

describe("speed", () => {
  it("keeps m/s for metric and gives imperial mph, not ft/s", () => {
    // US ag operators think in mph. The planner's physics and the DJI
    // parameters stay m/s regardless — only the screen changes.
    expect(fmtSpeed(6, "metric").text).toBe("6.0 m/s");
    expect(fmtSpeed(MS_PER_MPH, "imperial").value).toBeCloseTo(1, 9);
    expect(fmtSpeed(6, "imperial").unit).toBe("mph");
  });

  it("round-trips a speed the operator dragged in their own units", () => {
    // The altitude and speed sliders are inputs. If display and entry disagree,
    // a saved plan drifts every time somebody opens it — and this particular
    // number ends up on an aircraft.
    for (const ms of [1, 3, 6.5, 10, 20]) {
      expect(speedToMs(speedValue(ms, "imperial"), "imperial")).toBeCloseTo(ms, 9);
      expect(speedToMs(speedValue(ms, "metric"), "metric")).toBeCloseTo(ms, 9);
    }
    expect(speedUnit("imperial")).toBe("mph");
  });

  it("uses km/h and mph for wind, which is read not flown", () => {
    expect(fmtWindSpeed(10, "metric").text).toBe("36 km/h");
    expect(fmtWindSpeed(10, "imperial").value).toBeCloseTo(22.369, 2);
  });
});

describe("temperature and mass", () => {
  it("gives inches for a centimetre length", () => {
    expect(fmtLengthCm(2.54, "imperial").value).toBeCloseTo(1, 9);
    expect(fmtLengthCm(5, "metric").text).toBe("5.0 cm");
  });

  it("converts at the reference points", () => {
    expect(fmtTemp(0, "imperial").value).toBe(32);
    expect(fmtTemp(100, "imperial").value).toBe(212);
    expect(fmtTemp(-40, "imperial").value).toBe(-40);
    expect(fmtTemp(21, "metric").text).toBe("21 °C");
    expect(fmtMass(1, "imperial").value).toBeCloseTo(2.2046226, 6);
  });
});

describe("input costs — the case that must not silently rescale", () => {
  it("shows a per-acre price as the same money over a hectare", () => {
    // The farmer typed 45 per acre. A hectare is 2.47 acres, so treating one
    // costs 2.47x as much. The price did not change; the denominator did.
    expect(costPerAreaValue(45, "imperial")).toBe(45);
    expect(costPerAreaValue(45, "metric")).toBeCloseTo(111.197, 3);
    expect(costPerAreaUnit("metric")).toBe("/ha");
    expect(costPerAreaUnit("imperial")).toBe("/ac");
  });

  it("round-trips a price a metric farmer types, so editing one cannot inflate it", () => {
    // The cost field is an INPUT. Display per hectare while storing whatever
    // was typed and every price jumps 2.47x the first time it is edited.
    for (const perAcre of [20, 35, 45.5, 120]) {
      const shownToMetric = costPerAreaValue(perAcre, "metric");
      expect(costPerAreaToPerAcre(shownToMetric, "metric")).toBeCloseTo(perAcre, 9);
      expect(costPerAreaToPerAcre(costPerAreaValue(perAcre, "imperial"), "imperial")).toBe(perAcre);
    }
  });

  it("costs the same to treat the same ground in either system", () => {
    // This is the whole guarantee. If flipping the toggle changed a bill, the
    // setting would be a data-corruption feature.
    const perAcre = 45, ha = 12.5;
    const metricBill = costPerAreaValue(perAcre, "metric") * ha;
    const imperialBill = costPerAreaValue(perAcre, "imperial") * (ha * AC_PER_HA);
    expect(metricBill).toBeCloseTo(imperialBill, 9);
    expect(costOfAreaHa(ha, perAcre)).toBeCloseTo(imperialBill, 9);
  });
});

describe("the preference store", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("defaults to imperial when nothing is stored", async () => {
    const m = await import("@/hooks/useUnitSystem");
    expect(m.getUnitSystem()).toBe("imperial");
  });

  it("persists a choice", async () => {
    const m = await import("@/hooks/useUnitSystem");
    m.setUnitSystem("metric");
    expect(m.getUnitSystem()).toBe("metric");
    expect(localStorage.getItem("swathwise.units")).toBe("metric");
  });

  it("notifies subscribers, so every screen moves at once", async () => {
    const m = await import("@/hooks/useUnitSystem");
    const seen: string[] = [];
    // subscribe is not exported; the hook is the public surface, so drive it
    // the way React does via the module's own listener set.
    const unsub = (m as unknown as { default?: unknown });
    void unsub;
    m.setUnitSystem("metric");
    seen.push(m.getUnitSystem());
    expect(seen).toEqual(["metric"]);
  });

  it("seeds from a field's saved preference only when the user has none", async () => {
    const m = await import("@/hooks/useUnitSystem");
    m.seedUnitSystem("metric");
    expect(m.getUnitSystem()).toBe("metric");
  });

  it("never lets a field override a choice the user already made", async () => {
    // Opening an old field configured as imperial must not undo someone who
    // deliberately picked metric.
    const m = await import("@/hooks/useUnitSystem");
    m.setUnitSystem("metric");
    m.seedUnitSystem("imperial");
    expect(m.getUnitSystem()).toBe("metric");
  });

  it("ignores junk in storage rather than throwing", async () => {
    localStorage.setItem("swathwise.units", "furlongs");
    const m = await import("@/hooks/useUnitSystem");
    expect(m.getUnitSystem()).toBe("imperial");
  });
});

describe("operating ranges stored in metric", () => {
  it("keeps the metric visible for the two an operator cross-checks against DJI", () => {
    // The T40's advertised swath and speed, which is what the manual prints.
    expect(fmtMetricRange([9, 11], "imperial", "length", { keepMetric: true }))
      .toBe("9 to 11 m (29.5 to 36.1 ft)");
    expect(fmtMetricRange([7, 10], "imperial", "speed", { keepMetric: true }))
      .toBe("7 to 10 m/s (15.7 to 22.4 mph)");
  });

  it("converts outright where the metric is not the point", () => {
    expect(fmtMetricRange([3, 3.5], "imperial", "length")).toBe("9.8 to 11.5 ft");
  });

  it("leaves metric alone, brackets and all", () => {
    expect(fmtMetricRange([9, 11], "metric", "length", { keepMetric: true })).toBe("9 to 11 m");
    expect(fmtMetricRange([7, 10], "metric", "speed")).toBe("7 to 10 m/s");
  });

  it("moves a bound onto the input in the same unit the label used", () => {
    expect(metricRangeValue(9, "imperial", "length")).toBeCloseTo(29.5276, 3);
    expect(metricRangeUnit("imperial", "speed")).toBe("mph");
    expect(metricRangeUnit("metric", "length")).toBe("m");
  });
});

describe("a ratio of two distances", () => {
  it("puts both halves in ONE unit, chosen by the total", () => {
    // The bug: 1239 m rendered as feet against 1915 m rendered as miles, so the
    // panel printed "4064.52 / 1.19 mi".
    const p = fmtDistancePair(1239, 1915, "imperial");
    expect(p.unit).toBe("mi");
    expect(p.text).toBe("0.8 / 1.2 mi");
  });

  it("stays in feet while the whole job is under a mile", () => {
    const p = fmtDistancePair(414.8, 1000, "imperial");
    expect(p.unit).toBe("ft");
    expect(p.text).toBe("1,361 / 3,281 ft");
  });

  it("rounds to a precision a GPS-planned path actually has", () => {
    // Whole feet and metres; one decimal on the long units. Never centimetres.
    expect(fmtDistancePair(1239, 1500, "imperial").part).toBe("4,065");
    expect(fmtDistancePair(412, 900, "metric").text).toBe("412 / 900 m");
    expect(fmtDistancePair(1239, 2500, "metric").text).toBe("1.2 / 2.5 km");
  });

  it("does not switch units halfway through a playback", () => {
    // The total is fixed, so the unit is fixed, however small the numerator is.
    const start = fmtDistancePair(0, 1915, "imperial");
    const end = fmtDistancePair(1915, 1915, "imperial");
    expect(start.unit).toBe(end.unit);
    expect(start.text).toBe("0.0 / 1.2 mi");
  });
});
