// Photo Scout: the planting pattern of one photo, on a rendered stand.
//
// The scene is drawn in the photo's own frame (x right, y up, metres from
// the top-left corner, exactly as pattern.ts reads it): soil, plant discs on
// rows at a known angle, pitch and seed spacing, then the faults the pass
// must find: a stretch of missing plants (skips), a plant beside another
// (double), a plant midway between two planted ones (between plants) and
// greens between the rows (off-row).
import piexif from "piexifjs";
import { describe, expect, it } from "vitest";
import { estimateGsd, parsePhotoHeader } from "@/lib/photoScout/exif";
import { analysePhoto, fitWindowBrightness, lumaRaster, measureComponents, mergeComponents, placeOnRows, planWindows, rowSegmentsPx, splitAlongRow, type PhotoPixels } from "@/lib/photoScout/pattern";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

type Stand = {
  widthPx: number; heightPx: number; gsdM: number;
  angleDeg: number; pitchM: number; seedM: number; plantRadiusM: number;
  /** Along-row stretches with no plants, by row index. */
  skips?: { row: number; from: number; to: number }[];
  /** Extra plants at (row, along). */
  extra?: { row: number; along: number }[];
  /** Greens between rows at (row + 0.5, along). */
  weeds?: { row: number; along: number; r: number }[];
  seed?: number;
};

function renderStand(s: Stand): { px: PhotoPixels; plants: number } {
  const { widthPx: W, heightPx: H, gsdM: g } = s;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const rand = rng(s.seed ?? 3);
  const th = (s.angleDeg * Math.PI) / 180;
  const cx = (W / 2) * g, cy = -(H / 2) * g;
  const tx = Math.cos(th), ty = Math.sin(th), nx = -Math.sin(th), ny = Math.cos(th);
  const toGround = (row: number, along: number) => ({ x: cx + along * tx + row * s.pitchM * nx, y: cy + along * ty + row * s.pitchM * ny });
  const discs: { x: number; y: number; r: number }[] = [];
  const span = Math.hypot(W, H) * g;
  const kMax = Math.ceil(span / s.pitchM);
  let plants = 0;
  for (let k = -kMax; k <= kMax; k++) {
    for (let a = -span; a <= span; a += s.seedM) {
      if ((s.skips ?? []).some(sk => sk.row === k && a > sk.from && a < sk.to)) continue;
      const p = toGround(k, a);
      if (p.x < 0 || p.x > W * g || p.y > 0 || p.y < -H * g) continue;
      discs.push({ ...p, r: s.plantRadiusM });
      plants++;
    }
  }
  for (const e of s.extra ?? []) discs.push({ ...toGround(e.row, e.along), r: s.plantRadiusM });
  for (const w of s.weeds ?? []) discs.push({ ...toGround(w.row + 0.5, w.along), r: w.r });
  // Rasterise: a cell grid keyed by pixel keeps this O(pixels + discs).
  const green = new Uint8Array(W * H);
  for (const d of discs) {
    const px = d.x / g, py = -d.y / g, rp = d.r / g;
    for (let j = Math.max(0, Math.floor(py - rp)); j <= Math.min(H - 1, Math.ceil(py + rp)); j++) {
      for (let i = Math.max(0, Math.floor(px - rp)); i <= Math.min(W - 1, Math.ceil(px + rp)); i++) {
        if ((i + 0.5 - px) ** 2 + (j + 0.5 - py) ** 2 <= rp * rp) green[j * W + i] = 1;
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (green[i]) { rgba[o] = 58; rgba[o + 1] = 128; rgba[o + 2] = 40; }
    else { rgba[o] = 118 + (rand() - 0.5) * 16; rgba[o + 1] = 92 + (rand() - 0.5) * 16; rgba[o + 2] = 66 + (rand() - 0.5) * 16; }
    rgba[o + 3] = 255;
  }
  return { px: { width: W, height: H, rgba }, plants };
}

const norm180 = (a: number) => ((a % 180) + 180) % 180;
const angleDiff = (a: number, b: number) => { const d = Math.abs(norm180(a) - norm180(b)); return Math.min(d, 180 - d); };

describe("Photo Scout on a rendered stand at 1 cm/px", () => {
  const stand: Stand = {
    widthPx: 1200, heightPx: 900, gsdM: 0.01,
    angleDeg: 20, pitchM: 0.762, seedM: 0.2, plantRadiusM: 0.04,
    skips: [{ row: 1, from: 1.0, to: 2.2 }],
    extra: [{ row: 2, along: 0.1 }, { row: -2, along: 0.5 }],
    weeds: [
      { row: 0, along: -1, r: 0.05 }, { row: 1, along: 2.5, r: 0.06 }, { row: -1, along: 0.3, r: 0.04 },
      { row: 3, along: -2, r: 0.05 }, { row: -3, along: 1.4, r: 0.07 }, { row: 2, along: -0.7, r: 0.05 },
    ],
  };

  it("finds the row direction, the row spacing and the seed spacing", async () => {
    const { px } = renderStand(stand);
    const r = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    expect(r.summary.usableWindows).toBeGreaterThan(0);
    expect(angleDiff(r.summary.medianAngleDeg!, 20)).toBeLessThan(1.5);
    expect(Math.abs(r.summary.medianPitchM! - 0.762) / 0.762).toBeLessThan(0.05);
    expect(r.summary.seedSpacingM).not.toBeNull();
    expect(Math.abs(r.summary.seedSpacingM! - 0.2) / 0.2).toBeLessThan(0.1);
    expect(r.summary.seedAgreement!).toBeGreaterThan(0.8);
  });

  it("puts the planted plants on pattern and the faults in their own classes", async () => {
    const { px, plants } = renderStand(stand);
    const r = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    const s = r.summary;
    // Every planted plant that is not cut by the edge is a blob; nearly all are on pattern.
    expect(s.onPattern).toBeGreaterThan(plants * 0.85);
    expect(s.offRow).toBeGreaterThanOrEqual(5);
    expect(s.offRow).toBeLessThanOrEqual(7);
    expect(s.doubles).toBeGreaterThanOrEqual(1);
    expect(s.betweenPlants).toBeGreaterThanOrEqual(1);
    // 1.2 m with no plants at 0.2 m spacing is a gap of six spacings: five missing.
    expect(s.skips).toBeGreaterThanOrEqual(4);
    expect(s.skips).toBeLessThanOrEqual(7);
    // The classes the UI colours are the only ones that exist, and none is a verdict.
    for (const b of r.blobs) expect(["on pattern", "double", "between plants", "off-row", "unplaced"]).toContain(b.cls);
    expect(JSON.stringify(r.notes).toLowerCase()).not.toContain("weed");
  });

  it("finds a 38 cm spacing on its own when told nothing, and says so when told 76 cm", async () => {
    const narrow = { ...stand, pitchM: 0.381, skips: [], extra: [], weeds: [{ row: 0, along: -1, r: 0.05 }, { row: 2, along: 0.3, r: 0.05 }] };
    const { px, plants } = renderStand(narrow);
    const auto = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: "auto" }, { yieldBetweenWindows: false });
    expect(auto.rowSpacingM).toBeNull();
    expect(auto.summary.usableWindows).toBeGreaterThan(0);
    expect(Math.abs(auto.summary.medianPitchM! - 0.381) / 0.381).toBeLessThan(0.08);
    expect(auto.summary.onPattern).toBeGreaterThan(plants * 0.85);
    expect(auto.summary.offRow).toBeLessThanOrEqual(3);
    // Told twice the true spacing, the fit either keeps the given number (every
    // second row goes off-row and the note says why) or trusts no window at all.
    // Either way far fewer plants land on pattern than the automatic search gives.
    const wrong = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    expect(wrong.summary.onPattern).toBeLessThan(auto.summary.onPattern * 0.6);
    if (wrong.summary.usableWindows > 0) {
      expect(wrong.summary.pitchKeptFromGiven).toBeGreaterThan(0);
      expect(wrong.notes.join(" ")).toMatch(/kept your number/);
    } else {
      expect(wrong.notes.join(" ")).toMatch(/No window of this photo showed a row pattern/);
    }
  });

  it("finds rows from brightness in a closed canopy, where the vegetation mask is blind", async () => {
    // Every pixel is green; rows are lighter lines, gaps are shadowed, at 25 cm and 70 degrees.
    const W = 1200, H = 900, g = 0.01, pitch = 0.25, th = (70 * Math.PI) / 180;
    const rand = rng(5);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * g, y = -j * g;
      const across = -x * Math.sin(th) + y * Math.cos(th);
      const row = 0.5 + 0.5 * Math.cos((2 * Math.PI * across) / pitch);
      const k = 0.55 + 0.45 * row + (rand() - 0.5) * 0.15;
      const o = (j * W + i) * 4;
      rgba[o] = 58 * k; rgba[o + 1] = 128 * k; rgba[o + 2] = 40 * k; rgba[o + 3] = 255;
    }
    const r = await analysePhoto({ width: W, height: H, rgba }, { gsdM: g, rowSpacingM: "auto" }, { yieldBetweenWindows: false });
    // Otsu still splits an all-green canopy into its lit and shaded halves, so the
    // vegetation share does not read as closed; whichever signal wins, the rows are right.
    expect(r.summary.usableWindows).toBeGreaterThan(0);
    expect(angleDiff(r.summary.medianAngleDeg!, 70)).toBeLessThan(1.5);
    expect(Math.abs(r.summary.medianPitchM! - pitch) / pitch).toBeLessThan(0.08);
    // And the brightness signal finds them on its own.
    const b = fitWindowBrightness({ luma: lumaRaster({ width: W, height: H, rgba }), width: W, x0: 0, y0: 0, x1: W - 1, y1: H - 1, gsdM: g, growerSpacingM: 0.3, vegetationFraction: 0.5 });
    expect(b.confidence).toBeGreaterThanOrEqual(0.35);
    expect(angleDiff(b.angleDeg, 70)).toBeLessThan(1.5);
    expect(Math.abs(b.recoveredPitchM - pitch) / pitch).toBeLessThan(0.08);
  }, 60_000);

  it("reads a young orchard: trees 4.5 m between rows and 2 m along, over furrows at 50 cm", async () => {
    // 2 cm/px, 40 m x 30 m. Tree canopies 1 m across on bare soil; the soil carries
    // brightness furrows at 50 cm parallel to the rows, which must not win.
    const W = 2000, H = 1500, g = 0.02, pitch = 4.5, seed = 2.0, th = (-12 * Math.PI) / 180;
    const rand = rng(9);
    const rgba = new Uint8ClampedArray(W * H * 4);
    const cx = (W / 2) * g, cy = -(H / 2) * g;
    const tx = Math.cos(th), ty = Math.sin(th), nx = -Math.sin(th), ny = Math.cos(th);
    const trees: { x: number; y: number }[] = [];
    let planted = 0;
    for (let k = -6; k <= 6; k++) for (let a = -30; a <= 30; a += seed) {
      if (k === 1 && a > 4 && a < 10) continue; // three missing trees
      const t = { x: cx + a * tx + k * pitch * nx, y: cy + a * ty + k * pitch * ny };
      trees.push(t);
      if (t.x > 0.6 && t.x < W * g - 0.6 && t.y < -0.6 && t.y > -H * g + 0.6) planted++;
    }
    const weeds = [{ x: cx + 3 * tx + 2.25 * nx, y: cy + 3 * ty + 2.25 * ny }, { x: cx - 7 * tx - 1.5 * 4.5 * nx, y: cy - 7 * ty - 1.5 * 4.5 * ny }];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * g, y = -j * g;
      const across = (x - cx) * nx + (y - cy) * ny;
      const furrow = 0.85 + 0.15 * Math.cos((2 * Math.PI * across) / 0.5);
      let R = 150 * furrow, G = 120 * furrow, B = 85 * furrow;
      const near = (p: { x: number; y: number }, r: number) => (x - p.x) ** 2 + (y - p.y) ** 2 <= r * r;
      if (trees.some(t => near(t, 0.5)) || weeds.some(w => near(w, 0.3))) { R = 60; G = 125; B = 45; }
      R += (rand() - 0.5) * 12; G += (rand() - 0.5) * 12; B += (rand() - 0.5) * 12;
      const o = (j * W + i) * 4; rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
    }
    const r = await analysePhoto({ width: W, height: H, rgba }, { gsdM: g, rowSpacingM: "auto" }, { yieldBetweenWindows: false });
    expect(r.summary.usableWindows).toBeGreaterThan(r.summary.windows / 2);
    expect(r.summary.brightnessWindows).toBe(0);
    expect(angleDiff(r.summary.medianAngleDeg!, -12)).toBeLessThan(1.5);
    expect(Math.abs(r.summary.medianPitchM! - pitch) / pitch).toBeLessThan(0.08);
    expect(r.summary.seedSpacingM).not.toBeNull();
    expect(Math.abs(r.summary.seedSpacingM! - seed) / seed).toBeLessThan(0.1);
    expect(r.summary.onPattern).toBeGreaterThan(planted * 0.7);
    // The two weeds, plus a few specks the soil noise still makes at six pixels.
    expect(r.blobs.filter(b => b.cls === "off-row" && b.equivDiameterM > 0.4).length).toBe(2);
    expect(r.summary.offRow).toBeLessThanOrEqual(8);
    expect(r.summary.skips).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("fits each side of a photo on its own surroundings: two orchard blocks, two row directions", async () => {
    // 2 cm/px, 40 m x 30 m. The left block's rows run at -12 degrees, the
    // right block's at 40, both 4.5 m apart. Twelve rows at 4.5 m is more
    // than the photo, so a fit over the whole photo would give every window
    // one direction; each side must get its own, and each window's phase is
    // referenced to the window itself.
    const W = 2000, H = 1500, g = 0.02, pitch = 4.5, seed = 2.0;
    const rand = rng(11);
    const rgba = new Uint8ClampedArray(W * H * 4);
    const blocks = [
      { th: (-12 * Math.PI) / 180, cx: 10, cy: -15, from: 0, to: 20 },
      { th: (40 * Math.PI) / 180, cx: 30, cy: -15, from: 20, to: 40 },
    ];
    const trees: { x: number; y: number }[] = [];
    for (const b of blocks) {
      const tx = Math.cos(b.th), ty = Math.sin(b.th), nx = -Math.sin(b.th), ny = Math.cos(b.th);
      for (let k = -8; k <= 8; k++) for (let a = -30; a <= 30; a += seed) {
        const t = { x: b.cx + a * tx + k * pitch * nx, y: b.cy + a * ty + k * pitch * ny };
        if (t.x >= b.from && t.x < b.to) trees.push(t);
      }
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * g, y = -j * g;
      let R = 150, G = 120, B = 85;
      if (trees.some(t => (x - t.x) ** 2 + (y - t.y) ** 2 <= 0.25)) { R = 60; G = 125; B = 45; }
      R += (rand() - 0.5) * 12; G += (rand() - 0.5) * 12; B += (rand() - 0.5) * 12;
      const o = (j * W + i) * 4; rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
    }
    const r = await analysePhoto({ width: W, height: H, rgba }, { gsdM: g, rowSpacingM: "auto" }, { yieldBetweenWindows: false });
    const usable = r.windows.filter(w => w.usable);
    expect(usable.length).toBeGreaterThan(r.windows.length / 2);
    const left = usable.filter(w => w.x1 * g <= 8), right = usable.filter(w => w.x0 * g >= 32);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    for (const w of left) expect(angleDiff(w.fit.angleDeg, -12)).toBeLessThan(2);
    for (const w of right) expect(angleDiff(w.fit.angleDeg, 40)).toBeLessThan(2);
    for (const w of usable) expect(Math.abs(w.fit.pitchM - pitch) / pitch).toBeLessThan(0.1);
    // Each side is one block with one model, so its lines run unbroken; the
    // two sides are two blocks, and the photo says so.
    expect(new Set(left.map(w => w.block)).size).toBe(1);
    expect(new Set(right.map(w => w.block)).size).toBe(1);
    expect(left[0].block).not.toBe(right[0].block);
    for (const w of left) expect(w.fit).toEqual(left[0].fit);
    for (const w of right) expect(w.fit).toEqual(right[0].fit);
    expect(r.notes.some(n => n.startsWith("Rows run 2 ways"))).toBe(true);
    // And the trees of each side sit on that side's rows.
    const sideOf = (b: { x: number }) => (b.x * g < 20 ? 0 : 1);
    const onPattern = r.blobs.filter(b => b.cls === "on pattern" && !b.touchesBorder);
    expect(onPattern.filter(b => sideOf(b) === 0).length).toBeGreaterThan(40);
    expect(onPattern.filter(b => sideOf(b) === 1).length).toBeGreaterThan(40);
  }, 60_000);

  it("draws row segments through every usable window", async () => {
    const { px } = renderStand(stand);
    const r = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    for (const w of r.windows.filter(w => w.usable)) {
      const segs = rowSegmentsPx(w, r.gsdM);
      expect(segs.length).toBeGreaterThan(2);
      // Each segment runs along the fitted direction in pixel space (y flipped).
      const seg = segs[0];
      const a = (Math.atan2(-(seg.y2 - seg.y1), seg.x2 - seg.x1) * 180) / Math.PI;
      expect(angleDiff(a, w.fit.angleDeg)).toBeLessThan(0.01);
    }
  });

  it("says so when there is no row pattern", async () => {
    const rand = rng(11);
    const W = 600, H = 400;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const o = i * 4; rgba[o] = 118; rgba[o + 1] = 92; rgba[o + 2] = 66; rgba[o + 3] = 255; }
    for (let n = 0; n < 150; n++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || dx * dx + dy * dy > 9) continue;
        const o = (yy * W + xx) * 4; rgba[o] = 58; rgba[o + 1] = 128; rgba[o + 2] = 40;
      }
    }
    const r = await analysePhoto({ width: W, height: H, rgba }, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    expect(r.summary.usableWindows).toBe(0);
    expect(r.blobs.every(b => b.cls === "unplaced")).toBe(true);
    expect(r.notes.join(" ")).toMatch(/No window of this photo showed a row pattern/);
  });

  it("refuses without a pixel size or a row spacing", async () => {
    const px: PhotoPixels = { width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) };
    await expect(analysePhoto(px, { gsdM: 0, rowSpacingM: 0.762 })).rejects.toThrow(/pixel size/);
    await expect(analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0 })).rejects.toThrow(/row spacing/);
  });
});

describe("placing a point on a window's rows", () => {
  const fit = { centre: { x: 5, y: -5 }, sizeM: 10, angleDeg: 0, pitchM: 0.8, phaseM: 0.1, confidence: 1, angleConfidence: 1, pitchConfidence: 1, vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 0.8 };
  it("gives the row index, the signed offset across and the position along", () => {
    // Rows run along x at y = -5 + 0.1 + k * 0.8.
    const p = placeOnRows(fit, 7, -5 + 0.1 + 2 * 0.8 + 0.05);
    expect(p.rowIndex).toBe(2);
    expect(p.acrossM).toBeCloseTo(0.05, 6);
    expect(p.alongM).toBeCloseTo(2, 6);
  });
  it("splits a row of touching plants into one blob per plant, and leaves a lone plant whole", () => {
    // 1 cm/px. Three discs 20 cm across at 50 cm along a row at 20 degrees,
    // joined by a strip of weeds 4 cm wide under the row; and one disc alone.
    const W = 400, H = 200, g = 0.01;
    const mask = new Uint8Array(W * H);
    const th = (20 * Math.PI) / 180, tx = Math.cos(th), ty = Math.sin(th);
    const c = { x: 1.2, y: -0.8 };
    const centres = [-0.5, 0, 0.5].map(a => ({ x: c.x + a * tx, y: c.y + a * ty }));
    const lone = { x: 3.2, y: -1.5 };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * g, y = -j * g;
      const along = (x - c.x) * tx + (y - c.y) * ty, across = (x - c.x) * -Math.sin(th) + (y - c.y) * Math.cos(th);
      const inDisc = centres.some(p => (x - p.x) ** 2 + (y - p.y) ** 2 <= 0.1 ** 2) || (x - lone.x) ** 2 + (y - lone.y) ** 2 <= 0.1 ** 2;
      const inStrip = Math.abs(across) <= 0.02 && Math.abs(along) <= 0.6;
      if (inDisc || inStrip) mask[j * W + i] = 1;
    }
    const m = measureComponents(mask, W, H, 6);
    expect(m.blobs.length).toBe(2);
    const row = m.blobs.find(b => b.n > 500)!, alone = m.blobs.find(b => b.n <= 500)!;
    const fit = { centre: c, sizeM: 4, angleDeg: 20, pitchM: 10, phaseM: 0, confidence: 1, angleConfidence: 1, pitchConfidence: 1, vegetationFraction: 0.1, pitchFromGrower: false, recoveredPitchM: 10 };
    const parts = splitAlongRow(row, m.labels, W, fit, null, g, 6);
    expect(parts.length).toBe(3);
    for (const p of parts) expect(p.n).toBeGreaterThan(250);
    expect(splitAlongRow(alone, m.labels, W, fit, null, g, 6).length).toBe(1);
    // Two plants on neighbouring rows joined by weeds across the gap: one per row.
    const mask2 = new Uint8Array(W * H);
    const rows = [{ x: 1.0, y: -0.5 }, { x: 1.0, y: -1.3 }];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * g, y = -j * g;
      const inDisc = rows.some(p => (x - p.x) ** 2 + (y - p.y) ** 2 <= 0.1 ** 2);
      const inBridge = Math.abs(x - 1.0) <= 0.015 && y <= -0.5 && y >= -1.3;
      if (inDisc || inBridge) mask2[j * W + i] = 1;
    }
    const m2 = measureComponents(mask2, W, H, 6);
    expect(m2.blobs.length).toBe(1);
    const fit2 = { ...fit, centre: { x: 1.0, y: -0.5 }, angleDeg: 0, pitchM: 0.8, phaseM: 0, recoveredPitchM: 0.8 };
    const parts2 = splitAlongRow(m2.blobs[0], m2.labels, W, fit2, null, g, 6);
    expect(parts2.length).toBe(2);
  });

  it("merges the pieces of one plant and leaves neighbours apart", () => {
    const box = (x: number, y: number, s: number) => ({ n: s * s, sx: (x + s / 2) * s * s, sy: (y + s / 2) * s * s, minX: x, maxX: x + s - 1, minY: y, maxY: y + s - 1 });
    // Two pieces 3 px apart, a third piece touching the second, and a neighbour 20 px away.
    const merged = mergeComponents([box(0, 0, 10), box(13, 0, 10), box(23, 2, 4), box(47, 0, 10)], 4);
    expect(merged.length).toBe(2);
    const big = merged.find(m => m.n === 100 + 100 + 16)!;
    expect(big.minX).toBe(0); expect(big.maxX).toBe(26);
    expect(mergeComponents([box(0, 0, 10), box(13, 0, 10)], 0).length).toBe(2);
  });

  it("tiles the photo so every pixel is in exactly one window", () => {
    const ws = planWindows(1000, 700, 0.01, 3);
    expect(ws.length).toBe(Math.round(1000 / 300) * Math.round(700 / 300));
    const covered = new Uint8Array(1000 * 700);
    for (const w of ws) for (let y = w.y0; y <= w.y1; y++) for (let x = w.x0; x <= w.x1; x++) covered[y * 1000 + x]++;
    expect(covered.every(c => c === 1)).toBe(true);
  });
});

/** A JPEG that is only its header: SOI, an EXIF APP1, a DJI XMP APP1, EOI. */
function headerJpeg(exif: Record<string, Record<number, unknown>>, xmp: string | null): Uint8Array {
  const seg = (payload: string) => {
    const len = payload.length + 2;
    return "\xff\xe1" + String.fromCharCode((len >> 8) & 0xff, len & 0xff) + payload;
  };
  let bin = "\xff\xd8" + seg(piexif.dump(exif));
  if (xmp) bin += seg("http://ns.adobe.com/xap/1.0/\0" + xmp);
  bin += "\xff\xd9";
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

describe("the pixel size from what the photo says about itself", () => {
  const p4 = {
    "0th": { [piexif.ImageIFD.Make]: "DJI", [piexif.ImageIFD.Model]: "FC6310" },
    Exif: {
      [piexif.ExifIFD.FocalLength]: [880, 100], [piexif.ExifIFD.FocalLengthIn35mmFilm]: 24,
      [piexif.ExifIFD.PixelXDimension]: 5472, [piexif.ExifIFD.PixelYDimension]: 3648,
      [piexif.ExifIFD.DateTimeOriginal]: "2026:10:06 09:30:00",
    },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: "N", [piexif.GPSIFD.GPSLatitude]: [[37, 1], [30, 1], [0, 1]],
      [piexif.GPSIFD.GPSLongitudeRef]: "W", [piexif.GPSIFD.GPSLongitude]: [[78, 1], [0, 1], [0, 1]],
      [piexif.GPSIFD.GPSAltitudeRef]: 0, [piexif.GPSIFD.GPSAltitude]: [1234, 10],
    },
  };
  const xmp = '<x:xmpmeta><rdf:Description drone-dji:RelativeAltitude="+30.20" drone-dji:GimbalPitchDegree="-90.00"/></x:xmpmeta>';

  it("reads EXIF and the DJI height, and estimates about 0.8 cm/px for a Phantom 4 at 30 m", () => {
    const e = parsePhotoHeader(headerJpeg(p4, xmp));
    expect(e.make).toBe("DJI");
    expect(e.focalMm).toBeCloseTo(8.8, 6);
    expect(e.width).toBe(5472);
    expect(e.relativeAltitudeM).toBeCloseTo(30.2, 6);
    expect(e.gimbalPitchDeg).toBeCloseTo(-90, 6);
    expect(e.lat).toBeCloseTo(37.5, 6);
    expect(e.lng).toBeCloseTo(-78, 6);
    expect(e.gpsAltitudeM).toBeCloseTo(123.4, 6);
    const g = estimateGsd(e);
    // 30.2 m x 13.2 mm sensor / (8.8 mm x 5472 px)
    expect(g.gsdM).toBeCloseTo((30.2 * 13.2) / (8.8 * 5472), 4);
    expect(g.basis).toMatch(/height above take-off/);
  });

  it("has no pixel size without a height, and takes a typed one", () => {
    const e = parsePhotoHeader(headerJpeg(p4, null));
    expect(e.relativeAltitudeM).toBeNull();
    expect(estimateGsd(e).gsdM).toBeNull();
    const g = estimateGsd(e, { heightM: 60 });
    expect(g.gsdM).toBeCloseTo((60 * 13.2) / (8.8 * 5472), 4);
    expect(g.basis).toMatch(/height you typed/);
    // A copy drawn at half width has pixels twice the size.
    expect(estimateGsd(e, { heightM: 60, imageWidth: 2736 }).gsdM).toBeCloseTo(g.gsdM! * 2, 6);
  });

  it("survives bytes that are not a JPEG", () => {
    const e = parsePhotoHeader(new Uint8Array([1, 2, 3, 4]));
    expect(e.focalMm).toBeNull();
    expect(estimateGsd(e).gsdM).toBeNull();
  });
});
