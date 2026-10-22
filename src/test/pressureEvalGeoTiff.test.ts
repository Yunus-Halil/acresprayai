// The harness's GeoTIFF reader (scripts/eval/pressure/fixture.ts, rasterFromGeoTiff) on the projections an orthomosaic
// comes in: a pixel square in degrees (EPSG:4326) is a rectangle on the ground, cos(latitude) narrower east to west,
// and the reader must still give true lengths in both axes once on Web Mercator pixels. Also the four-band case:
// unassociated alpha and GDALNoData 0 must read as unimaged, never as black ground.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Raster, drawFrom, rasterFromGeoTiff, utmOf } from "../../scripts/eval/pressure/fixture";
import type { LatLng2 } from "@/lib/geo";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { coverMask } from "@/lib/weedVision/fieldRows";
import { latLngOfPx, mercatorPx, metresPerPixel } from "@/lib/weedVision/mapRun";
import { DEFAULT_STAGE1, readStage1 } from "@/lib/weedVision/twoStage/stage1";

const LAT = 40, LNG = -75; // 40° N, on UTM zone 18's central meridian
const SOIL = [150, 115, 80], GREEN = [60, 160, 50];
const DIR = mkdtempSync(join(tmpdir(), "pressure-geotiff-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

// Ground truth on the WGS 84 ellipsoid: metres per degree at a latitude (Snyder 1987, the radii of curvature).
const A = 6378137, E2 = 0.00669437999014;
const mPerDegLat = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return ((Math.PI / 180) * A * (1 - E2)) / (1 - E2 * s * s) ** 1.5; };
const mPerDegLng = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return ((Math.PI / 180) * A * Math.cos((lat * Math.PI) / 180)) / Math.sqrt(1 - E2 * s * s); };

/**
 * The test field in ground metres east and north of its centre: a 4 m bar east to west at 1.5 m north, and a 4 m bar
 * north to south at 2.5 m east, each 0.3 m wide, on soil.
 */
const BAR_M = 4, HALF_W = 0.15, H_NORTH = 1.5, V_EAST = 2.5;
const onBar = (east: number, north: number) => (Math.abs(north - H_NORTH) <= HALF_W && Math.abs(east) <= BAR_M / 2) || (Math.abs(east - V_EAST) <= HALF_W && Math.abs(north) <= BAR_M / 2);

/** A GeoTIFF of the field: `ground(i, j)` gives the ground metres (east, north) of the file pixel's centre. */
async function writeTiff(name: string, W: number, H: number, meta: Record<string, unknown>, ground: (i: number, j: number) => [number, number], bands = 3, paint?: (i: number, j: number, px: number[]) => number[]): Promise<string> {
  const { writeArrayBuffer } = await import("geotiff");
  const data = new Uint8Array(W * H * bands);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const [e, n] = ground(i, j);
    let px = onBar(e, n) ? [...GREEN] : [...SOIL];
    if (bands === 4) px.push(255);
    if (paint) px = paint(i, j, px);
    data.set(px, (j * W + i) * bands);
  }
  const buf = writeArrayBuffer(data, { width: W, height: H, ...meta } as never);
  const file = join(DIR, name);
  writeFileSync(file, Buffer.from(buf));
  return file;
}

/** The field's ring from its corner lat/lngs. */
const ringOf = (nw: LatLng2, se: LatLng2): LatLng2[] => [nw, { lat: nw.lat, lng: se.lng }, se, { lat: se.lat, lng: nw.lng }];

/** The two bars' lengths as the harness's raster shows them, metres: green runs through each bar's middle, in Web Mercator pixels times the map's pixel size there. */
function measure(r: Raster, at: (east: number, north: number) => LatLng2): { east: number; north: number } {
  const green = (x: number, y: number) => x >= 0 && y >= 0 && x < r.width && y < r.height && r.rgba[(y * r.width + x) * 4 + 3] > 0 && r.rgba[(y * r.width + x) * 4 + 1] > 130 && r.rgba[(y * r.width + x) * 4] < 110;
  const pix = (q: LatLng2) => { const [X, Y] = mercatorPx(q.lat, q.lng, r.z); return [Math.floor(X - r.left), Math.floor(Y - r.top)]; };
  const run = (x0: number, y0: number, dx: number, dy: number) => { let n = 0; for (let x = x0, y = y0; green(x, y); x += dx, y += dy) n++; for (let x = x0 - dx, y = y0 - dy; green(x, y); x -= dx, y -= dy) n++; return n; };
  const [hx, hy] = pix(at(0, H_NORTH)), [vx, vy] = pix(at(V_EAST, 0));
  const mpp = metresPerPixel(LAT, r.z);
  return { east: run(hx, hy, 1, 0) * mpp, north: run(vx, vy, 0, 1) * mpp };
}

describe("GeoTIFF lengths on the ground, every projection the reader takes", () => {
  it("EPSG:4326 at 40° N, a pixel square in degrees: both bars measure 4 m within 1%", async () => {
    const d = 1e-7; // degrees a pixel, both axes: 0.85 cm east to west, 1.11 cm north to south at 40° N
    const W = Math.ceil(7 / (d * mPerDegLng(LAT))), H = Math.ceil(6 / (d * mPerDegLat(LAT)));
    const lng0 = LNG - (W / 2) * d, lat0 = LAT + (H / 2) * d; // the north-west corner
    const ground = (i: number, j: number): [number, number] => [(lng0 + (i + 0.5) * d - LNG) * mPerDegLng(LAT), (lat0 - (j + 0.5) * d - LAT) * mPerDegLat(LAT)];
    const file = await writeTiff("wgs84.tif", W, H, { ModelPixelScale: [d, d, 0], ModelTiepoint: [0, 0, 0, lng0, lat0, 0], GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1 }, ground);
    const r = await rasterFromGeoTiff(file, ringOf({ lat: lat0, lng: lng0 }, { lat: lat0 - H * d, lng: lng0 + W * d }));
    const at = (e: number, n: number): LatLng2 => ({ lat: LAT + n / mPerDegLat(LAT), lng: LNG + e / mPerDegLng(LAT) });
    const m = measure(r, at);
    if (process.env.SHOW_LENGTHS) console.log("4326", m);
    expect(Math.abs(m.east / BAR_M - 1)).toBeLessThan(0.01);
    expect(Math.abs(m.north / BAR_M - 1)).toBeLessThan(0.01);
    // A degree-square pixel read as a ground-square one would stretch the east bar by 1 / cos(40°), 31%: the two bars agree instead.
    expect(Math.abs(m.east / m.north - 1)).toBeLessThan(0.01);
  });

  it("EPSG:3857: both bars measure 4 m within 1%", async () => {
    const s = 1 / Math.cos((LAT * Math.PI) / 180) * 0.01; // Mercator metres a pixel for 1 cm on the ground at 40° N
    const [cx, cy] = [(LNG * Math.PI * A) / 180, A * Math.log(Math.tan(Math.PI / 4 + (LAT * Math.PI) / 360))];
    const W = 700, H = 600, ox = cx - (W / 2) * s, oy = cy + (H / 2) * s;
    const latOf = (y: number) => (2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) * 180 / Math.PI;
    const ground = (i: number, j: number): [number, number] => {
      const lng = ((ox + (i + 0.5) * s) / A) * 180 / Math.PI, lat = latOf(oy - (j + 0.5) * s);
      return [(lng - LNG) * mPerDegLng(LAT), (lat - LAT) * mPerDegLat(LAT)];
    };
    const file = await writeTiff("mercator.tif", W, H, { ModelPixelScale: [s, s, 0], ModelTiepoint: [0, 0, 0, ox, oy, 0], ProjectedCSTypeGeoKey: 3857, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }, ground);
    const nw = { lat: latOf(oy), lng: (ox / A) * 180 / Math.PI }, se = { lat: latOf(oy - H * s), lng: ((ox + W * s) / A) * 180 / Math.PI };
    const r = await rasterFromGeoTiff(file, ringOf(nw, se));
    const m = measure(r, (e, n) => ({ lat: LAT + n / mPerDegLat(LAT), lng: LNG + e / mPerDegLng(LAT) }));
    if (process.env.SHOW_LENGTHS) console.log("3857", m);
    expect(Math.abs(m.east / BAR_M - 1)).toBeLessThan(0.01);
    expect(Math.abs(m.north / BAR_M - 1)).toBeLessThan(0.01);
  });

  it("WGS 84 UTM zone 18 N: both bars measure 4 m within 1%", async () => {
    const [ce, cn] = utmOf(LAT, LNG, 18, false);
    const s = 0.01, W = 700, H = 600, ox = ce - (W / 2) * s, oy = cn + (H / 2) * s;
    // On the central meridian a UTM metre is 0.9996 of a ground metre: well inside the 1%.
    const ground = (i: number, j: number): [number, number] => [ox + (i + 0.5) * s - ce, oy - (j + 0.5) * s - cn];
    const file = await writeTiff("utm.tif", W, H, { ModelPixelScale: [s, s, 0], ModelTiepoint: [0, 0, 0, ox, oy, 0], ProjectedCSTypeGeoKey: 32618, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }, ground);
    const half = (n: number) => n / mPerDegLat(LAT), halfE = (e: number) => e / mPerDegLng(LAT);
    const r = await rasterFromGeoTiff(file, ringOf({ lat: LAT + half(2.9), lng: LNG - halfE(3.4) }, { lat: LAT - half(2.9), lng: LNG + halfE(3.4) }));
    const m = measure(r, (e, n) => ({ lat: LAT + n / mPerDegLat(LAT), lng: LNG + e / mPerDegLng(LAT) }));
    if (process.env.SHOW_LENGTHS) console.log("utm", m);
    expect(Math.abs(m.east / BAR_M - 1)).toBeLessThan(0.01);
    expect(Math.abs(m.north / BAR_M - 1)).toBeLessThan(0.01);
  });
});

describe("a four-band EPSG:4326 ortho: unassociated alpha and GDALNoData 0", () => {
  it("alpha 0 and all-zero pixels read as unimaged: no imaged share, no green, no dark ground", async () => {
    // 6 x 6 m: the west third has alpha 0 over GREEN colour (alpha must win), the middle third is 0, 0, 0 with alpha
    // 255 (no data by GDALNoData 0, not black soil), the east third is soil with the bars.
    const d = 1e-7, W = Math.ceil(6 / (d * mPerDegLng(LAT))), H = Math.ceil(6 / (d * mPerDegLat(LAT)));
    const lng0 = LNG - (W / 2) * d, lat0 = LAT + (H / 2) * d;
    const ground = (i: number, j: number): [number, number] => [(lng0 + (i + 0.5) * d - LNG) * mPerDegLng(LAT), (lat0 - (j + 0.5) * d - LAT) * mPerDegLat(LAT)];
    const third = (i: number) => (i < W / 3 ? 0 : i < (2 * W) / 3 ? 1 : 2);
    const file = await writeTiff("rgba.tif", W, H, {
      ModelPixelScale: [d, d, 0], ModelTiepoint: [0, 0, 0, lng0, lat0, 0], GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1,
      ExtraSamples: [2], GDAL_NODATA: "0", PhotometricInterpretation: 2,
    }, ground, 4, (i, _j, px) => (third(i) === 0 ? [...GREEN, 0] : third(i) === 1 ? [0, 0, 0, 255] : [...SOIL, 255]));
    const ring = ringOf({ lat: lat0, lng: lng0 }, { lat: lat0 - H * d, lng: lng0 + W * d });
    const r = await rasterFromGeoTiff(file, ring);
    // The raster itself: west and middle transparent, east opaque soil.
    const opaqueAt = (east: number) => { const q = { lat: LAT, lng: LNG + east / mPerDegLng(LAT) }; const [X, Y] = mercatorPx(q.lat, q.lng, r.z); return r.rgba[(Math.floor(Y - r.top) * r.width + Math.floor(X - r.left)) * 4 + 3]; };
    expect(opaqueAt(-2.5)).toBe(0);
    expect(opaqueAt(0)).toBe(0);
    expect(opaqueAt(1.5)).toBe(255);
    // The cover mask never marks the alpha-0 green.
    const px: PhotoPixels = { width: r.width, height: r.height, rgba: r.rgba };
    const cover = coverMask(px);
    let coveredWest = 0;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      const q = latLngOfPx(r.left + x + 0.5, r.top + y + 0.5, r.z), east = (q.lng - LNG) * mPerDegLng(LAT);
      if (east < -1.2 && cover[y * r.width + x]) coveredWest++;
    }
    expect(coveredWest).toBe(0);
    // Stage 1 on it: cells in the west and middle thirds have no imaged pixels (so no cell at all), a cell straddling
    // the middle and east thirds is half imaged, and none of the no-data counts as dark (shadow) or green.
    // Stage 1 reads at its own zoom (22 here); the harness's draw box-filters the raster down to it, transparent stays transparent.
    const draw = drawFrom(r);
    const s1 = (await readStage1({ rings: [ring], tile: () => "", maxNative: r.z, lat: LAT, rows: null, params: { ...DEFAULT_STAGE1, cellM: 0.5 }, draw: draw as never }))!;
    const eastOf = (c: { centre: LatLng2 }) => (c.centre.lng - LNG) * mPerDegLng(LAT);
    const westEdge = 1; // the east third (imaged soil) starts 1 m east of centre
    expect(s1.cells.filter(c => eastOf(c) < westEdge - 0.5).length).toBe(0); // fully no-data cells are not read at all
    const edge = s1.cells.filter(c => Math.abs(eastOf(c) - westEdge) < 0.25 && c.imagedShare > 0);
    expect(edge.length).toBeGreaterThan(0);
    for (const c of edge) {
      expect(c.imagedShare).toBeGreaterThan(0.05);
      expect(c.imagedShare).toBeLessThan(0.95);
      expect(c.darkShare).toBe(0); // the 0, 0, 0 pixels are not black ground
      expect(c.greenShare).toBe(0); // and none of the alpha-0 green leaked in
    }
    expect(s1.cells.every(c => c.darkShare === 0)).toBe(true);
  });
});
