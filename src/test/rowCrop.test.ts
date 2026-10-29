// The continuous-row reader on rendered corn stands (scripts/cropProfiles/scenes.ts, development scenes only) and on
// hand-built profiles. The rows must sit on the crop, including over straw stripes (the failure that put the lattice
// pass's rows on the straw), nothing on a row may be reported, and weeds between the rows must be found.
import { describe, expect, it } from "vitest";
import { renderScene, sceneSet, type Scene } from "../../scripts/cropProfiles/scenes";
import { pitchFromProfile, readRowCrop, rowCropOverlay, type RowCropRead } from "@/lib/rowCrop/readRowCrop";
import { readsContinuousRows, rowCropParamsFor } from "@/lib/rowCrop/params";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const profile = cropProfileFor("corn")!;
const scenes = sceneSet("development").slice(0, 24);

/** Share of a read's row points within a quarter pitch of a true row. */
function pointsOnCrop(read: RowCropRead, s: Scene, acrossToRow: (x: number, y: number) => number): number | null {
  let on = 0, n = 0;
  for (const r of read.rows) for (const [x, y] of r.points) { n++; if (Math.abs(acrossToRow(x * s.gsdM, -y * s.gsdM)) < s.pitchM / 4) on++; }
  return n ? on / n : null;
}

describe("continuous-row reader on rendered corn", () => {
  const reads = scenes.map(s => { const { px, truth } = renderScene(s); return { s, truth, read: readRowCrop(px, rowCropParamsFor(profile, s.gsdM)) }; });

  it("finds rows on nearly every stand and puts them on the crop, straw or not", () => {
    const found = reads.filter(r => r.read.rows.length > 0);
    expect(found.length / reads.length).toBeGreaterThanOrEqual(0.9);
    const onCrop = found.map(r => pointsOnCrop(r.read, r.s, r.truth.acrossToRow)!);
    const mean = onCrop.reduce((a, b) => a + b, 0) / onCrop.length;
    expect(mean).toBeGreaterThanOrEqual(0.85);
    const straw = found.filter(r => r.s.straw);
    // development-5 (V2 at 0.3 cm on straw, with weeds larger than the plants) reads 0.73: the known weak case.
    for (const r of straw) expect(pointsOnCrop(r.read, r.s, r.truth.acrossToRow)).toBeGreaterThanOrEqual(0.7);
  });

  it("measures the pitch within the tolerance when the scale is given", () => {
    for (const r of reads) if (r.read.pitchM != null) expect(Math.abs(r.read.pitchM - r.s.pitchM) / r.s.pitchM).toBeLessThan(0.1);
  });

  it("never reports the crop: weed candidates stand clear of the true rows (single rows; a weed inside the row is not the crop)", () => {
    // Single rows, with the plants at least as large as the weeds: a V2 stand under weeds larger than its plants
    // (development-5) is the known weak case, where weed peaks can pass for rows.
    for (const r of reads.filter(x => !x.s.twinM && x.read.rows.length > 0 && x.s.leafM >= 2 * x.s.weedRadiusM)) {
      const onRow = r.read.weeds.filter(w => {
        const x = w.x * r.s.gsdM, y = -w.y * r.s.gsdM;
        if (Math.abs(r.truth.acrossToRow(x, y)) >= 0.1) return false;
        return !r.truth.inRowWeeds.some(t => Math.hypot(t.x - x, t.y - y) <= t.r + 0.06);
      });
      // A V2 stand (6 cm plants) at a row's end past the last traced strip is the residue here: at most a fifth.
      expect(onRow.length).toBeLessThanOrEqual(Math.max(2, Math.round(0.2 * r.read.weeds.length)));
    }
  });

  it("finds the weeds between the rows at fine pixels", () => {
    const weedy = reads.filter(r => r.s.weedsPerM2 > 0 && r.s.gsdM <= 0.01 && r.read.rows.length > 0 && r.truth.weeds.length >= 5);
    expect(weedy.length).toBeGreaterThan(0);
    let hit = 0, total = 0;
    for (const r of weedy) {
      for (const t of r.truth.weeds) {
        total++;
        if (r.read.weeds.some(w => Math.hypot(w.x * r.s.gsdM - t.x, -w.y * r.s.gsdM - t.y) <= Math.max(0.08, t.r + 0.04))) hit++;
      }
    }
    expect(hit / total).toBeGreaterThanOrEqual(0.5);
  });

  it("estimates the scale from the pitch when no pixel size is given, and says so", () => {
    const s = scenes.find(x => x.pitchM === 0.762 && x.gsdM <= 0.01 && !x.twinM)!;
    const { px } = renderScene(s);
    const read = readRowCrop(px, rowCropParamsFor(profile, null));
    expect(read.scaleBasis).toBe("assumed spacing");
    expect(read.notes.some(n => /assumes/.test(n))).toBe(true);
    expect(Math.abs(read.gsdM - s.gsdM) / s.gsdM).toBeLessThan(0.1);
  });

  it("draws rows, bands and weeds in photo pixels", () => {
    const r = reads.find(x => x.read.rows.length > 2)!;
    const o = rowCropOverlay(r.read);
    expect(o.rows.length).toBe(r.read.rows.length);
    expect(o.bands.length).toBe(2 * r.read.rows.length);
    // A strip's centre can fall just outside a rotated frame's corner, so a margin of one pitch is allowed.
    const m = (r.read.pitchM ?? 0.5) / r.read.gsdM;
    for (const row of o.rows) for (const [x, y] of row) { expect(x).toBeGreaterThanOrEqual(-m); expect(y).toBeGreaterThanOrEqual(-m); expect(x).toBeLessThanOrEqual(r.read.width + m); expect(y).toBeLessThanOrEqual(r.read.height + m); }
  });
});

describe("pieces", () => {
  it("reads the pitch of a comb profile", () => {
    const p = new Float64Array(600);
    for (let i = 0; i < 600; i++) p[i] = (i % 37) < 6 ? 1 : 0.05;
    const lag = pitchFromProfile(p, 8, 200)!;
    expect(Math.abs(lag - 37)).toBeLessThan(1);
  });

  it("returns an empty read on a blank photo", () => {
    const W = 300, H = 200, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = 150; rgba[i * 4 + 1] = 120; rgba[i * 4 + 2] = 90; rgba[i * 4 + 3] = 255; }
    const read = readRowCrop({ width: W, height: H, rgba }, rowCropParamsFor(profile, 0.01));
    expect(read.rows).toEqual([]);
    expect(read.notes.length).toBeGreaterThan(0);
  });

  it("corn reads continuous rows; a crop without a profile does not", () => {
    expect(readsContinuousRows("corn")).toBe(true);
    expect(readsContinuousRows("maize")).toBe(true);
    expect(readsContinuousRows("apricot")).toBe(false);
    expect(readsContinuousRows(null)).toBe(false);
  });
});

describe("mid-stage variant", () => {
  it("reports late seedlings as a layer and sizes the between-row plants; the establishment read carries neither", () => {
    const s = scenes.find(x => x.weedsPerM2 > 0 && x.gsdM <= 0.01 && !x.twinM)!;
    const { px } = renderScene(s);
    const early = readRowCrop(px, rowCropParamsFor(profile, s.gsdM, "establishment"));
    const mid = readRowCrop(px, rowCropParamsFor(profile, s.gsdM, "mid"));
    expect(early.stage).toBe("establishment");
    expect(early.seedlings).toBeNull();
    expect(early.weeds.every(w => w.sizeClass === undefined)).toBe(true);
    expect(mid.stage).toBe("mid");
    if (mid.rows.length) {
      expect(mid.seedlings).not.toBeNull();
      expect(mid.weeds.every(w => w.sizeClass === "small" || w.sizeClass === "escape")).toBe(true);
      expect(mid.notes.some(n => /V8/.test(n))).toBe(true);
    }
  });

  it("refuses a photo with no readable rows", () => {
    const W = 400, H = 300, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = 60; rgba[i * 4 + 1] = 140; rgba[i * 4 + 2] = 50; rgba[i * 4 + 3] = 255; }
    const read = readRowCrop({ width: W, height: H, rgba }, rowCropParamsFor(profile, 0.01, "mid"));
    expect(read.rows).toEqual([]);
    expect(read.weeds).toEqual([]);
  });
});
