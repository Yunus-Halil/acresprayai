// Flight physics: mass decay, slosh, air, power, battery, turnarounds.
//
// These pin BEHAVIOUR, not magnitude. The coefficients feeding this model are
// unverified — a test asserting "a full T40 draws 74.3 A" would be encoding a
// guess as a requirement and would break the moment a real datasheet arrives.
// What must hold regardless of the constants is the shape: heavier costs more,
// an empty tank cannot slosh, a reserve is never spent, turns are never free.
import { describe, it, expect } from "vitest";
import {
  DRIFT_CAUTION_MS, DRIFT_UNSAFE_MS, RHO_SEA_LEVEL, T40_PHYSICS,
  airDensity, allUpWeightKg, computeAmpDraw, densityPowerFactor, driftRisk,
  enduranceMinutes, physicsFor, pitchFromAccel, remainingLitres, staticFillOffsetCm,
  stepSlosh, sloshTargetCm, totalCogOffsetCm, turnCount, turnaroundCost, usableAh,
} from "@/lib/dronePhysics";

const CFG = T40_PHYSICS;

describe("tank drain", () => {
  it("drains at the flow rate while spraying", () => {
    // 24 L/min for 60 s = 24 L gone.
    expect(remainingLitres(40, 60, 24)).toBeCloseTo(16, 9);
  });

  it("reaches exactly zero and stays clamped there", () => {
    expect(remainingLitres(40, 60 * 10, 24)).toBe(0);
    expect(remainingLitres(0, 9999, 24)).toBe(0);
  });

  it("never refills itself", () => {
    // Negative elapsed time must not run the pump backwards.
    expect(remainingLitres(20, -100, 24)).toBeLessThanOrEqual(20);
  });

  it("holds level when nothing is being pumped", () => {
    expect(remainingLitres(40, 120, 0)).toBe(40);
  });

  it("weighs the airframe plus what is left in the tank", () => {
    expect(allUpWeightKg(CFG, 40)).toBeCloseTo(CFG.dryWeightKg + 40, 9);
    expect(allUpWeightKg(CFG, 0)).toBeCloseTo(CFG.dryWeightKg, 9);
    // Batteries live inside dry weight; adding them again would double count.
    expect(allUpWeightKg(CFG, 0)).toBeLessThan(allUpWeightKg(CFG, 1));
  });
});

describe("pitch", () => {
  it("is zero in level flight and signed with acceleration", () => {
    expect(pitchFromAccel(0, CFG)).toBe(0);
    expect(pitchFromAccel(3, CFG)).toBeGreaterThan(0);
    expect(pitchFromAccel(-3, CFG)).toBeLessThan(0);
  });

  it("clamps to the airframe limit rather than flying like a racing quad", () => {
    expect(pitchFromAccel(500, CFG)).toBe(CFG.maxPitchDeg);
    expect(pitchFromAccel(-500, CFG)).toBe(-CFG.maxPitchDeg);
  });

  it("matches tan(pitch) = a/g", () => {
    // At a = g the aircraft is tilted 45°, which the clamp then limits.
    const unclamped = { ...CFG, maxPitchDeg: 89 };
    expect(pitchFromAccel(9.80665, unclamped)).toBeCloseTo(45, 6);
  });
});

describe("slosh", () => {
  it("cannot happen in an empty tank, whatever the pitch", () => {
    // The property the brief calls out explicitly: no liquid, no slosh.
    expect(sloshTargetCm(CFG.maxPitchDeg, 0, CFG)).toBe(0);
    expect(stepSlosh(9, 9, 0, 0.1, CFG)).toBe(0);
  });

  it("throws liquid AFT under forward acceleration and FORWARD under braking", () => {
    // Sign convention: positive is aft. Getting this backwards would put the
    // CoG correction on the wrong pair of rotors.
    expect(sloshTargetCm(pitchFromAccel(4, CFG), 1, CFG)).toBeGreaterThan(0);
    expect(sloshTargetCm(pitchFromAccel(-4, CFG), 1, CFG)).toBeLessThan(0);
  });

  it("scales with how much liquid there is", () => {
    const full = sloshTargetCm(10, 1, CFG);
    const half = sloshTargetCm(10, 0.5, CFG);
    expect(Math.abs(half)).toBeLessThan(Math.abs(full));
    expect(half).toBeCloseTo(full / 2, 9);
  });

  it("approaches the target instead of teleporting to it", () => {
    // Liquid has momentum. One tick must not land on the answer.
    const afterOneTick = stepSlosh(0, 10, 1, 0.1, CFG);
    expect(afterOneTick).toBeGreaterThan(0);
    expect(afterOneTick).toBeLessThan(10);
  });

  it("settles to the target given enough time", () => {
    let off = 0;
    for (let i = 0; i < 400; i++) off = stepSlosh(off, 10, 1, 0.05, CFG);
    expect(off).toBeCloseTo(10, 3);
  });

  it("settles faster with a nearly empty tank than a full one", () => {
    // More liquid, more momentum, slower to settle.
    const full = stepSlosh(0, 10, 1, 0.2, CFG);
    const nearlyEmpty = stepSlosh(0, 10, 0.05, 0.2, CFG);
    // Compare fraction of the way travelled, not absolute cm.
    expect(nearlyEmpty / 10).toBeGreaterThan(full / 10);
  });

  it("relaxes back toward level when the pitch goes away", () => {
    let off = 10;
    for (let i = 0; i < 400; i++) off = stepSlosh(off, 0, 1, 0.05, CFG);
    expect(Math.abs(off)).toBeLessThan(0.05);
  });
});

describe("static fill offset", () => {
  it("is zero at full and displaced at empty", () => {
    expect(staticFillOffsetCm(1, CFG)).toBeCloseTo(0, 9);
    expect(staticFillOffsetCm(0, CFG)).toBeCloseTo(-CFG.staticFillOffsetCm, 9);
  });

  it("adds to the dynamic offset rather than replacing it", () => {
    expect(totalCogOffsetCm(-2, 5)).toBe(3);
  });
});

describe("air density", () => {
  it("matches the standard atmosphere at sea level and 15 °C", () => {
    // This one IS checkable against a reference: 1.225 kg/m³.
    expect(airDensity(15, 0, 0)).toBeCloseTo(RHO_SEA_LEVEL, 2);
  });

  it("thins with altitude and with heat", () => {
    expect(airDensity(15, 2000, 0)).toBeLessThan(airDensity(15, 0, 0));
    expect(airDensity(35, 0, 0)).toBeLessThan(airDensity(15, 0, 0));
  });

  it("makes humid air lighter than dry air, which is counterintuitive but real", () => {
    // Water vapour is 18 g/mol displacing ~29 g/mol air.
    expect(airDensity(30, 0, 1)).toBeLessThan(airDensity(30, 0, 0));
  });

  it("costs power when the air thins", () => {
    expect(densityPowerFactor(RHO_SEA_LEVEL)).toBeCloseTo(1, 6);
    expect(densityPowerFactor(1.0)).toBeGreaterThan(1);
  });
});

describe("wind and drift", () => {
  it("flags the 10–12 mph advisory band and past it", () => {
    expect(driftRisk(2).level).toBe("ok");
    expect(driftRisk(DRIFT_CAUTION_MS + 0.1).level).toBe("caution");
    expect(driftRisk(DRIFT_UNSAFE_MS + 0.1).level).toBe("unsafe");
  });

  it("lets a gust push an otherwise-calm reading into unsafe", () => {
    expect(driftRisk(1, DRIFT_UNSAFE_MS + 3).level).toBe("unsafe");
  });
});

describe("amp draw", () => {
  it("rises with all-up weight", () => {
    const rho = RHO_SEA_LEVEL;
    const light = computeAmpDraw(allUpWeightKg(CFG, 0), 0, rho, CFG);
    const heavy = computeAmpDraw(allUpWeightKg(CFG, 40), 0, rho, CFG);
    expect(heavy).toBeGreaterThan(light);
  });

  it("rises faster than linearly with weight", () => {
    // Momentum theory gives P ∝ m^1.5, which is why a full tank costs
    // disproportionately more than a half one — and why a linear model
    // understates the start of every mission.
    const rho = RHO_SEA_LEVEL;
    const a = computeAmpDraw(50, 0, rho, CFG);
    const b = computeAmpDraw(100, 0, rho, CFG);
    expect(b / a).toBeGreaterThan(2);
  });

  it("rises with imbalance in either direction", () => {
    const rho = RHO_SEA_LEVEL;
    const level = computeAmpDraw(80, 0, rho, CFG);
    expect(computeAmpDraw(80, 6, rho, CFG)).toBeGreaterThan(level);
    expect(computeAmpDraw(80, -6, rho, CFG)).toBeGreaterThan(level);
  });

  it("rises in thinner air", () => {
    expect(computeAmpDraw(80, 0, 0.9, CFG)).toBeGreaterThan(computeAmpDraw(80, 0, RHO_SEA_LEVEL, CFG));
  });
});

describe("battery reserve", () => {
  it("never offers the reserve for planning", () => {
    // The whole point. Sizing against nameplate is how an operator walks into
    // a field to fetch an aircraft.
    const usable = usableAh(CFG, 0, 0.2);
    expect(usable).toBeCloseTo(CFG.batteryCapacityAh * 0.8, 6);
    expect(usable).toBeLessThan(CFG.batteryCapacityAh);
  });

  it("takes another cut for age", () => {
    expect(usableAh(CFG, 500, 0.2)).toBeLessThan(usableAh(CFG, 0, 0.2));
  });

  it("does not let an ancient pack fall to nothing", () => {
    expect(usableAh(CFG, 100_000, 0.2)).toBeGreaterThan(0);
  });

  it("converts usable capacity to minutes at a draw", () => {
    expect(enduranceMinutes(24, 24)).toBeCloseTo(60, 6);
    expect(enduranceMinutes(24, 0)).toBe(0);
  });
});

describe("turnarounds", () => {
  it("are never free", () => {
    // The largest structural error in a naive distance-over-speed estimate.
    const cost = turnaroundCost(10, 6, 70, CFG);
    expect(cost.seconds).toBeGreaterThan(0);
    expect(cost.ampSeconds).toBeGreaterThan(0);
  });

  it("cost more when there are more of them", () => {
    expect(turnaroundCost(20, 6, 70, CFG).seconds)
      .toBeGreaterThan(turnaroundCost(10, 6, 70, CFG).seconds);
  });

  it("cost more from a higher speed, because there is more to shed", () => {
    expect(turnaroundCost(10, 10, 70, CFG).seconds)
      .toBeGreaterThan(turnaroundCost(10, 4, 70, CFG).seconds);
  });

  it("counts one fewer turn than there are rows", () => {
    // 10 rows means 9 turns — you do not turn at the end of the last one.
    expect(turnCount(10 * 11 * 200, 11, 200)).toBe(9);
    expect(turnCount(0, 11, 200)).toBe(0);
  });

  it("finds more turns in a field flown as many short rows", () => {
    const area = 100_000;
    expect(turnCount(area, 11, 100)).toBeGreaterThan(turnCount(area, 11, 400));
  });
});

describe("config", () => {
  it("falls back to a known airframe rather than undefined", () => {
    expect(physicsFor(null).model).toBe(T40_PHYSICS.model);
    expect(physicsFor("Something Unheard Of").model).toBe(T40_PHYSICS.model);
    expect(physicsFor("DJI Agras T40")).toBe(T40_PHYSICS);
  });
});
