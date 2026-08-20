// Tank profile — the state the widget draws, and the reason scrubbing works.
import { describe, it, expect } from "vitest";
import { buildTankProfile, sampleTankAt, surfaceTiltDeg } from "@/lib/tankProfile";
import { T40_PHYSICS } from "@/lib/dronePhysics";

const CFG = T40_PHYSICS;

/** Transit up to speed, spray a long leg, brake to a stop. */
const SEGS = [
  { speed: 10, spray: false, tStart: 0, tEnd: 20 },
  { speed: 6, spray: true, tStart: 20, tEnd: 320 },
  { speed: 0, spray: false, tStart: 320, tEnd: 340 },
];
const TOTAL = 340;

const profileOf = (over = {}) =>
  buildTankProfile(SEGS, TOTAL, { config: CFG, startLitres: 40, flowLpm: 8, ...over });

describe("draining", () => {
  it("starts full and ends lighter", () => {
    const p = profileOf();
    const first = p.samples[0];
    const last = p.samples[p.samples.length - 1];
    expect(first.litres).toBeCloseTo(40, 6);
    expect(last.litres).toBeLessThan(first.litres);
    expect(last.auwKg).toBeLessThan(first.auwKg);
  });

  it("only drains while spraying", () => {
    // The transit leg at the start must not cost a drop.
    const p = profileOf();
    const duringTransit = sampleTankAt(p, 10)!;
    expect(duringTransit.litres).toBeCloseTo(40, 6);
    expect(duringTransit.spraying).toBe(false);
  });

  it("never goes below empty however long the spray runs", () => {
    const p = buildTankProfile(SEGS, TOTAL, { config: CFG, startLitres: 5, flowLpm: 60 });
    expect(p.samples.every(s => s.litres >= 0)).toBe(true);
    expect(p.samples[p.samples.length - 1].litres).toBe(0);
  });

  it("drains evenly when no pump rate is known", () => {
    // Honest fallback: spread the load over the spray legs rather than invent
    // a pump curve. The tank should be near empty by the end.
    const p = buildTankProfile(SEGS, TOTAL, { config: CFG, startLitres: 40 });
    expect(p.samples[p.samples.length - 1].litres).toBeLessThan(1);
  });
});

describe("slosh through the flight profile", () => {
  it("throws fluid forward when the aircraft brakes", () => {
    // The transit leg runs at 10 m/s into a 6 m/s spray leg, so t=20 is a real
    // deceleration with a full tank behind it.
    const p = profileOf();
    const braking = sampleTankAt(p, 20)!;
    expect(braking.accelMs2).toBeLessThan(0);
    expect(braking.pitchDeg).toBeLessThan(0);
    expect(braking.sloshCm).toBeLessThan(0);   // forward, toward the nose
  });

  it("throws fluid aft when the aircraft accelerates", () => {
    const p = buildTankProfile(
      [{ speed: 0, spray: false, tStart: 0, tEnd: 10 },
       { speed: 9, spray: false, tStart: 10, tEnd: 60 }],
      60, { config: CFG, startLitres: 40, flowLpm: 0 },
    );
    const accelerating = sampleTankAt(p, 10)!;
    expect(accelerating.accelMs2).toBeGreaterThan(0);
    expect(accelerating.sloshCm).toBeGreaterThan(0);   // aft, toward the tail
  });

  it("stays level under a violent manoeuvre once the tank is dry", () => {
    // At t=320 the aircraft brakes from 6 m/s to nothing — full pitch — but
    // 8 L/min over the 300 s spray leg has emptied the tank exactly. No fluid,
    // no slosh, however hard it is thrown about.
    const p = profileOf();
    const dry = sampleTankAt(p, 320)!;
    expect(dry.litres).toBe(0);
    expect(Math.abs(dry.pitchDeg)).toBeGreaterThan(20);
    expect(dry.sloshCm).toBe(0);
  });

  it("settles during steady cruise rather than staying tilted", () => {
    // Mid-spray, speed is constant, so there is nothing tilting the aircraft.
    const p = profileOf();
    const cruising = sampleTankAt(p, 200)!;
    expect(Math.abs(cruising.accelMs2)).toBeLessThan(0.01);
    expect(Math.abs(cruising.sloshCm)).toBeLessThan(0.5);
  });

  it("cannot slosh once the tank is dry", () => {
    const p = buildTankProfile(SEGS, TOTAL, { config: CFG, startLitres: 2, flowLpm: 60 });
    const late = p.samples[p.samples.length - 1];
    expect(late.litres).toBe(0);
    expect(late.sloshCm).toBe(0);
  });
});

describe("current draw", () => {
  it("falls as the tank empties", () => {
    // The headline claim of the whole model: the aircraft gets cheaper to fly.
    const p = profileOf();
    const early = sampleTankAt(p, 25)!;
    const late = sampleTankAt(p, 315)!;
    expect(late.amps).toBeLessThan(early.amps);
  });
});

describe("charge consumption", () => {
  it("spends charge faster on the loaded leg than on the way home", () => {
    // The bug this exists to prevent: a battery bar linear in TIME drains at the
    // same rate with a full tank as with an empty one. It does not — the
    // aircraft is heaviest outbound, and hover power goes as mass^1.5.
    const p = profileOf();
    const q = p.total / 4;
    const firstQuarter = sampleTankAt(p, q)!.cumAmpS;
    const lastQuarter = p.totalAmpS - sampleTankAt(p, p.total - q)!.cumAmpS;
    expect(firstQuarter).toBeGreaterThan(lastQuarter);
  });

  it("accumulates monotonically and ends at the mission total", () => {
    const p = profileOf();
    for (let i = 1; i < p.samples.length; i++) {
      expect(p.samples[i].cumAmpS).toBeGreaterThanOrEqual(p.samples[i - 1].cumAmpS);
    }
    expect(p.samples[p.samples.length - 1].cumAmpS).toBeCloseTo(p.totalAmpS, 6);
  });

  it("starts at zero — no charge is spent before takeoff", () => {
    expect(profileOf().samples[0].cumAmpS).toBe(0);
  });
});

describe("sampling", () => {
  it("answers any moment, in any order — which is what scrubbing needs", () => {
    // Dragging the scrubber jumps to moments that were never played. Each must
    // return what playback would have produced, not a replay from zero.
    const p = profileOf();
    const forward = [50, 120, 200, 300].map(t => sampleTankAt(p, t)!.litres);
    const backward = [300, 200, 120, 50].map(t => sampleTankAt(p, t)!.litres).reverse();
    expect(backward).toEqual(forward);
  });

  it("interpolates between samples instead of snapping to a staircase", () => {
    const p = profileOf();
    const a = sampleTankAt(p, 100)!;
    const mid = sampleTankAt(p, 100 + p.dt / 2)!;
    const b = sampleTankAt(p, 100 + p.dt)!;
    expect(mid.litres).toBeLessThan(a.litres);
    expect(mid.litres).toBeGreaterThan(b.litres);
  });

  it("clamps outside the mission rather than returning nonsense", () => {
    const p = profileOf();
    expect(sampleTankAt(p, -50)!.t).toBe(0);
    expect(sampleTankAt(p, TOTAL + 500)!.t).toBe(TOTAL);
  });
});

describe("surface tilt", () => {
  it("is level with no slosh and leans with the fluid", () => {
    expect(surfaceTiltDeg(0, CFG)).toBe(0);
    expect(surfaceTiltDeg(6, CFG)).toBeGreaterThan(0);
    expect(surfaceTiltDeg(-6, CFG)).toBeLessThan(0);
  });

  it("stays within an angle that still reads as a liquid surface", () => {
    expect(Math.abs(surfaceTiltDeg(9999, CFG))).toBeLessThanOrEqual(18);
  });
});
