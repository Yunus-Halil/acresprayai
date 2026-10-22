// The labelling tool's arithmetic (scripts/annotate/labelCore.js): the diameter a drag writes, and the exhaustive
// region's tag on export. The file is a classic browser script, so it is run here as the page runs it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Label = { x: number; y: number; rx: number; ry: number; cls: string; diameterCm: number | null; shadow?: boolean; at?: string; prior?: string | null; exhaustiveRegion?: string | null };
type Core = {
  CLICK_PX: number;
  diameterCmFromDrag(cx: number, cy: number, ex: number, ey: number, gsd: number | null): number | null;
  radiusPx(d: number | null, gsd: number | null): number | null;
  inside(x: number, y: number, r: { x: number; y: number; width: number; height: number } | null): boolean;
  regionCounts(l: Label[], r: object): { inside: number; sized: number; unsized: number; weeds: number; weedsSized: number };
  nextUnsized(l: Label[], r: object, from: number): number;
  exportLabels(l: Label[], o: Record<string, unknown>): { labels: (Record<string, unknown> & { exhaustiveRegion?: string })[]; activeRegion: string | null; format: string };
};
const ctx: { LabelCore?: Core } = {};
runInNewContext(readFileSync(join(__dirname, "..", "..", "scripts", "annotate", "labelCore.js"), "utf8"), ctx);
const C = ctx.LabelCore!;

// The two windows of evaluation/groundtruth/image1/regions-exhaustive.json.
const REGIONS = JSON.parse(readFileSync(join(__dirname, "..", "..", "evaluation", "groundtruth", "image1", "regions-exhaustive.json"), "utf8"));
const A = REGIONS[0];
const GSD = 0.9863710162122517; // DJI_0301's cm per pixel, from its predictions files

const lab = (x: number, y: number, cls = "weed", diameterCm: number | null = null, extra: Partial<Label> = {}): Label => ({ x, y, rx: x, ry: y, cls, diameterCm, at: "t", ...extra });

describe("the diameter a drag writes", () => {
  it("is twice the drag's length in photo pixels times the photo's cm per pixel", () => {
    expect(C.diameterCmFromDrag(100, 100, 103, 104, GSD)).toBeCloseTo(2 * 5 * GSD, 2); // a 5 px radius: 9.86 cm
    expect(C.diameterCmFromDrag(0, 0, 2, 0, GSD)).toBeCloseTo(3.95, 2); // a weed under 5 cm can be sized
    expect(C.diameterCmFromDrag(0, 0, 10, 0, null)).toBeNull(); // no pixel size: no diameter, never a guess
    expect(C.diameterCmFromDrag(0, 0, 10, 0, 0)).toBeNull();
  });

  it("draws back at the size it was given, and a click is told from a drag", () => {
    const d = C.diameterCmFromDrag(50, 50, 50, 62, GSD)!;
    expect(C.radiusPx(d, GSD)).toBeCloseTo(12, 1);
    expect(C.radiusPx(null, GSD)).toBeNull();
    expect(C.CLICK_PX).toBeGreaterThan(0);
  });

  it("lands in the export as diameterCm; a point label keeps null", () => {
    const out = C.exportLabels([lab(10, 10, "weed", C.diameterCmFromDrag(10, 10, 16, 10, GSD)), lab(20, 20)], { imageName: "DJI_0301.JPG", idPrefix: "image1-full" });
    expect(out.format).toBe("swardus-region-labels-v1");
    expect(out.labels[0].diameterCm).toBeCloseTo(12 * GSD, 2);
    expect(out.labels[1].diameterCm).toBeNull();
  });
});

describe("the exhaustive region", () => {
  it("counts a label by its centre: one touching the outline is in when its centre is", () => {
    expect(A.id).toBe("image1-A");
    expect(C.inside(A.x, A.y, A)).toBe(true);
    expect(C.inside(A.x + A.width - 0.1, A.y + 1, A)).toBe(true);
    expect(C.inside(A.x + A.width, A.y + 1, A)).toBe(false);
    expect(C.inside(A.x - 1, A.y + 1, A)).toBe(false);
  });

  it("keeps a running count inside, with and without a diameter", () => {
    const ls = [lab(A.x + 10, A.y + 10, "weed", 4), lab(A.x + 20, A.y + 20), lab(A.x + 30, A.y + 30, "crop"), lab(A.x - 50, A.y + 10, "weed", 8)];
    expect(C.regionCounts(ls, A)).toEqual({ inside: 3, sized: 1, unsized: 2, weeds: 2, weedsSized: 1 });
  });

  it("tags labels inside the active region on export, leaves those outside untagged, and keeps an earlier tag", () => {
    const B = REGIONS[1];
    const ls = [lab(A.x + 10, A.y + 10, "weed", 4), lab(A.x - 50, A.y + 10), lab(B.x + 5, B.y + 5, "weed", 3, { exhaustiveRegion: B.id })];
    const out = C.exportLabels(ls, { imageName: "DJI_0301.JPG", idPrefix: "image1-full", activeRegion: A });
    expect(out.activeRegion).toBe("image1-A");
    expect(out.labels[0].exhaustiveRegion).toBe("image1-A");
    expect("exhaustiveRegion" in out.labels[1]).toBe(false);
    expect(out.labels[2].exhaustiveRegion).toBe("image1-B");
    // With no region active nothing new is tagged.
    const none = C.exportLabels(ls, { imageName: "DJI_0301.JPG", idPrefix: "image1-full" });
    expect(none.activeRegion).toBeNull();
    expect("exhaustiveRegion" in none.labels[0]).toBe(false);
  });

  it("jumps to the next weed in the region with no diameter, wrapping round, skipping crop and sized labels", () => {
    const ls = [lab(A.x + 1, A.y + 1, "weed", 5), lab(A.x + 2, A.y + 2), lab(A.x + 3, A.y + 3, "crop"), lab(A.x - 9, A.y + 3), lab(A.x + 4, A.y + 4, "uncertain")];
    expect(C.nextUnsized(ls, A, -1)).toBe(1);
    expect(C.nextUnsized(ls, A, 1)).toBe(4);
    expect(C.nextUnsized(ls, A, 4)).toBe(1); // wraps
    ls[1].diameterCm = 3; ls[4].diameterCm = 2;
    expect(C.nextUnsized(ls, A, 0)).toBe(-1); // every one sized
  });
});
