import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng, ringsAreaM2 } from "@/lib/geo";
import { buildMission } from "@/lib/mission";
import {
  WGS84_ESRI_WKT, readDbf, readPolygonShapefile, writePolygonShapefile,
} from "@/lib/shapefile";
import { readGeoTiffFloat32, worldFile, writeGeoTiffFloat32 } from "@/lib/geotiff";
import { buildAgrasPackage } from "@/lib/djiAgras";
import {
  MAX_CONSUMER_WAYPOINTS, WaypointLimitError, buildWpmlKmz,
  missionToWpmlWaypoints, readKmzEntries,
} from "@/lib/wpml";

const LAT = 45;
const LNG = -93;
const WHEN = new Date(2026, 7, 19);

/** Axis-aligned rectangle sized in metres, anchored at (lat,lng). */
function rect(lat: number, lng: number, widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT;
  const dLng = widthM / mPerDegLng(lat);
  return [
    { lat, lng },
    { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng },
  ];
}

const FIELD = rect(LAT, LNG, 400, 300);
const ZONE_A = rect(LAT + 100 / M_PER_DEG_LAT, LNG + 100 / mPerDegLng(LAT), 100, 100);
const ZONE_B = rect(LAT + 50 / M_PER_DEG_LAT, LNG + 250 / mPerDegLng(LAT), 60, 60);

describe("shapefile writer", () => {
  const bundle = writePolygonShapefile(
    [{ ring: FIELD, attrs: { ID: 0, TYPE: "boundary", AREA_HA: 12.0 } }],
    [
      { name: "ID", type: "N", length: 10, decimals: 0 },
      { name: "TYPE", type: "C", length: 16 },
      { name: "AREA_HA", type: "N", length: 16, decimals: 4 },
    ],
    WHEN,
  );

  it("declares polygon type and a self-consistent header length", () => {
    const read = readPolygonShapefile(bundle.shp);
    expect(read.shapeType).toBe(5);
    expect(read.polygons).toHaveLength(1);
  });

  it("preserves the enclosed area through a write/read round trip", () => {
    const read = readPolygonShapefile(bundle.shp);
    const src = ringsAreaM2([FIELD]);
    const back = ringsAreaM2(read.polygons);
    expect(Math.abs(back - src) / src).toBeLessThan(1e-6);
    // 400 m x 300 m = 12 ha, give or take the spherical-excess approximation.
    expect(back).toBeGreaterThan(119_000);
    expect(back).toBeLessThan(121_000);
  });

  it("closes the ring and winds the outer boundary clockwise", () => {
    const [ring] = readPolygonShapefile(bundle.shp).polygons;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Clockwise in (x=lng, y=lat) means a negative shoelace sum. ESRI readers
    // treat a counter-clockwise outer ring as a hole.
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += ring[i].lng * ring[i + 1].lat - ring[i + 1].lng * ring[i].lat;
    }
    expect(a).toBeLessThan(0);
  });

  it("writes an index whose record offsets land on real records", () => {
    const shx = new DataView(bundle.shx.buffer);
    expect(shx.getInt32(0, false)).toBe(9994);
    // First record starts immediately after the 100-byte header: word 50.
    expect(shx.getInt32(100, false)).toBe(50);
  });

  it("round-trips attributes and keeps numerics right-aligned", () => {
    const rows = readDbf(bundle.dbf);
    expect(rows).toHaveLength(1);
    expect(rows[0].ID).toBe("0");
    expect(rows[0].TYPE).toBe("boundary");
    expect(Number(rows[0].AREA_HA)).toBeCloseTo(12.0, 4);
  });

  it("emits WGS84 as the projection", () => {
    const prj = new TextDecoder().decode(bundle.prj);
    expect(prj).toBe(WGS84_ESRI_WKT);
    expect(prj).toContain("GCS_WGS_1984");
    expect(prj).toContain("6378137.0");
  });

  it("refuses degenerate input rather than writing a broken file", () => {
    expect(() => writePolygonShapefile([], [], WHEN)).toThrow(/zero features/);
    expect(() => writePolygonShapefile(
      [{ ring: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], attrs: {} }], [], WHEN,
    )).toThrow(/at least 3/);
  });
});

describe("geotiff writer", () => {
  const spec = {
    width: 4, height: 3,
    pixels: Float32Array.from([
      0, 0, 0, 0,
      0, 25, 40, 0,
      0, 0, 0, 0,
    ]),
    originLng: -93, originLat: 45,
    pixelWidthDeg: 0.0001, pixelHeightDeg: 0.00008,
  };

  it("round-trips dimensions, georeferencing and pixel values", () => {
    const { tiff } = writeGeoTiffFloat32(spec);
    const read = readGeoTiffFloat32(tiff);
    expect(read.width).toBe(4);
    expect(read.height).toBe(3);
    expect(read.originLng).toBeCloseTo(-93, 10);
    expect(read.originLat).toBeCloseTo(45, 10);
    expect(read.pixelWidthDeg).toBeCloseTo(0.0001, 12);
    expect(read.pixelHeightDeg).toBeCloseTo(0.00008, 12);
    expect(Array.from(read.pixels)).toEqual(Array.from(spec.pixels));
  });

  it("declares EPSG:4326 in the GeoKeyDirectory", () => {
    const { tiff } = writeGeoTiffFloat32(spec);
    expect(readGeoTiffFloat32(tiff).epsg).toBe(4326);
  });

  it("puts the world file on pixel CENTRES while the tiepoint uses the corner", () => {
    const tfw = worldFile(spec).trim().split("\n").map(Number);
    const [a, d, b, e, c, f] = tfw;
    expect(a).toBeCloseTo(0.0001, 12);
    expect(d).toBe(0);
    expect(b).toBe(0);
    expect(e).toBeCloseTo(-0.00008, 12);      // negative = north-up
    // Half a pixel in from the corner the GeoTIFF tiepoint records.
    expect(c).toBeCloseTo(-93 + 0.0001 / 2, 12);
    expect(f).toBeCloseTo(45 - 0.00008 / 2, 12);
    const read = readGeoTiffFloat32(writeGeoTiffFloat32(spec).tiff);
    expect(c - read.originLng).toBeCloseTo(read.pixelWidthDeg / 2, 12);
  });

  it("rejects a pixel buffer that does not match the declared size", () => {
    expect(() => writeGeoTiffFloat32({ ...spec, pixels: new Float32Array(5) }))
      .toThrow(/expected 12 pixels/);
  });
});

describe("DJI Agras package", () => {
  const zones = [
    { id: "a", ring: ZONE_A, rateLha: 25 },
    { id: "b", ring: ZONE_B, rateLha: 40 },
  ];
  const pkg = buildAgrasPackage({ boundary: [FIELD], zones, when: WHEN });

  it("lays out DJI/Shapefile and DJI/Rx with the expected members", () => {
    expect(Object.keys(pkg.files).sort()).toEqual([
      "DJI/Rx/spot_treatment.tfw",
      "DJI/Rx/spot_treatment.tiff",
      "DJI/Shapefile/field_boundary.dbf",
      "DJI/Shapefile/field_boundary.prj",
      "DJI/Shapefile/field_boundary.shp",
      "DJI/Shapefile/field_boundary.shx",
    ]);
  });

  it("defaults the raster to .tiff, as PIX4D and the DJI folder spec both describe", () => {
    expect(Object.keys(pkg.files)).toContain("DJI/Rx/spot_treatment.tiff");
    expect(Object.keys(pkg.files)).not.toContain("DJI/Rx/spot_treatment.tif");
  });

  it("can still emit .tif if a captured package turns out to want it", () => {
    const alt = buildAgrasPackage({ boundary: [FIELD], zones, when: WHEN, rxExtension: "tif" });
    expect(Object.keys(alt.files)).toContain("DJI/Rx/spot_treatment.tif");
    // The world file keeps its name either way — that is the whole ambiguity.
    expect(Object.keys(alt.files)).toContain("DJI/Rx/spot_treatment.tfw");
    expect(alt.verification.epsg).toBe(4326);
  });

  it("keeps the boundary area within a rounding error of the source", () => {
    const v = pkg.verification;
    expect(v.boundaryAreaErrorPct).toBeLessThan(0.5);
    expect(v.boundaryAreaM2Readback).toBeCloseTo(ringsAreaM2([FIELD]), 0);
  });

  it("covers the whole boundary extent with the raster", () => {
    const { rasterExtent: r, boundaryExtent: b } = pkg.verification;
    expect(r.minLat).toBeLessThanOrEqual(b.minLat);
    expect(r.maxLat).toBeGreaterThanOrEqual(b.maxLat);
    expect(r.minLng).toBeLessThanOrEqual(b.minLng);
    expect(r.maxLng).toBeGreaterThanOrEqual(b.maxLng);
    expect(pkg.verification.epsg).toBe(4326);
  });

  it("burns each zone rate into the raster and leaves the rest at zero", () => {
    const read = readGeoTiffFloat32(pkg.files["DJI/Rx/spot_treatment.tiff"]);
    const values = new Set(Array.from(read.pixels));
    expect(values).toEqual(new Set([0, 25, 40]));
    expect(pkg.verification.rateRange).toEqual({ min: 25, max: 40 });
  });

  it("treats roughly the zone area and nothing more", () => {
    // 100x100 m + 60x60 m = 13,600 m² at ~1 m/px.
    const treated = pkg.verification.treatedPixelCount;
    const expected = 13_600 / (pkg.raster.resolutionM ** 2);
    expect(treated).toBeGreaterThan(expected * 0.9);
    expect(treated).toBeLessThan(expected * 1.1);
  });

  it("stays inside the 10 MB prescription upload cap", () => {
    expect(pkg.raster.bytes).toBeLessThan(10 * 1024 * 1024);
  });

  it("fails loudly when no zone carries a rate", () => {
    expect(() => buildAgrasPackage({
      boundary: [FIELD], zones: [{ id: "a", ring: ZONE_A, rateLha: 0 }], when: WHEN,
    })).toThrow(/zero application rate/);
  });

  it("fails loudly when zones fall outside the boundary", () => {
    const away = rect(LAT + 5, LNG + 5, 50, 50);
    expect(() => buildAgrasPackage({
      boundary: [FIELD], zones: [{ id: "a", ring: away, rateLha: 20 }], when: WHEN,
    })).toThrow(/prescription would be empty/);
  });

  it("refuses a mission with no boundary or no zones", () => {
    expect(() => buildAgrasPackage({ boundary: [], zones, when: WHEN })).toThrow(/no field boundary/);
    expect(() => buildAgrasPackage({ boundary: [FIELD], zones: [], when: WHEN })).toThrow(/no treatment zones/);
  });
});

describe("WPML .kmz export", () => {
  const mission = buildMission(
    [FIELD],
    [{ id: "a", ring: ZONE_A }],
    {
      home: { lat: LAT, lng: LNG },
      transitAltM: 30, sprayAltM: 3, transitSpeed: 10, spraySpeed: 3, spacingM: 25,
    },
  );
  const opts = {
    createTimeMs: 1_755_561_600_000,
    transitSpeed: 10, autoFlightSpeed: 3, takeOffSecurityHeightM: 30,
  };

  it("drops payload-only commands and collapses duplicate points", () => {
    const wps = missionToWpmlWaypoints(mission);
    expect(wps.length).toBeGreaterThan(0);
    expect(wps.length).toBeLessThan(mission.waypoints.length);
    for (let i = 1; i < wps.length; i++) {
      const same = wps[i].lat === wps[i - 1].lat
        && wps[i].lng === wps[i - 1].lng
        && wps[i].alt === wps[i - 1].alt;
      expect(same).toBe(false);
    }
  });

  it("puts wpmz/ at the zip root with both required members and nothing else", () => {
    const pkg = buildWpmlKmz(mission, opts);
    const entries = readKmzEntries(zipSync(pkg.files));
    // No wrapping mission-named folder, and no standalone `wpmz/` directory
    // entry — DJI Pilot looks for wpmz/ at the root of the archive.
    expect(Object.keys(entries).sort()).toEqual(["wpmz/template.kml", "wpmz/waylines.wpml"]);
  });

  it("uses DJI's real namespaces, not the bare opengis.net/dji.com forms", () => {
    const xml = new TextDecoder().decode(buildWpmlKmz(mission, opts).files["wpmz/waylines.wpml"]);
    expect(xml).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    expect(xml).toContain('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"');
    expect(xml).not.toContain('xmlns="http://opengis.net"');
    expect(xml).not.toContain('xmlns:wpml="http://dji.com"');
  });

  it("emits the documented missionConfig element names", () => {
    const xml = new TextDecoder().decode(buildWpmlKmz(mission, opts).files["wpmz/waylines.wpml"]);
    expect(xml).toContain("<wpml:missionConfig>");
    expect(xml).toContain("<wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>");
    expect(xml).toContain("<wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>");
    expect(xml).toContain("<wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>");
    expect(xml).toContain("<wpml:globalTransitionalSpeed>10.0</wpml:globalTransitionalSpeed>");
    // The names from the circulating third-party skeleton must not appear.
    expect(xml).not.toContain("<MissionConfig>");
    expect(xml).not.toContain("exitOnGpsLost");
    expect(xml).not.toContain("executeRtkSpeed");
  });

  it("indexes placemarks sequentially from zero in both documents", () => {
    const pkg = buildWpmlKmz(mission, opts);
    expect(pkg.verification.waypointCount).toBe(pkg.waypointCount);
    for (const name of ["wpmz/waylines.wpml", "wpmz/template.kml"]) {
      const doc = new DOMParser().parseFromString(
        new TextDecoder().decode(pkg.files[name]), "application/xml",
      );
      expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
      const idx = Array.from(doc.getElementsByTagName("Placemark")).map(
        p => p.getElementsByTagNameNS("http://www.dji.com/wpmz/1.0.2", "index")[0]?.textContent,
      );
      expect(idx).toEqual(idx.map((_, i) => String(i)));
    }
  });

  it("declares the same height reference the planner works in", () => {
    const xml = new TextDecoder().decode(buildWpmlKmz(mission, opts).files["wpmz/waylines.wpml"]);
    expect(xml).toContain("<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>");
  });

  it("keeps waylines.wpml to missionConfig + Folder, like DJI's example", () => {
    const pkg = buildWpmlKmz(mission, opts);
    const wayline = new TextDecoder().decode(pkg.files["wpmz/waylines.wpml"]);
    const template = new TextDecoder().decode(pkg.files["wpmz/template.kml"]);
    // The file-creation block belongs to template.kml, not the execution file.
    expect(wayline).not.toContain("<wpml:author>");
    expect(wayline).not.toContain("<wpml:createTime>");
    expect(template).toContain("<wpml:author>SwathWise</wpml:author>");
    expect(template).toContain("<wpml:createTime>");
  });

  it("orders Folder children the way DJI's published example does", () => {
    const xml = new TextDecoder().decode(buildWpmlKmz(mission, opts).files["wpmz/waylines.wpml"]);
    const order = ["templateId", "executeHeightMode", "waylineId", "autoFlightSpeed"]
      .map(t => xml.indexOf(`<wpml:${t}>`));
    expect(order.every(i => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("omits useStraightLine, which DJI's example also omits for this turn mode", () => {
    const xml = new TextDecoder().decode(buildWpmlKmz(mission, opts).files["wpmz/waylines.wpml"]);
    expect(xml).not.toContain("useStraightLine");
  });

  it("carries no spray vocabulary — DJI documents none for WPML", () => {
    const pkg = buildWpmlKmz(mission, opts);
    for (const name of ["wpmz/waylines.wpml", "wpmz/template.kml"]) {
      const xml = new TextDecoder().decode(pkg.files[name]).toLowerCase();
      for (const invented of ["spray", "pump", "spreader", "flowrate", "dosage"]) {
        expect(xml).not.toContain(invented);
      }
    }
  });

  it("emits droneInfo and payloadInfo only when the caller supplies them", () => {
    const bare = new TextDecoder().decode(buildWpmlKmz(mission, opts).files["wpmz/waylines.wpml"]);
    expect(bare).not.toContain("droneInfo");
    expect(bare).not.toContain("payloadInfo");

    const identified = new TextDecoder().decode(buildWpmlKmz(mission, {
      ...opts,
      drone: { enumValue: 67, subEnumValue: 0 },
      payload: { enumValue: 52, positionIndex: 0 },
    }).files["wpmz/waylines.wpml"]);
    expect(identified).toContain("<wpml:droneEnumValue>67</wpml:droneEnumValue>");
    expect(identified).toContain("<wpml:payloadEnumValue>52</wpml:payloadEnumValue>");
  });

  it("fails loudly past the consumer waypoint cap rather than truncating", () => {
    // Tight spacing over the same field pushes the pass count far past 200.
    const dense = buildMission(
      [FIELD],
      [{ id: "a", ring: FIELD }],
      {
        home: { lat: LAT, lng: LNG },
        transitAltM: 30, sprayAltM: 3, transitSpeed: 10, spraySpeed: 3, spacingM: 2,
      },
    );
    const needed = missionToWpmlWaypoints(dense).length;
    expect(needed).toBeGreaterThan(MAX_CONSUMER_WAYPOINTS);
    expect(() => buildWpmlKmz(dense, opts)).toThrow(WaypointLimitError);
    expect(() => buildWpmlKmz(dense, opts)).toThrow(new RegExp(`needs ${needed} waypoints`));
  });
});
