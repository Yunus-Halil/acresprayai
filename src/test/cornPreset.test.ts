// The corn presets (src/lib/fieldTwin/cornPreset.ts) and who gets which (cornFinal3Flag.ts), APP-1 2026-11-18.
//  - "today" is the app as it was (no extents, no lower-bar candidates, no cores, no guard, the V1 rules, no ground);
//  - "final3" is the frozen FINAL-3 setup, with every layer option off;
//  - since SHIP-1 (2026-11-19) everyone reads with "final3"; the kill switch VITE_CORN_FINAL3=0 brings back "today".
import { describe, expect, it } from "vitest";
import { cornFinal3Killed, defaultCornPreset } from "@/lib/fieldTwin/cornFinal3Flag";
import { CORN_PRESET_SETTINGS, cornPresetSettings } from "@/lib/fieldTwin/cornPreset";
import { CORN_CANDIDATE_FINAL3 } from "@/lib/fieldTwin/cornSetups";
import { PLANTS_FIRST, PLANTS_FIRST_V1, SEQUENCE, SEQUENCE_V1 } from "@/lib/fieldTwin/plantsFirst";
import { CORES_WHEN_TOUCHING } from "@/lib/rowCrop/cornV1";

describe("the presets", () => {
  it("today: the app as it was", () => {
    const T = CORN_PRESET_SETTINGS.today;
    expect(T.read).toEqual({ rowSpans: false, rowCandidates: false, cores: false, coresReference: "marks", countGuard: false, lateGuard: false, learnedGreen: false, coresWhenTouching: false });
    expect(T.flightGuard).toBe(false); expect(T.ground).toBe(false); expect(T.keepLook).toBe(false);
    expect(T.plants.sequence).toBe(SEQUENCE_V1); expect(T.plants.placing).toBe(PLANTS_FIRST_V1);
  });
  it("final3: the frozen setup, layers all off", () => {
    const F = CORN_PRESET_SETTINGS.final3;
    expect(F.read).toEqual({ rowSpans: true, rowCandidates: true, cores: true, coresReference: "marks", countGuard: true, lateGuard: true, learnedGreen: false, coresWhenTouching: true });
    expect(F.flightGuard).toBe(true); expect(F.ground).toBe(true);
    expect(F.plants.sequence).toEqual({ ...SEQUENCE, placeOffSpacing: true, offSpacingStricterOnly: true, sweepLoneMarks: false, retryTooFar: true, doublesApart: true, secondLookAcrossMaxM: 0.05 });
    // The frozen FINAL-3 setup, and on top of it (2026-11-19) the retry of the "too far" dots and the doubles told apart.
    expect(F.plants.sequence).toEqual({ ...SEQUENCE, ...CORN_CANDIDATE_FINAL3.field.sequence, retryTooFar: true, doublesApart: true, secondLookAcrossMaxM: 0.05 });
    expect(SEQUENCE.retryTooFar).toBe(false); expect(SEQUENCE.doublesApart).toBe(false); expect(SEQUENCE_V1.retryTooFar).toBe(false); expect(SEQUENCE.secondLookAcrossMaxM).toBe(0);
    expect(F.plants.placing).toBe(PLANTS_FIRST); expect(F.plants.layers).toEqual({});
  });
  it("SPEED-1: the cores' cut is halfway between the private seedling flight's ratio and 53.JPG's", () => {
    expect(CORES_WHEN_TOUCHING.cut).toBeCloseTo((9.5 / 152 + 49.6 / 212.1) / 2, 3);
  });
  it("an unknown or missing name is today", () => {
    expect(cornPresetSettings(null)).toBe(CORN_PRESET_SETTINGS.today);
    expect(cornPresetSettings("nonsense" as never)).toBe(CORN_PRESET_SETTINGS.today);
  });
});

describe("who reads with final3 (SHIP-1: everyone)", () => {
  it("everyone, in any build, unless the kill switch is set", () => {
    expect(defaultCornPreset({})).toBe("final3");
    expect(defaultCornPreset({ VITE_CORN_FINAL3: "1" })).toBe("final3");
    expect(defaultCornPreset({ VITE_CORN_FINAL3: "0" })).toBe("today");
    expect(cornFinal3Killed({ VITE_CORN_FINAL3: "0" })).toBe(true);
  });
});
