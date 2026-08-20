// Mission stats — the numbers a pilot packs a truck from.
//
// The property that matters most is that ONE function produces them. The
// planner shows them live and the calendar freezes a copy; if those could ever
// disagree, the way you find out is a pilot bringing two batteries for a job
// that needed three.
import { describe, it, expect } from "vitest";
import {
  USABLE_BATTERY_PCT, computeMissionStats, conditionsAt, pesticideLitres, planRefills,
} from "@/lib/missionStats";
import { dayKey, groupByDay, monthGrid, monthRangeISO } from "@/lib/schedule";
import type { ScheduledMission } from "@/lib/schedule";
import { DRONE_SPECS } from "@/lib/droneSpecs";
import { T40_PHYSICS } from "@/lib/dronePhysics";
import type { Mission } from "@/lib/mission";
import type { Forecast } from "@/lib/weather";

const SPEC = { ...DRONE_SPECS["DJI Agras T30"] };

/** A straight north-south spray leg, so the wind geometry is predictable. */
const missionOf = (over: Partial<Mission> = {}): Mission => ({
  waypoints: [],
  transitDistM: 200, sprayDistM: 1800,
  transitTimeS: 20, sprayTimeS: 600,
  sprayOnCount: 1,
  transitSegments: [],
  spraySegments: [[{ lat: 40.000, lng: -100 }, { lat: 40.010, lng: -100 }]],
  home: { lat: 40, lng: -100 },
  ...over,
});

const base = {
  mission: missionOf(),
  spec: SPEC,
  sprayAltM: 3,
  transitAltM: 30,
  tankLoadPct: 80,
  zones: [{ areaM2: 20_000, rateLha: 25 }],
  wx: null,
};

describe("chemical volume", () => {
  it("scales with marked-zone area", () => {
    const one = pesticideLitres([{ areaM2: 10_000, rateLha: 20 }]);
    const two = pesticideLitres([{ areaM2: 20_000, rateLha: 20 }]);
    expect(one).toBeCloseTo(20, 9);       // 1 ha at 20 L/ha
    expect(two).toBeCloseTo(40, 9);
  });

  it("treats each zone at its own rate rather than one blended figure", () => {
    // The whole point of marking zones separately is that they can differ.
    const mixed = pesticideLitres([
      { areaM2: 10_000, rateLha: 10 },
      { areaM2: 10_000, rateLha: 30 },
    ]);
    expect(mixed).toBeCloseTo(40, 9);
  });

  it("ignores zones with no area or no rate instead of counting them as zero-cost", () => {
    expect(pesticideLitres([
      { areaM2: 0, rateLha: 20 },
      { areaM2: 10_000, rateLha: 0 },
      { areaM2: 10_000, rateLha: 20 },
    ])).toBeCloseTo(20, 9);
  });

  it("reports chemical even when there is no flyable route", () => {
    // The chemical figure comes from the marked GROUND, not the plan, so it
    // still stands when the route could not be built.
    const s = computeMissionStats({ ...base, mission: null });
    expect(s.pesticideAmountLiters).toBeCloseTo(50, 9);
    expect(s.flightTimeMinutes).toBe(0);
    expect(s.batteriesNeeded).toBe(0);
  });
});

describe("battery count", () => {
  it("never packs a single battery to more than its usable fraction", () => {
    const s = computeMissionStats(base);
    const perBattery = SPEC.max_flight_min * (USABLE_BATTERY_PCT / 100);
    expect(s.batteriesNeeded).toBe(Math.max(1, Math.ceil(s.flightTimeMinutes / perBattery)));
  });

  it("always packs at least one", () => {
    const s = computeMissionStats({
      ...base,
      mission: missionOf({ sprayDistM: 5, sprayTimeS: 2, transitDistM: 1, transitTimeS: 1 }),
    });
    expect(s.batteriesNeeded).toBeGreaterThanOrEqual(1);
  });

  it("needs more batteries for a longer job", () => {
    const short = computeMissionStats(base);
    const long = computeMissionStats({
      ...base,
      mission: missionOf({ sprayDistM: 18_000, sprayTimeS: 6_000 }),
    });
    expect(long.flightTimeMinutes).toBeGreaterThan(short.flightTimeMinutes);
    expect(long.batteriesNeeded).toBeGreaterThan(short.batteriesNeeded);
  });

  it("needs more batteries from a drone with less endurance", () => {
    const tough = computeMissionStats(base);
    const weak = computeMissionStats({ ...base, spec: { ...SPEC, max_flight_min: 6 } });
    expect(weak.batteriesNeeded).toBeGreaterThan(tough.batteriesNeeded);
  });
});

describe("changing the drone", () => {
  it("changes the estimate without mutating the flight plan", () => {
    // The schedule form re-estimates as the operator tries drones. If that
    // mutated the plan, backing out of the form would leave the planner showing
    // numbers for an aircraft nobody picked.
    const mission = missionOf();
    const before = JSON.stringify(mission);

    const a = computeMissionStats({ ...base, mission });
    const b = computeMissionStats({ ...base, mission, spec: { ...SPEC, max_flight_min: 9 } });

    expect(JSON.stringify(mission)).toBe(before);
    expect(a.flightTimeMinutes).toBeCloseTo(b.flightTimeMinutes, 9);  // same route
    expect(b.batteriesNeeded).not.toBe(a.batteriesNeeded);            // different aircraft
  });

  it("leaves the input zones untouched", () => {
    const zones = [{ areaM2: 20_000, rateLha: 25 }];
    const snapshot = JSON.stringify(zones);
    computeMissionStats({ ...base, zones });
    expect(JSON.stringify(zones)).toBe(snapshot);
  });
});

describe("weather derating", () => {
  it("costs endurance when the wind is there and none when it is not", () => {
    const calm = computeMissionStats(base);
    const windy = computeMissionStats({
      ...base, wx: { wind_ms: 8, wind_dir: 180, temp_c: 20 },
    });
    expect(windy.flightTimeMinutes).toBeGreaterThan(calm.flightTimeMinutes);
    expect(calm.derating.windFactor).toBe(1);
    expect(calm.derating.windKind).toBe("calm");
  });

  it("penalises cold, and does not reward heat", () => {
    const cold = computeMissionStats({ ...base, wx: { wind_ms: 0, wind_dir: 0, temp_c: 0 } });
    const mild = computeMissionStats({ ...base, wx: { wind_ms: 0, wind_dir: 0, temp_c: 20 } });
    const hot = computeMissionStats({ ...base, wx: { wind_ms: 0, wind_dir: 0, temp_c: 35 } });
    expect(cold.derating.tempFactor).toBeGreaterThan(1);
    expect(mild.derating.tempFactor).toBe(1);
    expect(hot.derating.tempFactor).toBe(1);
  });
});

describe("flight conditions", () => {
  const fmt = {
    windText: (ms: number) => `${(ms * 2.237).toFixed(0)} mph`,
    tempText: (c: number) => `${(c * 9 / 5 + 32).toFixed(0)}°F`,
  };
  // Every `time` in a Forecast is UNIX SECONDS. These fixtures say so
  // explicitly, because an earlier version of this file used milliseconds and
  // so agreed with a bug instead of catching it: nothing ever matched, every
  // lookup fell through to "current", and the UI announced the forecast as
  // unavailable while displaying real wind and temperature.
  const atMs = new Date("2026-08-21T15:00:00Z").getTime();
  const secs = (ms: number) => Math.floor(ms / 1000);

  const forecast = (over: Partial<Forecast> = {}): Forecast => ({
    current: {
      time: secs(atMs), temp_c: 20, feels_c: 20, humidity: 50, wind_kmh: 10, gust_kmh: 15,
      wind_dir: 180, clouds: 10, precip_mm: 0, code: 0, icon: "sun", desc: "clear",
    },
    hourly: [], daily: [], ...over,
  });

  it("uses the forecast hour covering the scheduled time", () => {
    const c = conditionsAt(forecast({
      hourly: [{
        time: secs(atMs), temp_c: 25, feels_c: 25, humidity: 40, wind_kmh: 20, gust_kmh: 25,
        wind_dir: 90, clouds: 0, precip_mm: 0, code: 0, icon: "sun", desc: "sunny",
        precip_prob: 5,
      }],
    }), atMs, fmt);
    expect(c.available).toBe(true);
    expect(c.basis).toBe("forecast");
    expect(c.summary).toContain("sunny");
  });

  it("reads the forecast timestamps as SECONDS, not milliseconds", () => {
    // The regression guard. An hour stamped in seconds must match a scheduled
    // time in milliseconds; treating the two as the same scale matches nothing.
    const c = conditionsAt(forecast({
      hourly: [{
        time: secs(atMs), temp_c: 25, feels_c: 25, humidity: 40, wind_kmh: 20, gust_kmh: 25,
        wind_dir: 90, clouds: 0, precip_mm: 0, code: 0, icon: "sun", desc: "sunny",
        precip_prob: 5,
      }],
    }), atMs, fmt);
    expect(c.basis).toBe("forecast");
    expect(c.wind_ms).toBeCloseTo(20 / 3.6, 6);
  });

  it("says the forecast is unavailable rather than inventing one", () => {
    // A mission three weeks out is past the 7-day window. Letting the last day
    // in the array stand in for that date is the failure this guards: a pilot
    // can act on a fabricated number.
    const far = atMs + 21 * 86_400_000;
    const c = conditionsAt(forecast(), far, fmt);
    expect(c.available).toBe(false);
    expect(c.basis).toBe("current");
    expect(c.summary).toMatch(/beyond the 7-day forecast/i);
    // And it still says what it DID find, clearly labelled as current.
    expect(c.summary).toMatch(/current conditions/i);
  });

  it("reports nothing at all when the location has no weather cached", () => {
    const c = conditionsAt(null, atMs, fmt);
    expect(c.available).toBe(false);
    expect(c.basis).toBe("none");
    expect(c.wind_ms).toBeNull();
  });

  it("falls back to the day when there is no matching hour", () => {
    const c = conditionsAt(forecast({
      daily: [{
        time: secs(Date.UTC(2026, 7, 21)), tmin_c: 12, tmax_c: 24, humidity: 50,
        wind_kmh: 14, gust_kmh: 20, wind_dir: 180, precip_mm: 0, precip_prob: 10,
        clouds: 20, code: 1, icon: "cloud", desc: "partly cloudy",
      }],
    }), new Date(2026, 7, 21, 9, 0).getTime(), fmt);
    expect(c.available).toBe(true);
    expect(c.summary).toContain("partly cloudy");
  });

  it("does not hand an evening mission the next day's forecast", () => {
    // Daily entries are stamped at midnight. A "within 12 hours" match would
    // pull tomorrow's weather for a 21:00 job tonight.
    const c = conditionsAt(forecast({
      daily: [{
        time: secs(Date.UTC(2026, 7, 22)), tmin_c: 5, tmax_c: 9, humidity: 90,
        wind_kmh: 40, gust_kmh: 60, wind_dir: 180, precip_mm: 12, precip_prob: 95,
        clouds: 100, code: 65, icon: "rain", desc: "heavy rain",
      }],
    }), new Date(2026, 7, 21, 21, 0).getTime(), fmt);
    expect(c.summary).not.toContain("heavy rain");
    expect(c.available).toBe(false);
  });
});

describe("the integrated physics path", () => {
  const phys = {
    config: T40_PHYSICS,
    elevationM: 0,
    swathM: 11,
    rowLengthM: 200,
    flowLpm: 8,
    reserveFraction: 0.2,
    headingDeg: 0,
  };

  it("is opt-in — no physics inputs, no change in behaviour", () => {
    // The flat estimate is the honest answer when nobody has said what the
    // elevation or the pack's age is. It must not be quietly replaced.
    const plain = computeMissionStats(base);
    expect(plain.physics).toBeUndefined();
  });

  it("reports a breakdown when physics inputs are supplied", () => {
    const s = computeMissionStats({ ...base, physics: phys });
    expect(s.physics).toBeDefined();
    expect(s.physics!.confidence).toBe("structured-estimate");
  });

  it("gets lighter as the tank drains", () => {
    // The whole premise: mass is not constant across a mission.
    const s = computeMissionStats({ ...base, physics: phys });
    expect(s.physics!.auwEndKg).toBeLessThan(s.physics!.auwStartKg);
  });

  it("charges for the turnarounds", () => {
    const s = computeMissionStats({ ...base, physics: phys });
    expect(s.physics!.turnCount).toBeGreaterThan(0);
    expect(s.physics!.turnaroundSeconds).toBeGreaterThan(0);
    // And the flight time includes them, rather than reporting bare cruise.
    expect(s.flightTimeMinutes).toBeGreaterThan(base.mission!.sprayTimeS / 60);
  });

  it("sizes batteries on usable capacity, never on nameplate", () => {
    const s = computeMissionStats({ ...base, physics: phys });
    expect(s.physics!.usableAh).toBeLessThan(T40_PHYSICS.batteryCapacityAh);
    expect(s.physics!.reserveFraction).toBe(0.2);
  });

  it("needs more batteries from an aged pack than a new one", () => {
    const fresh = computeMissionStats({ ...base, physics: { ...phys, batteryCycleCount: 0 } });
    const worn = computeMissionStats({ ...base, physics: { ...phys, batteryCycleCount: 900 } });
    expect(worn.physics!.usableAh).toBeLessThan(fresh.physics!.usableAh);
    expect(worn.batteriesNeeded).toBeGreaterThanOrEqual(fresh.batteriesNeeded);
  });

  it("draws more current in thin mountain air than at sea level", () => {
    const low = computeMissionStats({ ...base, physics: { ...phys, elevationM: 0 } });
    const high = computeMissionStats({ ...base, physics: { ...phys, elevationM: 2500 } });
    expect(high.physics!.airDensityKgM3).toBeLessThan(low.physics!.airDensityKgM3);
    expect(high.physics!.meanAmps).toBeGreaterThan(low.physics!.meanAmps);
  });

  it("raises a drift warning when the wind is past the advisory", () => {
    const calm = computeMissionStats({
      ...base, wx: { wind_ms: 2, wind_dir: 0, temp_c: 20 }, physics: phys,
    });
    const blowy = computeMissionStats({
      ...base, wx: { wind_ms: 7, wind_dir: 0, temp_c: 20 }, physics: phys,
    });
    expect(calm.physics!.drift.level).toBe("ok");
    expect(blowy.physics!.drift.level).not.toBe("ok");
  });

  it("produces a finite, sane estimate over a whole mission", () => {
    const s = computeMissionStats({ ...base, physics: phys });
    expect(Number.isFinite(s.flightTimeMinutes)).toBe(true);
    expect(s.flightTimeMinutes).toBeGreaterThan(0);
    expect(s.flightTimeMinutes).toBeLessThan(600);
    expect(Number.isFinite(s.physics!.meanAmps)).toBe(true);
    expect(s.physics!.peakAmps).toBeGreaterThanOrEqual(s.physics!.meanAmps);
  });

  it("never claims more than a structured estimate", () => {
    // Guards the honesty of the label. The coefficients are unverified; a
    // "high confidence" badge on top of them would be the confident-looking
    // guess this codebase keeps refusing to ship.
    const s = computeMissionStats({ ...base, physics: phys });
    expect(s.physics!.confidence).toBe("structured-estimate");
  });
});

describe("calendar shaping", () => {
  const mission = (id: string, iso: string): ScheduledMission => ({
    id, fieldId: "f", scanId: null, flightPlanId: null, scheduledAt: iso,
    location: null, droneId: null, status: "scheduled", chemical: null,
    notes: null, stats: null, createdAt: iso,
  });

  it("always draws six rows, so the grid does not resize between months", () => {
    // A calendar that changes height as you page through it is one that gets
    // mis-clicked.
    for (const m of [0, 1, 5, 11]) expect(monthGrid(2026, m)).toHaveLength(42);
  });

  it("covers the first of the month and borrows the surrounding days", () => {
    const grid = monthGrid(2026, 7);            // August 2026
    expect(grid.some(d => d.getMonth() === 7 && d.getDate() === 1)).toBe(true);
    expect(grid[0].getDay()).toBe(0);           // weeks start Sunday by default
  });

  it("stacks several missions on one day instead of letting the last win", () => {
    const g = groupByDay([
      mission("b", "2026-08-20T16:00:00Z"),
      mission("a", "2026-08-20T09:00:00Z"),
      mission("c", "2026-08-21T09:00:00Z"),
    ]);
    const day = g.get(dayKey("2026-08-20T09:00:00Z"))!;
    expect(day).toHaveLength(2);
    expect(day.map(m => m.id)).toEqual(["a", "b"]);   // and in time order
  });

  it("buckets by the viewer's local day, not UTC's", () => {
    // A 23:00 local mission must not land on tomorrow's cell because UTC has
    // already rolled over.
    const local = new Date(2026, 7, 20, 23, 30);
    expect(dayKey(local)).toBe("2026-08-20");
  });

  it("asks the database for exactly the span the grid can show", () => {
    const { fromISO, toISO } = monthRangeISO(2026, 7);
    const grid = monthGrid(2026, 7);
    expect(new Date(fromISO).getTime()).toBe(grid[0].getTime());
    expect(new Date(toISO).getTime()).toBeGreaterThan(grid[41].getTime());
  });
});

describe("refills", () => {
  it("needs no refill when one load covers the job, and says what is spare", () => {
    const r = planRefills(30, 40, 100);
    expect(r.loads).toBe(1);
    expect(r.refills).toBe(0);
    expect(r.dryFractions).toEqual([]);
    expect(r.leftoverLitres).toBeCloseTo(10, 9);
  });

  it("counts the trips back to the nurse tank", () => {
    // 100 L of chemical from a 40 L tank at full fill: three loads, two refills.
    const r = planRefills(100, 40, 100);
    expect(r.loads).toBe(3);
    expect(r.refills).toBe(2);
  });

  it("respects a partial fill — the tank the pilot actually loaded", () => {
    // Same job, tank filled to 50%: 20 L per load, so five loads.
    const r = planRefills(100, 40, 50);
    expect(r.perLoadLitres).toBeCloseTo(20, 9);
    expect(r.loads).toBe(5);
    expect(r.refills).toBe(4);
  });

  it("puts each dry point where that load actually runs out", () => {
    // 100 L job, 40 L loads: dry at 40% and 80% of the sprayed distance —
    // NOT evenly spaced thirds, and never at the end.
    const r = planRefills(100, 40, 100);
    expect(r.dryFractions).toHaveLength(2);
    expect(r.dryFractions[0]).toBeCloseTo(0.4, 9);
    expect(r.dryFractions[1]).toBeCloseTo(0.8, 9);
    for (const f of r.dryFractions) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("does not invent a refill when the job exactly fills the loads", () => {
    // 80 L from 40 L loads is two loads and one refill — not three.
    const r = planRefills(80, 40, 100);
    expect(r.loads).toBe(2);
    expect(r.refills).toBe(1);
    expect(r.leftoverLitres).toBeCloseTo(0, 9);
  });

  it("handles a non-sprayer or an empty job without dividing by zero", () => {
    expect(planRefills(50, 0, 100).refills).toBe(0);      // no tank
    expect(planRefills(0, 40, 100).loads).toBe(1);        // nothing to spray
    expect(planRefills(50, 40, 0).refills).toBe(0);       // tank not loaded
  });

  it("scales with the marked area, through the same volume figure the grid shows", () => {
    // The chemical number comes from computeMissionStats, so the refill count
    // and the Prescription panel cannot disagree about how much is needed.
    const litres = pesticideLitres([{ areaM2: 400_000, rateLha: 25 }]);   // 40 ha at 25 L/ha
    expect(litres).toBeCloseTo(1000, 6);
    expect(planRefills(litres, 40, 100).loads).toBe(25);
  });
});
