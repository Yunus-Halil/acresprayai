// Spray-safety rules. These decide whether a real operator flies, so the
// tests pin the boundaries and the ordering rather than just "returns a value".
import { describe, it, expect } from "vitest";
import {
  type SprayHour, DEFAULT_SPRAY_LIMITS, findSprayWindows, formatReason, rainAhead,
  shortReason, sprayVerdict, verdictAtTime, verdictRank,
} from "@/lib/sprayWindow";

const HOUR = 3600;
const T0 = Math.floor(Date.UTC(2026, 7, 20, 6, 0, 0) / 1000);

/** A calm, warm, dry hour: green on every axis. */
const good = (over: Partial<SprayHour> = {}, i = 0): SprayHour => ({
  time: T0 + i * HOUR,
  temp_c: 20, humidity: 55, wind_kmh: 8, gust_kmh: 12, precip_mm: 0,
  ...over,
});

const series = (n: number, f: (i: number) => Partial<SprayHour> = () => ({})) =>
  Array.from({ length: n }, (_, i) => good(f(i), i));

describe("a single hour", () => {
  it("passes calm, warm, dry conditions", () => {
    const r = sprayVerdict(good(), 0);
    expect(r.verdict).toBe("green");
    expect(r.reasons).toEqual([]);
    expect(r.headline).toBeNull();
  });

  it("stops hard on wind, gusts, cold, or rain on the way", () => {
    expect(sprayVerdict(good({ wind_kmh: 20 }), 0).verdict).toBe("red");
    expect(sprayVerdict(good({ gust_kmh: 30 }), 0).verdict).toBe("red");
    expect(sprayVerdict(good({ temp_c: 4 }), 0).verdict).toBe("red");
    expect(sprayVerdict(good(), 2).verdict).toBe("red");   // 2 mm due within 6h
  });

  it("warns without stopping when conditions are merely marginal", () => {
    expect(sprayVerdict(good({ wind_kmh: 14 }), 0).verdict).toBe("yellow");
    expect(sprayVerdict(good({ humidity: 30 }), 0).verdict).toBe("yellow");
    expect(sprayVerdict(good({ humidity: 85 }), 0).verdict).toBe("yellow");
    expect(sprayVerdict(good({ temp_c: 33 }), 0).verdict).toBe("yellow");
  });

  it("leads with the reason that actually decided it", () => {
    // A row that opens with "humidity a little low" while a 30 km/h gust is the
    // real problem teaches operators to stop reading the list.
    const r = sprayVerdict(good({ gust_kmh: 30, humidity: 20 }), 0);
    expect(r.verdict).toBe("red");
    expect(r.headline?.kind).toBe("gust");
    expect(r.headline?.severity).toBe("hard");
  });

  it("does not clutter a hard stop with soft warnings", () => {
    // Once it is a no, the marginal notes are noise.
    const r = sprayVerdict(good({ wind_kmh: 40, humidity: 20, temp_c: 33 }), 0);
    expect(r.reasons.every(x => x.severity === "hard")).toBe(true);
    expect(r.reasons.some(x => x.kind.startsWith("humidity"))).toBe(false);
  });

  it("carries the measured value and the threshold it failed", () => {
    // The UI needs both to say "24 km/h, over the 16 limit" in any unit system.
    const r = sprayVerdict(good({ wind_kmh: 24 }), 0);
    expect(r.headline).toMatchObject({ kind: "wind", value: 24, limit: DEFAULT_SPRAY_LIMITS.windMaxKmh });
  });

  it("treats the limits as boundaries, not as approximations", () => {
    const L = DEFAULT_SPRAY_LIMITS;
    expect(sprayVerdict(good({ wind_kmh: L.windMaxKmh }), 0).verdict).not.toBe("red");
    expect(sprayVerdict(good({ wind_kmh: L.windMaxKmh + 0.1 }), 0).verdict).toBe("red");
    expect(sprayVerdict(good({ temp_c: L.tempMinC }), 0).verdict).not.toBe("red");
    expect(sprayVerdict(good({ temp_c: L.tempMinC - 0.1 }), 0).verdict).toBe("red");
  });

  it("accepts stricter limits, because a product label can be stricter", () => {
    const strict = { ...DEFAULT_SPRAY_LIMITS, windMaxKmh: 5 };
    expect(sprayVerdict(good({ wind_kmh: 8 }), 0).verdict).toBe("green");
    expect(sprayVerdict(good({ wind_kmh: 8 }), 0, strict).verdict).toBe("red");
  });
});

describe("rain ahead", () => {
  it("sums the next six hours, not the whole forecast", () => {
    const h = series(24, i => ({ precip_mm: i < 6 ? 0.2 : 5 }));
    expect(rainAhead(h, 0)).toBeCloseTo(1.2, 6);
  });
});

describe("finding windows", () => {
  it("finds a clean run and reports its length", () => {
    // Windy for 4 hours, then calm.
    const h = series(24, i => ({ wind_kmh: i < 4 ? 30 : 8 }));
    const w = findSprayWindows(h, { now: (T0 - HOUR) * 1000 });
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].startTs).toBe(T0 + 4 * HOUR);
    expect(w[0].hours).toBeGreaterThanOrEqual(2);
  });

  it("ignores a single sprayable hour", () => {
    // By the time the tank is mixed, a one-hour window has closed. That is the
    // difference between a forecast and a plan.
    const h = series(12, i => ({ wind_kmh: i === 5 ? 8 : 30 }));
    expect(findSprayWindows(h)).toHaveLength(0);
  });

  it("honours a lower minimum when the caller asks for one", () => {
    const h = series(12, i => ({ wind_kmh: i === 5 ? 8 : 30 }));
    expect(findSprayWindows(h, { minHours: 1 })).toHaveLength(1);
  });

  it("splits a run that rain interrupts", () => {
    // Rain in hour 10 poisons the six hours before it, so the early run ends.
    const h = series(24, i => ({ precip_mm: i === 10 ? 4 : 0 }));
    const w = findSprayWindows(h, { now: (T0 - HOUR) * 1000 });
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w.every(x => x.startTs <= T0 + 4 * HOUR || x.startTs >= T0 + 10 * HOUR)).toBe(true);
  });

  it("marks a window already under way as active", () => {
    const h = series(24);
    const w = findSprayWindows(h, { now: (T0 + 2 * HOUR) * 1000 });
    expect(w[0].active).toBe(true);
  });

  it("returns nothing when the whole horizon is unflyable", () => {
    expect(findSprayWindows(series(48, () => ({ wind_kmh: 40 })))).toHaveLength(0);
  });
});

describe("checking a scheduled moment", () => {
  it("judges the hour the mission actually falls in", () => {
    const h = series(48, i => ({ wind_kmh: i === 10 ? 40 : 8 }));
    const r = verdictAtTime(h, (T0 + 10 * HOUR) * 1000);
    expect(r?.verdict).toBe("red");
    expect(r?.headline?.kind).toBe("wind");
  });

  it("returns null past the end of the forecast instead of guessing", () => {
    // A mission ten days out cannot be checked. Judging it against the nearest
    // available hour would put a green tick on a day nobody has a forecast for.
    const h = series(48);
    expect(verdictAtTime(h, (T0 + 300 * HOUR) * 1000)).toBeNull();
  });

  it("returns null for a time before the forecast starts", () => {
    expect(verdictAtTime(series(48), (T0 - 50 * HOUR) * 1000)).toBeNull();
  });
});

describe("putting a reason into words", () => {
  it("speaks mph and Fahrenheit to an imperial operator", () => {
    // 24 km/h is 15 mph; the 16 km/h limit is 10 mph.
    const r = sprayVerdict(good({ wind_kmh: 24 }), 0).headline!;
    const s = formatReason(r, "imperial");
    expect(s).toContain("15 mph");
    expect(s).toContain("10 mph");
    expect(s).not.toMatch(/km\/h/);
  });

  it("speaks km/h and Celsius to a metric operator", () => {
    const r = sprayVerdict(good({ wind_kmh: 24 }), 0).headline!;
    expect(formatReason(r, "metric")).toContain("24 km/h");
    expect(formatReason(r, "metric")).not.toMatch(/mph/);
  });

  it("converts temperature limits too, not just the reading", () => {
    const r = sprayVerdict(good({ temp_c: 0 }), 0).headline!;
    const s = formatReason(r, "imperial");
    expect(s).toContain("32 °F");   // the reading
    expect(s).toContain("50 °F");   // the 10 °C minimum
  });

  it("has words for every reason it can produce, in both systems", () => {
    // A missing case would return undefined and render as blank next to a red
    // badge: the operator would see that they cannot fly and no reason why.
    const cases: Partial<SprayHour>[] = [
      { wind_kmh: 40 }, { gust_kmh: 30 }, { temp_c: 0 }, { wind_kmh: 14 },
      { temp_c: 33 }, { humidity: 20 }, { humidity: 90 },
    ];
    const seen = new Set<string>();
    for (const c of cases) {
      for (const rain of [0, 5]) {
        for (const r of sprayVerdict(good(c), rain).reasons) {
          seen.add(r.kind);
          for (const sys of ["metric", "imperial"] as const) {
            expect(formatReason(r, sys)).toMatch(/\S/);
            expect(shortReason(r, sys)).toMatch(/\S/);
          }
        }
      }
    }
    expect(seen).toEqual(new Set([
      "wind", "gust", "rain", "cold", "hot", "humidity-low", "humidity-high",
    ]));
  });
});

describe("ranking", () => {
  it("sorts sprayable first and unflyable last", () => {
    expect([...["red", "green", "yellow"] as const].sort((a, b) => verdictRank(a) - verdictRank(b)))
      .toEqual(["green", "yellow", "red"]);
  });
});
