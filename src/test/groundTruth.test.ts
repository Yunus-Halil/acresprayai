// The field walk's rules: walking order, distances, and what a record must say.
import { describe, expect, it } from "vitest";
import {
  type GroundTruthInput, UNKNOWN_WEED, type WalkPatch, bearingDeg, compass, directionsUrl, distanceM,
  groundTruthRow, validateGroundTruth, walkList,
} from "@/lib/groundTruth/walk";

const patch = (over: Partial<WalkPatch> = {}): WalkPatch => ({
  observationId: "o1", candidateId: "spot-region-1", scanId: "s1", fieldId: "f1",
  lat: 54.17, lng: 12.30, label: "bare or dry ground", verdict: "unsure", areaM2: 120, crop: "wheat", ...over,
});
const input = (over: Partial<GroundTruthInput> = {}): GroundTruthInput => ({
  patch: patch(), visitor: { lat: 54.1701, lng: 12.3001, accuracyM: 4 }, whatIsHere: "weeds",
  species: [{ name: "blackgrass", catalogId: null, coverPct: 40, dominant: true }],
  growthStage: "vegetative", patchCoverPct: 60, confidence: "likely", identifiedBy: "operator", notes: "", ...over,
});

describe("distances and directions", () => {
  it("measures a metre-scale walk and points the right way", () => {
    const a = { lat: 54.17, lng: 12.30 };
    const north = { lat: 54.17 + 100 / 111_195, lng: 12.30 };
    expect(distanceM(a, north)).toBeCloseTo(100, 0);
    expect(compass(bearingDeg(a, north))).toBe("N");
    const east = { lat: 54.17, lng: 12.30 + 0.001 };
    expect(compass(bearingDeg(a, east))).toBe("E");
    expect(compass(bearingDeg(north, a))).toBe("S");
  });

  it("links walking directions to the patch", () => {
    expect(directionsUrl({ lat: 54.1, lng: 12.3 })).toBe("https://www.google.com/maps/dir/?api=1&destination=54.1000000,12.3000000&travelmode=walking");
  });
});

describe("walkList", () => {
  const near = patch({ observationId: "near", candidateId: "a", lat: 54.1701 });
  const far = patch({ observationId: "far", candidateId: "b", lat: 54.18 });
  const here = { lat: 54.17, lng: 12.30 };

  it("puts the nearest unvisited patch first, visited ones last", () => {
    expect(walkList([far, near], here, {}).map(i => i.observationId)).toEqual(["near", "far"]);
    expect(walkList([far, near], here, { a: 1 }).map(i => i.observationId)).toEqual(["far", "near"]);
  });

  it("keeps the scan's order when the walker's position is unknown", () => {
    const list = walkList([far, near], null, {});
    expect(list.map(i => i.observationId)).toEqual(["far", "near"]);
    expect(list[0].distanceM).toBeNull();
  });
});

describe("validateGroundTruth", () => {
  it("accepts a complete weed record", () => {
    expect(validateGroundTruth(input())).toEqual([]);
  });

  it("asks what is in the patch before anything else", () => {
    expect(validateGroundTruth(input({ whatIsHere: null }))).toContain("Say what is in the patch first.");
  });

  it("needs a name for weeds, and accepts 'species not known' as one", () => {
    const unnamed = validateGroundTruth(input({ species: [{ name: " ", catalogId: null, coverPct: null, dominant: true }] }));
    expect(unnamed[0]).toMatch(/Name at least one weed/);
    expect(validateGroundTruth(input({ species: [{ name: UNKNOWN_WEED, catalogId: null, coverPct: null, dominant: true }] }))).toEqual([]);
  });

  it("does not need a weed name when the patch is something else", () => {
    expect(validateGroundTruth(input({ whatIsHere: "waterlogging", species: [] }))).toEqual([]);
  });

  it("refuses covers that cannot be true", () => {
    expect(validateGroundTruth(input({ patchCoverPct: 140 }))).toContain("Patch cover must be between 0 and 100%.");
    const over = input({ species: [
      { name: "a", catalogId: null, coverPct: 70, dominant: true },
      { name: "b", catalogId: null, coverPct: 50, dominant: false },
    ] });
    expect(validateGroundTruth(over).join(" ")).toMatch(/add up to 120%/);
    const twoMain = input({ species: [
      { name: "a", catalogId: null, coverPct: null, dominant: true },
      { name: "b", catalogId: null, coverPct: null, dominant: true },
    ] });
    expect(validateGroundTruth(twoMain)).toContain("Only one plant can be the dominant one.");
  });
});

describe("groundTruthRow", () => {
  it("records the patch, where the person stood, and what they said", () => {
    const row = groundTruthRow(input(), "u1");
    expect(row).toMatchObject({
      user_id: "u1", field_id: "f1", scan_id: "s1", candidate_id: "spot-region-1", observation_id: "o1",
      patch_lat: 54.17, patch_lng: 12.30, visitor_lat: 54.1701, visitor_accuracy_m: 4,
      what_is_here: "weeds", growth_stage: "vegetative", patch_cover_pct: 60, confidence: "likely",
      identified_by: "operator", crop: "wheat", notes: null,
    });
    expect(row.species).toEqual([{ name: "blackgrass", catalogId: null, coverPct: 40, dominant: true }]);
  });

  it("drops species and growth stage when the patch is not weeds, and keeps no position it does not have", () => {
    const row = groundTruthRow(input({ whatIsHere: "crop_stress", visitor: null, notes: "  yellowing  " }), "u1");
    expect(row.species).toEqual([]);
    expect(row.growth_stage).toBeNull();
    expect(row.visitor_lat).toBeNull();
    expect(row.notes).toBe("yellowing");
  });
});
