// Validation suite for the DJI Agras prescription export.
//
// SCOPE: this file proves what SOFTWARE INSPECTION can prove — that the package
// we write contains the geometry, rates and georeferencing we intended, and
// that they survive a write/read round trip. It cannot and does not prove that
// an Agras controller accepts the package. Tests 5 and 6 of the validation plan
// (SD card import, on-aircraft route generation, route comparison) require
// physical hardware and are not simulated here. Nothing in this file should be
// cited as evidence of Agras compatibility.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import {
  type LatLng2, M_PER_DEG_LAT, bboxOfRings, mPerDegLng, pointInAnyRing,
  polygonAreaM2, ringsAreaM2, segSegT,
} from "@/lib/geo";
import { readDbf, readPolygonShapefile } from "@/lib/shapefile";
import { readGeoTiffFloat32, worldFile } from "@/lib/geotiff";
import { RX_NODATA, buildAgrasPackage } from "@/lib/djiAgras";

const LAT = 45;
const LNG = -93;
const WHEN = new Date(2026, 7, 19);
const SHP = "DJI/Shapefile/field_boundary.shp";
const DBF = "DJI/Shapefile/field_boundary.dbf";
const TIF = "DJI/Rx/spot_treatment.tiff";
const TFW = "DJI/Rx/spot_treatment.tfw";

/** Rectangle sized in metres, offset from the (LAT,LNG) origin in metres. */
function rectAt(eastM: number, northM: number, widthM: number, heightM: number): LatLng2[] {
  const lat = LAT + northM / M_PER_DEG_LAT;
  const lng = LNG + eastM / mPerDegLng(LAT);
  const dLat = heightM / M_PER_DEG_LAT;
  const dLng = widthM / mPerDegLng(lat);
  return [
    { lat, lng },
    { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng },
  ];
}

const centroid = (ring: LatLng2[]): LatLng2 => ({
  lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length,
  lng: ring.reduce((a, p) => a + p.lng, 0) / ring.length,
});

/** Read the raster value at a geographic point, via the GeoTIFF's own georef. */
function sampleAt(raster: ReturnType<typeof readGeoTiffFloat32>, p: LatLng2): number {
  const x = Math.floor((p.lng - raster.originLng) / raster.pixelWidthDeg);
  const y = Math.floor((raster.originLat - p.lat) / raster.pixelHeightDeg);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    throw new Error(`sample point falls outside the raster at (${x},${y})`);
  }
  return raster.pixels[y * raster.width + x];
}

/** True when any two non-adjacent edges of the ring cross. */
function selfIntersects(ring: LatLng2[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;          // shared closing vertex
      const t = segSegT(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]);
      if (t != null) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// TEST 1 — Multi-rate prescription
// ---------------------------------------------------------------------------
describe("Test 1 · multi-rate prescription survives export", () => {
  // 600 m x 400 m field, four well-separated 100 m x 100 m zones.
  const FIELD = rectAt(0, 0, 600, 400);
  const ZONES = [
    { id: "A", ring: rectAt(50, 50, 100, 100), rateLha: 5 },
    { id: "B", ring: rectAt(250, 50, 100, 100), rateLha: 10 },
    { id: "C", ring: rectAt(450, 50, 100, 100), rateLha: 15 },
    { id: "D", ring: rectAt(250, 250, 100, 100), rateLha: 25 },
  ];
  const pkg = buildAgrasPackage({ boundary: [FIELD], zones: ZONES, when: WHEN });
  const raster = readGeoTiffFloat32(pkg.files[TIF]);

  it("reports the raster's full inventory", () => {
    const v = pkg.verification;
    const report = {
      uniqueValues: v.valueHistogram.map(h => h.value),
      counts: Object.fromEntries(v.valueHistogram.map(h => [h.value, h.count])),
      extent: v.rasterExtent,
      crs: `EPSG:${raster.epsg}`,
      pixelSizeDeg: { x: raster.pixelWidthDeg, y: raster.pixelHeightDeg },
      pixelSizeM: pkg.raster.resolutionM,
      noData: v.declaredNoData,
      fill: v.fill,
      dimensions: `${raster.width}x${raster.height}`,
    };
    // Printed so the numbers are visible in CI output, not just asserted.
    console.log("TEST 1 raster inventory:\n" + JSON.stringify(report, null, 2));
    expect(report.crs).toBe("EPSG:4326");
  });

  it("contains every intended rate, and no invented ones", () => {
    const values = pkg.verification.valueHistogram.map(h => h.value).sort((a, b) => a - b);
    expect(values).toEqual([0, 5, 10, 15, 25]);
  });

  it("does not round, quantise or merge any rate", () => {
    for (const z of ZONES) {
      const hit = pkg.verification.valueHistogram.find(h => h.value === z.rateLha);
      expect(hit, `rate ${z.rateLha} missing entirely`).toBeDefined();
      // 100 m x 100 m at ~1 m/px, allowing for edge sampling.
      expect(hit!.count).toBeGreaterThan(9_000);
      expect(hit!.count).toBeLessThan(11_000);
    }
  });

  it("places each rate at the correct geographic location", () => {
    for (const z of ZONES) {
      expect(sampleAt(raster, centroid(z.ring)), `zone ${z.id} centroid`).toBe(z.rateLha);
    }
    // And the gaps between zones are genuinely untreated, not bleeding.
    expect(sampleAt(raster, { lat: LAT + 200 / M_PER_DEG_LAT, lng: LNG + 200 / mPerDegLng(LAT) })).toBe(0);
  });

  it("keeps the raster aligned to the field boundary", () => {
    const { rasterExtent: r, boundaryExtent: b } = pkg.verification;
    expect(r.minLat).toBeLessThanOrEqual(b.minLat);
    expect(r.maxLat).toBeGreaterThanOrEqual(b.maxLat);
    expect(r.minLng).toBeLessThanOrEqual(b.minLng);
    expect(r.maxLng).toBeGreaterThanOrEqual(b.maxLng);
    // Padding is exactly the one cell planGrid adds, not an accidental drift.
    expect((b.minLng - r.minLng) / raster.pixelWidthDeg).toBeCloseTo(1, 3);
    expect((r.maxLat - b.maxLat) / raster.pixelHeightDeg).toBeCloseTo(1, 3);
  });

  it("treats only the zone area, so rates did not leak across the field", () => {
    const treatedM2 = pkg.verification.treatedPixelCount * pkg.raster.resolutionM ** 2;
    expect(treatedM2).toBeGreaterThan(4 * 100 * 100 * 0.95);
    expect(treatedM2).toBeLessThan(4 * 100 * 100 * 1.05);
  });
});

// ---------------------------------------------------------------------------
// TEST 2 — Zero and NoData semantics
// ---------------------------------------------------------------------------
describe("Test 2 · zero and NoData carry distinct, deliberate meanings", () => {
  // A field narrower than its own bounding box guarantees cells outside the
  // boundary but inside the raster — the only place NoData can legitimately go.
  const FIELD: LatLng2[] = [
    ...rectAt(0, 0, 300, 400).slice(0, 2),
    { lat: LAT + 400 / M_PER_DEG_LAT, lng: LNG + 150 / mPerDegLng(LAT) },
  ];
  const ZONES = [{ id: "A", ring: rectAt(80, 40, 80, 80), rateLha: 20 }];

  it("default policy declares NO NoData, because it writes none", () => {
    const pkg = buildAgrasPackage({ boundary: [FIELD], zones: ZONES, when: WHEN });
    const raster = readGeoTiffFloat32(pkg.files[TIF]);
    expect(pkg.verification.fill).toBe("zero-untreated");
    expect(raster.noData).toBeNull();
    expect(pkg.verification.declaredNoData).toBeNull();
    // Every cell is a real rate. Nothing is a sentinel.
    expect(pkg.verification.valueHistogram.every(h => h.value >= 0)).toBe(true);
    expect(pkg.verification.noDataPixelCount).toBe(0);
  });

  it("nodata-outside emits all three states, and keeps them distinct", () => {
    const pkg = buildAgrasPackage({
      boundary: [FIELD], zones: ZONES, when: WHEN, fill: "nodata-outside",
    });
    const raster = readGeoTiffFloat32(pkg.files[TIF]);
    const v = pkg.verification;

    expect(raster.noData).toBe(RX_NODATA);
    expect(v.noDataPixelCount).toBeGreaterThan(0);      // outside the field
    expect(v.untreatedPixelCount).toBeGreaterThan(0);   // inside, no zone
    expect(v.treatedPixelCount).toBeGreaterThan(0);     // inside a zone

    const values = v.valueHistogram.map(h => h.value).sort((a, b) => a - b);
    expect(values).toEqual([RX_NODATA, 0, 20]);
    console.log("TEST 2 histogram:\n" + JSON.stringify(v.valueHistogram, null, 2));
  });

  it("puts each state exactly where its meaning says it should be", () => {
    const pkg = buildAgrasPackage({
      boundary: [FIELD], zones: ZONES, when: WHEN, fill: "nodata-outside",
    });
    const raster = readGeoTiffFloat32(pkg.files[TIF]);

    // Inside a zone → the rate.
    expect(sampleAt(raster, centroid(ZONES[0].ring))).toBe(20);
    // Inside the field, outside every zone → explicitly untreated.
    const inField = { lat: LAT + 30 / M_PER_DEG_LAT, lng: LNG + 40 / mPerDegLng(LAT) };
    expect(pointInAnyRing(inField, [FIELD])).toBe(true);
    expect(sampleAt(raster, inField)).toBe(0);
    // Outside the field entirely → not part of the prescription.
    const outField = { lat: LAT + 380 / M_PER_DEG_LAT, lng: LNG + 280 / mPerDegLng(LAT) };
    expect(pointInAnyRing(outField, [FIELD])).toBe(false);
    expect(sampleAt(raster, outField)).toBe(RX_NODATA);
  });

  it("refuses to declare a sentinel it does not write, in either direction", () => {
    // This is the bug the policy exists to prevent: a decorative NoData tag on a
    // raster where 0 silently means both "untreated" and "not applicable".
    const zeroFill = buildAgrasPackage({ boundary: [FIELD], zones: ZONES, when: WHEN });
    expect(readGeoTiffFloat32(zeroFill.files[TIF]).noData).toBeNull();

    const nodataFill = buildAgrasPackage({
      boundary: [FIELD], zones: ZONES, when: WHEN, fill: "nodata-outside",
    });
    const r = readGeoTiffFloat32(nodataFill.files[TIF]);
    expect(r.noData).toBe(RX_NODATA);
    expect(Array.from(r.pixels).includes(RX_NODATA)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 3 — Boundary / raster alignment
// ---------------------------------------------------------------------------
describe("Test 3 · boundary and raster stay aligned", () => {
  const FIELD = rectAt(0, 0, 500, 300);
  // Zones deliberately pushed against different edges of the field.
  const ZONES = [
    { id: "NW", ring: rectAt(10, 220, 70, 70), rateLha: 8 },
    { id: "SE", ring: rectAt(420, 10, 70, 70), rateLha: 18 },
    { id: "MID", ring: rectAt(215, 115, 70, 70), rateLha: 12 },
  ];
  const pkg = buildAgrasPackage({ boundary: [FIELD], zones: ZONES, when: WHEN });
  const raster = readGeoTiffFloat32(pkg.files[TIF]);

  it("covers every prescription cell with room to spare", () => {
    for (const z of ZONES) {
      const zb = bboxOfRings([z.ring]);
      const { rasterExtent: r } = pkg.verification;
      expect(zb.minLat).toBeGreaterThan(r.minLat);
      expect(zb.maxLat).toBeLessThan(r.maxLat);
      expect(zb.minLng).toBeGreaterThan(r.minLng);
      expect(zb.maxLng).toBeLessThan(r.maxLng);
    }
  });

  it("does not shift relative to the shapefile", () => {
    const shpBox = readPolygonShapefile(pkg.files[SHP]).bbox;
    const fieldBox = bboxOfRings([FIELD]);
    // The shapefile header bbox must match the source geometry to full double
    // precision — any drift here would move the raster relative to the boundary.
    expect(shpBox.minX).toBeCloseTo(fieldBox.minLng, 12);
    expect(shpBox.maxX).toBeCloseTo(fieldBox.maxLng, 12);
    expect(shpBox.minY).toBeCloseTo(fieldBox.minLat, 12);
    expect(shpBox.maxY).toBeCloseTo(fieldBox.maxLat, 12);
  });

  it("puts every zone's sampled rate at its own centroid, with no offset", () => {
    for (const z of ZONES) {
      expect(sampleAt(raster, centroid(z.ring)), `zone ${z.id}`).toBe(z.rateLha);
    }
  });

  it("keeps the .tfw and the GeoTIFF tiepoint consistent under their conventions", () => {
    const tfw = new TextDecoder().decode(pkg.files[TFW]).trim().split("\n").map(Number);
    const [a, d, b, e, c, f] = tfw;
    expect(d).toBe(0);
    expect(b).toBe(0);
    expect(a).toBeCloseTo(raster.pixelWidthDeg, 12);
    expect(e).toBeCloseTo(-raster.pixelHeightDeg, 12);
    // ModelTiepointTag = outer corner (PixelIsArea). World file = pixel centre.
    // They must differ by exactly half a pixel, in both axes, in the right sign.
    expect(c - raster.originLng).toBeCloseTo(raster.pixelWidthDeg / 2, 12);
    expect(raster.originLat - f).toBeCloseTo(raster.pixelHeightDeg / 2, 12);
  });

  it("produces a visual diagnostic of boundary over prescription", () => {
    const COLS = 72, ROWS = 26;
    const { rasterExtent: r } = pkg.verification;
    const symbols = new Map<number, string>([[8, "a"], [12, "b"], [18, "c"]]);

    const grid: string[][] = [];
    const inside: boolean[][] = [];
    for (let row = 0; row < ROWS; row++) {
      grid.push([]); inside.push([]);
      const lat = r.maxLat - ((row + 0.5) / ROWS) * (r.maxLat - r.minLat);
      for (let col = 0; col < COLS; col++) {
        const lng = r.minLng + ((col + 0.5) / COLS) * (r.maxLng - r.minLng);
        const v = sampleAt(raster, { lat, lng });
        const isIn = pointInAnyRing({ lat, lng }, [FIELD]);
        inside[row].push(isIn);
        grid[row].push(v > 0 ? (symbols.get(v) ?? "?") : isIn ? "·" : " ");
      }
    }
    // Outline: an inside cell with an outside (or off-grid) neighbour.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!inside[row][col] || grid[row][col] !== "·") continue;
        const edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => {
          const rr = row + dr, cc = col + dc;
          return rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS || !inside[rr][cc];
        });
        if (edge) grid[row][col] = "#";
      }
    }

    const art = grid.map(r2 => r2.join("")).join("\n");
    const legend =
      "# boundary edge   · in field, untreated   (blank) outside field\n" +
      "a = 8 L/ha (NW)   b = 12 L/ha (MID)   c = 18 L/ha (SE)";
    console.log(`TEST 3 boundary over prescription:\n${art}\n${legend}`);

    // The picture must actually contain all three zones and a closed outline.
    for (const s of ["a", "b", "c", "#"]) expect(art).toContain(s);

    // Each zone symbol must sit in the correct quadrant of the diagnostic.
    const rowsOf = (s: string) => grid.flatMap((r2, i) => (r2.includes(s) ? [i] : []));
    const colsOf = (s: string) =>
      grid.flatMap(r2 => r2.flatMap((ch, i) => (ch === s ? [i] : [])));
    expect(Math.min(...rowsOf("a"))).toBeLessThan(ROWS / 2);      // NW zone is north
    expect(Math.max(...rowsOf("c"))).toBeGreaterThan(ROWS / 2);   // SE zone is south
    expect(Math.max(...colsOf("a"))).toBeLessThan(COLS / 2);      // NW zone is west
    expect(Math.min(...colsOf("c"))).toBeGreaterThan(COLS / 2);   // SE zone is east

    // Also drop an SVG next to the other scratch artefacts for eyeballing.
    const scale = 900 / (r.maxLng - r.minLng);
    const px = (lng: number) => ((lng - r.minLng) * scale).toFixed(1);
    const py = (lat: number) => ((r.maxLat - lat) * scale).toFixed(1);
    const poly = (ring: LatLng2[], fillCol: string, stroke: string) =>
      `<polygon points="${ring.map(p => `${px(p.lng)},${py(p.lat)}`).join(" ")}" ` +
      `fill="${fillCol}" stroke="${stroke}" stroke-width="2"/>`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" ` +
      `height="${((r.maxLat - r.minLat) * scale).toFixed(0)}">` +
      `<rect width="100%" height="100%" fill="#111"/>` +
      poly(FIELD, "#1b2a1b", "#4CAF50") +
      ZONES.map(z => poly(z.ring, "#ffb30055", "#ffb300")).join("") +
      `</svg>`;
    const out = path.join(os.tmpdir(), "swathwise-agras-alignment.svg");
    fs.writeFileSync(out, svg);
    console.log(`TEST 3 SVG diagnostic written to ${out}`);
    expect(fs.existsSync(out)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 4 — Multiple polygons
// ---------------------------------------------------------------------------
describe("Test 4 · a multi-part field stays multi-part", () => {
  const PARTS = [
    rectAt(0, 0, 200, 150),
    rectAt(300, 0, 150, 150),
    rectAt(0, 250, 250, 120),
  ];
  const ZONES = [
    { id: "p1", ring: rectAt(40, 40, 60, 60), rateLha: 7 },
    { id: "p2", ring: rectAt(330, 40, 60, 60), rateLha: 14 },
    { id: "p3", ring: rectAt(40, 280, 60, 60), rateLha: 21 },
  ];
  const pkg = buildAgrasPackage({ boundary: PARTS, zones: ZONES, when: WHEN });
  const read = readPolygonShapefile(pkg.files[SHP]);
  const raster = readGeoTiffFloat32(pkg.files[TIF]);

  it("preserves the polygon count — nothing merged, nothing dropped", () => {
    expect(read.polygons).toHaveLength(3);
    expect(read.shapeType).toBe(5);
  });

  it("closes every ring", () => {
    for (const ring of read.polygons) {
      expect(ring[0].lat).toBe(ring[ring.length - 1].lat);
      expect(ring[0].lng).toBe(ring[ring.length - 1].lng);
    }
  });

  it("emits valid, non-self-intersecting geometry", () => {
    for (const ring of read.polygons) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(selfIntersects(ring.slice(0, -1))).toBe(false);
    }
  });

  it("declares WGS84 on both the shapefile and the raster", () => {
    expect(new TextDecoder().decode(pkg.files["DJI/Shapefile/field_boundary.prj"]))
      .toContain("GCS_WGS_1984");
    expect(raster.epsg).toBe(4326);
  });

  it("writes one attribute record per polygon with the right area", () => {
    const rows = readDbf(pkg.files[DBF]);
    expect(rows).toHaveLength(3);
    rows.forEach((row, i) => {
      expect(row.ID).toBe(String(i));
      expect(row.TYPE).toBe("boundary");
      expect(Number(row.AREA_HA)).toBeCloseTo(polygonAreaM2(PARTS[i]) / 10_000, 3);
    });
  });

  it("keeps each part's own area rather than a merged total", () => {
    const merged = ringsAreaM2(PARTS);
    for (let i = 0; i < 3; i++) {
      const back = polygonAreaM2(read.polygons[i].slice(0, -1));
      expect(back).toBeCloseTo(polygonAreaM2(PARTS[i]), 0);
      expect(back).toBeLessThan(merged);
    }
    expect(pkg.verification.boundaryAreaErrorPct).toBeLessThan(0.5);
  });

  it("keeps the raster aligned with every part, not just the first", () => {
    for (const z of ZONES) {
      expect(sampleAt(raster, centroid(z.ring)), `zone ${z.id}`).toBe(z.rateLha);
    }
    const values = pkg.verification.valueHistogram.map(h => h.value).sort((a, b) => a - b);
    expect(values).toEqual([0, 7, 14, 21]);
  });

  it("leaves the gaps between parts unsprayed", () => {
    // Between part 1 (ends 200 m) and part 2 (starts 300 m).
    const gap = { lat: LAT + 75 / M_PER_DEG_LAT, lng: LNG + 250 / mPerDegLng(LAT) };
    expect(pointInAnyRing(gap, PARTS)).toBe(false);
    expect(sampleAt(raster, gap)).toBe(0);
  });
});
