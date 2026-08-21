// The hero's instruments run the real model. These pin the properties that
// make the marketing claim true, so a change that quietly turns the panel into
// decoration fails here instead of on the homepage.
import { describe, it, expect } from "vitest";
import {
  HERO_FLIGHT_FROM, HERO_FLIGHT_TO, SPRAY_ALT_M, TRANSIT_ALT_M,
  buildHeroMission, heroTelemetryAt, sprayingAt,
} from "@/lib/heroTelemetry";

const mission = buildHeroMission();
const frames = Array.from({ length: 120 }, (_, i) =>
  heroTelemetryAt(mission, HERO_FLIGHT_FROM + (HERO_FLIGHT_TO - HERO_FLIGHT_FROM) * (i / 119)));

describe("the demo mission is a plausible job", () => {
  it("flies a real distance in a time a T40 could actually manage", () => {
    expect(mission.totalDistM).toBeGreaterThan(2000);
    expect(mission.totalTimeS / 60).toBeLessThan(18);   // the airframe's endurance
    expect(mission.requiredLitres).toBeGreaterThan(0);
    expect(mission.requiredLitres).toBeLessThanOrEqual(40);
  });

  it("sprays only over the zones the picture draws", () => {
    // The instruments and the drawing share one geometry, so a marker inside a
    // green zone must read SPRAYING.
    expect(sprayingAt(300, 150)).toBe(true);    // inside zone 1
    expect(sprayingAt(1000, 60)).toBe(false);   // bare corner
    expect(mission.segs.some(s => s.spray)).toBe(true);
    expect(mission.segs.some(s => !s.spray)).toBe(true);
  });
});

describe("what the panel shows is model output", () => {
  it("drains the tank and never refills it mid-flight", () => {
    const litres = frames.map(f => f.sample?.litres ?? 0);
    for (let i = 1; i < litres.length; i++) {
      expect(litres[i]).toBeLessThanOrEqual(litres[i - 1] + 1e-9);
    }
    expect(litres[0]).toBeGreaterThan(litres[litres.length - 1]);
  });

  it("draws less current as the aircraft lightens", () => {
    const first = frames[5].sample?.amps ?? 0;
    const last = frames[frames.length - 5].sample?.amps ?? 0;
    expect(last).toBeLessThan(first);
  });

  it("spends battery faster while the tank is full", () => {
    // The claim the endurance model exists to make. Equal slices of the
    // flight, unequal cost.
    const at = (i: number) => frames[i].batteryPct;
    const early = at(0) - at(20);
    const late = at(frames.length - 21) - at(frames.length - 1);
    expect(early).toBeGreaterThan(late);
  });

  it("actually sloshes — the headline feature must not read zero throughout", () => {
    const peak = Math.max(...frames.map(f => Math.abs(f.sample?.sloshCm ?? 0)));
    expect(peak).toBeGreaterThan(0.5);
  });

  it("settles the fluid on the straights instead of shaking permanently", () => {
    const quiet = frames.filter(f => Math.abs(f.sample?.sloshCm ?? 0) < 0.05);
    expect(quiet.length).toBeGreaterThan(frames.length / 4);
  });

  it("flies low over the crop and high in transit", () => {
    const alts = new Set(frames.map(f => f.altitudeM));
    expect(alts.has(SPRAY_ALT_M)).toBe(true);
    expect(alts.has(TRANSIT_ALT_M)).toBe(true);
  });
});

describe("before the marker takes off", () => {
  it("spends most of the loop flying, not parked", () => {
    // The panel is the reason to stop and look at the hero. If the flight
    // window shrinks back towards half the loop, it is a frozen readout again.
    expect(HERO_FLIGHT_TO - HERO_FLIGHT_FROM).toBeGreaterThan(0.6);
  });

  it("reads standby rather than inventing a flight", () => {
    const pre = heroTelemetryAt(mission, 0.1);
    expect(pre.flying).toBe(false);
    expect(pre.batteryPct).toBe(100);
    expect(pre.distanceM).toBe(0);
    expect(pre.altitudeM).toBe(0);
  });

  it("does not show a parked aircraft doing 20 mph", () => {
    // STANDBY beside a cruise speed and a 129 A draw is the one reading on
    // this panel a visitor could catch out at a glance.
    const pre = heroTelemetryAt(mission, 0.1);
    expect(pre.sample?.speedMs).toBe(0);
    expect(pre.sample?.amps).toBe(0);
    expect(pre.spraying).toBe(false);
    // The tank is still full, because it is: this is the moment before takeoff.
    expect(pre.sample?.litres).toBeGreaterThan(0);
  });

  it("wraps cleanly across the loop boundary", () => {
    expect(() => heroTelemetryAt(mission, 1.7)).not.toThrow();
    expect(heroTelemetryAt(mission, 1.1).flying).toBe(false);
  });
});
