// DJI Agras SD-card package: a `DJI/` folder holding the field boundary as a
// shapefile and the variable-rate prescription as a georeferenced raster.
//
//   DJI/
//   ├── Shapefile/  field_boundary.shp .shx .dbf .prj
//   └── Rx/         spot_treatment.tiff .tfw
//
// WHAT IS AND IS NOT CONFIRMED
// ----------------------------
// Confirmed by DJI's own support docs and independently by PIX4Dfields and
// Agremo, who both ship into this same pathway:
//   - the DJI/Shapefile + DJI/Rx layout, unzipped onto the card
//   - the shapefile carries the BOUNDARY; the per-zone rates live in the raster
//   - on the controller: Map Source = "Other", Source Unit = "ha" regardless of
//     the units you actually authored in, plus a Max/Average resample choice
//   - prescription uploads are capped at 10 MB, and long filenames cause trouble
//
// NOT published by DJI anywhere we could find:
//   - any .dbf attribute schema. We therefore keep the attribute table minimal
//     and self-describing rather than inventing field names; a reader that
//     ignores our columns still gets valid geometry, which is what it reads.
//   - the raster's bit depth. Single-band numeric is a strong inference — the
//     controller asks for a *unit* and offers *Average* resampling, neither of
//     which is meaningful over a legend-mapped RGB image — but float32 vs
//     scaled-integer is unverified. `writeGeoTiffFloat32` is the place to change
//     if hardware testing says otherwise, and `rxExtension` covers .tiff/.tif.
import {
  M_PER_DEG_LAT, bboxOfRings, mPerDegLng, pointInAnyRing, pointInRing,
  ringsAreaM2, type LatLng2,
} from "./geo";
import {
  readDbf, readPolygonShapefile, writePolygonShapefile,
  type DbfField, type ShpFeature,
} from "./shapefile";
import { readGeoTiffFloat32, writeGeoTiffFloat32, type GeoRasterSpec } from "./geotiff";
import { zipSync } from "fflate";

/**
 * The unit the Rx raster values are written in.
 *
 * SAFETY-RELEVANT. The raster does not describe its own unit — the Agras
 * operator picks one on the controller at import time. If they pick something
 * other than this, the field is mis-dosed and nothing warns them: the import
 * succeeds, the aircraft flies, and the rate is wrong. Every surface that hands
 * a grower this package must state the unit and the controller settings, so
 * these constants exist to keep the UI, the docs and the exporter from drifting
 * apart.
 */
export const RX_RATE_UNIT = "L/ha";

/** What the operator must select on the controller. Corroborated by PIX4D. */
export const AGRAS_IMPORT_STEPS = {
  mapSource: "Other",
  sourceUnit: "ha",
  note: `Rates are written in ${RX_RATE_UNIT}. Selecting a different source unit on the controller will mis-dose the field without any warning.`,
} as const;

/**
 * What a pixel value MEANS in the Rx raster.
 *
 * There are three genuinely different states a cell can be in, and conflating
 * any two of them is a real agronomic error rather than a formatting choice:
 *
 *   NoData  — this cell is not part of the prescription. Not applicable.
 *   0       — this cell IS part of the prescription, and the rate is zero.
 *             An explicit instruction: fly it, do not spray it.
 *   > 0     — apply at this rate, in L/ha.
 *
 * We previously declared a NoData sentinel of -9999 and then never wrote it,
 * so 0 silently carried both of the first two meanings — outside-the-field and
 * inside-but-untreated were the same number. That is exactly the accidental
 * semantics this type exists to prevent.
 *
 * WHICH ONE DJI WANTS IS UNTESTED. Both policies are implemented and neither is
 * asserted to be correct:
 *
 * `zero-untreated` (default) — every cell in the raster is a real rate, most of
 *   them 0, and NO NoData value is declared. Chosen as the default purely on
 *   risk asymmetry: if the controller ignores GDAL_NODATA, a -9999 cell is read
 *   as a rate, and a large negative rate is an unknown failure mode in the
 *   field. A 0 cell degrades to "don't spray" under every interpretation.
 *
 * `nodata-outside` — -9999 outside the field boundary, 0 inside the boundary
 *   but outside every zone, rate inside zones. Strictly more informative and
 *   the semantically correct answer if the controller honours NoData.
 *
 * Flip the default only once a captured package or a hardware test says which
 * the aircraft actually expects.
 */
export type PrescriptionFill = "zero-untreated" | "nodata-outside";

/** Sentinel used by `nodata-outside`. Never written under `zero-untreated`. */
export const RX_NODATA = -9999;

/** A treatment zone with the numeric dose the Rx raster is built from. */
export type RateZone = {
  id: string;
  ring: LatLng2[];
  /** Target application rate, litres per hectare. */
  rateLha: number;
};

export type AgrasPackageInput = {
  boundary: LatLng2[][];
  zones: RateZone[];
  /** Ground resolution to aim for, metres per pixel. Coarsened if too large. */
  targetResolutionM?: number;
  /** Stamped into the .dbf date header. Injectable so tests stay deterministic. */
  when?: Date;
  /** Raster extension. See RxExtension — defaults to the observed `.tiff`. */
  rxExtension?: RxExtension;
  /** Pixel-value semantics. See PrescriptionFill — defaults to `zero-untreated`. */
  fill?: PrescriptionFill;
};

export type AgrasPackage = {
  zip: Blob;
  files: Record<string, Uint8Array>;
  /** What the raster ended up as, after any coarsening for the size cap. */
  raster: { width: number; height: number; resolutionM: number; bytes: number };
  verification: AgrasVerification;
};

// DJI caps prescription uploads at 10 MB. float32 is 4 bytes per pixel, so this
// pixel budget leaves comfortable headroom for headers and the shapefile.
const MAX_RASTER_PIXELS = 2_000_000;

const SHAPE_BASENAME = "field_boundary";
const RX_BASENAME = "spot_treatment";

/**
 * Raster extension for the Rx map.
 *
 * `.tiff`, not `.tif`. The generic world-file convention derives the sidecar
 * name from the first, last and trailing letters of the raster extension, which
 * would pair `.tiff` with `.tfwf` rather than `.tfw` — that argues for `.tif`
 * in the abstract, and we shipped `.tif` on exactly that reasoning.
 *
 * It was the wrong call. Two independent descriptions of THIS pathway — the
 * original DJI folder spec and PIX4Dfields, who ship into it successfully —
 * both say `.tiff` alongside `.tfw`. Vendor importers routinely match a literal
 * basename instead of implementing the generic rule, so the abstract convention
 * loses to two observations of the concrete one.
 *
 * Still unsettled until a real captured package is diffed against ours, hence
 * `rxExtension` on the input rather than a bare constant.
 */
export type RxExtension = "tiff" | "tif";
const DEFAULT_RX_EXTENSION: RxExtension = "tiff";

/**
 * Attribute schema for the boundary shapefile.
 *
 * DJI publishes no required field list, so this is deliberately minimal and
 * descriptive rather than a guess at internal column names: an id, a type code
 * separating the outer boundary from any exclusion polygon, and the polygon
 * area. A reader that only wants geometry ignores all three.
 */
const BOUNDARY_FIELDS: DbfField[] = [
  { name: "ID", type: "N", length: 10, decimals: 0 },
  { name: "TYPE", type: "C", length: 16 },
  { name: "AREA_HA", type: "N", length: 16, decimals: 4 },
];

export type AgrasVerification = {
  boundaryAreaM2Source: number;
  boundaryAreaM2Readback: number;
  boundaryAreaErrorPct: number;
  rasterExtent: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  boundaryExtent: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  epsg: number | null;
  zoneCount: number;
  treatedPixelCount: number;
  rateRange: { min: number; max: number };
  /** Pixel-value semantics actually written. */
  fill: PrescriptionFill;
  /** Declared GDAL_NODATA, or null when the raster declares none. */
  declaredNoData: number | null;
  /** Every distinct pixel value and how many cells carry it, rate-ascending. */
  valueHistogram: { value: number; count: number }[];
  untreatedPixelCount: number;
  noDataPixelCount: number;
};

/**
 * Choose a raster grid covering the boundary, at the requested ground
 * resolution or the finest resolution that fits the pixel budget.
 *
 * The grid is defined in degrees because the output CRS is EPSG:4326, but the
 * pixel size in each axis is derived from metres so cells stay square ON THE
 * GROUND. A single degree-valued pixel size would be badly non-square at any
 * farming latitude — a 1 m cell is ~1.4× wider in longitude at 45°N.
 */
function planGrid(boundary: LatLng2[][], targetResolutionM: number) {
  const bb = bboxOfRings(boundary);
  const midLat = (bb.minLat + bb.maxLat) / 2;
  const mPerLng = mPerDegLng(midLat);
  const widthM = Math.max(1, (bb.maxLng - bb.minLng) * mPerLng);
  const heightM = Math.max(1, (bb.maxLat - bb.minLat) * M_PER_DEG_LAT);

  let res = Math.max(0.1, targetResolutionM);
  if ((widthM / res) * (heightM / res) > MAX_RASTER_PIXELS) {
    res = Math.sqrt((widthM * heightM) / MAX_RASTER_PIXELS);
  }

  const pixelWidthDeg = res / mPerLng;
  const pixelHeightDeg = res / M_PER_DEG_LAT;
  // One cell of padding on each side so boundary-edge zones are not clipped by
  // the raster itself rounding down.
  const width = Math.ceil(widthM / res) + 2;
  const height = Math.ceil(heightM / res) + 2;

  return {
    width, height, resolutionM: res, pixelWidthDeg, pixelHeightDeg,
    originLng: bb.minLng - pixelWidthDeg,
    originLat: bb.maxLat + pixelHeightDeg,
    bbox: bb,
  };
}

/**
 * Burn zone rates into the grid. A pixel takes a rate only where its centre is
 * inside both a zone and the field boundary — the boundary is the hard no-fly
 * perimeter, so anything outside it must read as zero regardless of zone shape.
 *
 * Overlapping zones resolve to the HIGHER rate. Both zones were flagged as
 * needing treatment, and the controller's own overlap handling offers the same
 * Max choice, so under-dosing an overlap would silently contradict the plan.
 */
function rasterizeZones(
  grid: ReturnType<typeof planGrid>,
  boundary: LatLng2[][],
  zones: RateZone[],
  fill: PrescriptionFill,
): { pixels: Float32Array; treated: number; untreated: number; noData: number; min: number; max: number } {
  const pixels = new Float32Array(grid.width * grid.height);

  if (fill === "nodata-outside") {
    // Start everything as "not part of the prescription", then promote cells
    // inside the field to an explicit zero. This is the only pass that has to
    // touch every cell, which is why the other policy skips it entirely.
    pixels.fill(RX_NODATA);
    for (let y = 0; y < grid.height; y++) {
      const lat = grid.originLat - (y + 0.5) * grid.pixelHeightDeg;
      for (let x = 0; x < grid.width; x++) {
        const lng = grid.originLng + (x + 0.5) * grid.pixelWidthDeg;
        if (pointInAnyRing({ lat, lng }, boundary)) pixels[y * grid.width + x] = 0;
      }
    }
  }
  // Under "zero-untreated" the Float32Array is already zero-filled, and zero is
  // the intended meaning for every cell we do not burn a rate into.

  for (const zone of zones) {
    if (!(zone.rateLha > 0) || zone.ring.length < 3) continue;
    const zb = bboxOfRings([zone.ring]);
    // Only walk the zone's own bounding box, not the whole field.
    const x0 = Math.max(0, Math.floor((zb.minLng - grid.originLng) / grid.pixelWidthDeg));
    const x1 = Math.min(grid.width - 1, Math.ceil((zb.maxLng - grid.originLng) / grid.pixelWidthDeg));
    const y0 = Math.max(0, Math.floor((grid.originLat - zb.maxLat) / grid.pixelHeightDeg));
    const y1 = Math.min(grid.height - 1, Math.ceil((grid.originLat - zb.minLat) / grid.pixelHeightDeg));

    for (let y = y0; y <= y1; y++) {
      const lat = grid.originLat - (y + 0.5) * grid.pixelHeightDeg;
      for (let x = x0; x <= x1; x++) {
        const lng = grid.originLng + (x + 0.5) * grid.pixelWidthDeg;
        const pt = { lat, lng };
        if (!pointInRing(pt, zone.ring)) continue;
        // The boundary is the hard perimeter: a zone spilling outside it must
        // not produce a rate, under either fill policy.
        if (!pointInAnyRing(pt, boundary)) continue;
        const i = y * grid.width + x;
        // Overlapping zones resolve to the HIGHER rate. Both were flagged as
        // needing treatment and the controller offers the same Max choice, so
        // under-dosing an overlap would silently contradict the plan.
        const current = pixels[i] === RX_NODATA ? 0 : pixels[i];
        if (zone.rateLha > current) pixels[i] = zone.rateLha;
      }
    }
  }

  let treated = 0, untreated = 0, noData = 0, min = Infinity, max = 0;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    if (v === RX_NODATA && fill === "nodata-outside") { noData++; continue; }
    if (v > 0) { treated++; if (v < min) min = v; if (v > max) max = v; }
    else untreated++;
  }
  return { pixels, treated, untreated, noData, min: treated ? min : 0, max };
}

/**
 * Build the DJI Agras package and verify it by reading it back.
 *
 * Verification is not "the files exist": the shapefile is re-parsed and its
 * polygon area compared against the source boundary, and the raster is
 * re-parsed and its georeferenced extent compared against the boundary extent.
 * A mismatch throws rather than handing the farmer a package that will fail
 * silently on the aircraft.
 */
export function buildAgrasPackage(input: AgrasPackageInput): AgrasPackage {
  const { boundary, zones } = input;
  if (!boundary?.length) throw new Error("Agras export: no field boundary");
  if (!zones.length) throw new Error("Agras export: no treatment zones");

  const bad = zones.filter(z => !(z.rateLha > 0));
  if (bad.length === zones.length) {
    throw new Error("Agras export: every zone has a zero application rate — set a rate before exporting");
  }

  const rxExt = input.rxExtension ?? DEFAULT_RX_EXTENSION;
  const fill: PrescriptionFill = input.fill ?? "zero-untreated";
  const grid = planGrid(boundary, input.targetResolutionM ?? 1);
  const burn = rasterizeZones(grid, boundary, zones, fill);
  if (burn.treated === 0) {
    throw new Error(
      "Agras export: no raster cell fell inside both a zone and the boundary — " +
      "the prescription would be empty",
    );
  }

  const features: ShpFeature[] = boundary.map((ring, i) => ({
    ring,
    attrs: {
      ID: i,
      // Only outer boundary parts exist today. When exclusion polygons are
      // added to the mission model they become additional features with a
      // different TYPE here rather than a second file.
      TYPE: "boundary",
      AREA_HA: ringsAreaM2([ring]) / 10_000,
    },
  }));
  const shape = writePolygonShapefile(features, BOUNDARY_FIELDS, input.when);

  const rasterSpec: GeoRasterSpec = {
    width: grid.width,
    height: grid.height,
    pixels: burn.pixels,
    originLng: grid.originLng,
    originLat: grid.originLat,
    pixelWidthDeg: grid.pixelWidthDeg,
    pixelHeightDeg: grid.pixelHeightDeg,
    // Declared ONLY when the raster actually contains the sentinel. Under
    // "zero-untreated" every cell is a real rate and no NoData tag is written,
    // so a reader can never mistake an ordinary 0 for an absence.
    noData: fill === "nodata-outside" ? RX_NODATA : undefined,
  };
  const rx = writeGeoTiffFloat32(rasterSpec);

  const files: Record<string, Uint8Array> = {
    [`DJI/Shapefile/${SHAPE_BASENAME}.shp`]: shape.shp,
    [`DJI/Shapefile/${SHAPE_BASENAME}.shx`]: shape.shx,
    [`DJI/Shapefile/${SHAPE_BASENAME}.dbf`]: shape.dbf,
    [`DJI/Shapefile/${SHAPE_BASENAME}.prj`]: shape.prj,
    [`DJI/Rx/${RX_BASENAME}.${rxExt}`]: rx.tiff,
    [`DJI/Rx/${RX_BASENAME}.tfw`]: new TextEncoder().encode(rx.tfw),
  };

  const verification = verifyAgrasPackage(files, boundary, zones, rxExt, fill);

  return {
    // Flat slash-separated keys rather than a nested object: fflate's nested
    // form adds standalone directory entries, and the card wants exactly the
    // six files under DJI/Shapefile and DJI/Rx.
    zip: new Blob([zipSync(files) as unknown as BlobPart], { type: "application/zip" }),
    files,
    raster: {
      width: grid.width, height: grid.height,
      resolutionM: grid.resolutionM, bytes: rx.tiff.byteLength,
    },
    verification,
  };
}

/** Reopen the written bytes and assert they still describe the source mission. */
export function verifyAgrasPackage(
  files: Record<string, Uint8Array>,
  boundary: LatLng2[][],
  zones: RateZone[],
  rxExtension: RxExtension = DEFAULT_RX_EXTENSION,
  fill: PrescriptionFill = "zero-untreated",
): AgrasVerification {
  const shp = files[`DJI/Shapefile/${SHAPE_BASENAME}.shp`];
  const dbf = files[`DJI/Shapefile/${SHAPE_BASENAME}.dbf`];
  const tif = files[`DJI/Rx/${RX_BASENAME}.${rxExtension}`];
  if (!shp || !dbf || !tif) throw new Error("Agras export: package is missing a required file");

  const read = readPolygonShapefile(shp);
  if (read.shapeType !== 5) throw new Error(`Agras export: shape type ${read.shapeType} is not polygon`);
  if (read.polygons.length !== boundary.length) {
    throw new Error(`Agras export: wrote ${boundary.length} boundary parts, read back ${read.polygons.length}`);
  }
  const rows = readDbf(dbf);
  if (rows.length !== boundary.length) {
    throw new Error(`Agras export: ${rows.length} attribute rows for ${boundary.length} polygons`);
  }

  const areaSource = ringsAreaM2(boundary);
  const areaReadback = ringsAreaM2(read.polygons);
  const areaErrorPct = areaSource > 0
    ? Math.abs(areaReadback - areaSource) / areaSource * 100
    : 0;
  // Ring closure adds a repeated vertex and winding may be reversed, but neither
  // changes the enclosed area. Anything above a rounding error is a real bug.
  if (areaErrorPct > 0.5) {
    throw new Error(
      `Agras export: boundary area drifted ${areaErrorPct.toFixed(2)}% on readback ` +
      `(${areaSource.toFixed(0)} m² → ${areaReadback.toFixed(0)} m²)`,
    );
  }

  const raster = readGeoTiffFloat32(tif);
  if (raster.epsg !== 4326) {
    throw new Error(`Agras export: raster declares EPSG:${raster.epsg}, expected 4326`);
  }
  const rasterExtent = {
    minLng: raster.originLng,
    maxLng: raster.originLng + raster.width * raster.pixelWidthDeg,
    maxLat: raster.originLat,
    minLat: raster.originLat - raster.height * raster.pixelHeightDeg,
  };
  const bb = bboxOfRings(boundary);
  const boundaryExtent = { minLat: bb.minLat, minLng: bb.minLng, maxLat: bb.maxLat, maxLng: bb.maxLng };
  if (
    rasterExtent.minLat > boundaryExtent.minLat || rasterExtent.maxLat < boundaryExtent.maxLat ||
    rasterExtent.minLng > boundaryExtent.minLng || rasterExtent.maxLng < boundaryExtent.maxLng
  ) {
    throw new Error("Agras export: raster extent does not cover the field boundary");
  }

  // Histogram the readback rather than trusting the burn counters — this is the
  // only place that proves the values survived the float32 round trip intact.
  const counts = new Map<number, number>();
  for (const v of raster.pixels) counts.set(v, (counts.get(v) ?? 0) + 1);
  const valueHistogram = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value - b.value);

  let treated = 0, untreated = 0, noDataCount = 0, min = Infinity, max = 0;
  for (const { value, count } of valueHistogram) {
    if (fill === "nodata-outside" && value === RX_NODATA) { noDataCount += count; continue; }
    if (value > 0) { treated += count; if (value < min) min = value; if (value > max) max = value; }
    else untreated += count;
  }
  if (treated === 0) throw new Error("Agras export: raster read back with no treated cells");

  // The declared sentinel and the policy must agree. A NoData tag on a raster
  // that never uses it is what made 0 ambiguous in the first place.
  if (fill === "nodata-outside") {
    if (raster.noData !== RX_NODATA) {
      throw new Error(`Agras export: fill is nodata-outside but raster declares NoData ${raster.noData}`);
    }
    if (noDataCount === 0) {
      throw new Error("Agras export: NoData declared but no cell carries it");
    }
  } else if (raster.noData !== null) {
    throw new Error(
      `Agras export: fill is ${fill} so no NoData should be declared, but raster declares ${raster.noData}`,
    );
  }

  return {
    boundaryAreaM2Source: areaSource,
    boundaryAreaM2Readback: areaReadback,
    boundaryAreaErrorPct: areaErrorPct,
    rasterExtent, boundaryExtent,
    epsg: raster.epsg,
    zoneCount: zones.length,
    treatedPixelCount: treated,
    rateRange: { min: treated ? min : 0, max },
    fill,
    declaredNoData: raster.noData,
    valueHistogram,
    untreatedPixelCount: untreated,
    noDataPixelCount: noDataCount,
  };
}
