// A weed-pressure evaluation fixture: one field's imagery, its boundary, its rows and a truth file of quadrats, and
// the headless run of Stage 1 and the grade on it. The format is documented in README.md next to this file.
//
// Headless: readStage1 takes a `draw` that hands it the map's pixels, so the raster here stands in for the map's
// tiles and no browser is needed (the same injection scripts/bench/twoStageTrial.ts uses). Everything after the
// pixels is the app's own code: readStage1, gradePressure, cropGroupOf, canopyClosedOf, PRESSURE_CELL_M.
//
// Imagery comes as a raw RGBA raster already in Web Mercator global pixels at one zoom (what
// research/weed-vision-lab/scripts/prep_two_stage_trial.py writes), or as a GeoTIFF read with geotiff.js (already a
// dependency of the app's orthomosaic import, src/lib/orthoImport.ts) in EPSG:4326, EPSG:3857 or a WGS 84 UTM zone,
// resampled here onto the read zoom's pixels.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { LatLng2 } from "../../../src/lib/geo";
import type { PhotoPixels } from "../../../src/lib/photoScout/pattern";
import { type FieldRows, coverMask, fieldReadPlan, fieldRowStatusAt, shadowMask, vegetationMask } from "../../../src/lib/weedVision/fieldRows";
import type { FrameDetection, GroundPlant } from "../../../src/lib/weedVision/frames";
import { fitLayoutAll, latticeFromClicks, layoutsToFieldRows, rasterFromMask } from "../../../src/lib/weedVision/layout/plantingLayout";
import { latLngOfPx, mercatorPx, metresPerPixel } from "../../../src/lib/weedVision/mapRun";
import { type CropGroup, type PressureGrade, cropGroupOf, gradePressure, weedObjectsOf } from "../../../src/lib/weedVision/pressure/grade";
import { PRESSURE_CELL_M, canopyClosedOf, pressureRefusal } from "../../../src/lib/weedVision/pressure/pressureStore";
import { DEFAULT_STAGE1, type Stage1Result, readStage1 } from "../../../src/lib/weedVision/twoStage/stage1";

/** Pixels in Web Mercator global pixels at zoom z: pixel (x, y) of the raster is global (left + x, top + y). */
export type Raster = { z: number; left: number; top: number; width: number; height: number; rgba: Uint8ClampedArray };

/** One truth quadrat: a square on the ground, north-up, with the weed cover share of its ground and its object count. */
export type TruthQuadrat = { id: string; centre: LatLng2; sideM: number; cover: number; count: number };

export type LoadedFixture = {
  name: string;
  crop: string | null;
  group?: CropGroup;
  ring: LatLng2[];
  raster: Raster;
  rows: FieldRows | null;
  /** Weeds found by a model (the app's GroundPlant or FrameDetection shape); empty when the grade runs on pixels alone. */
  plants: GroundPlant[];
  photoBased: boolean;
  /** Undefined: read from Stage 1 as the app does. */
  canopyClosed?: boolean | null;
  truth: TruthQuadrat[];
};

/** fixture.json, as written on disk. Paths are relative to the fixture's directory. */
export type FixtureFile = {
  name: string;
  crop: string | null;
  group?: CropGroup;
  ring: [number, number][] | string;
  raster: { kind: "rgba"; file: string; z: number; left: number; top: number; width: number; height: number } | { kind: "geotiff"; file: string };
  rows: string | { clicks: [number, number][] } | null;
  objects?: string;
  photoBased?: boolean;
  canopyClosed?: boolean | null;
  truth: string;
};

// ------------------------------------------------------------- reading a fixture

const at = (dir: string, p: string) => (isAbsolute(p) ? p : join(dir, p));

/** The field ring from [lat, lng] pairs or a GeoJSON file (a Polygon, or a Feature or FeatureCollection holding one). */
function ringOf(dir: string, ring: FixtureFile["ring"]): LatLng2[] {
  if (Array.isArray(ring)) return ring.map(([lat, lng]) => ({ lat, lng }));
  const g = JSON.parse(readFileSync(at(dir, ring), "utf8"));
  const geom = g.type === "FeatureCollection" ? g.features[0].geometry : g.type === "Feature" ? g.geometry : g;
  const coords: [number, number][] = geom.type === "MultiPolygon" ? geom.coordinates[0][0] : geom.coordinates[0];
  return coords.map(([lng, lat]) => ({ lat, lng }));
}

/** The truth CSV: a header naming lat, lng, side_m, cover, count (any order; id optional); lines starting with # are comments. */
export function parseTruthCsv(text: string): TruthQuadrat[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if (!lines.length) return [];
  const head = lines[0].split(",").map(h => h.trim().toLowerCase());
  const col = (k: string) => { const i = head.indexOf(k); if (i < 0 && k !== "id") throw new Error(`truth CSV: no "${k}" column`); return i; };
  const [iId, iLat, iLng, iSide, iCover, iCount] = ["id", "lat", "lng", "side_m", "cover", "count"].map(col);
  return lines.slice(1).map((l, n) => {
    const v = l.split(",").map(s => s.trim());
    const q: TruthQuadrat = { id: iId >= 0 && v[iId] ? v[iId] : `q${n + 1}`, centre: { lat: Number(v[iLat]), lng: Number(v[iLng]) }, sideM: Number(v[iSide]), cover: Number(v[iCover]), count: Number(v[iCount]) };
    if (![q.centre.lat, q.centre.lng, q.sideM, q.cover, q.count].every(Number.isFinite) || q.sideM <= 0 || q.cover < 0 || q.cover > 1) throw new Error(`truth CSV line ${n + 2}: ${l}`);
    return q;
  });
}

/** A fixture directory read into memory, its rows fitted from the three clicks when that is what it carries. */
export async function loadFixture(dir: string): Promise<LoadedFixture> {
  const f: FixtureFile = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8"));
  const ring = ringOf(dir, f.ring);
  const raster = f.raster.kind === "rgba"
    ? { z: f.raster.z, left: f.raster.left, top: f.raster.top, width: f.raster.width, height: f.raster.height, rgba: new Uint8ClampedArray(readFileSync(at(dir, f.raster.file))) }
    : await rasterFromGeoTiff(at(dir, f.raster.file), ring);
  if (raster.rgba.length !== raster.width * raster.height * 4) throw new Error(`raster: ${raster.rgba.length} bytes for ${raster.width} x ${raster.height}`);
  const rows = f.rows == null ? null : typeof f.rows === "string" ? JSON.parse(readFileSync(at(dir, f.rows), "utf8")) as FieldRows : rowsFromClicks(raster, ring, f.rows.clicks.map(([lat, lng]) => ({ lat, lng })));
  const plants = f.objects && existsSync(at(dir, f.objects)) ? (JSON.parse(readFileSync(at(dir, f.objects), "utf8")) as (FrameDetection | GroundPlant)[]).map(asPlant) : [];
  return { name: f.name, crop: f.crop ?? null, group: f.group, ring, raster, rows, plants, photoBased: !!f.photoBased, canopyClosed: f.canopyClosed, truth: parseTruthCsv(readFileSync(at(dir, f.truth), "utf8")) };
}

/** A detection as a plant: one view, its row status as found (the run tags it against the fixture's rows). */
export const asPlant = (d: FrameDetection | GroundPlant): GroundPlant => ({ ...d, seenIn: "seenIn" in d && d.seenIn ? d.seenIn : [d.frame], duplicates: "duplicates" in d ? d.duplicates : 0 });

// ------------------------------------------------------------- the map's pixels

/** The raster cut to a rectangle at its own zoom; outside it is transparent. */
export function sliceRaster(r: Raster, gx: number, gy: number, w: number, h: number): PhotoPixels {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = gy + y - r.top;
    if (sy < 0 || sy >= r.height) continue;
    const x0 = Math.max(0, r.left - gx), x1 = Math.min(w, r.left + r.width - gx);
    if (x1 <= x0) continue;
    const s = (sy * r.width + (gx + x0 - r.left)) * 4;
    out.set(r.rgba.subarray(s, s + (x1 - x0) * 4), (y * w + x0) * 4);
  }
  return { width: w, height: h, rgba: out };
}

/** The raster at a coarser zoom: each pixel the mean of the opaque pixels it covers (a box filter); transparent when none. */
export function downsample(r: Raster, z: number): Raster {
  const f = 2 ** (r.z - z);
  if (f === 1) return r;
  if (!Number.isInteger(f) || f < 1) throw new Error(`cannot draw zoom ${z} from a zoom ${r.z} raster`);
  const left = Math.floor(r.left / f), top = Math.floor(r.top / f);
  const width = Math.ceil((r.left + r.width) / f) - left, height = Math.ceil((r.top + r.height) / f) - top;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const sx = (left + x) * f + dx - r.left, sy = (top + y) * f + dy - r.top;
      if (sx < 0 || sy < 0 || sx >= r.width || sy >= r.height) continue;
      const o = (sy * r.width + sx) * 4;
      if (r.rgba[o + 3] === 0) continue;
      n++; sr += r.rgba[o]; sg += r.rgba[o + 1]; sb += r.rgba[o + 2];
    }
    if (!n) continue;
    const o = (y * width + x) * 4;
    rgba[o] = sr / n; rgba[o + 1] = sg / n; rgba[o + 2] = sb / n; rgba[o + 3] = 255;
  }
  return { z, left, top, width, height, rgba };
}

/** readStage1's `draw` from a raster: the map's tiles at the read zoom without a browser. */
export function drawFrom(r: Raster) {
  const byZ = new Map<number, Raster>([[r.z, r]]);
  return async (_tile: unknown, z: number, gx: number, gy: number, w: number, h: number): Promise<PhotoPixels | null> => {
    if (z > r.z) return null;
    if (!byZ.has(z)) byZ.set(z, downsample(r, z));
    return sliceRaster(byZ.get(z)!, gx, gy, w, h);
  };
}

// ------------------------------------------------------------- GeoTIFF

/** WGS 84 lat/lng to UTM easting and northing (Snyder 1987, eqs. 8-9 and 8-10; under a millimetre near the zone's meridian). */
export function utmOf(lat: number, lng: number, zone: number, south: boolean): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lng * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [500000 + x, south ? y + 10000000 : y];
}

/** A lat/lng to the GeoTIFF's own coordinates, by its EPSG code. */
export function projectorFor(epsg: number): (q: LatLng2) => [number, number] {
  if (epsg === 4326) return q => [q.lng, q.lat];
  if (epsg === 3857 || epsg === 900913) return q => [(q.lng * Math.PI * 6378137) / 180, 6378137 * Math.log(Math.tan(Math.PI / 4 + (q.lat * Math.PI) / 360))];
  if (epsg >= 32601 && epsg <= 32660) return q => utmOf(q.lat, q.lng, epsg - 32600, false);
  if (epsg >= 32701 && epsg <= 32760) return q => utmOf(q.lat, q.lng, epsg - 32700, true);
  throw new Error(`GeoTIFF in EPSG:${epsg}: only 4326, 3857 and WGS 84 UTM (326xx, 327xx) are read; reproject it first (gdalwarp -t_srs EPSG:3857)`);
}

/**
 * A GeoTIFF onto Web Mercator pixels at the zoom nearest its own pixel (never finer), over the ring's extent. Bands 1 to
 * 3 are red, green and blue; a fourth band is alpha; a pixel that is zero in every band is no data. Each output pixel is
 * the mean of up to 4 x 4 samples across it, so a coarser read does not alias.
 */
export async function rasterFromGeoTiff(file: string, ring: LatLng2[]): Promise<Raster> {
  const { fromArrayBuffer } = await import("geotiff");
  const buf = readFileSync(file);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage();
  const keys = img.getGeoKeys() as Record<string, number>;
  const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 4326;
  const proj = projectorFor(epsg);
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
  const W = img.getWidth(), H = img.getHeight(), bands = img.getSamplesPerPixel();
  const lat = ring.reduce((s, q) => s + q.lat, 0) / ring.length;
  // The tiff's pixel on the ground, metres (degrees converted at the field's latitude).
  const groundM = epsg === 4326 ? Math.abs(rx) * 111320 * Math.cos((lat * Math.PI) / 180) : epsg === 3857 ? Math.abs(rx) * Math.cos((lat * Math.PI) / 180) : Math.abs(rx);
  let z = 23;
  while (z > 14 && metresPerPixel(lat, z) < groundM * 0.999) z--;
  const px = ring.map(q => mercatorPx(q.lat, q.lng, z));
  const left = Math.floor(Math.min(...px.map(p => p[0]))) - 2, top = Math.floor(Math.min(...px.map(p => p[1]))) - 2;
  const width = Math.ceil(Math.max(...px.map(p => p[0]))) + 2 - left, height = Math.ceil(Math.max(...px.map(p => p[1]))) + 2 - top;
  // The tiff's window that covers the extent, read once.
  const corners = [[left, top], [left + width, top], [left + width, top + height], [left, top + height]].map(([X, Y]) => proj(latLngOfPx(X, Y, z))).map(([e, n]) => [(e - ox) / rx, (n - oy) / ry]);
  const wx0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c[0]))) - 1), wy0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c[1]))) - 1);
  const wx1 = Math.min(W, Math.ceil(Math.max(...corners.map(c => c[0]))) + 1), wy1 = Math.min(H, Math.ceil(Math.max(...corners.map(c => c[1]))) + 1);
  if (wx1 <= wx0 || wy1 <= wy0) throw new Error("the GeoTIFF does not cover the field ring");
  const data = await img.readRasters({ interleave: true, window: [wx0, wy0, wx1, wy1] }) as unknown as ArrayLike<number>;
  const ww = wx1 - wx0;
  const max = img.getBitsPerSample() > 8 ? 65535 : 255;
  const k = Math.min(4, Math.max(1, Math.round(metresPerPixel(lat, z) / groundM)));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
      const [e, nn] = proj(latLngOfPx(left + x + (sx + 0.5) / k, top + y + (sy + 0.5) / k, z));
      const tx = Math.floor((e - ox) / rx) - wx0, ty = Math.floor((nn - oy) / ry) - wy0;
      if (tx < 0 || ty < 0 || tx >= ww || ty >= wy1 - wy0) continue;
      const o = (ty * ww + tx) * bands;
      const r = data[o], g = data[o + 1], b = data[o + 2], a = bands >= 4 ? data[o + 3] : max;
      if (a === 0 || (r === 0 && g === 0 && b === 0)) continue;
      n++; sr += r; sg += g; sb += b;
    }
    if (!n) continue;
    const o = (y * width + x) * 4, s = 255 / max;
    rgba[o] = (sr / n) * s; rgba[o + 1] = (sg / n) * s; rgba[o + 2] = (sb / n) * s; rgba[o + 3] = 255;
  }
  return { z, left, top, width, height, rgba };
}

// ------------------------------------------------------------- rows from three clicks

/**
 * The planting layout fitted from the operator's three clicks (two neighbours in one row, one in the next row), as the
 * app fits it (layout/plantingLayout.ts, driven the way scripts/bench/layoutTrial.ts drives it), at the read zoom.
 */
export function rowsFromClicks(raster: Raster, ring: LatLng2[], clicks: LatLng2[]): FieldRows | null {
  if (clicks.length !== 3) throw new Error("rows from clicks: exactly three clicks");
  const lat = ring.reduce((s, q) => s + q.lat, 0) / ring.length;
  const plan = fieldReadPlan([ring], raster.z, lat);
  if (!plan) return null;
  const r = downsample(raster, plan.z);
  const px: PhotoPixels = sliceRaster(r, plan.left, plan.top, plan.width, plan.height);
  const k = Math.max(1, Math.round(0.08 / plan.mpp));
  const ringPx = ring.map(q => mercatorPx(q.lat, q.lng, plan.z) as [number, number]);
  const lr = rasterFromMask(vegetationMask(px), px.width, px.height, k, plan.z, plan.left, plan.top, plan.mpp, [ringPx], shadowMask(px), coverMask(px));
  const toR = (q: LatLng2): [number, number] => { const [X, Y] = mercatorPx(q.lat, q.lng, plan.z); return [(X - plan.left) / k, (Y - plan.top) / k]; };
  const c = clicks.map(toR);
  const L0 = latticeFromClicks(c[0], c[1], c[2]);
  if (!L0) return null;
  return layoutsToFieldRows(fitLayoutAll(L0, lr, c), lr);
}

// ------------------------------------------------------------- the run

export type FixtureRun = { stage1: Stage1Result; grade: PressureGrade; rows: FieldRows | null };

/**
 * Stage 1 and the grade on a fixture, the way gradeField runs them in the app (pressure/pressureStore.ts), the
 * row-crop guard included: a fixture the app would refuse throws with the app's message.
 */
export async function runFixture(f: LoadedFixture): Promise<FixtureRun> {
  const refusal = pressureRefusal(f.crop, f.rows);
  if (refusal) throw new Error(`${f.name}: ${refusal}`);
  const lat = f.ring.reduce((s, q) => s + q.lat, 0) / f.ring.length;
  const stage1 = await readStage1({ rings: [f.ring], tile: () => "", maxNative: f.raster.z, lat, rows: f.rows, params: { ...DEFAULT_STAGE1, cellM: PRESSURE_CELL_M }, draw: drawFrom(f.raster) as never });
  if (!stage1) throw new Error(`${f.name}: Stage 1 read nothing (is the ring inside the raster?)`);
  // The weeds against the fixture's rows, as the store tags them.
  const plants = f.plants.map(p => (p.klass === "weed" && p.centre ? { ...p, rowStatus: f.rows ? fieldRowStatusAt(f.rows, p.centre) : "no-rows" as const } : p));
  const grade = gradePressure({
    objects: weedObjectsOf(plants), grid: stage1.grid, cells: stage1.cells, rows: f.rows, crop: f.crop,
    group: f.group ?? cropGroupOf(f.crop, f.rows?.source === "layout"),
    canopyClosed: f.canopyClosed !== undefined ? f.canopyClosed : canopyClosedOf(stage1.cells), photoBased: f.photoBased,
  });
  return { stage1, grade, rows: f.rows };
}
