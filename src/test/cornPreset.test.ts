// The corn presets (src/lib/fieldTwin/cornPreset.ts) and who gets which (cornFinal3Flag.ts), APP-1 2026-11-18.
//  - "today" is the app as it was (no extents, no lower-bar candidates, no cores, no guard, the V1 rules, no ground);
//  - "final3" is the frozen FINAL-3 setup, with every layer option off;
//  - only the founder, with the founder's own switch on this device, gets "final3"; the kill switch wins; the
//    developer's switch works in a development build only.
import { afterEach, describe, expect, it } from "vitest";
import { CORN_FINAL3_KEY, cornFinal3Offered, cornPresetFor, setCornFinal3Switch } from "@/lib/fieldTwin/cornFinal3Flag";
import { CORN_PRESET_SETTINGS, cornPresetSettings } from "@/lib/fieldTwin/cornPreset";
import { CORN_CANDIDATE_FINAL3 } from "@/lib/fieldTwin/cornSetups";
import { PLANTS_FIRST, PLANTS_FIRST_V1, SEQUENCE, SEQUENCE_V1 } from "@/lib/fieldTwin/plantsFirst";

describe("the presets", () => {
  it("today: the app as it was", () => {
    const T = CORN_PRESET_SETTINGS.today;
    expect(T.read).toEqual({ rowSpans: false, rowCandidates: false, cores: false, coresReference: "marks", countGuard: false, learnedGreen: false });
    expect(T.flightGuard).toBe(false); expect(T.ground).toBe(false); expect(T.keepLook).toBe(false);
    expect(T.plants.sequence).toBe(SEQUENCE_V1); expect(T.plants.placing).toBe(PLANTS_FIRST_V1);
  });
  it("final3: the frozen setup, layers all off", () => {
    const F = CORN_PRESET_SETTINGS.final3;
    expect(F.read).toEqual({ rowSpans: true, rowCandidates: true, cores: true, coresReference: "marks", countGuard: true, learnedGreen: false });
    expect(F.flightGuard).toBe(true); expect(F.ground).toBe(true);
    expect(F.plants.sequence).toEqual({ ...SEQUENCE, placeOffSpacing: true, offSpacingStricterOnly: true, sweepLoneMarks: false });
    expect(F.plants.sequence).toEqual({ ...SEQUENCE, ...CORN_CANDIDATE_FINAL3.field.sequence });
    expect(F.plants.placing).toBe(PLANTS_FIRST); expect(F.plants.layers).toEqual({});
  });
  it("an unknown or missing name is today", () => {
    expect(cornPresetSettings(null)).toBe(CORN_PRESET_SETTINGS.today);
    expect(cornPresetSettings("nonsense" as never)).toBe(CORN_PRESET_SETTINGS.today);
  });
});

describe("who reads with final3", () => {
  afterEach(() => { try { localStorage.removeItem(CORN_FINAL3_KEY); } catch { /* none */ } });
  const prod = { DEV: false }, dev = { DEV: true, VITE_CORN_FINAL3: "1" };
  it("the founder with the switch on; nobody else; off by default", () => {
    expect(cornPresetFor("founder", false, prod)).toBe("today");
    expect(cornPresetFor("founder", true, prod)).toBe("final3");
    expect(cornPresetFor("participant", true, prod)).toBe("today");
    expect(cornPresetFor(null, true, prod)).toBe("today");
    expect(cornFinal3Offered("founder", prod)).toBe(true); expect(cornFinal3Offered("participant", prod)).toBe(false);
  });
  it("the kill switch wins; the developer's switch only in a development build", () => {
    expect(cornPresetFor("founder", true, { DEV: false, VITE_CORN_FINAL3: "0" })).toBe("today");
    expect(cornFinal3Offered("founder", { VITE_CORN_FINAL3: "0" })).toBe(false);
    expect(cornPresetFor(null, false, dev)).toBe("final3");
    expect(cornPresetFor(null, false, { DEV: false, VITE_CORN_FINAL3: "1" })).toBe("today");
  });
  it("the switch is kept on this device", () => {
    setCornFinal3Switch(true); expect(localStorage.getItem(CORN_FINAL3_KEY)).toBe("1");
    setCornFinal3Switch(false); expect(localStorage.getItem(CORN_FINAL3_KEY)).toBeNull();
  });
});
