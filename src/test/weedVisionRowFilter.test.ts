// @vitest-environment node
// The planting pattern as a filter on the model's weeds: on a crop plant, on a row line, off the rows, or unread.
import { describe, expect, it } from "vitest";
import type { PhotoPattern } from "@/lib/photoScout/pattern";
import { ROW_BAND_MIN_M, isOnRow, rowContextFromPattern, rowStatusOf } from "@/lib/weedVision/rowFilter";
import { countByRow } from "@/lib/weedVision/frames";

/**
 * A pattern read on 1000 x 800 px at 2 cm/px: one block, one window, rows along x at pixel y = 200 and 600 (the fit
 * works in local metres with y up: phase -4 m and pitch 8 m give y = -4 m and -12 m), with two crop plants on the first row.
 */
function pattern(): PhotoPattern {
  const window = {
    index: 0, x0: 0, y0: 0, x1: 999, y1: 799, usable: true, block: 0, signal: "vegetation", own: null, rowLines: null, squareGrid: false, seed: null, onRow: 2, offRow: 1,
    fit: { centre: { x: 10, y: -8 }, sizeM: 10, angleDeg: 0, pitchM: 8, phaseM: -4, confidence: 1, angleConfidence: 1, pitchConfidence: 1, vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 8 },
  };
  const blob = (id: number, x: number, y: number, cls: PhotoPattern["blobs"][number]["cls"], dM = 1.0) => ({ id, x, y, areaPx: Math.PI * (dM / 0.02 / 2) ** 2, areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, touchesBorder: false, window: 0, rowIndex: cls === "off-row" ? null : 0, acrossM: 0, alongM: 0, cls });
  return {
    width: 1000, height: 800, gsdM: 0.02, rowSpacingM: 8, windowM: 20, minBlobAreaCm2: 1, vegetationFraction: 0.2, canopyClosed: false,
    windows: [window as unknown as PhotoPattern["windows"][number]],
    blobs: [blob(1, 300, 200, "on pattern"), blob(2, 700, 200, "on pattern"), blob(3, 500, 400, "off-row", 0.3)],
    blocks: [], summary: { blocks: 1, usableWindows: 1, windows: 1 } as unknown as PhotoPattern["summary"], notes: [],
  } as unknown as PhotoPattern;
}

describe("rowContextFromPattern", () => {
  it("carries the pattern's crop circles to native pixels and sets the band from their size", () => {
    const ctx = rowContextFromPattern(pattern(), 2);  // the original is twice the read's pixels
    expect(ctx).not.toBeNull();
    expect(ctx!.crops).toHaveLength(2);
    expect(ctx!.crops[0]).toMatchObject({ x: 600, y: 400 });
    expect(ctx!.crops[0].r).toBeCloseTo(50, 0); // 1 m across at 2 cm/px = 50 px read, 100 px native... radius 25 read -> 50 native
    expect(ctx!.gsdM).toBeCloseTo(0.01, 6);
    expect(ctx!.bandPx).toBeCloseTo(50, 0);
  });

  it("is null when no rows were read, and the band never drops under the floor", () => {
    const p = pattern();
    (p.summary as unknown as { blocks: number }).blocks = 0;
    expect(rowContextFromPattern(p, 1)).toBeNull();
    const q = pattern();
    q.blobs = q.blobs.map(b => ({ ...b, equivDiameterM: 0.05 }));
    const ctx = rowContextFromPattern(q, 1)!;
    expect(ctx.bandPx).toBeCloseTo(ROW_BAND_MIN_M / 0.02, 3);
  });
});

describe("rowStatusOf", () => {
  const ctx = rowContextFromPattern(pattern(), 1)!;
  it("tells a weed on a crop plant from one on the row line from one off the rows", () => {
    expect(rowStatusOf(ctx, 300, 205)).toBe("on-crop");   // inside the first crop circle (r 25)
    expect(rowStatusOf(ctx, 500, 210)).toBe("on-row");    // on the row at y = 200, between the plants (band 25 px)
    expect(rowStatusOf(ctx, 500, 400)).toBe("off-row");   // mid-way between the rows
    expect(rowStatusOf(null, 500, 400)).toBe("no-rows");
  });

  it("counts for the summary and the toggle", () => {
    const dets = [
      { klass: "weed" as const, rowStatus: rowStatusOf(ctx, 300, 205) },
      { klass: "weed" as const, rowStatus: rowStatusOf(ctx, 500, 400) },
      { klass: "weed" as const, rowStatus: rowStatusOf(null, 1, 1) },
      { klass: "crop" as const, rowStatus: undefined },
    ];
    expect(countByRow(dets)).toEqual({ offRow: 1, onRow: 1, noRows: 1 });
    expect(isOnRow("on-crop")).toBe(true);
    expect(isOnRow("off-row")).toBe(false);
    expect(isOnRow(undefined)).toBe(false);
  });
});
