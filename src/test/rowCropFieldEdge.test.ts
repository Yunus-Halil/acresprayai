// Establishment: where the field ends (2026-11-02). A rendered V5 stand with a grass verge and a gravel road painted
// across its bottom: the rows must stop at the verge, nothing past it may be a row, a gap or a weed, and the ends must
// say what lies beyond. The outline of a left-out patch must follow the patch, not its convex hull.
import { describe, expect, it } from "vitest";
import { renderScene, type Scene } from "../../scripts/cropProfiles/scenes";
import { cellOutline, readRowCrop } from "@/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const profile = cropProfileFor("corn")!;
const scene: Scene = { name: "edge", widthM: 12, heightM: 9, gsdM: 0.01, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.2, soil: "light", straw: null, weedsPerM2: 0, weedRadiusM: 0.04, inRowWeedsPerM: 0, seed: 7 };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * The stand with the bottom of the photo painted: from `verge` (share of the height) a grass verge, from `road` a
 * gravel road. The verge is a little greener along the rows' lines (grass over old furrows, mowing stripes), which is
 * what carried the tracer on into real verges.
 */
function fieldWithEdge(verge: number, road: number) {
  const { px, truth } = renderScene(scene);
  const { width: W, height: H, rgba } = px, r = rng(11);
  for (let y = Math.round(verge * H); y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const stripe = Math.abs(truth.acrossToRow(x * scene.gsdM, -y * scene.gsdM)) < 0.1 ? 1 : 0;
    if (y < road * H) { const g = r(); const blade = r() < 0.3 ? 30 : 0; rgba[o] = 60 + 25 * g + blade - 15 * stripe; rgba[o + 1] = 105 + 40 * g + blade + 20 * stripe; rgba[o + 2] = 40 + 20 * g - 10 * stripe; }
    else { const g = 140 + 30 * r(); rgba[o] = g; rgba[o + 1] = g - 4; rgba[o + 2] = g - 12; }
  }
  return { px, vergeY: verge * H };
}

describe("establishment: the field's edge", { timeout: 60000 }, () => {
  const { px, vergeY } = fieldWithEdge(0.7, 0.85);
  const read = readRowCrop(px, rowCropParamsFor(profile, scene.gsdM, "establishment"));
  const slack = 0.5 / scene.gsdM; // half a metre: a strip

  // A guard only: the rendered verge does not carry the tracer on as the real ones did (34, 63 and 64 in
  // directtestimagery/estabilishmentphase are the evidence for that); the two tests on the ends fail without the step.
  it("stops every row at the verge", () => {
    expect(read.rows.length).toBeGreaterThanOrEqual(10);
    for (const r of read.rows) for (const [, y] of r.points) expect(y).toBeLessThanOrEqual(vergeY + slack);
  });

  it("reports nothing past the verge: no gaps, no weeds", () => {
    for (const r of read.rows) for (const g of r.gaps) expect(Math.max(g.y1, g.y2)).toBeLessThanOrEqual(vergeY + slack);
    for (const w of read.weeds) expect(w.y).toBeLessThanOrEqual(vergeY);
  });

  it("says where the field ends and that grass lies beyond, and draws the edge across the rows", () => {
    const ends = read.fieldEdge!.ends;
    expect(ends.length).toBeGreaterThanOrEqual(0.8 * read.rows.length);
    expect(ends.filter(e => e.beyond === "grass or cover").length).toBeGreaterThanOrEqual(0.8 * ends.length);
    for (const e of ends) expect(Math.abs(e.y - vergeY)).toBeLessThanOrEqual(2 * slack);
    expect(read.fieldEdge!.lines.length).toBeGreaterThan(0);
    expect(read.notes.some(n => /field ends inside the photo/.test(n))).toBe(true);
  });

  it("stops at bare ground (a road straight after the crop) and says so", () => {
    const bare = fieldWithEdge(0.7, 0.7);
    const r2 = readRowCrop(bare.px, rowCropParamsFor(profile, scene.gsdM, "establishment"));
    for (const r of r2.rows) for (const [, y] of r.points) expect(y).toBeLessThanOrEqual(bare.vergeY + slack);
    const ends = r2.fieldEdge!.ends;
    expect(ends.length).toBeGreaterThanOrEqual(0.8 * r2.rows.length);
    expect(ends.filter(e => e.beyond === "bare ground").length).toBeGreaterThanOrEqual(0.8 * ends.length);
  });

  it("leaves a stand that runs off the frame as it was: no ends", () => {
    const { px: open } = renderScene(scene);
    const r3 = readRowCrop(open, rowCropParamsFor(profile, scene.gsdM, "establishment"));
    expect(r3.fieldEdge!.ends.length).toBeLessThanOrEqual(1);
  });

  it("the mid variant carries no field edge", () => {
    const mid = readRowCrop(px, rowCropParamsFor(profile, scene.gsdM, "mid"));
    expect(mid.fieldEdge).toBeUndefined();
  });
});

describe("outline of a left-out patch", { timeout: 60000 }, () => {
  it("follows an L shape instead of cutting across its notch", () => {
    const W = 100, pix: number[] = [];
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if (x < 20 || y >= 80) pix.push(y * W + x); // an L
    const ring = cellOutline(pix, W, 5);
    const inside = (px: number, py: number) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c; } return c; };
    expect(inside(10, 10)).toBe(true); // the upright
    expect(inside(90, 90)).toBe(true); // the foot
    expect(inside(60, 40)).toBe(false); // the notch a convex hull would cover
  });
});
