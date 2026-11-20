// The named corn setups (src/lib/fieldTwin/cornSetups.ts): a frozen setup still means what it meant when it was frozen.
import { describe, expect, it } from "vitest";
import { CORN_CANDIDATE_FINAL3, CORN_CANDIDATE_FINAL3_FROZEN, resolveSetup } from "@/lib/fieldTwin/cornSetups";
import { CORN_CORES, CORN_COUNT_GUARD } from "@/lib/rowCrop/cornV1";

describe("the candidate frozen for FINAL-3", () => {
  it("resolves, with the code as it is, to every value it was frozen with", () => {
    // Switches added to SEQUENCE since the freeze (2026-11-19: retryTooFar, doublesApart) resolve OFF in the frozen
    // setup, so it still means what it meant; named here one by one, everything else compared exactly.
    const r = resolveSetup(CORN_CANDIDATE_FINAL3), seq = r.SEQUENCE as Record<string, unknown>;
    for (const k of ["retryTooFar", "doublesApart"]) { expect(seq[k]).toBe(false); delete seq[k]; }
    expect(r).toEqual(CORN_CANDIDATE_FINAL3_FROZEN);
  });
  it("is the cores (new reference), variant A, the guard with its misread check, the sweep off", () => {
    const r = resolveSetup(CORN_CANDIDATE_FINAL3);
    expect(r.read).toEqual({ cores: true, coresReference: "marks", countGuard: true, rowSpans: true });
    expect(r.CORN_COUNT_GUARD.misreadRatio).toBe(1.5);
    expect([r.SEQUENCE.placeOffSpacing, r.SEQUENCE.offSpacingStricterOnly, r.SEQUENCE.sweepLoneMarks, r.SEQUENCE.tooCloseFromField]).toEqual([true, true, false, false]);
  });
  it("leaves the code's own defaults alone", () => {
    resolveSetup(CORN_CANDIDATE_FINAL3);
    expect(CORN_CORES.on).toBe(false); expect(CORN_COUNT_GUARD.on).toBe(false);
  });
});
