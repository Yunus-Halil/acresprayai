// Treatment quantities respond to area and rate, and refuse to guess.
import { describe, expect, it } from "vitest";
import {
  NOT_CALCULATED, type TreatmentChoice, carrierLitresPerHectare, choiceProblems, computeQuantities, cropConflict,
  ratePerHectare,
} from "@/lib/treatment/quantities";
import { assignSpotIds, spotIdFor } from "@/lib/weedScout/spotId";
import type { Candidate } from "@/lib/weedScout/types";

const verified: TreatmentChoice = {
  id: "t1", weed_catalog_id: "VT-10", weed_label: "common ragweed",
  product_name: "Example Herbicide", epa_reg_no: "000-000", label_source: "https://example.org/label.pdf",
  label_checked_on: "2026-09-20", label_crop: "Corn", application_method: "aerial", restrictions: null,
  rate_value: 2, rate_unit: "L/ha", carrier_volume_value: 20, carrier_unit: "L/ha", label_verified: true, notes: null,
};
const calib = { tankCapacityL: 40, tankLoadPct: 100, applicationVolumeLha: 25, fieldCrop: "Corn" };
const HA = 10_000;

describe("computeQuantities", () => {
  it("scales with area and with rate", () => {
    const one = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: verified }], calib);
    const two = computeQuantities([{ key: "a", label: "A", areaM2: 2 * HA, zoneCount: 2, choice: verified }], calib);
    expect(one.total!.products[0].amount).toBeCloseTo(2, 9);
    expect(two.total!.products[0].amount).toBeCloseTo(4, 9);
    expect(one.total!.sprayVolumeL).toBeCloseTo(20, 9);
    expect(two.total!.sprayVolumeL).toBeCloseTo(40, 9);
    const faster = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, rate_value: 3 } }], calib);
    expect(faster.total!.products[0].amount).toBeCloseTo(3, 9);
    expect(faster.total!.sprayVolumeL).toBeCloseTo(20, 9);
  });

  it("counts tank loads from the spray volume and the loaded tank", () => {
    const r = computeQuantities([{ key: "a", label: "A", areaM2: 4.5 * HA, zoneCount: 1, choice: verified }], calib);
    // 90 L of spray, 40 L per load: three loads, the last carrying 10 L.
    expect(r.total!.loads).toBe(3);
    expect(r.total!.perLoadL).toBe(40);
    expect(r.total!.lastLoadL).toBeCloseTo(10, 9);
    const half = computeQuantities([{ key: "a", label: "A", areaM2: 4.5 * HA, zoneCount: 1, choice: verified }], { ...calib, tankLoadPct: 50 });
    expect(half.total!.loads).toBe(5);
  });

  it("does not calculate without a product, a rate, a unit or a verified label, and says which", () => {
    const none = computeQuantities([{ key: "a", label: "Unidentified", areaM2: HA, zoneCount: 1, choice: null }], calib);
    expect(none.total).toBeNull();
    expect(none.groups[0].kind).toBe("not-calculated");
    expect(none.reasons).toEqual(["Unidentified: No product chosen."]);
    const noRate = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, rate_value: null } }], calib);
    expect(noRate.total).toBeNull();
    expect(noRate.reasons.join(" ")).toMatch(/No application rate/);
    const unverified = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, label_verified: false } }], calib);
    expect(unverified.total).toBeNull();
    expect(unverified.reasons.join(" ")).toMatch(/Label not marked as verified/);
    const badUnit = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, rate_unit: "cups/ac" } }], calib);
    expect(badUnit.total).toBeNull();
  });

  it("does not calculate when the label crop conflicts with the field crop", () => {
    const r = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, label_crop: "Soybeans" } }], calib);
    expect(r.total).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/checked for Soybeans, but this field's crop is Corn/);
    expect(cropConflict("soybean", "Soybeans")).toBeNull();
    expect(cropConflict(null, "Corn")).toBeNull();
  });

  it("one unpriced group withholds the total but keeps the priced groups' figures", () => {
    const r = computeQuantities([
      { key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: verified },
      { key: "b", label: "B", areaM2: HA, zoneCount: 1, choice: null },
    ], calib);
    expect(r.total).toBeNull();
    expect(r.groups[0].kind).toBe("calculated");
    expect(r.groups[1].kind).toBe("not-calculated");
  });

  it("falls back to the planner's application volume only when the label states none, and says so", () => {
    const r = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, carrier_volume_value: null, carrier_unit: null } }], calib);
    expect(r.total!.sprayVolumeL).toBeCloseTo(25, 9);
    expect((r.groups[0] as { carrierSource: string }).carrierSource).toBe("planner");
    expect(r.assumptions.join(" ")).toMatch(/planner's application volume/);
    const nothing = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, carrier_volume_value: null, carrier_unit: null } }], { ...calib, applicationVolumeLha: null });
    expect(nothing.total).toBeNull();
    expect(nothing.reasons.join(" ")).toMatch(/No carrier volume/);
  });

  it("needs a tank to count loads, but still prices the product", () => {
    const r = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: verified }], { ...calib, tankCapacityL: null });
    expect(r.total).toBeNull();
    expect(r.groups[0].kind).toBe("calculated");
    expect(r.reasons.join(" ")).toMatch(/no tank capacity/);
  });

  it("converts label units exactly and keeps dry products in kilograms", () => {
    expect(ratePerHectare(1, "gal/ac")).toBeCloseTo(3.785411784 / 0.40468564224, 9);
    expect(ratePerHectare(32, "fl oz/ac")).toBeCloseTo(ratePerHectare(1, "qt/ac"), 9);
    expect(ratePerHectare(1, "lb/ac")).toBeCloseTo(0.45359237 / 0.40468564224, 9);
    expect(ratePerHectare(500, "g/ha")).toBe(0.5);
    expect(carrierLitresPerHectare(10, "gal/ac")).toBeCloseTo(93.54, 1);
    const dry = computeQuantities([{ key: "a", label: "A", areaM2: HA, zoneCount: 1, choice: { ...verified, rate_value: 1.5, rate_unit: "kg/ha" } }], calib);
    expect(dry.total!.products[0]).toEqual({ name: "Example Herbicide", amount: 1.5, unit: "kg" });
  });

  it("names the phrase once", () => {
    expect(NOT_CALCULATED).toBe("Quantity not calculated");
    expect(choiceProblems(null, { fieldCrop: null })).toEqual(["No product chosen."]);
  });
});

describe("spot ids", () => {
  const at = (lat: number, lng: number) => ({ lat, lng });
  it("are the same for the same ground and family, across runs", () => {
    expect(spotIdFor("off-row vegetation", at(38.951234, -77.451234))).toBe(spotIdFor("vegetation outlier", at(38.951234, -77.451234)));
    expect(spotIdFor("off-row vegetation", at(38.951234, -77.451234))).toBe(spotIdFor("off-row vegetation", at(38.9512341, -77.4512339)));
    expect(spotIdFor("not-average region", at(38.951234, -77.451234))).not.toBe(spotIdFor("off-row vegetation", at(38.951234, -77.451234)));
    expect(spotIdFor("off-row vegetation", at(38.951234, -77.451234))).not.toBe(spotIdFor("off-row vegetation", at(38.9513, -77.451234)));
  });
  it("stay unique within a run", () => {
    const mk = (id: string, lat: number): Candidate => ({
      id, tileId: "t", centroid: at(lat, -77.45), kind: "off-row vegetation", score: 1, distanceToRowM: null, rowConfidence: null,
      anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null, blob: null, region: null, areaM2: 0, feedback: null,
      estimate: null, chip: null, chipSpanM: null, chipGsdM: null,
    });
    const cs = assignSpotIds([mk("a", 38.95), mk("b", 38.950001), mk("c", 38.96)]);
    expect(new Set(cs.map(c => c.id)).size).toBe(3);
    expect(cs[1].id).toBe(`${cs[0].id}-2`);
  });
});
