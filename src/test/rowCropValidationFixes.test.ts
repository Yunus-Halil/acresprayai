// The fixes from the corn validation of 2026-11-02 (docs/features/corn-row-reader.md), each on a rendered scene and
// each shown to matter by switching it off:
// - emergence: off-row green is tiered against the stand's own seedlings (larger: a weed candidate; smaller: counted apart);
// - emergence: rows are followed on past their last clear seedling where the seedlings turn faint (the frame's dim rim);
// - establishment: an empty stretch running out to the field's edge is the headland, not a gap;
// - late: rows read from how green a closed canopy is, a lawn beside it left out, nothing between the rows judged;
// - mid: a corn leaf's tip, cut off from its plant by a shadowed stretch of the same leaf, is not a seedling.
import { afterEach, describe, expect, it } from "vitest";
import { renderScene, type Scene } from "../../scripts/cropProfiles/scenes";
import { EDGE, readRowCrop, rowCropOverlay } from "@/lib/rowCrop/readRowCrop";
import { EMERGENCE } from "@/lib/rowCrop/emergence";
import { FINE, fineSeedlings } from "@/lib/rowCrop/fineSeedlings";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const saved = { e: { ...EMERGENCE }, d: { ...EDGE }, f: { ...FINE } };
afterEach(() => { Object.assign(EMERGENCE, saved.e); Object.assign(EDGE, saved.d); Object.assign(FINE, saved.f); });
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Bare soil at 1 cm, vertical rows 76 cm apart, a seedling every 16 cm; below `faintFrom` (share of the height) the
 * seedlings are faint (a tint the strict test misses and the relaxed one sees), as in a vignetted rim. */
function emergenceField(o: { faintFrom?: number; weeds?: [number, number, number][]; flecks?: [number, number][]; vergeFrom?: number }) {
  const W = 1200, H = 1000, r = rng(5), rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const n = (r() - 0.5) * 20; rgba[i * 4] = 128 + n; rgba[i * 4 + 1] = 108 + n; rgba[i * 4 + 2] = 88 + n; rgba[i * 4 + 3] = 255; }
  const blob = (x: number, y: number, rx: number, ry: number, c: [number, number, number]) => {
    for (let yy = Math.floor(y - ry); yy <= y + ry; yy++) for (let xx = Math.floor(x - rx); xx <= x + rx; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || ((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2 > 1) continue;
      const q = (yy * W + xx) * 4; rgba[q] = c[0]; rgba[q + 1] = c[1]; rgba[q + 2] = c[2];
    }
  };
  const faintY = (o.faintFrom ?? 2) * H;
  for (let x = 30; x < W; x += 76) for (let y = 8; y < H - 4; y += 16) {
    const jx = (r() - 0.5) * 2;
    blob(x + jx, y, 2.5, 1.5, y < faintY ? [70, 150, 55] : [125, 121, 90]);
  }
  // A grass verge across the bottom (solid green), when asked for.
  if (o.vergeFrom != null) for (let y = Math.round(o.vergeFrom * H); y < H; y++) for (let x = 0; x < W; x++) { const q = (y * W + x) * 4, n = (r() - 0.5) * 40; rgba[q] = 60 + n; rgba[q + 1] = 140 + n; rgba[q + 2] = 50 + n; }
  for (const [x, y, rad] of o.weeds ?? []) blob(x, y, rad, rad, [70, 150, 55]);
  for (const [x, y] of o.flecks ?? []) blob(x, y, 1.2, 1.2, [70, 150, 55]);
  return { width: W, height: H, rgba };
}

describe("emergence: off-row green against the stand's own seedlings", () => {
  const weeds: [number, number, number][] = [[68, 300, 7], [372, 620, 6], [828, 200, 7]];
  const flecks: [number, number][] = [[220, 410], [524, 150], [980, 700], [676, 820]];
  const px = emergenceField({ weeds, flecks });

  it("calls a patch larger than nearly all the seedlings a weed candidate, and counts smaller green apart", () => {
    const read = readRowCrop(px, { stage: "emergence", gsdM: 0.01 });
    expect(read.emergence!.seedlingAreaCm2).not.toBeNull();
    for (const [x, y] of weeds) expect(read.weeds.find(w => Math.hypot(w.x - x, w.y - y) < 6)?.tier, `weed at ${x},${y}`).toBe("larger than the crop");
    for (const [x, y] of flecks) expect(read.weeds.find(w => Math.hypot(w.x - x, w.y - y) < 6)?.tier, `fleck at ${x},${y}`).toBe("small green");
    expect(read.summary.weeds).toBe(weeds.length);
    expect(read.emergence!.smallGreen).toBe(flecks.length);
    const o = rowCropOverlay(read);
    expect(o.weeds.length).toBe(weeds.length);
    expect(o.smallGreen.length).toBe(flecks.length);
  });

  it("without the tiers every off-row patch is a weed candidate, as before", () => {
    EMERGENCE.tierBySeedlings = false;
    const read = readRowCrop(px, { stage: "emergence", gsdM: 0.01 });
    expect(read.summary.weeds).toBe(weeds.length + flecks.length);
    expect(read.weeds.every(w => w.tier === undefined)).toBe(true);
  });
});

describe("emergence: rows followed on where the seedlings turn faint", () => {
  const px = emergenceField({ faintFrom: 0.75 });
  const lastY = (read: ReturnType<typeof readRowCrop>) => read.rows.map(r => Math.max(...r.points.map(p => p[1])));

  it("follows each row on to the frame through the faint seedlings, as possible plants", () => {
    const read = readRowCrop(px, { stage: "emergence", gsdM: 0.01 });
    expect(read.rows.length).toBeGreaterThanOrEqual(14);
    for (const y of lastY(read)) expect(y).toBeGreaterThan(0.95 * px.height);
    expect(read.emergence!.rowEndsFollowed.possible).toBeGreaterThan(100);
    expect(read.summary.weeds).toBe(0);
  });

  it("without following the ends the rows stop where the seedlings turn faint", () => {
    EMERGENCE.extendEnds = false;
    const read = readRowCrop(px, { stage: "emergence", gsdM: 0.01 });
    for (const y of lastY(read)) expect(y).toBeLessThan(0.8 * px.height);
  });
});

// A guard only: on this rendered headland the field's edge already stops the rows at the bare soil, so no trailing gap
// forms with the rule off either. On the real photographs (34, 63 and 64 in directtestimagery/estabilishmentphase)
// flecks of stubble kept the field going to the verge and the stubble strip was drawn as gaps; those are the evidence.
describe("establishment: the headland before the verge is not a gap", () => {
  const profile = cropProfileFor("corn")!;
  const scene = { name: "headland", widthM: 12, heightM: 9, gsdM: 0.01, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.2, soil: "light", straw: null, weedsPerM2: 0, weedRadiusM: 0.04, gapsPerRow: 0, seed: 3 } as unknown as Scene;
  // The stand, then a metre of bare headland (the alley's soil copied over the rows), then a grass verge.
  const { px, truth } = renderScene(scene);
  const { width: W, height: H, rgba } = px, r = rng(9), half = Math.round(0.381 / scene.gsdM);
  const headY = Math.round(0.6 * H), vergeY = Math.round(0.72 * H);
  for (let y = headY; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (y >= vergeY) { const g = r(); rgba[o] = 60 + 25 * g; rgba[o + 1] = 105 + 40 * g; rgba[o + 2] = 40 + 20 * g; continue; }
    if (Math.abs(truth.acrossToRow(x * scene.gsdM, -y * scene.gsdM)) < 0.3) { const xs = Math.min(W - 1, x + half), q = (y * W + xs) * 4; rgba[o] = rgba[q]; rgba[o + 1] = rgba[q + 1]; rgba[o + 2] = rgba[q + 2]; }
  }
  const gapsInHeadland = (read: ReturnType<typeof readRowCrop>) => read.rows.flatMap(rw => rw.gaps).filter(g => Math.max(g.y1, g.y2) > headY + 20).length;

  it("draws no gap across the headland and stops each row at its last corn", () => {
    const read = readRowCrop(px, rowCropParamsFor(profile, scene.gsdM, "establishment"));
    expect(read.rows.length).toBeGreaterThanOrEqual(10);
    expect(gapsInHeadland(read)).toBe(0);
    for (const rw of read.rows) for (const [, y] of rw.points) expect(y).toBeLessThanOrEqual(headY + 0.5 / scene.gsdM);
  });

});

describe("late: rows read from a closed canopy", () => {
  // Leaves everywhere; along each row the canopy is greener and lighter, the alleys between them shaded. A lawn,
  // as green but with no rows, down the left quarter.
  const W = 1400, H = 1000, r = rng(17), rgba = new Uint8ClampedArray(W * H * 4), pitch = 50, lawnX = 350;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, n = r();
    if (x < lawnX) { rgba[o] = 120 + 30 * n; rgba[o + 1] = 160 + 30 * n; rgba[o + 2] = 70 + 20 * n; rgba[o + 3] = 255; continue; }
    const ph = Math.cos((2 * Math.PI * (x - lawnX)) / pitch), leaf = r() < 0.5 + 0.35 * ph;
    rgba[o] = leaf ? 50 + 20 * n : 30 + 10 * n; rgba[o + 1] = leaf ? 130 + 40 * n : 60 + 20 * n; rgba[o + 2] = leaf ? 40 + 15 * n : 30 + 10 * n; rgba[o + 3] = 255;
  }
  const px = { width: W, height: H, rgba };

  it("reads the rows across the canopy, none in the lawn, and judges nothing between them", () => {
    const read = readRowCrop(px, { stage: "late", gsdM: 0.762 / pitch });
    expect(read.stage).toBe("late");
    expect(read.rows.length).toBeGreaterThanOrEqual(18);
    for (const rw of read.rows) for (const [x] of rw.points) expect(x).toBeGreaterThan(lawnX - 20);
    // On the row lines: the green ridges at lawnX + k * pitch.
    for (const rw of read.rows) for (const [x] of rw.points) { const d = Math.abs(((x - lawnX) % pitch + pitch) % pitch); expect(Math.min(d, pitch - d)).toBeLessThan(0.2 * pitch); }
    expect(read.weeds).toEqual([]);
    expect(read.seedlings).toBeNull();
    expect(read.summary.plants).toBeNull();
    expect(read.notes.some(n => /Late stage/.test(n))).toBe(true);
  });
});

describe("mid: a leaf tip cut off by its own shadow is not a seedling", () => {
  // 0.5 cm pixels. A corn leaf 6 cm wide, its tip beyond a 2 cm shadowed stretch of the same leaf; a grass seedling alone on the soil.
  const W = 300, H = 200, rgba = new Uint8ClampedArray(W * H * 4);
  const paint = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; } };
  paint(0, 0, W, H, [110, 95, 80]);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = 255;
  paint(20, 90, 120, 102, [70, 170, 60]);   // the leaf
  paint(120, 93, 124, 99, [32, 40, 26]);    // its shadowed stretch (dark, barely green)
  paint(124, 94, 138, 98, [125, 195, 95]);  // its tip, sunlit (14 cm²)
  paint(230, 60, 236, 64, [125, 195, 95]);  // a grass seedling on the soil
  const px = { width: W, height: H, rgba };
  const near = (s: { x: number; y: number }[], x: number, y: number) => s.some(q => Math.hypot(q.x - x, q.y - y) < 8);

  it("keeps the seedling and drops the tip", () => {
    const { seedlings } = fineSeedlings(px, 0.005, () => true);
    expect(near(seedlings, 233, 62)).toBe(true);
    expect(near(seedlings, 131, 96)).toBe(false);
  });

  it("without the leaf-piece test the tip is a seedling", () => {
    FINE.leafPieces = false;
    const { seedlings } = fineSeedlings(px, 0.005, () => true);
    expect(near(seedlings, 131, 96)).toBe(true);
  });
});

describe("emergence: a higher bar for weeds at the field's edge (Yunus, 2026-11-02)", () => {
  // The same mid-sized patch (larger than the seedlings, under three times their large ones) in the field and 40 cm from the verge.
  const inField: [number, number, number][] = [[68, 300, 3.5], [372, 450, 3.5]];
  const atEdge: [number, number, number][] = [[220, 760, 3.5], [676, 770, 3.5]];
  const px = emergenceField({ weeds: [...inField, ...atEdge], vergeFrom: 0.8 });
  const tierAt = (read: ReturnType<typeof readRowCrop>, x: number, y: number) => read.weeds.find(w => Math.hypot(w.x - x, w.y - y) < 6)?.tier;

  it("calls the patch a weed in the field and counts it apart at the edge", () => {
    const read = readRowCrop(px, { stage: "emergence", gsdM: 0.01 });
    for (const [x, y] of inField) expect(tierAt(read, x, y), `in field at ${x},${y}`).toBe("larger than the crop");
    for (const [x, y] of atEdge) expect(tierAt(read, x, y), `at edge ${x},${y}`).toBe("small green");
    expect(read.notes.some(n => /field's edge/.test(n))).toBe(true);
  });

  it("without the edge rule the patches at the edge are weeds too", () => {
    EMERGENCE.edgeFactor = 1;
    const read = readRowCrop(px, { stage: "emergence", gsdM: 0.01 });
    for (const [x, y] of atEdge) expect(tierAt(read, x, y), `at edge ${x},${y}`).toBe("larger than the crop");
  });
});
