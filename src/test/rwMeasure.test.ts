// @vitest-environment node
//
// The ruler-referenced measurement experiment's arithmetic and its parts on
// painted pictures: a tape with sixteen ticks to the inch, read at a tilt;
// a leaf among blades; spans, widths, areas; refusals.
import { describe, expect, it } from "vitest";
import { CM_PER_INCH, type Calibration, type SegmentationQuality } from "@/lib/rwMeasure/types";
import { convexHull, equivalentDiameterCm, inchesToCm, maxSpan, perpendicularSpan, pixelsPerCmFromInchPx, pxToCm, roundCm, scaleFromRulerPoints } from "@/lib/rwMeasure/geometry";
import { calibrateFromTicks, dominantPeriod, findTape, peaks, straighten, type Rgba } from "@/lib/rwMeasure/tape";
import { boundary, open, prepare, segmentCanopy } from "@/lib/rwMeasure/canopy";
import { compare, measureCanopy } from "@/lib/rwMeasure/measure";

describe("units and scale", () => {
  it("converts inches to centimetres and pixels to centimetres", () => {
    expect(CM_PER_INCH).toBe(2.54);
    expect(inchesToCm(12)).toBeCloseTo(30.48, 9);
    expect(pixelsPerCmFromInchPx(254)).toBeCloseTo(100, 9);
    expect(pxToCm(1000, 50)).toBe(20);
    expect(roundCm(3.456)).toBe(3.5);
    expect(roundCm(34.56)).toBe(35);
  });
  it("takes a person's ruler points, needing two at least two inches apart", () => {
    expect(scaleFromRulerPoints([{ x: 0, y: 0, inches: 1 }, { x: 100, y: 0, inches: 2 }])).toBeNull();
    const s = scaleFromRulerPoints([{ x: 0, y: 0, inches: 2 }, { x: 508, y: 0, inches: 4 }, { x: 1270, y: 0, inches: 7 }])!;
    expect(s.pixelsPerCm).toBeCloseTo(100, 6);
    expect(s.relativeUncertainty).toBeCloseTo(0.005, 6);
    // Tilted points give the same scale.
    const t = scaleFromRulerPoints([{ x: 0, y: 0, inches: 0 }, { x: 508 * Math.cos(0.3), y: 508 * Math.sin(0.3), inches: 2 }])!;
    expect(t.pixelsPerCm).toBeCloseTo(100, 6);
  });
});

describe("spans and areas", () => {
  it("max span is the diameter of a disc, the perpendicular its diameter too; a 40 by 10 bar reads 40 and 10", () => {
    const disc: { x: number; y: number }[] = [];
    for (let a = 0; a < 360; a += 5) disc.push({ x: 100 + 50 * Math.cos((a * Math.PI) / 180), y: 100 + 50 * Math.sin((a * Math.PI) / 180) });
    const s = maxSpan(convexHull(disc))!;
    expect(s.lengthPx).toBeCloseTo(100, 0);
    expect(perpendicularSpan(disc, s)!.lengthPx).toBeCloseTo(100, 0);
    const bar = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }, { x: 20, y: 0 }, { x: 20, y: 10 }];
    const bs = maxSpan(convexHull(bar))!;
    expect(bs.lengthPx).toBeCloseTo(Math.hypot(40, 10), 6);
    // The perpendicular to the diagonal of a 40 by 10 bar is its projection across that diagonal.
    const p = perpendicularSpan(bar, bs)!;
    expect(p.lengthPx).toBeCloseTo((40 * 10 * 2) / Math.hypot(40, 10), 6);
    expect(maxSpan([{ x: 0, y: 0 }])).toBeNull();
  });
  it("equivalent diameter is not the span", () => {
    expect(equivalentDiameterCm(Math.PI * 25)).toBeCloseTo(10, 9);
    expect(equivalentDiameterCm(0)).toBe(0);
  });
});

/** A painted picture: grass-green background with thin dark blades, a yellow tape with ticks, and a smooth leaf rosette. */
function paint(opts: { w: number; h: number; inchPx: number; tapeAngleDeg: number; leafR: number; grass: boolean; metric?: boolean; noTape?: boolean }): Rgba {
  const { w, h, inchPx } = opts;
  const data = new Uint8Array(w * h * 4);
  let seed = 11; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const n = (rand() - 0.5) * (opts.grass ? 90 : 16); data[o] = (opts.grass ? 70 : 140) + n; data[o + 1] = (opts.grass ? 120 : 110) + n; data[o + 2] = (opts.grass ? 45 : 80) + n; data[o + 3] = 255; }
  if (opts.grass) {
    // Blades: dark-green lines about a blade wide (10 px at 47 px/cm), 40 to 90 px long, dense.
    for (let k = 0; k < (w * h) / 1500; k++) { const x0 = rand() * w, y0 = rand() * h, a = rand() * Math.PI, L = 40 + rand() * 50; for (let t = 0; t < L; t++) { const x = Math.round(x0 + t * Math.cos(a)), y = Math.round(y0 + t * Math.sin(a)); for (let d = 0; d < 10; d++) { const xx = x + d; if (xx < 0 || y < 0 || xx >= w || y >= h) continue; const o = (y * w + xx) * 4; data[o] = 50; data[o + 1] = 110; data[o + 2] = 40; } } }
  }
  // The leaf rosette: six smooth elliptical leaves about a centre, at the picture's centre.
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on = false;
    for (let k = 0; k < 6 && !on; k++) { const a = (k * Math.PI) / 3, lx = cx + Math.cos(a) * opts.leafR * 0.55, ly = cy + Math.sin(a) * opts.leafR * 0.55; const dx = x - lx, dy = y - ly; const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a); if ((u / (opts.leafR * 0.5)) ** 2 + (v / (opts.leafR * 0.18)) ** 2 <= 1) on = true; }
    if (on) { const o = (y * w + x) * 4; data[o] = 110; data[o + 1] = 200; data[o + 2] = 70; }
  }
  if (!opts.noTape) {
    // The tape: a yellow band 0.9 inch wide along an axis through (w/2, h*0.2), with ticks from the top edge: every 1/16 inch short, every inch long (the metric variant: every 1/10 cm short, every cm long).
    const th = (opts.tapeAngleDeg * Math.PI) / 180, dir = { x: Math.cos(th), y: Math.sin(th) }, nrm = { x: -dir.y, y: dir.x };
    const tc = { x: w / 2, y: h * 0.2 }, half = w * 0.42, wid = inchPx * 0.9;
    const unitPx = opts.metric ? inchPx / 2.54 : inchPx, fine = opts.metric ? 10 : 16;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - tc.x, dy = y - tc.y, t = dx * dir.x + dy * dir.y, s = dx * nrm.x + dy * nrm.y;
      if (Math.abs(t) > half || Math.abs(s) > wid / 2) continue;
      const o = (y * w + x) * 4;
      data[o] = 235; data[o + 1] = 210; data[o + 2] = 40;
      const pos = t + half, k = pos / (unitPx / fine), frac = k - Math.round(k);
      const idx = Math.round(k);
      const long = idx % fine === 0, half2 = idx % (fine / 2) === 0, quarter = idx % (fine / 4) === 0;
      const depth = long ? 0.72 : half2 ? 0.45 : quarter ? 0.32 : 0.2;
      const fromTop = s + wid / 2;
      if (Math.abs(frac) * (unitPx / fine) <= 1.2 && fromTop <= depth * wid) { data[o] = 20; data[o + 1] = 20; data[o + 2] = 20; }
    }
  }
  return { width: w, height: h, data };
}

describe("the tape", () => {
  it("is found, straightened at a tilt, and read as sixteen fine ticks to a long tick: an inch", () => {
    for (const angle of [0, 7, -12, 25]) {
      const inchPx = 120;
      const img = paint({ w: 2400, h: 1800, inchPx, tapeAngleDeg: angle, leafR: 150, grass: false });
      const tape = findTape(img, 4)!;
      expect(tape).not.toBeNull();
      expect(Math.abs(((Math.atan2(tape.dir.y, tape.dir.x) * 180) / Math.PI) - angle) % 180).toBeLessThan(1.5);
      expect(tape.halfWidth).toBeGreaterThan(40); expect(tape.halfWidth).toBeLessThan(80);
      const cal = calibrateFromTicks(straighten(img, tape));
      expect(cal.status, `angle ${angle}: ${cal.reason}`).toBe("ok");
      expect(cal.units).toBe("inch");
      expect(cal.inchPxFromLongTicks!).toBeCloseTo(inchPx, -1);
      expect(cal.inchPxFromFineTicks!).toBeCloseTo(inchPx, 0);
      expect(cal.pixelsPerCm!).toBeCloseTo(inchPx / 2.54, 0);
      expect(cal.relativeUncertainty!).toBeLessThan(0.03);
      expect(cal.longTicks.length).toBeGreaterThanOrEqual(8);
    }
  });
  it("refuses a metric tape, an absent tape, and a picture with no periodic ticks", () => {
    const metric = paint({ w: 2400, h: 1800, inchPx: 120, tapeAngleDeg: 3, leafR: 150, grass: false, metric: true });
    const cm = calibrateFromTicks(straighten(metric, findTape(metric, 4)!));
    expect(cm.status).toBe("failed");
    expect(cm.reason).toMatch(/metric|long tick/);
    expect(cm.pixelsPerCm).toBeNull();
    expect(findTape(paint({ w: 1200, h: 900, inchPx: 60, tapeAngleDeg: 0, leafR: 80, grass: false, noTape: true }), 4)).toBeNull();
    const blank: Rgba = { width: 800, height: 200, data: new Uint8Array(800 * 200 * 4).fill(235) };
    for (let i = 0; i < 800 * 200; i++) { blank.data[i * 4 + 1] = 210; blank.data[i * 4 + 2] = 40; }
    const t = findTape(blank, 2)!;
    const c = calibrateFromTicks(straighten(blank, t));
    expect(c.status).toBe("failed");
  });
  it("period and peak helpers", () => {
    const prof = new Float32Array(400); for (let i = 0; i < 400; i++) prof[i] = i % 25 === 0 ? 10 : i % 5 === 0 ? 3 : 0;
    expect(dominantPeriod(prof, 3, 12)!.period).toBeCloseTo(5, 0);
    expect(peaks(prof, 7, 10)).toHaveLength(16);
  });
});

describe("the canopy", () => {
  it("cuts the smooth rosette out of the grass, measures it, and says it is isolated", () => {
    const inchPx = 120, ppcm = inchPx / 2.54;
    const img = paint({ w: 2400, h: 1800, inchPx, tapeAngleDeg: 5, leafR: 180, grass: true });
    const wk = prepare(img, 4, ppcm);
    const seg = segmentCanopy(wk);
    expect(seg.target.status).toBe("selected");
    expect(Math.hypot(seg.target.centre!.x - 1200, seg.target.centre!.y - 900)).toBeLessThan(40);
    expect(["isolated", "touching-vegetation"]).toContain(seg.quality.status);
    const cal: Calibration = { status: "ok", method: "tick-periodicity", units: "inch", pixelsPerCm: ppcm, relativeUncertainty: 0.01, inchPxFromLongTicks: inchPx, inchPxFromFineTicks: inchPx, longTicks: [], localInchPx: [], driftAlongTape: null, bodyWidthPx: null, edge: "top", reason: null };
    const { measurement: m, outlinePx } = measureCanopy(seg.mask, wk.width, wk.height, wk.scale, cal, seg.quality, -90);
    expect(m.status).toBe("measured");
    // The rosette spans about 2 * (0.55 + 0.5) * leafR = 378 px = 8.0 cm tip to tip.
    expect(m.maxSpanCm!).toBeGreaterThan(7);
    expect(m.maxSpanCm!).toBeLessThan(9.5);
    expect(m.perpendicularSpanCm!).toBeGreaterThan(5);
    expect(m.canopyAreaCm2!).toBeGreaterThan(10);
    expect(m.equivalentDiameterCm!).toBeLessThan(m.maxSpanCm!);
    expect(m.scaleAssumption).toMatch(/near nadir/);
    expect(outlinePx!.length).toBeGreaterThan(20);
    expect(m.spanEndpoints![0].x).not.toBe(m.spanEndpoints![1].x);
  });
  it("withholds the area off nadir, refuses without a scale, and refuses an empty mask", () => {
    const wk = prepare(paint({ w: 1200, h: 900, inchPx: 60, tapeAngleDeg: 0, leafR: 90, grass: false }), 4, 60 / 2.54);
    const seg = segmentCanopy(wk);
    const ok: Calibration = { status: "ok", method: "tick-periodicity", units: "inch", pixelsPerCm: 60 / 2.54, relativeUncertainty: 0.01, inchPxFromLongTicks: 60, inchPxFromFineTicks: 60, longTicks: [], localInchPx: [], driftAlongTape: null, bodyWidthPx: null, edge: "top", reason: null };
    const tilted = measureCanopy(seg.mask, wk.width, wk.height, 4, ok, seg.quality, -70).measurement;
    expect(tilted.status).toBe("measured");
    expect(tilted.canopyAreaCm2).toBeNull();
    expect(tilted.maxSpanCm).not.toBeNull();
    expect(tilted.scaleAssumption).toMatch(/area is withheld/);
    const failed: Calibration = { ...ok, status: "failed", pixelsPerCm: null, reason: "no ticks" };
    expect(measureCanopy(seg.mask, wk.width, wk.height, 4, failed, seg.quality, -90).measurement).toMatchObject({ status: "refused", reason: "no scale: no ticks" });
    const q: SegmentationQuality = { status: "failed", coreShare: null, touchesImageEdge: false, mergedWithAlternative: false, maskPixels: 0, pieces: 0, joinedCores: 0, nearbyCores: 0, reason: "nothing" };
    expect(measureCanopy(new Uint8Array(wk.width * wk.height), wk.width, wk.height, 4, ok, q, -90).measurement.status).toBe("refused");
    expect(boundary(new Uint8Array(16), 4, 4)).toEqual([]);
    const sq = new Uint8Array(100); for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) sq[y * 10 + x] = 1;
    expect(boundary(sq, 10, 10)).toHaveLength(20);
    expect(open(sq, 10, 10, 1).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
  it("a person's override picks the plant, and the comparison is unavailable without a tape measurement", () => {
    const wk = prepare(paint({ w: 1200, h: 900, inchPx: 60, tapeAngleDeg: 0, leafR: 90, grass: false }), 4, 60 / 2.54);
    const seg = segmentCanopy(wk, { override: { x: 600, y: 450 } });
    expect(seg.target.method).toBe("manual");
    expect(seg.target.status).toBe("selected");
    const m = { status: "measured", maxSpanCm: 8, reason: null, perpendicularSpanCm: 7, canopyAreaCm2: 30, equivalentDiameterCm: 6.2, spanEndpoints: null, perpendicularEndpoints: null, scaleAssumption: "" } as const;
    expect(compare(m, null).available).toBe(false);
    expect(compare(m, { maxSpanCm: 7.5, perpendicularSpanCm: null, measuredInField: true })).toEqual({ absoluteErrorCm: 0.5, signedErrorCm: 0.5, percentError: 7, available: true });
  });
});
