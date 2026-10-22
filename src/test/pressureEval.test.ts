// The weed-pressure evaluation harness (scripts/eval/pressure): the synthetic fixture must score near zero error, the
// scorer must see an error when there is one, and the fixture readers (truth CSV, GeoTIFF, UTM) must read right.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type FixtureRun, type LoadedFixture, downsample, parseTruthCsv, rasterFromGeoTiff, runFixture, sliceRaster, utmOf } from "../../scripts/eval/pressure/fixture";
import { disagreementCsv, disagreementRows } from "../../scripts/eval/pressure/disagreement";
import { buildReport, reportMarkdown } from "../../scripts/eval/pressure/report";
import { scoreGrade } from "../../scripts/eval/pressure/score";
import { makeSyntheticFixture } from "../../scripts/eval/pressure/synthetic";
import { gradePressure, weedObjectsOf } from "@/lib/weedVision/pressure/grade";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { cellKey } from "@/lib/weedVision/twoStage/stage1";

// One synthetic fixture and one run of it, shared: each run is a Stage 1 read of 1.4 million pixels, and the suite
// runs beside a hundred other files.
let f: LoadedFixture, run: FixtureRun;
beforeAll(async () => { f = makeSyntheticFixture(); run = await runFixture(f); }, 30_000);

describe("the synthetic fixture", () => {
  it("scores near zero error: cover, count, act or not, patches, nothing unassessed", async () => {
    const { metrics: m, quadrats } = scoreGrade(run.grade, run.stage1.grid, f.truth);
    expect(m.quadrats).toBe(12);
    expect(m.scored).toBe(12);
    // The truth is not trivial: weedy and clean quadrats both, real counts.
    expect(f.truth.filter(q => q.cover >= 0.1).length).toBe(6);
    expect(f.truth.filter(q => q.cover === 0).length).toBe(3);
    expect(Math.max(...f.truth.map(q => q.count))).toBeGreaterThan(5);
    expect(m.cover.mae).toBeLessThan(0.002);
    expect(Math.abs(m.cover.bias!)).toBeLessThan(0.002);
    expect(m.count.mae).toBeLessThan(0.5);
    expect(m.confusion).toMatchObject({ fp: 0, fn: 0, tp: 6, tn: 6, precision: 1, recall: 1 });
    expect(m.patchIoU).toBeGreaterThan(0.99);
    expect(m.notAssessedCells).toBe(0);
    expect(quadrats.every(q => q.assessedShare > 0.999)).toBe(true);
    const md = reportMarkdown(buildReport(f.name, "2026-10-22", run.grade, run.stage1.grid.cellPx * run.stage1.grid.mpp, m, quadrats));
    expect(md).toMatch(/Scored 12 of 12 truth quadrats/);
    expect(md).not.toMatch(/\u2014/); // house style: no em dashes
  });

  it("the scorer sees an error when there is one: truth shifted by five points reads as five points of bias", async () => {
    const shifted = f.truth.map(q => ({ ...q, cover: q.cover + 0.05, count: q.count + 2 }));
    const { metrics: m } = scoreGrade(run.grade, run.stage1.grid, shifted);
    expect(m.cover.mae).toBeCloseTo(0.05, 3);
    expect(m.cover.bias).toBeCloseTo(-0.05, 3);
    expect(m.count.bias).toBeCloseTo(-2, 3);
    // The 2.8% quadrats now read 7.8% truth: still under the 10% action point, so the confusion holds.
    expect(m.confusion.fn).toBe(0);
  });

  it("cells the grade could not assess are counted by reason, and a mostly unassessed quadrat is not scored", async () => {
    const g = run.stage1.grid;
    // Shadow over every cell of the first quadrat.
    const [X, Y] = mercatorPx(f.truth[0].centre.lat, f.truth[0].centre.lng, g.z);
    const ci = Math.floor((X - g.left) / g.cellPx), cj = Math.floor((Y - g.top) / g.cellPx);
    const shaded = new Set([cellKey(ci - 1, cj - 1), cellKey(ci, cj - 1), cellKey(ci - 1, cj), cellKey(ci, cj)]);
    const cells = run.stage1.cells.map(c => (shaded.has(c.key) ? { ...c, uncertain: ["shadow" as const] } : c));
    const grade = gradePressure({ objects: [], grid: g, cells, rows: f.rows, crop: f.crop, canopyClosed: false, photoBased: false });
    const { metrics: m, quadrats } = scoreGrade(grade, g, f.truth);
    expect(quadrats[0].scored).toBe(false);
    expect(quadrats[0].predCover).toBeNull();
    expect(m.scored).toBe(11);
    expect(m.notAssessedCells).toBe(4);
    expect(m.notAssessedByReason).toEqual({ shadow: 4 });
  });
});

describe("the disagreement export", () => {
  it("lists assessed cells where pixels and objects differ by over a tenth of the ground, the model's excess first", async () => {
    const g = run.stage1.grid;
    const cellCentre = (q: (typeof f.truth)[number], di: number) => { const [X, Y] = mercatorPx(q.centre.lat, q.centre.lng, g.z); return latLngOfPx(X + di * g.cellPx - g.cellPx / 2, Y - g.cellPx / 2, g.z); };
    const obj = (id: string, centre: { lat: number; lng: number }, areaM2: number) => ({ id, frame: "t", klass: "weed", centre, areaM2, diameterM: 2 * Math.sqrt(areaM2 / Math.PI), equivalentDiameterPx: 20, seenIn: ["t"], rowStatus: "off-row" }) as unknown as GroundPlant;
    const clean = f.truth.find(q => q.cover === 0)!, weedy = f.truth.find(q => q.cover > 0.3)!;
    // A crown-sized "weed" over a clean cell, a small one (just over the 12 cm floor) over a weedy cell, and one too small to matter.
    const objects = weedObjectsOf([obj("big", cellCentre(clean, 0), 0.2), obj("small", cellCentre(weedy, 0), 0.012), obj("ok", cellCentre(clean, 1), 0.01)]);
    const grade = gradePressure({ objects, grid: g, cells: run.stage1.cells, rows: f.rows, crop: f.crop, canopyClosed: false, photoBased: false });
    const rows = disagreementRows("t", grade);
    expect(rows.map(r => r.objM2 > r.pixelM2)).toEqual([true, false]);
    expect(rows[0].objM2).toBeCloseTo(0.2, 6);
    expect(rows[0].pixelM2).toBe(0);
    expect(rows.length).toBe(grade.summary.disagreeing);
    const csv = disagreementCsv(rows).trim().split(/\r?\n/);
    expect(csv[0]).toBe("frame,cell,lat,lng,pixelM2,objM2,groundM2,nearCrop,tier,klass");
    expect(csv).toHaveLength(3);
    expect(csv[1].startsWith(`t,${rows[0].cell},`)).toBe(true);
  });
});

describe("reading fixtures", () => {
  it("the truth CSV: named columns in any order, comments, an id when given, bad lines refused", () => {
    const q = parseTruthCsv("# quadrats\ncount,lat,lng,cover,side_m,id\n3,37.6,-78.4,0.12,1,a\n0,37.61,-78.41,0,0.5,\n");
    expect(q).toEqual([{ id: "a", centre: { lat: 37.6, lng: -78.4 }, sideM: 1, cover: 0.12, count: 3 }, { id: "q2", centre: { lat: 37.61, lng: -78.41 }, sideM: 0.5, cover: 0, count: 0 }]);
    expect(() => parseTruthCsv("lat,lng,side_m,cover,count\n37.6,-78.4,1,12,3")).toThrow(/line 2/); // cover as a percent, not a share
    expect(() => parseTruthCsv("lat,lng,cover,count\n37.6,-78.4,0.1,3")).toThrow(/side_m/);
  });

  it("UTM from lat/lng: on the zone's meridian, and the meridian arc at 40° N", () => {
    const [e0, n0] = utmOf(0, 3, 31, false);
    expect(e0).toBeCloseTo(500000, 3);
    expect(n0).toBeCloseTo(0, 3);
    const [e, n] = utmOf(40, -105, 13, false);
    expect(e).toBeCloseTo(500000, 3);
    expect(n).toBeCloseTo(4427757.2, 0); // 4,429,529.0 m of meridian arc times 0.9996
    expect(utmOf(-33.9, 18.4, 34, true)[1]).toBeGreaterThan(6_000_000); // the south's false northing
  });

  it("a GeoTIFF in Web Mercator reads back onto the same pixels (the grade is a function of its pixels, so it grades the same)", async () => {
    // A 300 px window of the synthetic map round the first quadrat, its own ring the window's corners.
    const [QX, QY] = mercatorPx(f.truth[0].centre.lat, f.truth[0].centre.lng, f.raster.z);
    const left = Math.round(QX) - 150, top = Math.round(QY) - 150;
    const px = sliceRaster(f.raster, left, top, 300, 300);
    const r = { z: f.raster.z, left, top, width: 300, height: 300, rgba: px.rgba };
    const ring = [latLngOfPx(left + 3, top + 3, r.z), latLngOfPx(left + 297, top + 3, r.z), latLngOfPx(left + 297, top + 297, r.z), latLngOfPx(left + 3, top + 297, r.z)];
    const { writeArrayBuffer } = await import("geotiff");
    const res = (2 * Math.PI * 6378137) / (256 * 2 ** r.z), half = Math.PI * 6378137;
    const rgb = new Uint8Array(r.width * r.height * 3);
    for (let p = 0; p < r.width * r.height; p++) { rgb[p * 3] = r.rgba[p * 4]; rgb[p * 3 + 1] = r.rgba[p * 4 + 1]; rgb[p * 3 + 2] = r.rgba[p * 4 + 2]; }
    const buf = writeArrayBuffer(rgb, { width: r.width, height: r.height, ModelPixelScale: [res, res, 0], ModelTiepoint: [0, 0, 0, r.left * res - half, half - r.top * res, 0], ProjectedCSTypeGeoKey: 3857, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 } as never);
    const dir = mkdtempSync(join(tmpdir(), "pressure-eval-"));
    try {
      const file = join(dir, "ortho.tif");
      writeFileSync(file, Buffer.from(buf));
      const back = await rasterFromGeoTiff(file, ring);
      expect(back.z).toBe(r.z);
      let same = 0, n = 0;
      for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
        const bx = r.left + x - back.left, by = r.top + y - back.top;
        if (bx < 0 || by < 0 || bx >= back.width || by >= back.height) continue;
        n++;
        const o = (y * r.width + x) * 4, b = (by * back.width + bx) * 4;
        if (back.rgba[b] === r.rgba[o] && back.rgba[b + 1] === r.rgba[o + 1] && back.rgba[b + 2] === r.rgba[o + 2]) same++;
      }
      expect(n).toBeGreaterThan(0.95 * r.width * r.height);
      expect(same / n).toBeGreaterThan(0.999);
      // The window holds weed and soil both, so matching pixels is not matching a blank.
      let green = 0;
      for (let p = 0; p < back.width * back.height; p++) if (back.rgba[p * 4 + 1] === 160) green++;
      expect(green).toBeGreaterThan(500);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a finer raster is drawn at the read zoom by a box filter", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    for (let p = 0; p < 16; p++) rgba[p * 4] = p % 2 ? 200 : 100;
    const d = downsample({ z: 23, left: 8, top: 8, width: 4, height: 4, rgba }, 22);
    expect([d.left, d.top, d.width, d.height]).toEqual([4, 4, 2, 2]);
    expect(d.rgba[0]).toBe(150);
  });

  it("the harness refuses a row crop on reader rows, as the app does", async () => {
    await expect(runFixture({ ...f, crop: "corn", rows: { ...f.rows!, source: "reader" } })).rejects.toThrow(/Row-crop grading is not supported yet/);
  });
});
