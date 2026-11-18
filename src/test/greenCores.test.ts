// The vivid cores (src/lib/rowCrop/greenCores.ts) and the option that adds them to the plant read's marks
// (greenPoints.ts plantPointsFromGreen, cornV1.ts CORN_CORES): off by default, and with it off nothing changes.
import { describe, expect, it } from "vitest";
import type { AdaptiveRead } from "@/lib/rowCrop/adaptive";
import { CORN_CORES, cornV1PlantPoints, readCornV1 } from "@/lib/rowCrop/cornV1";
import { corePeaks, coresView, gaussianBlur, greenCores, vividGreen } from "@/lib/rowCrop/greenCores";
import { GREEN_POINTS, plantPointsFromGreen } from "@/lib/rowCrop/greenPoints";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import { seedlingCache } from "@/lib/rowCrop/seedlingGreen";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const W = 1200, H = 900, R = 10;
/** Soil with plants on it: each a disc of green, vivid at its middle and dull at its rim. `pairs` are two plants whose
 * rims touch, joined by dull green: one piece of green holding two plants. */
function field(singles: [number, number][], pairs: [number, number][], gap = 2 * R + 2) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 118 + rnd() * 6; rgba[i * 4 + 1] = 94 + rnd() * 6; rgba[i * 4 + 2] = 70 + rnd() * 6; rgba[i * 4 + 3] = 255; }
  const put = (x: number, y: number, t: number) => { const q = (y * W + x) * 4; rgba[q] = 90 - 50 * t; rgba[q + 1] = 140 + 60 * t; rgba[q + 2] = 70 - 30 * t; };
  const disc = (cx: number, cy: number) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d = Math.hypot(dx, dy); if (d <= R) put(cx + dx, cy + dy, 1 - d / R); } };
  for (const [x, y] of pairs) { for (let dy = -3; dy <= 3; dy++) for (let dx = 0; dx <= gap; dx++) put(x + dx, y + dy, 0); disc(x, y); disc(x + gap, y); }
  for (const [x, y] of singles) disc(x, y);
  return { width: W, height: H, rgba };
}
const singles: [number, number][] = []; for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) singles.push([100 + c * 130, 100 + r * 160]);
const PAIR: [number, number] = [165, 180], ASKED = { finePx: 3, widePx: 12.8, share: 0.15 };
const near = (pts: { x: number; y: number }[], x: number, y: number, r = 6) => pts.filter(p => Math.hypot(p.x - x, p.y - y) <= r).length;

describe("the vivid cores of the green", () => {
  it("is zero off the green and peaks once at the middle of each plant", () => {
    const px = field(singles, [PAIR]), v = vividGreen(px);
    expect(v[0]).toBe(0);
    expect(v[100 * W + 100]).toBeGreaterThan(v[100 * W + 100 + R - 1]);
    const cores = greenCores(px, ASKED.finePx, ASKED.widePx, ASKED.share);
    expect(cores.length).toBe(singles.length + 2);
    for (const [x, y] of singles) expect(near(cores, x, y, 2)).toBe(1);
    expect(near(cores, PAIR[0], PAIR[1], 3)).toBe(1);
    expect(near(cores, PAIR[0] + 2 * R + 2, PAIR[1], 3)).toBe(1);
    expect(Math.max(...cores.map(c => c.s))).toBe(1);
  });

  it("keeps only the cores at or over the share of the strongest", () => {
    const px = field(singles, []), v = vividGreen(px), { strength, top } = coresView(v, W, H, ASKED.finePx, ASKED.widePx);
    expect(corePeaks(strength, W, H, top, 0.15).length).toBe(singles.length);
    expect(corePeaks(strength, W, H, top, 1.01).length).toBe(0);
    expect(corePeaks(new Float32Array(W * H), W, H, 0, 0.15).length).toBe(0);
  });

  it("blurs to nothing where nothing lies under the blur, and keeps the total", () => {
    const src = new Float32Array(W * H); src[450 * W + 600] = 1;
    const out = gaussianBlur(src, W, H, 4);
    expect(out[450 * W + 600 + 13]).toBe(0);
    expect(out[450 * W + 600]).toBeGreaterThan(out[450 * W + 601]);
    let sum = 0; for (let i = 0; i < W * H; i++) sum += out[i];
    expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
  });
});

describe("the vivid cores added to the plant read's marks (off by default)", { timeout: 60000 }, () => {
  it("is off by default", () => {
    expect(CORN_CORES.on).toBe(false);
  });

  it("as it stands: two touching plants in one piece of green are one mark", () => {
    const px = field(singles, [PAIR]), g = plantPointsFromGreen(px);
    expect(g.points.length).toBe(singles.length + 1);
    expect(g.coresAdded).toBeUndefined();
    expect(near(g.points, PAIR[0] + R + 1, PAIR[1], 4)).toBe(1);
  });

  it("with the cores: every mark is kept and the piece gets the core left over, lone plants get nothing", () => {
    const px = field(singles, [PAIR]), off = plantPointsFromGreen(px), on = plantPointsFromGreen(px, GREEN_POINTS, undefined, ASKED);
    expect(on.coresAdded).toBe(1);
    expect(on.points.length).toBe(off.points.length + 1);
    expect(on.points.slice(0, off.points.length)).toEqual(off.points);
    const added = on.points[on.points.length - 1];
    expect(Math.min(Math.hypot(added.x - PAIR[0], added.y - PAIR[1]), Math.hypot(added.x - PAIR[0] - 2 * R - 2, added.y - PAIR[1]))).toBeLessThanOrEqual(3);
    for (const [x, y] of singles) expect(near(on.points, x, y)).toBe(1);
  });

  it("with the cores: cover still gets no marks", () => {
    const rgba = new Uint8ClampedArray(W * H * 4);
    let s = 99; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < W * H; i++) { const lawn = (i % W) > W / 3, g = rnd() < 0.85; rgba[i * 4] = lawn && g ? 70 + rnd() * 30 : 110 + rnd() * 10; rgba[i * 4 + 1] = lawn && g ? 150 + rnd() * 50 : 85 + rnd() * 10; rgba[i * 4 + 2] = lawn && g ? 50 + rnd() * 20 : 65 + rnd() * 10; rgba[i * 4 + 3] = 255; }
    const px = { width: W, height: H, rgba }, off = plantPointsFromGreen(px), on = plantPointsFromGreen(px, GREEN_POINTS, undefined, ASKED);
    expect(greenCores(px, ASKED.finePx, ASKED.widePx, ASKED.share).filter(c => c.x > W / 3 + 20).length).toBeGreaterThan(100);
    expect(on.points.filter(p => p.x > W / 3 + 20).length).toBe(off.points.filter(p => p.x > W / 3 + 20).length);
  });

  it("takes its blurs from the row spacing the green read holds, and does nothing without one", () => {
    const px = field(singles, [PAIR]), cache = () => seedlingCache(px);
    const plan = (pitchPx: number) => ({ plans: [{ id: 0, stage: "emergence", ownedShare: 1, pitchPx, read: { pitchM: null, gsdM: NaN } }] }) as unknown as AdaptiveRead;
    const none = { plans: [] } as unknown as AdaptiveRead;
    const off = cornV1PlantPoints(px, plan(53), cache());
    expect(cornV1PlantPoints(px, plan(53), cache(), false)).toEqual(off);
    expect(cornV1PlantPoints(px, none, cache(), true)).toEqual(off);
    // 53 px between rows: blurs of 3.0 and 12.7 px.
    expect(CORN_CORES.fineShare * 53).toBeCloseTo(3.0, 1);
    expect(CORN_CORES.wideShare * 53).toBeCloseTo(12.7, 1);
    const on = cornV1PlantPoints(px, plan(53), cache(), true);
    expect(on.length).toBe(off.length + 1);
    expect(on.slice(0, off.length)).toEqual(off);
  });

  it("measured against the cores on the read's own marks, a grass spot in the frame does not shut the crop out", () => {
    // The same field with its plants dull, and one spot of far more vivid green (a tuft of verge grass).
    const px = field(singles, [PAIR]);
    for (let i = 0; i < W * H; i++) { const q = i * 4; if (px.rgba[q + 1] > 130) { px.rgba[q] = 100 - (px.rgba[q + 1] - 140) / 6; px.rgba[q + 1] = 135 + (px.rgba[q + 1] - 140) / 4; px.rgba[q + 2] = 80; } }
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (Math.hypot(dx, dy) <= R) { const q = ((800 + dy) * W + 1100 + dx) * 4; px.rgba[q] = 20; px.rgba[q + 1] = 235; px.rgba[q + 2] = 20; }
    const off = plantPointsFromGreen(px);
    expect(off.points.length).toBe(singles.length + 2);
    // By the strongest core: the tuft sets the bar over every plant's core, and the touching pair stays one mark.
    const strongest = plantPointsFromGreen(px, GREEN_POINTS, undefined, { ...ASKED, reference: "strongest" });
    expect(strongest.coresAdded).toBe(0);
    expect(strongest.coresInfo!.kept.length).toBe(1);
    // By the marks: the bar is a share of the plants' own cores, and the pair gets its second mark.
    const marks = plantPointsFromGreen(px, GREEN_POINTS, undefined, { ...ASKED, reference: "marks", factor: CORN_CORES.factor });
    expect(marks.coresInfo!.onMarks).toBe(singles.length + 2);
    expect(marks.coresInfo!.strongest).toBeGreaterThan(marks.coresInfo!.medianOnMarks! / 0.15);
    expect(marks.coresInfo!.threshold).toBeCloseTo(CORN_CORES.factor * marks.coresInfo!.medianOnMarks!, 9);
    expect(marks.coresAdded).toBe(1);
    expect(marks.points.slice(0, off.points.length)).toEqual(off.points);
  });

  it("with no reference given the first one stands, and a photograph with no core on a mark gets none by the marks", () => {
    const px = field(singles, [PAIR]);
    const asIs = plantPointsFromGreen(px, GREEN_POINTS, undefined, ASKED), first = plantPointsFromGreen(px, GREEN_POINTS, undefined, { ...ASKED, reference: "strongest" });
    expect(asIs.points).toEqual(first.points); expect(asIs.coresInfo!.reference).toBe("strongest");
    // Bare soil: no mark, so nothing to measure a core against.
    const bare = field([], []), none = plantPointsFromGreen(bare, GREEN_POINTS, undefined, { ...ASKED, reference: "marks", factor: CORN_CORES.factor });
    expect(none.points.length).toBe(0); expect(none.coresAdded).toBe(0); expect(none.coresInfo!.threshold).toBeNull();
    expect(CORN_CORES.reference).toBe("marks"); expect(CORN_CORES.factor).toBe(0.4);
  });

  it("is not asked by a read unless the read or CORN_CORES says so, and never by the corn-v1.0 comparison read", () => {
    const px = field(singles, [PAIR]), params = rowCropParamsFor(cropProfileFor("corn")!, 0.005);
    const asIs = readCornV1(px, params, { enteredCrop: "corn" }), off = readCornV1(px, params, { enteredCrop: "corn", cores: false });
    expect(asIs.plants.points).toEqual(off.plants.points);
    const base = readCornV1(px, params, { enteredCrop: "corn", baselineSeedlings: true }), baseOn = readCornV1(px, params, { enteredCrop: "corn", baselineSeedlings: true, cores: true });
    expect(baseOn.plants.points).toEqual(base.plants.points);
  });
});
