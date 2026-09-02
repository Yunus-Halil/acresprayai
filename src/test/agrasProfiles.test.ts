// The profile table, and the envelope that keeps its three ranges honest.
//
// The tests that matter here are the ones about what is NOT in the data: that
// midpoints rather than maxima come out of a range, that an unmatched model
// falls to the generic profile instead of the nearest Agras, and that a null
// flow ceiling stays null instead of acquiring a plausible number on the way
// through.
import { describe, expect, it } from "vitest";
import {
  AGRAS_PROFILES, EFFECTIVE_SWATH_FACTOR_DEFAULT, EFFECTIVE_SWATH_FACTOR_PUBLISHED,
  GENERIC_PROFILE, PAYLOAD_DERATE_KG_PER_1000M,
  atFraction, availableNozzleCounts, constrainSwath, maxFlowLpm, maxSwathAt, midpoint,
  payloadDerateKg, rangeFraction, resolveAgrasProfile, usableTankAtElevationL,
} from "@/lib/agrasProfiles";
import { AIRCRAFT } from "@/lib/aircraftDirectory";

const byId = (id: string) => {
  const p = AGRAS_PROFILES.find(x => x.id === id);
  if (!p) throw new Error(`no profile ${id}`);
  return p;
};

describe("the profile table", () => {
  it("covers every model in the source table", () => {
    const models = AGRAS_PROFILES.map(p => p.model).sort();
    expect(models).toEqual([
      "MG-1P", "MG-1S", "T10", "T100", "T16", "T20", "T20P", "T25", "T30", "T40", "T50",
    ]);
  });

  it("is DJI Agras only, by design", () => {
    for (const p of AGRAS_PROFILES) expect(p.id.startsWith("DJI Agras ")).toBe(true);
  });

  it("resolves every profile id to a real directory entry", () => {
    // A profile for an airframe nobody can register is a profile nobody reaches.
    const ids = new Set(AIRCRAFT.map(a => a.id));
    for (const p of AGRAS_PROFILES) expect(ids.has(p.id)).toBe(true);
  });

  it("orders every range low to high", () => {
    for (const p of AGRAS_PROFILES) {
      expect(p.swath_m[0]).toBeLessThan(p.swath_m[1]);
      expect(p.height_m[0]).toBeLessThan(p.height_m[1]);
      expect(p.speed_ms[0]).toBeLessThan(p.speed_ms[1]);
    }
  });

  it("nulls a field it lists as unverified rather than guessing one", () => {
    for (const p of AGRAS_PROFILES) {
      if (p.unverified.includes("flow_lpm")) expect(p.flow_lpm).toBeNull();
      if (p.unverified.includes("battery")) expect(p.battery).toBeNull();
      if (p.unverified.includes("hover")) expect(p.hover).toBeNull();
    }
  });

  it("carries the verified spec-sheet figures", () => {
    expect(byId("DJI Agras T100").battery).toEqual({ mah: 41000, volts: 52 });
    expect(byId("DJI Agras T50").battery).toEqual({ mah: 30000, volts: 52.22 });
    expect(byId("DJI Agras T25").battery).toEqual({ mah: 15500, volts: 52.22 });
    expect(byId("DJI Agras T100").hover).toEqual({ minutes: 4.7, at_kg: 175 });
    expect(byId("DJI Agras T50").hover).toEqual({ minutes: 7, at_kg: 92 });
    expect(byId("DJI Agras T40").hover).toEqual({ minutes: 7, at_kg: 90 });
    for (const id of ["T25", "T40", "T50", "T100"]) {
      expect(byId(`DJI Agras ${id}`).wind_limit_ms).toBe(6);
    }
  });

  it("reports flow by nozzle count, and null where nobody verified one", () => {
    expect(maxFlowLpm(byId("DJI Agras T100"), 2)).toBe(30);
    expect(maxFlowLpm(byId("DJI Agras T100"), 4)).toBe(40);
    expect(maxFlowLpm(byId("DJI Agras T50"), 2)).toBe(16);
    expect(maxFlowLpm(byId("DJI Agras T50"), 4)).toBe(24);
    expect(maxFlowLpm(byId("DJI Agras T40"), 4)).toBe(12);
    expect(maxFlowLpm(byId("DJI Agras T40"), 2)).toBeNull();
    expect(maxFlowLpm(byId("DJI Agras T30"), 4)).toBeNull();
    expect(availableNozzleCounts(byId("DJI Agras T40"))).toEqual([4]);
    expect(availableNozzleCounts(byId("DJI Agras T25"))).toEqual([2, 4]);
  });

  it("states the MG-1 has no spreader rather than an unknown one", () => {
    // null here is a fact about the airframe, not a missing figure, so it must
    // not be listed as something awaiting verification.
    expect(byId("DJI Agras MG-1P").dry_spread_kg).toBeNull();
    expect(byId("DJI Agras MG-1P").unverified).not.toContain("dry_spread_kg");
  });
});

describe("resolving a model", () => {
  it("matches a fleet model string", () => {
    const r = resolveAgrasProfile("DJI Agras T50");
    expect(r.matched).toBe(true);
    expect(r.profile.model).toBe("T50");
  });

  it("follows the same aliases the planner does", () => {
    expect(resolveAgrasProfile("DJI Agras T-40").profile.model).toBe("T40");
  });

  it("falls back to generic rather than the nearest Agras", () => {
    // The line spans 8 L to 100 L. There is no such thing as a near miss.
    const r = resolveAgrasProfile("XAG P100 Pro");
    expect(r.matched).toBe(false);
    expect(r.profile).toBe(GENERIC_PROFILE);
    expect(r.requested).toBe("XAG P100 Pro");
  });

  it("falls back for a profiled-looking model that has no profile", () => {
    const r = resolveAgrasProfile("DJI Agras T55");
    expect(r.matched).toBe(false);
  });

  it("falls back on null", () => {
    expect(resolveAgrasProfile(null).matched).toBe(false);
  });

  it("marks every generic figure unverified", () => {
    for (const f of ["tank_l", "swath_m", "speed_ms", "hover"]) {
      expect(GENERIC_PROFILE.unverified).toContain(f);
    }
  });
});

describe("range defaults", () => {
  it("defaults to the midpoint, never the maximum", () => {
    const t100 = byId("DJI Agras T100");
    expect(midpoint(t100.swath_m)).toBe(9);
    expect(midpoint(t100.speed_ms)).toBe(14.25);
    for (const p of AGRAS_PROFILES) {
      expect(midpoint(p.swath_m)).toBeLessThan(p.swath_m[1]);
      expect(midpoint(p.speed_ms)).toBeLessThan(p.speed_ms[1]);
    }
  });

  it("round-trips a fraction through a range", () => {
    const r = byId("DJI Agras T50").swath_m;
    expect(rangeFraction(atFraction(0.25, r), r)).toBeCloseTo(0.25, 9);
    expect(rangeFraction(9, r)).toBe(0);
    expect(rangeFraction(11, r)).toBe(1);
  });

  it("puts the Purdue default inside the published band", () => {
    expect(EFFECTIVE_SWATH_FACTOR_DEFAULT).toBeGreaterThanOrEqual(EFFECTIVE_SWATH_FACTOR_PUBLISHED[0]);
    expect(EFFECTIVE_SWATH_FACTOR_DEFAULT).toBeLessThanOrEqual(EFFECTIVE_SWATH_FACTOR_PUBLISHED[1]);
  });
});

describe("the swath / speed / height envelope", () => {
  const t100 = byId("DJI Agras T100");

  it("gives the widest swath only at the top of speed and height", () => {
    expect(maxSwathAt(t100, 20, 5)).toBeCloseTo(13, 6);
  });

  it("refuses the widest swath at the bottom of both", () => {
    expect(maxSwathAt(t100, 8.5, 3)).toBeCloseTo(5, 6);
  });

  it("is held back by whichever of the two is lower", () => {
    // Fast but low: the height is the limiter, so the swath tracks the height.
    expect(maxSwathAt(t100, 20, 3)).toBeCloseTo(5, 6);
    // High but slow: now the speed is.
    expect(maxSwathAt(t100, 8.5, 5)).toBeCloseTo(5, 6);
  });

  it("clamps a request the envelope cannot deliver, and says why", () => {
    const c = constrainSwath(t100, 13, 8.5, 3);
    expect(c.clamped).toBe(true);
    expect(c.swathM).toBeCloseTo(5, 6);
    expect(c.requestedM).toBe(13);
    expect(c.reason).toMatch(/speed/);
    expect(c.reason).toMatch(/13 m of swath needs/);
  });

  it("names height as the limiter when height is the limiter", () => {
    expect(constrainSwath(t100, 13, 20, 3).reason).toMatch(/height/);
  });

  it("passes a request the envelope allows through untouched", () => {
    const c = constrainSwath(t100, 9, 14.25, 4);
    expect(c.clamped).toBe(false);
    expect(c.swathM).toBe(9);
    expect(c.reason).toBe("");
  });

  it("clamps a request outside the aircraft's range at all", () => {
    const c = constrainSwath(t100, 40, 20, 5);
    expect(c.swathM).toBe(13);
    expect(c.clamped).toBe(true);
  });

  it("holds for every profile: bottom of the envelope is the narrowest swath", () => {
    for (const p of AGRAS_PROFILES) {
      expect(maxSwathAt(p, p.speed_ms[0], p.height_m[0])).toBeCloseTo(p.swath_m[0], 6);
      expect(maxSwathAt(p, p.speed_ms[1], p.height_m[1])).toBeCloseTo(p.swath_m[1], 6);
    }
  });
});

describe("payload derate", () => {
  it("takes 10 kg per 1000 m", () => {
    expect(PAYLOAD_DERATE_KG_PER_1000M).toBe(10);
    expect(payloadDerateKg(1000)).toBe(10);
    expect(payloadDerateKg(2500)).toBe(25);
    expect(payloadDerateKg(0)).toBe(0);
    expect(payloadDerateKg(-500)).toBe(0);
  });

  it("takes it off the tank an operator can plan on filling", () => {
    const t50 = byId("DJI Agras T50");
    expect(usableTankAtElevationL(t50, 0)).toBe(40);
    expect(usableTankAtElevationL(t50, 1000)).toBe(30);
    // Never negative, however high the field.
    expect(usableTankAtElevationL(t50, 9000)).toBe(0);
  });
});
