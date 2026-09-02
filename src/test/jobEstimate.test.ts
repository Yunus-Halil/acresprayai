// The job estimate: loads, refill stops, packs, and the gap between flight time
// and a day.
//
// The load walk is the part worth guarding. It is the only place where the tank
// and the battery are allowed to disagree about what ends a load, and getting it
// wrong is silent in both directions — size the day on the tank and the swaps
// vanish, size it on the battery and the refills do.
import { describe, expect, it } from "vitest";
import { GENERIC_PROFILE, midpoint, resolveAgrasProfile } from "@/lib/agrasProfiles";
import {
  DEFAULT_GROUND_OPS, type JobEstimateInput, estimateJob, fmtMinutes,
} from "@/lib/jobEstimate";
import { M2_PER_HECTARE } from "@/lib/units";

const t50 = resolveAgrasProfile("DJI Agras T50");

/** A 20 ha job on a T50 at 25 L/ha, every assumption at its default. */
function base(over: Partial<JobEstimateInput> = {}): JobEstimateInput {
  return {
    profile: t50.profile,
    profileMatched: t50.matched,
    treatedAreaM2: 20 * M2_PER_HECTARE,
    applicationRateLha: 25,
    advertisedSwathM: midpoint(t50.profile.swath_m),
    effectiveSwathFactor: 0.70,
    inCanopy: false,
    speedMs: midpoint(t50.profile.speed_ms),
    heightM: midpoint(t50.profile.height_m),
    tankLoadPct: 100,
    nozzles: 4,
    elevationM: 0,
    tankCapacityL: 40,
    ground: { ...DEFAULT_GROUND_OPS },
    ...over,
  };
}

const warn = (e: ReturnType<typeof estimateJob>, field: string) =>
  e.warnings.find(w => w.field === field);

describe("treated acreage leads, and comes from the marked ground", () => {
  it("reports the area it was given, untouched by the aircraft", () => {
    const a = estimateJob(base());
    const b = estimateJob(base({ profile: GENERIC_PROFILE, profileMatched: false }));
    expect(a.treatedAreaHa).toBe(20);
    expect(b.treatedAreaHa).toBe(20);
  });

  it("prices the chemical off area and rate alone", () => {
    expect(estimateJob(base()).requiredLitres).toBeCloseTo(500, 6);
    expect(estimateJob(base({ applicationRateLha: 50 })).requiredLitres).toBeCloseTo(1000, 6);
  });
});

describe("effective swath", () => {
  it("applies the calibration factor to the advertised width", () => {
    // 10 m advertised at the default 0.70.
    expect(estimateJob(base()).effectiveSwathM).toBeCloseTo(7, 6);
  });

  it("is what the coverage rate is built on, not the advertised width", () => {
    const e = estimateJob(base());
    expect(e.coverageRateM2S).toBeCloseTo(7 * 8.5, 6);
  });

  it("narrows the swath and lengthens the job when the factor drops", () => {
    const loose = estimateJob(base({ effectiveSwathFactor: 1.0 }));
    const tight = estimateJob(base({ effectiveSwathFactor: 0.65 }));
    expect(tight.effectiveSwathM).toBeLessThan(loose.effectiveSwathM);
    expect(tight.sprayFlightMin).toBeGreaterThan(loose.sprayFlightMin);
  });

  it("caps in-canopy work at 7 m however wide the aircraft is", () => {
    // A T50 at the top of its envelope with no calibration loss would be 11 m.
    const e = estimateJob(base({
      inCanopy: true, effectiveSwathFactor: 1.0,
      advertisedSwathM: 11, speedMs: 10, heightM: 3.5,
    }));
    expect(e.effectiveSwathM).toBe(7);
    expect(e.inCanopyCapped).toBe(true);
    expect(warn(e, "inCanopy")).toBeTruthy();
  });

  it("leaves an already-narrow in-canopy swath alone", () => {
    const e = estimateJob(base({ inCanopy: true }));
    expect(e.effectiveSwathM).toBeCloseTo(7, 6);
    expect(e.inCanopyCapped).toBe(false);
  });

  it("clamps a swath the speed and height cannot deliver, and warns", () => {
    const e = estimateJob(base({ advertisedSwathM: 11, speedMs: 7, heightM: 3 }));
    expect(e.swath.clamped).toBe(true);
    expect(e.swath.swathM).toBeCloseTo(9, 6);
    expect(warn(e, "advertisedSwathM")).toBeTruthy();
  });
});

describe("tank loads and refill stops", () => {
  it("counts loads from chemical over capacity, and stops as loads minus one", () => {
    // 500 L needed, 40 L a load -> 13 loads, 12 stops.
    const e = estimateJob(base());
    expect(e.tankLoads).toBe(13);
    expect(e.refillStops).toBe(12);
  });

  it("reports the ground one load covers", () => {
    // 40 L at 25 L/ha is 1.6 ha.
    expect(estimateJob(base()).areaPerLoadM2).toBeCloseTo(1.6 * M2_PER_HECTARE, 6);
  });

  it("needs no stop when one load covers the job", () => {
    const e = estimateJob(base({ treatedAreaM2: 1 * M2_PER_HECTARE }));
    expect(e.tankLoads).toBe(1);
    expect(e.refillStops).toBe(0);
    expect(e.leftoverLitres).toBeCloseTo(15, 6);
  });

  it("takes a part fill at its word", () => {
    const e = estimateJob(base({ tankLoadPct: 50 }));
    expect(e.perLoadLitres).toBe(20);
    expect(e.tankLoads).toBe(25);
  });

  it("takes the elevation derate off the load, and says so", () => {
    const e = estimateJob(base({ elevationM: 1000 }));
    expect(e.perLoadLitres).toBeCloseTo(30, 6);
    expect(warn(e, "elevationM")).toBeTruthy();
  });

  it("prefers a stated capacity over the profile's", () => {
    const stated = estimateJob(base({ tankCapacityL: 30 }));
    expect(stated.perLoadLitres).toBe(30);
  });

  it("warns when it is running on a quoted capacity nobody published", () => {
    const t20 = resolveAgrasProfile("DJI Agras T20");
    const e = estimateJob(base({
      profile: t20.profile, profileMatched: t20.matched, tankCapacityL: null,
      advertisedSwathM: midpoint(t20.profile.swath_m),
      speedMs: midpoint(t20.profile.speed_ms),
      heightM: midpoint(t20.profile.height_m),
    }));
    expect(warn(e, "tank_l")).toBeTruthy();
  });
});

describe("flow", () => {
  it("computes what the rate and speed demand of the pump", () => {
    // 7 m x 8.5 m/s = 59.5 m2/s = 0.357 ha/min, at 25 L/ha.
    const e = estimateJob(base());
    expect(e.requiredFlowLpm).toBeCloseTo(8.925, 3);
    expect(e.maxFlowLpm).toBe(24);
    expect(e.flowCeilingExceeded).toBe(false);
  });

  it("flags a rate the pump cannot deliver at that speed, and says how slow to fly", () => {
    // 80 L/ha overruns the 24 L/min pump at 8.5 m/s but fits at the bottom of
    // the speed envelope, so there is a speed to name.
    const e = estimateJob(base({ applicationRateLha: 80 }));
    expect(e.flowCeilingExceeded).toBe(true);
    expect(e.maxSpeedForRateMs).toBeGreaterThan(0);
    expect(e.maxSpeedForRateMs!).toBeLessThan(8.5);
    expect(warn(e, "speedMs")?.severity).toBe("note");
    // At the speed it names, the demand lands ON the ceiling rather than under
    // it. That is the whole point of solving instead of dividing: slowing down
    // narrows the swath too, so a linear guess leaves speed on the table.
    const slowed = estimateJob(base({ applicationRateLha: 80, speedMs: e.maxSpeedForRateMs! }));
    expect(slowed.requiredFlowLpm).toBeCloseTo(24, 3);
    expect(slowed.flowCeilingExceeded).toBe(false);
  });

  it("says the rate is unflyable when no speed in the envelope delivers it", () => {
    // Slowing down cannot rescue this one, because the swath narrows with it.
    const e = estimateJob(base({ applicationRateLha: 400 }));
    expect(e.flowCeilingExceeded).toBe(true);
    expect(e.maxSpeedForRateMs).toBeNull();
    expect(warn(e, "speedMs")?.severity).toBe("blocking");
    expect(warn(e, "speedMs")?.message).toMatch(/nozzles/);
  });

  it("reports the continuous-spray floor on a load", () => {
    // 40 L at the 24 L/min ceiling.
    expect(estimateJob(base()).minTimePerTankMin).toBeCloseTo(40 / 24, 6);
  });

  it("says nothing was checked when no ceiling is verified", () => {
    const t30 = resolveAgrasProfile("DJI Agras T30");
    const e = estimateJob(base({
      profile: t30.profile, profileMatched: t30.matched, tankCapacityL: 30,
      advertisedSwathM: midpoint(t30.profile.swath_m),
      speedMs: midpoint(t30.profile.speed_ms),
      heightM: midpoint(t30.profile.height_m),
    }));
    expect(e.maxFlowLpm).toBeNull();
    expect(e.minTimePerTankMin).toBeNull();
    // Absent, not false: an unchecked ceiling must never read as a passed check.
    expect(e.flowCeilingExceeded).toBe(false);
    expect(warn(e, "flow_lpm")?.severity).toBe("blocking");
  });
});

describe("battery, and which constraint binds", () => {
  it("derives endurance from hover at load rather than a nominal flight time", () => {
    expect(estimateJob(base()).batteryEnduranceMin).toBe(7);
  });

  it("lets the tank end the load when the tank runs out first", () => {
    // 40 L at 8.925 L/min is 4.5 min of spraying, inside a fresh 7 min pack.
    const e = estimateJob(base());
    expect(e.loads[0].sprayMin).toBeLessThan(7);
    expect(e.loads[0].binds).toBe("tank");
    expect(e.loads[0].midLoadSwaps).toBe(0);
  });

  it("carries a part-used pack into the next load rather than starting fresh", () => {
    // The pack does not reset at a refill: 4.5 minutes of spraying leaves 2.5
    // on a 7 minute pack, which is less than the next load needs. So the second
    // load is battery-bound even though no single load outlasts a pack. A model
    // that reset the pack per load would report zero swaps for the whole job.
    const e = estimateJob(base());
    expect(e.loads[1].binds).toBe("battery");
    expect(e.loads.some(l => l.binds === "tank")).toBe(true);
    expect(e.batteryChanges).toBeGreaterThan(0);
  });

  it("lets the battery end the load when the pack runs out first", () => {
    // A low rate makes a load last a long time, so the pack gives out inside it.
    const e = estimateJob(base({ applicationRateLha: 3 }));
    expect(e.loads[0].sprayMin).toBeGreaterThan(7);
    expect(e.loads[0].binds).toBe("battery");
    expect(e.loads[0].midLoadSwaps).toBeGreaterThan(0);
  });

  it("counts pack swaps across the job", () => {
    const e = estimateJob(base());
    expect(e.batteryChanges).toBeGreaterThan(0);
    // Total airtime over endurance, less the pack it started on.
    const airtime = e.sprayFlightMin;
    expect(e.batteryChanges!).toBeGreaterThanOrEqual(Math.floor(airtime / 7) - 1);
  });

  it("does not compute a pack count it cannot stand behind", () => {
    const t30 = resolveAgrasProfile("DJI Agras T30");
    const e = estimateJob(base({
      profile: t30.profile, profileMatched: t30.matched, tankCapacityL: 30,
      advertisedSwathM: midpoint(t30.profile.swath_m),
      speedMs: midpoint(t30.profile.speed_ms),
      heightM: midpoint(t30.profile.height_m),
    }));
    expect(e.batteryEnduranceMin).toBeNull();
    expect(e.batteryChanges).toBeNull();
    expect(e.loads.every(l => l.binds === "unknown")).toBe(true);
    expect(warn(e, "hover")?.severity).toBe("blocking");
  });

  it("makes the aircraft wait when there are too few packs to rotate", () => {
    const few = estimateJob(base({
      ground: { ...DEFAULT_GROUND_OPS, batteriesOnHand: 2, batteryCooldownMin: 30 },
    }));
    const many = estimateJob(base({
      ground: { ...DEFAULT_GROUND_OPS, batteriesOnHand: 6, batteryCooldownMin: 30 },
    }));
    expect(few.coolingWaitMin).toBeGreaterThan(0);
    expect(many.coolingWaitMin).toBeLessThan(few.coolingWaitMin);
    expect(few.totalJobMin).toBeGreaterThan(many.totalJobMin);
    expect(warn(few, "batteriesOnHand")).toBeTruthy();
  });

  it("charges ferry flight against the pack as well as the clock", () => {
    const grounded = estimateJob(base());
    const ferried = estimateJob(base({
      ground: { ...DEFAULT_GROUND_OPS, ferryMinPerLoad: 4 },
    }));
    expect(ferried.batteryChanges!).toBeGreaterThan(grounded.batteryChanges!);
  });
});

describe("productive time against a day", () => {
  it("keeps spray time free of everything that is not spraying", () => {
    const e = estimateJob(base());
    // 20 ha at 59.5 m2/s.
    expect(e.sprayFlightMin).toBeCloseTo((20 * M2_PER_HECTARE) / 59.5 / 60, 6);
    expect(e.productiveMin).toBe(e.sprayFlightMin);
  });

  it("adds up to a total that exceeds it", () => {
    const e = estimateJob(base());
    expect(e.totalJobMin).toBeGreaterThan(e.productiveMin);
    expect(e.totalJobMin).toBeCloseTo(e.productiveMin + e.nonProductive.total, 6);
    expect(e.nonProductive.total).toBeCloseTo(
      e.nonProductive.ferryMin + e.nonProductive.refillMin
      + e.nonProductive.batterySwapMin + e.nonProductive.coolingMin, 6);
  });

  it("charges refill time to the stops, not to the loads", () => {
    // The first tank is filled before the aircraft launches.
    const e = estimateJob(base());
    expect(e.nonProductive.refillMin).toBeCloseTo(e.refillStops * DEFAULT_GROUND_OPS.refillMin, 6);
    const single = estimateJob(base({ treatedAreaM2: 1 * M2_PER_HECTARE }));
    expect(single.nonProductive.refillMin).toBe(0);
  });

  it("charges ferry time to every load", () => {
    const e = estimateJob(base({ ground: { ...DEFAULT_GROUND_OPS, ferryMinPerLoad: 3 } }));
    expect(e.nonProductive.ferryMin).toBeCloseTo(e.tankLoads * 3, 6);
  });

  it("shows a gap wide enough to be the point", () => {
    // 13 loads of ground time on a job with well under an hour of spraying.
    const e = estimateJob(base({ ground: { ...DEFAULT_GROUND_OPS, ferryMinPerLoad: 3 } }));
    expect(e.nonProductive.total).toBeGreaterThan(e.productiveMin);
  });
});

describe("degenerate input", () => {
  it("returns zeros rather than infinities on no ground", () => {
    const e = estimateJob(base({ treatedAreaM2: 0 }));
    expect(e.requiredLitres).toBe(0);
    expect(e.sprayFlightMin).toBe(0);
    expect(e.tankLoads).toBe(1);
    expect(e.refillStops).toBe(0);
    expect(Number.isFinite(e.totalJobMin)).toBe(true);
  });

  it("survives a zero rate", () => {
    const e = estimateJob(base({ applicationRateLha: 0 }));
    expect(e.requiredLitres).toBe(0);
    expect(e.areaPerLoadM2).toBe(0);
    expect(Number.isFinite(e.totalJobMin)).toBe(true);
  });

  it("survives an empty tank setting", () => {
    const e = estimateJob(base({ tankLoadPct: 0 }));
    expect(e.perLoadLitres).toBe(0);
    expect(e.tankLoads).toBe(0);
    expect(Number.isFinite(e.totalJobMin)).toBe(true);
  });

  it("labels a generic estimate as one", () => {
    const e = estimateJob(base({ profile: GENERIC_PROFILE, profileMatched: false }));
    expect(warn(e, "profile")).toBeTruthy();
  });
});

describe("fmtMinutes", () => {
  it("reads like a day, not like a float", () => {
    expect(fmtMinutes(0)).toBe("0m");
    expect(fmtMinutes(24.4)).toBe("24m");
    expect(fmtMinutes(84)).toBe("1h 24m");
    expect(fmtMinutes(120)).toBe("2h 0m");
    expect(fmtMinutes(NaN)).toBe("0m");
  });
});
