// The pattern as lines and circles on the photo: rows across each block's
// windows, a circle per placed plant in its class's colour, the legend plain.
import { describe, expect, it } from "vitest";
import type { PhotoPattern } from "@/lib/photoScout/pattern";
import { BLOB_COLOUR, lookFromPattern, lookLegend, overlayFromPattern, overlayLegend, patternLookSideM } from "@/lib/sourceFrames/patternLook";

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

  it("marks the spot: the nearest placed blob within reach, else a ring where the map put it", () => {
    const near = overlayFromPattern(pattern, { x: 310, y: 108 });
    expect(near.focus).toMatchObject({ x: 300, y: 100, cls: "between plants", matched: true });
    const far = overlayFromPattern(pattern, { x: 900, y: 900, diameterM: 0.5 });
    expect(far.focus).toMatchObject({ x: 900, y: 900, matched: false });
    expect(far.focus!.r).toBeCloseTo(25, 5);
    expect(overlayFromPattern(pattern).focus).toBeNull();
  });

  it("cuts the look around a spot from the whole photo's pattern, in the original's pixels", () => {
    // 6 m around (310, 108) at 1 cm/px: a 600 px window, clamped to the photo's top edge; the original is twice the size.
    const look = lookFromPattern(pattern, { x: 310, y: 108 }, { filename: "DJI_0001.JPG", sideM: 6, nativeScale: 2 });
    expect(look.filename).toBe("DJI_0001.JPG");
    expect(look.window).toEqual({ x: 20, y: 0, width: 1200, height: 1200 });
    expect(look.gsdM).toBeCloseTo(0.005, 6);
    // The blobs at (100,100), (300,100), (300,300) fall inside; (700,100) and the unplaced one do not.
    expect(look.circles).toHaveLength(3);
    expect(look.counts).toEqual({ onPattern: 1, between: 1, offRow: 1, doubles: 0 });
    const between = look.circles.find(c => c.cls === "between plants")!;
    expect(between.x).toBeCloseTo((300 - 10) * 2, 5);
    expect(between.y).toBeCloseTo(200, 5);
    expect(between.r).toBeCloseTo((0.2257 / 0.01 / 2) * 2, 3);
    // The rows are clipped to the window and scaled; none runs past its edge.
    expect(look.lines.length).toBeGreaterThanOrEqual(3);
    for (const l of look.lines) {
      expect(Math.min(l.x1, l.x2)).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(l.x1, l.x2)).toBeLessThanOrEqual(1200 + 1e-6);
      expect(Math.max(l.y1, l.y2)).toBeLessThanOrEqual(1200 + 1e-6);
    }
    expect(look.focus).toMatchObject({ cls: "between plants", matched: true });
    expect(look.focus!.x).toBeCloseTo(580, 5);
    expect(lookLegend(look)).toBe("The white ring is this spot, read here as between plants. Around it: 1 crop plants on the pattern (green), 1 between plants (orange), 1 off the rows (red).");
    // A photo with no rows says so; rows elsewhere in the photo say the cut missed them.
    expect(lookLegend({ ...look, blocks: 0 })).toMatch(/No row pattern was read in this photo/);
    expect(lookLegend({ ...look, lines: [] })).toMatch(/do not run through this cut/);
    // The window never leaves the photo: a spot at the far corner is cut from the corner.
    const corner = lookFromPattern(pattern, { x: 1190, y: 1190 }, { filename: "x", sideM: 6, nativeScale: 1 });
    expect(corner.window).toEqual({ x: 600, y: 600, width: 600, height: 600 });
  });

  it("says what the colours mean and sizes the cut from the row spacing", () => {
    const o = overlayFromPattern(pattern, { x: 310, y: 108 });
    expect(overlayLegend(o, pattern)).toBe("The white ring is this spot, read here as between plants. Around it: 1 crop plants on the pattern (green), 1 between plants (orange), 1 off the rows (red), 1 doubles (blue), in 1 planting.");
    expect(overlayLegend({ ...o, blocks: 0 }, pattern)).toMatch(/No row pattern/);
    expect(patternLookSideM(null)).toBe(8);
    expect(patternLookSideM(0.76)).toBe(8);
    expect(patternLookSideM(5.1)).toBeCloseTo(15.3, 5);
    expect(patternLookSideM(9)).toBe(24);
  });
});
