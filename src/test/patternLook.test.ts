// The pattern as lines and circles on the photo: rows across each block's
// windows, a circle per placed plant in its class's colour, the legend plain.
import { describe, expect, it } from "vitest";
import type { PhotoPattern } from "@/lib/photoScout/pattern";
import { BLOB_COLOUR, overlayFromPattern, overlayLegend, patternLookSideM } from "@/lib/sourceFrames/patternLook";

const fit = (angleDeg: number) => ({
  centre: { x: 6, y: -6 }, sizeM: 12, angleDeg, pitchM: 2, phaseM: 0, confidence: 0.9, angleConfidence: 0.9, pitchConfidence: 0.9,
  vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 2,
});
const win = (index: number, x0: number, y0: number, block: number | null, usable = true) => ({
  index, x0, y0, x1: x0 + 599, y1: y0 + 599, fit: fit(0), signal: "vegetation" as const, usable, block, own: null, rowLines: [], squareGrid: false, seed: null, onRow: 0, offRow: 0,
});
const blob = (id: number, x: number, y: number, cls: PhotoPattern["blobs"][number]["cls"]) => ({
  id, x, y, areaPx: 400, areaM2: 0.04, equivDiameterM: 0.2257, touchesBorder: false, window: 0, rowIndex: 0, acrossM: 0, alongM: 0, cls,
});
/** 12 m square at 1 cm/px: two windows side by side in one block, one window with no rows. */
const pattern: PhotoPattern = {
  width: 1200, height: 1200, gsdM: 0.01, rowSpacingM: null, windowM: 6, minBlobAreaCm2: 4, vegetationFraction: 0.2, canopyClosed: false,
  windows: [win(0, 0, 0, 0), win(1, 600, 0, 0), win(2, 0, 600, null, false), win(3, 600, 600, null, false)],
  blobs: [blob(0, 100, 100, "on pattern"), blob(1, 300, 100, "between plants"), blob(2, 300, 300, "off-row"), blob(3, 700, 100, "double"), blob(4, 100, 900, "unplaced")],
  blocks: [{ id: 0, angleDeg: 0, pitchM: 2, phaseM: 0, centre: { x: 6, y: -6 }, signal: "vegetation", windows: [0, 1], rowLines: [], squareGrid: false, plants: 1, seedSpacingM: null }],
  summary: { windows: 4, usableWindows: 2, brightnessWindows: 0, medianAngleDeg: 0, medianPitchM: 2, pitchKeptFromGiven: 0, plantDiameterM: 0.22, seedSpacingM: null, seedAgreement: null, blobs: 5, specks: 0, onPattern: 1, doubles: 1, betweenPlants: 1, offRow: 1, unplaced: 1, skips: 0, blocks: 1, squareGrid: false },
  notes: [],
};

describe("the pattern on the photo", () => {
  it("draws each row across the block's windows only, and never into a window without rows", () => {
    const o = overlayFromPattern(pattern);
    expect(o.blocks).toBe(1);
    // Rows at 2 m in a 6 m tall block: three rows cross it, each spanning the two windows (0..1200 px) and no further.
    expect(o.lines.length).toBeGreaterThanOrEqual(3);
    for (const l of o.lines) {
      expect(Math.min(l.y1, l.y2)).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(l.y1, l.y2)).toBeLessThanOrEqual(600 + 1e-6);
      expect(Math.min(l.x1, l.x2)).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(1200 + 1e-6);
      expect(Math.abs(l.x2 - l.x1)).toBeGreaterThan(1100);
    }
  });

  it("gives every placed plant a circle of its own size in its class colour, and leaves the unplaced alone", () => {
    const o = overlayFromPattern(pattern);
    expect(o.circles).toHaveLength(4);
    expect(o.circles.map(c => c.cls).sort()).toEqual(["between plants", "double", "off-row", "on pattern"]);
    for (const c of o.circles) expect(c.r).toBeCloseTo(0.2257 / 0.01 / 2, 1);
    expect(BLOB_COLOUR["on pattern"]).toBe("#4CAF50");
    expect(BLOB_COLOUR["off-row"]).not.toBe(BLOB_COLOUR["between plants"]);
  });

  it("says what the colours mean and sizes the cut from the row spacing", () => {
    const o = overlayFromPattern(pattern);
    expect(overlayLegend(o, pattern)).toBe("Rows in 1 planting: 1 plants on the pattern (green), 1 between plants (orange), 1 off the rows (red), 1 doubles (blue).");
    expect(overlayLegend({ ...o, blocks: 0 }, pattern)).toMatch(/No row pattern/);
    expect(patternLookSideM(null)).toBe(12);
    expect(patternLookSideM(0.76)).toBe(12);
    expect(patternLookSideM(5.1)).toBeCloseTo(30.6, 5);
    expect(patternLookSideM(9)).toBe(40);
  });
});
