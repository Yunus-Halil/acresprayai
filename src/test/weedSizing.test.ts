// @vitest-environment node
//
// Weed size v1 on painted ground truth: discs of known diameter on soil at a
// known pixel size, alone, touching, cut by an edge, beside the crop, and
// too small to see. Then the same measurement carried through a real camera
// pose (the odm-dd0f6314 reconstruction), with a cutter that paints the disc
// at the pixel the pose predicts, so the native pixel size and the window
// arithmetic are checked against the geometry and not against themselves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import type { AreaWindow } from "@/lib/sourceFrames/crop";
import { groundAltitudeFromOdm, parseOdmOutputs, pixelToGround } from "@/lib/sourceFrames/odm";
import type { PhotoLook } from "@/lib/sourceFrames/patternLook";
import { DEFAULT_SIZE_THRESHOLDS, MEASUREMENT_VERSION, readMeasurement, readSizeThresholds, sizeCategoryOf, unavailableMeasurement } from "@/lib/weedScout/sizing/types";
import { confidenceOf, convexHull, maxFeret, segmentWeed, traceOutline, vegetationThreshold } from "@/lib/weedScout/sizing/segment";
import { expectedDiameterM, measureSpotInPhoto, squareWindow, wantsMeasurement } from "@/lib/weedScout/sizing/measure";
import { measurementLine, measurementRows } from "@/lib/weedScout/sizing/describe";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

type Disc = { x: number; y: number; rM: number };

/** Soil with noise, green discs at known ground radii, optional deep shadow. */
function scene(widthPx: number, heightPx: number, gsdM: number, discs: Disc[], opts: { shadow?: { x0: number; y0: number; x1: number; y1: number }; seed?: number } = {}): PhotoPixels {
  const rgba = new Uint8ClampedArray(widthPx * heightPx * 4);
  const rand = rng(opts.seed ?? 7);
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const o = (y * widthPx + x) * 4;
    const n = (rand() - 0.5) * 30;
    let r = 150 + n, g = 110 + n, b = 80 + n;
    for (const d of discs) {
      if ((x + 0.5 - d.x) ** 2 + (y + 0.5 - d.y) ** 2 <= (d.rM / gsdM) ** 2) { r = 70 + n * 0.5; g = 150 + n * 0.5; b = 50 + n * 0.5; }
    }
    const s = opts.shadow;
    if (s && x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1) { r *= 0.08; g *= 0.08; b *= 0.08; }
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }
  return { width: widthPx, height: heightPx, rgba };
}

const T = DEFAULT_SIZE_THRESHOLDS;

describe("segmentWeed on painted discs", () => {
  it("measures a lone disc to within a few percent, in ground units at any pixel size", () => {
    for (const gsd of [0.005, 0.01, 0.02]) {
      const px = scene(200, 200, gsd, [{ x: 100, y: 100, rM: 0.08 }]);
      const { measurement: m, wider } = segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: gsd, thresholds: T, cropCircles: [] });
      expect(wider).toBe(false);
      expect(m.status).toBe("measured");
      expect(m.canopyDiameterCm!).toBeGreaterThan(15);
      expect(m.canopyDiameterCm!).toBeLessThan(17);
      expect(m.canopyAreaCm2!).toBeGreaterThan(Math.PI * 64 * 0.92);
      expect(m.canopyAreaCm2!).toBeLessThan(Math.PI * 64 * 1.08);
      // The longest axis of a disc is its diameter; the box is the diameter square.
      expect(m.maxExtentCm!).toBeGreaterThan(15);
      expect(m.maxExtentCm!).toBeLessThan(18);
      expect(m.boxWidthCm!).toBeGreaterThan(15);
      expect(m.boxHeightCm!).toBeLessThan(18);
      expect(m.sizeCategory).toBe("medium");
      expect(m.gsdCmPx).toBeCloseTo(gsd * 100, 6);
      expect(m.quality!.touchingNeighbours).toBe(0);
      expect(m.quality!.touchesCrop).toBe(false);
      expect(m.quality!.cropContext).toBe("known");
      // 16 cm is 32 px across at 5 mm, 8 px at 2 cm: the confidence says so.
      expect(m.confidence!).toBeGreaterThan(gsd <= 0.01 ? 0.5 : 0.3);
      expect(m.outlinePx!.length).toBeGreaterThan(8);
      expect(m.centrePx!.x).toBeCloseTo(100, 0);
      expect(m.version).toBe(MEASUREMENT_VERSION);
    }
  });

  it("finds the plant within reach when the map's point missed it, and not beyond", () => {
    const px = scene(300, 300, 0.01, [{ x: 150, y: 150, rM: 0.06 }]);
    const near = segmentWeed({ px, centre: { x: 150 + 15, y: 150 + 10 }, gsdM: 0.01, thresholds: T }).measurement;
    expect(near.status).toBe("measured");
    expect(near.canopyDiameterCm!).toBeCloseTo(12, 0);
    const far = segmentWeed({ px, centre: { x: 20, y: 20 }, gsdM: 0.01, thresholds: T }).measurement;
    expect(far.status).toBe("unknown");
    expect(far.reason).toMatch(/no vegetation at the spot/);
  });

  it("cuts two touching plants apart and measures the one at the spot, saying it touches another", () => {
    // Two 20 cm discs whose centres are 19 cm apart at 1 cm/px: one component with a neck.
    const px = scene(300, 300, 0.01, [{ x: 120.5, y: 150, rM: 0.1 }, { x: 139.5, y: 150, rM: 0.1 }]);
    const { measurement: m } = segmentWeed({ px, centre: { x: 117, y: 150 }, gsdM: 0.01, thresholds: T, cropCircles: [] });
    expect(m.status).toBe("measured");
    expect(m.quality!.touchingNeighbours).toBe(1);
    expect(m.clump).not.toBeNull();
    expect(m.clump!.parts).toBe(2);
    // About one disc, less the overlap it shares: well under the clump and over half of it.
    expect(m.canopyDiameterCm!).toBeGreaterThan(16);
    expect(m.canopyDiameterCm!).toBeLessThan(23);
    expect(m.clump!.diameterCm).toBeGreaterThan(m.canopyDiameterCm!);
    expect(m.confidence!).toBeLessThan(segmentWeed({ px: scene(300, 300, 0.01, [{ x: 150, y: 150, rM: 0.1 }]), centre: { x: 150, y: 150 }, gsdM: 0.01, thresholds: T, cropCircles: [] }).measurement.confidence!);
  });

  it("refuses a crop plant, flags a weed that reaches one, and says when the crop was not known", () => {
    const px = scene(300, 300, 0.01, [{ x: 150, y: 150, rM: 0.06 }]);
    const crop = segmentWeed({ px, centre: { x: 150, y: 150 }, gsdM: 0.01, thresholds: T, cropCircles: [{ x: 150, y: 150, r: 20 }] }).measurement;
    expect(crop.status).toBe("unknown");
    expect(crop.reason).toMatch(/crop plant/);
    const leaning = segmentWeed({ px, centre: { x: 150, y: 150 }, gsdM: 0.01, thresholds: T, cropCircles: [{ x: 190, y: 150, r: 36 }] }).measurement;
    expect(leaning.status).toBe("measured");
    expect(leaning.quality!.touchesCrop).toBe(true);
    const blind = segmentWeed({ px, centre: { x: 150, y: 150 }, gsdM: 0.01, thresholds: T }).measurement;
    expect(blind.quality!.cropContext).toBe("unknown");
    expect(blind.confidence!).toBeLessThan(segmentWeed({ px, centre: { x: 150, y: 150 }, gsdM: 0.01, thresholds: T, cropCircles: [] }).measurement.confidence!);
  });

  it("asks for a wider window when the plant runs past it, and gives up at the photo's edge", () => {
    const px = scene(100, 100, 0.01, [{ x: 50, y: 50, rM: 0.6 }]);
    const wide = segmentWeed({ px, centre: { x: 50, y: 50 }, gsdM: 0.01, thresholds: T, cropCircles: [] });
    expect(wide.wider).toBe(true);
    expect(wide.measurement.status).toBe("unknown");
    expect(wide.measurement.reason).toMatch(/runs past/);
    const edge = segmentWeed({ px, centre: { x: 50, y: 50 }, gsdM: 0.01, thresholds: T, cropCircles: [], photoEdge: { left: true, top: false, right: false, bottom: false } });
    expect(edge.wider).toBe(false);
    expect(edge.measurement.status).toBe("unknown");
    expect(edge.measurement.reason).toMatch(/photo's edge/);
    expect(edge.measurement.quality!.touchesPhotoEdge).toBe(true);
  });

  it("withholds a size under the pixel floor, and on soil with nothing green", () => {
    const tiny = segmentWeed({ px: scene(100, 100, 0.02, [{ x: 50, y: 50, rM: 0.035 }]), centre: { x: 50, y: 50 }, gsdM: 0.02, thresholds: T, cropCircles: [], minPixelsAcross: 6 }).measurement;
    expect(tiny.status).toBe("unknown");
    expect(tiny.reason).toMatch(/too small to measure/);
    expect(tiny.quality!.pixelsAcross).toBeLessThan(6);
    const bare = segmentWeed({ px: scene(100, 100, 0.01, []), centre: { x: 50, y: 50 }, gsdM: 0.01, thresholds: T, cropCircles: [] }).measurement;
    expect(bare.status).toBe("unknown");
    expect(bare.canopyDiameterCm).toBeNull();
  });

  it("takes the context's threshold when it has contrast, and the window's when it has none", () => {
    const px = scene(200, 200, 0.01, [{ x: 100, y: 100, rM: 0.08 }]);
    const ctx = vegetationThreshold(scene(600, 600, 0.01, [{ x: 300, y: 300, rM: 0.08 }, { x: 100, y: 100, rM: 0.2 }]))!;
    expect(ctx.spread).toBeGreaterThan(0.05);
    const withContext = segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: 0.01, thresholds: T, cropCircles: [], context: ctx }).measurement;
    expect(withContext.status).toBe("measured");
    expect(withContext.quality!.thresholdSource).toBe("context");
    expect(withContext.quality!.maskContrast).toBeCloseTo(ctx.spread, 3);
    expect(withContext.canopyDiameterCm!).toBeCloseTo(16, 0);
    const flat = segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: 0.01, thresholds: T, cropCircles: [], context: { threshold: 0, spread: 0.01 } }).measurement;
    expect(flat.quality!.thresholdSource).toBe("window");
    expect(flat.status).toBe("measured");
    expect(vegetationThreshold(scene(4, 4, 0.01, []))).toBeNull();
  });

  it("leaves deep shadow out of the mask and records how much of the window it was", () => {
    const px = scene(200, 200, 0.01, [{ x: 100, y: 100, rM: 0.08 }], { shadow: { x0: 0, y0: 0, x1: 200, y1: 60 } });
    const m = segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: 0.01, thresholds: T, cropCircles: [] }).measurement;
    expect(m.status).toBe("measured");
    expect(m.quality!.darkShare).toBeCloseTo(0.3, 1);
    expect(m.canopyDiameterCm!).toBeCloseTo(16, 0);
  });

  it("withholds the numbers when the confidence is under the floor, keeping the confidence and the reason", () => {
    const px = scene(200, 200, 0.01, [{ x: 100, y: 100, rM: 0.08 }]);
    const m = segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: 0.01, thresholds: T, cropCircles: [], viewAngleDeg: 38, minConfidence: 0.9 }).measurement;
    expect(m.status).toBe("unknown");
    expect(m.reason).toMatch(/confidence .* is under 0.9/);
    expect(m.reason).toMatch(/38 degrees off straight down/);
    expect(m.confidence).not.toBeNull();
    expect(m.canopyDiameterCm).toBeNull();
  });

  it("categorises by the thresholds it was given and reads stored thresholds safely", () => {
    expect(sizeCategoryOf(5, T)).toBe("small");
    expect(sizeCategoryOf(10, T)).toBe("small");
    expect(sizeCategoryOf(10.1, T)).toBe("medium");
    expect(sizeCategoryOf(31, T)).toBe("large");
    expect(sizeCategoryOf(31, { smallMaxCm: 20, mediumMaxCm: 50 })).toBe("medium");
    expect(readSizeThresholds(null)).toEqual(T);
    expect(readSizeThresholds({ smallMaxCm: 5, mediumMaxCm: 2 })).toEqual({ smallMaxCm: 5, mediumMaxCm: 30 });
    expect(readSizeThresholds({ smallMaxCm: 40, mediumMaxCm: 20 })).toEqual({ smallMaxCm: 40, mediumMaxCm: 80 });
    expect(readSizeThresholds({ smallMaxCm: 8, mediumMaxCm: 25 })).toEqual({ smallMaxCm: 8, mediumMaxCm: 25 });
    const px = scene(200, 200, 0.01, [{ x: 100, y: 100, rM: 0.08 }]);
    expect(segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: 0.01, thresholds: { smallMaxCm: 20, mediumMaxCm: 40 }, cropCircles: [] }).measurement.sizeCategory).toBe("small");
  });

  it("confidence: the weaker of resolution and contrast, scaled by view, touching and the crop", () => {
    const q = { pixelsAcross: 16, maskContrast: 0.2, darkShare: 0, touchingNeighbours: 0, touchesCrop: false, cropContext: "known" as const, thresholdSource: "window" as const, touchesWindowEdge: false, touchesPhotoEdge: false };
    expect(confidenceOf(q, 0, 6)).toBe(1);
    expect(confidenceOf({ ...q, pixelsAcross: 3 }, 0, 6)).toBe(0);
    expect(confidenceOf({ ...q, maskContrast: 0.05 }, 0, 6)).toBe(0);
    expect(confidenceOf(q, 20, 6)).toBe(0.5);
    expect(confidenceOf(q, 90, 6)).toBe(0.25);
    expect(confidenceOf({ ...q, touchingNeighbours: 2 }, null, 6)).toBe(0.6);
    expect(confidenceOf({ ...q, touchesCrop: true }, null, 6)).toBe(0.5);
    expect(confidenceOf({ ...q, cropContext: "unknown" }, null, 6)).toBe(0.85);
  });
});

describe("the geometry helpers", () => {
  it("hull and Feret of a square", () => {
    const pts = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) pts.push({ x, y });
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    expect(maxFeret(hull)).toBeCloseTo(Math.hypot(9, 9), 6);
  });

  it("traces the outline of a disc as one ring, and an isolated pixel as one point", () => {
    const W = 40, H = 40;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (x - 20) ** 2 + (y - 20) ** 2 <= 100;
    const ring = traceOutline(inside, W, H);
    expect(ring.length).toBeGreaterThan(40);
    expect(ring.length).toBeLessThan(90);
    for (const p of ring) {
      expect(inside(p.x, p.y)).toBe(true);
      const r = Math.hypot(p.x - 20, p.y - 20);
      expect(r).toBeGreaterThan(8);
    }
    // No point twice: one lap.
    expect(new Set(ring.map(p => `${p.x},${p.y}`)).size).toBe(ring.length);
    expect(traceOutline((x, y) => x === 3 && y === 3, 10, 10)).toEqual([{ x: 3, y: 3 }]);
    expect(traceOutline(() => false, 10, 10)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Through a real pose
// --------------------------------------------------------------------------

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const stats = read("stats.json");
const groundAlt = groundAltitudeFromOdm(set, stats.odm_processing_statistics.average_gsd)!;
const cam = Object.values(set.cameras)[0];

/** A cutter that paints a disc of `rM` ground metres at native pixel `at`, with the pixel size the caller says. */
function discCutter(at: { x: number; y: number }, rM: number, gsdM: number, nativeWidth: number, nativeHeight: number) {
  const calls: AreaWindow[] = [];
  const cut = (win: AreaWindow): PhotoPixels => {
    calls.push(win);
    const w = Math.min(win.width, nativeWidth - win.x), h = Math.min(win.height, nativeHeight - win.y);
    return scene(w, h, gsdM, [{ x: at.x - win.x, y: at.y - win.y, rM }]);
  };
  return { cut, calls };
}

describe("measureSpotInPhoto through the reconstruction", () => {
  const shot = set.shots[0];
  // A 5472 px original behind the 2,400 px frame ODM saw. This scan was flown high (about 6.5 cm/px uploaded, 2.9 cm/px native), so the painted plants are large.
  const nativeScale = 5472 / cam.width;
  const nativeWidth = Math.round(cam.width * nativeScale), nativeHeight = Math.round(cam.height * nativeScale);
  const at = { x: 1000 * nativeScale, y: 700 * nativeScale };

  it("measures a plant at the pixel the pose predicts, at the native pixel size there", () => {
    // A spot on the ground where the uploaded frame's pixel (1000, 700) lands.
    const g = pixelToGround(set, shot, 1000, 700, groundAlt)!;
    const { cut, calls } = discCutter(at, 0.3, 0.0, nativeWidth, nativeHeight);
    // The cutter needs the pixel size the pose will compute: measure once to learn it, then paint at it.
    const probe = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look: null, thresholds: T, cut: (w) => ({ width: w.width, height: w.height, rgba: new Uint8ClampedArray(w.width * w.height * 4) }) });
    expect(probe.gsdCmPx).not.toBeNull();
    const gsdM = probe.gsdCmPx! / 100;
    expect(gsdM).toBeGreaterThan(0.002);
    expect(gsdM).toBeLessThan(0.05);
    const painted = discCutter(at, 0.3, gsdM, nativeWidth, nativeHeight);
    const m = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look: null, thresholds: T, cut: painted.cut });
    expect(m.status).toBe("measured");
    expect(m.sourceFrame).toBe(shot.filename);
    expect(m.canopyDiameterCm!).toBeGreaterThan(57);
    expect(m.canopyDiameterCm!).toBeLessThan(63);
    expect(m.centrePx!.x).toBeCloseTo(at.x, -1);
    expect(m.centrePx!.y).toBeCloseTo(at.y, -1);
    expect(m.source!.window.x).toBeLessThan(at.x);
    expect(m.source!.window.x + m.source!.window.width).toBeGreaterThan(at.x);
    expect(m.source!.viewAngleDeg).not.toBeNull();
    expect(m.source!.groundAltM).toBe(groundAlt);
    // The outline is in the photo's own pixels, around the plant.
    for (const p of m.outlinePx!) expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThan(0.3 / gsdM + 2);
    expect(calls.length).toBe(0);
    // The context for the threshold, then the window.
    expect(painted.calls.length).toBe(2);
    expect(painted.calls[0].width).toBeGreaterThan(painted.calls[1].width);
    expect(m.quality!.cropContext).toBe("unknown");
    expect(m.quality!.thresholdSource).toBe("context");
  });

  it("widens the window once for a plant that runs past the first cut, and reports the crop from the look", () => {
    const g = pixelToGround(set, shot, 1000, 700, groundAlt)!;
    const probe = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look: null, thresholds: T, cut: (w) => ({ width: w.width, height: w.height, rgba: new Uint8ClampedArray(w.width * w.height * 4) }) });
    const gsdM = probe.gsdCmPx! / 100;
    // Expected 20 cm from the map, so the first window is 1.2 m; the plant is 2 m across.
    const big = discCutter(at, 1.0, gsdM, nativeWidth, nativeHeight);
    const m = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: { equivDiameterM: 0.2 } as never }, look: null, thresholds: T, cut: big.cut });
    expect(big.calls.length).toBe(3);
    expect(big.calls[2].width).toBeGreaterThan(big.calls[1].width);
    expect(m.status).toBe("measured");
    expect(m.canopyDiameterCm!).toBeGreaterThan(190);
    expect(m.canopyDiameterCm!).toBeLessThan(210);
    expect(m.sizeCategory).toBe("large");
    // A look in this photo with a crop circle on the plant: it is the crop.
    const look: PhotoLook = { filename: shot.filename, window: { x: at.x - 100, y: at.y - 100, width: 200, height: 200 }, gsdM, lines: [], circles: [{ x: 100, y: 100, r: 30, cls: "on pattern" }], focus: null, blocks: 1, counts: { onPattern: 1, between: 0, offRow: 0, doubles: 0 } };
    const cropped = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look, thresholds: T, cut: discCutter(at, 0.3, gsdM, nativeWidth, nativeHeight).cut });
    expect(cropped.status).toBe("unknown");
    expect(cropped.reason).toMatch(/crop plant/);
    expect(cropped.quality!.cropContext).toBe("known");
    // A look from another photo says nothing about this one.
    const other = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look: { ...look, filename: "elsewhere.JPG" }, thresholds: T, cut: discCutter(at, 0.3, gsdM, nativeWidth, nativeHeight).cut });
    expect(other.status).toBe("measured");
    expect(other.quality!.cropContext).toBe("unknown");
  });

  it("is unavailable, with the reason, when the spot is not in the photo or the original's size is unknown", () => {
    const far = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: shot.centre.lat + 1, lng: shot.centre.lng }, blob: null }, look: null, thresholds: T, cut: () => null });
    expect(far.status).toBe("unavailable");
    expect(far.reason).toMatch(/not fall inside/);
    expect(far.sourceFrame).toBe(shot.filename);
    const g = pixelToGround(set, shot, 1000, 700, groundAlt)!;
    const sizeless = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth: 0, nativeHeight: 0, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look: null, thresholds: T, cut: () => null });
    expect(sizeless.status).toBe("unavailable");
    const uncut = measureSpotInPhoto({ set, shot, groundAltM: groundAlt, nativeWidth, nativeHeight, candidate: { centroid: { lat: g.lat, lng: g.lng }, blob: null }, look: null, thresholds: T, cut: () => null });
    expect(uncut.status).toBe("unavailable");
    expect(uncut.reason).toMatch(/could not be cut/);
  });

  it("helpers: the window is square and clamped, the expected size comes from the map then the look, and a spot wants measuring until it has one", () => {
    expect(squareWindow({ x: 10, y: 10 }, 100, 1000, 800)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(squareWindow({ x: 990, y: 790 }, 100, 1000, 800)).toEqual({ x: 900, y: 700, width: 100, height: 100 });
    expect(squareWindow({ x: 500, y: 400 }, 5000, 1000, 800)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(expectedDiameterM({ blob: { equivDiameterM: 0.3 } as never }, null)).toBe(0.3);
    expect(expectedDiameterM({ blob: null }, { focus: { matched: true, r: 10 }, gsdM: 0.01 } as never)).toBeCloseTo(0.2, 6);
    expect(expectedDiameterM({ blob: null }, null)).toBe(0.2);
    expect(wantsMeasurement({ region: null })).toBe(true);
    expect(wantsMeasurement({ region: null, measurement: unavailableMeasurement("no photo", T) })).toBe(true);
    expect(wantsMeasurement({ region: null, measurement: { ...unavailableMeasurement("x", T), status: "unknown" } })).toBe(false);
    expect(wantsMeasurement({ region: {} as never })).toBe(false);
    expect(readMeasurement(unavailableMeasurement("x", T))?.status).toBe("unavailable");
    expect(readMeasurement({ foo: 1 })).toBeNull();
    expect(readMeasurement(null)).toBeNull();
  });
});

describe("the words", () => {
  it("say the size, or why there is none, in the operator's units", () => {
    const px = scene(200, 200, 0.01, [{ x: 100, y: 100, rM: 0.08 }]);
    const m = { ...segmentWeed({ px, centre: { x: 100, y: 100 }, gsdM: 0.01, thresholds: T, cropCircles: [] }).measurement, sourceFrame: "DJI_0001.JPG", source: { frame: "DJI_0001.JPG", nativeWidth: 5472, nativeHeight: 3648, window: { x: 0, y: 0, width: 200, height: 200 }, viewAngleDeg: 3, groundAltM: 100 } };
    expect(measurementLine(m, "metric")).toMatch(/^Canopy 1[56]\.\d cm across, \d+ cm², medium \(measured in the photo; confidence (1\.00|0\.\d+)\)\.$/);
    expect(measurementLine(m, "imperial")).toMatch(/in across, .* in²/);
    expect(measurementLine(null, "metric")).toBe("Size not measured yet.");
    expect(measurementLine(unavailableMeasurement("no original photo was kept", T), "metric")).toBe("Size not measured: no original photo was kept.");
    expect(measurementLine({ ...m, status: "unknown", reason: "the plant is cut by the photo's edge" }, "metric")).toBe("Size not measured in the photo: the plant is cut by the photo's edge.");
    const rows = measurementRows(m, "metric");
    const keys = rows.map(r => r[0]);
    expect(keys).toEqual(["Canopy", "Longest axis", "Box (not the canopy)", "Size class", "Confidence", "Pixel size", "Photo", "Mask", "Method"]);
    expect(rows.find(r => r[0] === "Photo")![1]).toBe("DJI_0001.JPG, 3° from straight down");
    expect(rows.find(r => r[0] === "Method")![1]).toBe(`native-photo-mask-v1 (${MEASUREMENT_VERSION})`);
    const touching = { ...m, quality: { ...m.quality!, touchingNeighbours: 1 }, clump: { diameterCm: 30, areaCm2: 700, parts: 2 } };
    expect(measurementLine(touching, "metric")).toMatch(/touches 1 other plant/);
    expect(measurementRows(touching, "metric").find(r => r[0] === "Whole clump")![1]).toBe("30.0 cm across, 2 plants");
  });
});
