// Late corn (lateStage.ts, stageSample.ts, the late guard in cornV1.ts): the signal, the flight's verdict, how far the
// check before a build reduces a photograph, the warning's words, and, on the late flight of 2026-11-19 where it is on
// this computer, the guard withholding the count on a closed canopy that the emergence guard let through.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LATE_STAGE, checkDownFor, flightStageOf, isLatePhoto, lateShareOf, spreadPick } from "@/lib/fieldTwin/lateStage";
import { lateFlightWarning, sampleFlightStage } from "@/lib/fieldTwin/stageSample";
import type { CropState } from "@/lib/rowCrop/assess";

const cells = (states: CropState[]) => ({ cells: states.map(state => ({ state })) as never });

describe("the late signal", () => {
  it("is the share of the photograph's cells in canopy or closed", () => {
    expect(lateShareOf(cells(["closed", "canopy", "rows", "bare"]))).toBe(0.5);
    expect(lateShareOf(cells(["rows", "seedlings", "cover", "unknown"]))).toBe(0);
    expect(lateShareOf(cells([]))).toBe(0);
  });
  it("calls a photograph late from the cut up, never without a share", () => {
    expect(isLatePhoto(LATE_STAGE.photoCut)).toBe(true);
    expect(isLatePhoto(LATE_STAGE.photoCut - 0.01)).toBe(false);
    expect(isLatePhoto(null)).toBe(false);
  });
  it("calls a flight late when at least half of the photographs looked at are", () => {
    // Measured on the stored flights (crop-views LATE-1.md): Day045's photographs read about 0.77, Day023's at most 0.23.
    expect(flightStageOf([0.77, 0.83, 0.31, 0.8])).toEqual({ looked: 4, late: 3, verdict: "late" });
    expect(flightStageOf([0.23, 0.19, 0, 0.1])).toEqual({ looked: 4, late: 0, verdict: "ok" });
    // The late flight of 2026-11-19: one photograph mostly another field (0.24), one closed canopy (0.60).
    expect(flightStageOf([0.24, 0.6]).verdict).toBe("late");
    // A photograph that could not be looked at is not counted either way.
    expect(flightStageOf([null, 0.6])).toEqual({ looked: 1, late: 1, verdict: "late" });
    expect(flightStageOf([null]).verdict).toBeNull();
  });
  it("looks at photographs spread through the flight", () => {
    expect(spreadPick([1, 2, 3], 8)).toEqual([1, 2, 3]);
    expect(spreadPick(Array.from({ length: 100 }, (_, i) => i), 4)).toEqual([12, 37, 62, 87]);
  });
  it("reduces a fine photograph by four and a coarse one not at all, so a row stays 24 pixels from the next", () => {
    expect(checkDownFor(0.0018)).toBe(4);
    expect(checkDownFor(0.006)).toBe(4);
    expect(checkDownFor(0.0254)).toBe(1);
    expect(checkDownFor(0.016)).toBe(1);
    expect(checkDownFor(null)).toBe(LATE_STAGE.maxDown);
  });
});

describe("the check before a build", () => {
  it("skips a photograph it cannot decode, and reads the flight from the rest", async () => {
    const bad = { name: "a.jpg", decode: async () => { throw new Error("no decoder"); } };
    const r = await sampleFlightStage([bad, bad], 0.01);
    expect(r).toMatchObject({ looked: 0, late: 0, verdict: null });
    expect(r.shares).toEqual([{ name: "a.jpg", share: null }, { name: "a.jpg", share: null }]);
  });
  it("words the warning, and adds the height when the flight is also coarse", () => {
    const w = lateFlightWarning({ looked: 8, late: 6 }, 1.0);
    expect(w).toMatch(/^This looks like a late flight\. In 6 of the 8 photographs looked at, the corn canopy has closed/);
    expect(w).toMatch(/Support for later flights is coming in an update\.$/);
    expect(w).not.toMatch(/flown high/);
    expect(lateFlightWarning({ looked: 8, late: 6 }, 2.5)).toMatch(/It was also flown high: about 2\.5 cm of ground per pixel/);
  });
});

// The late flight of 2026-11-19 (two photographs, kept on this computer only; never committed).
const LATE = "D:/swardus-research/crop-views/canopy/late/2.jpg";
describe.skipIf(!existsSync(LATE))("the late guard on a closed canopy (the late flight of 2026-11-19, photograph 2)", () => {
  it("withholds the count the emergence guard let through, and says why", { timeout: 300_000 }, async () => {
    const { nodePhoto } = await import("../../scripts/directGeoref/nodePhotos");
    const { parseDjiHeader } = await import("@/lib/directGeoref/metadata");
    const { frameFromDji } = await import("@/lib/directGeoref/frame");
    const { groundSampleAt } = await import("@/lib/directGeoref/projection");
    const { readCornV1 } = await import("@/lib/rowCrop/cornV1");
    const { rowCropParamsFor } = await import("@/lib/rowCrop/params");
    const { cropProfileFor } = await import("@/lib/cropProfiles/registry");
    const { cornPresetSettings } = await import("@/lib/fieldTwin/cornPreset");
    const f = frameFromDji("2.jpg", parseDjiHeader(new Uint8Array(readFileSync(LATE).subarray(0, 1 << 20))) as never);
    if (!f.ok) throw new Error("no camera from the header");
    const params = rowCropParamsFor(cropProfileFor("corn")!, groundSampleAt(f.frame, f.frame.intrinsics.cx, f.frame.intrinsics.cy));
    const px = await nodePhoto(LATE).decode(1), R = cornPresetSettings("final3").read;
    const on = readCornV1(px, params, { enteredCrop: "corn", ...R });
    expect(on.count).toMatchObject({ withheld: true, late: true });
    expect(on.count!.rowGreenShare!).toBeLessThan(on.count!.cut);
    expect(on.count!.lateShare!).toBeGreaterThanOrEqual(LATE_STAGE.photoCut);
    expect(on.plants.points).toEqual([]);
    expect(on.notes[0]).toMatch(/the canopy has closed: too late for a per-plant count/);
    // Without the late guard: the read as shipped, counting the canopy.
    const off = readCornV1(px, params, { enteredCrop: "corn", ...R, lateGuard: false });
    expect(off.count?.withheld).toBe(false);
    expect(off.plants.points.length).toBeGreaterThan(1000);
  });
});
