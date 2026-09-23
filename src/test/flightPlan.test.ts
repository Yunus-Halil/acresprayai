// The survey planner: footprint, capture interval, grid, and the export.
//
// The bug this feature exists to fix is a route that flies the right shape and
// only fires the camera at the turns. On a 400 m leg that is two photographs
// covering the ends and nothing in between, and the operator does not find out
// until the reconstruction fails on the ground. So the assertions that matter
// most here are about WHERE the shutter fires, not about whether the file
// parses.
import { describe, expect, it } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng } from "@/lib/geo";
import {
  CAMERAS, DEFAULT_CAMERA_KEY, DJI_AIR_3S, captureIntervalM, footprintM, lineSpacingM,
  pointsAlongLeg,
} from "@/lib/flightPlan/camera";
import { buildSurveyGrid, gridStats, headingForDirection } from "@/lib/flightPlan/grid";
import {
  DEFAULT_FLIGHT_PLAN_PARAMS, EmptyPlanError, blockerFor, generateKmz, kmzFilename, resolveFlightPlan,
} from "@/lib/flightPlan/generateKmz";
import { MAX_CONSUMER_WAYPOINTS, readKmzEntries } from "@/lib/wpml";

const LAT0 = 38.95, LNG0 = -77.45;

/** A square of `sideM` metres centred on a point. */
function square(sideM: number, centre: LatLng2 = { lat: LAT0, lng: LNG0 }): LatLng2[][] {
  const half = sideM / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLng = half / mPerDegLng(centre.lat);
  return [[
    { lat: centre.lat + dLat, lng: centre.lng - dLng },
    { lat: centre.lat + dLat, lng: centre.lng + dLng },
    { lat: centre.lat - dLat, lng: centre.lng + dLng },
    { lat: centre.lat - dLat, lng: centre.lng - dLng },
  ]];
}

const camera = CAMERAS[DEFAULT_CAMERA_KEY];

describe("what the camera sees", () => {
  it("scales the footprint linearly with altitude", () => {
    const a = footprintM(camera, 50);
    const b = footprintM(camera, 100);
    expect(b.acrossTrackM).toBeCloseTo(a.acrossTrackM * 2, 6);
    expect(b.alongTrackM).toBeCloseTo(a.alongTrackM * 2, 6);
  });

  it("puts the long edge across the direction of travel", () => {
    // Not interchangeable: swapping them inflates the trigger interval by half
    // as much again, and the resulting gaps look like a windy day.
    const fp = footprintM(camera, 100);
    expect(fp.acrossTrackM).toBeGreaterThan(fp.alongTrackM);
    expect(fp.acrossTrackM / fp.alongTrackM).toBeCloseTo(camera.aspect, 6);
  });

  it("computes a 24mm-equivalent footprint that matches the lens geometry", () => {
    // 36mm frame over 24mm focal length is a 1.5x multiple of altitude.
    expect(footprintM(camera, 100).acrossTrackM).toBeCloseTo(150, 6);
  });

  it("advances one quarter of a frame at 75 percent front overlap", () => {
    const fp = footprintM(camera, 100);
    expect(captureIntervalM(camera, 100, 75)).toBeCloseTo(fp.alongTrackM * 0.25, 6);
    expect(captureIntervalM(camera, 100, 0)).toBeCloseTo(fp.alongTrackM, 6);
  });

  it("derives line spacing from side overlap the same way", () => {
    const fp = footprintM(camera, 100);
    expect(lineSpacingM(camera, 100, 75)).toBeCloseTo(fp.acrossTrackM * 0.25, 6);
    expect(lineSpacingM(camera, 100, 50)).toBeCloseTo(fp.acrossTrackM * 0.5, 6);
  });

  it("never lets overlap reach a spacing of zero", () => {
    // 100 percent overlap means the aircraft never advances, which is not a
    // flight plan. Clamped rather than dividing the field into infinite lines.
    expect(captureIntervalM(camera, 100, 100)).toBeGreaterThan(0);
    expect(lineSpacingM(camera, 100, 100)).toBeGreaterThan(0);
  });
});

describe("capture positions along a leg", () => {
  const a = { lat: LAT0, lng: LNG0 };
  const b = { lat: LAT0, lng: LNG0 + 400 / mPerDegLng(LAT0) };   // 400 m east

  it("fires along the leg, not only at its ends", () => {
    // The whole point. Two points would be the bug.
    const pts = pointsAlongLeg(a, b, 25);
    expect(pts.length).toBe(17);
    expect(pts.length).toBeGreaterThan(2);
  });

  it("includes both ends, so a strip is anchored at each end", () => {
    const pts = pointsAlongLeg(a, b, 25);
    expect(distM(pts[0], a)).toBeLessThan(0.01);
    expect(distM(pts[pts.length - 1], b)).toBeLessThan(0.01);
  });

  it("never leaves a gap wider than the interval, including the last one", () => {
    // Rounding the step count down would leave the widest gap at the end of
    // every single leg, which is the overlap failing where nobody looks.
    for (const legLength of [400, 417, 33, 7]) {
      const end = { lat: LAT0, lng: LNG0 + legLength / mPerDegLng(LAT0) };
      const pts = pointsAlongLeg(a, end, 25);
      for (let i = 1; i < pts.length; i++) {
        expect(distM(pts[i - 1], pts[i])).toBeLessThanOrEqual(25 + 1e-6);
      }
    }
  });

  it("survives a zero-length leg without producing an infinite list", () => {
    expect(pointsAlongLeg(a, a, 25)).toEqual([a]);
  });
});

describe("the grid", () => {
  const params = { direction: "ew" as const, lineSpacingM: 40, captureIntervalM: 25, insetM: 0 };

  it("runs its lines along the direction the operator asked for", () => {
    expect(headingForDirection("ew", square(200))).toBe(90);
    expect(headingForDirection("ns", square(200))).toBe(0);
  });

  it("follows the longest axis when asked to choose", () => {
    // A field twice as wide as it is tall should be flown east-west: fewer
    // turns, and a turn is the most expensive thing in a survey.
    const wide = [[
      { lat: LAT0 + 0.0005, lng: LNG0 - 0.004 }, { lat: LAT0 + 0.0005, lng: LNG0 + 0.004 },
      { lat: LAT0 - 0.0005, lng: LNG0 + 0.004 }, { lat: LAT0 - 0.0005, lng: LNG0 - 0.004 },
    ]];
    expect(headingForDirection("auto", wide)).toBe(90);
  });

  it("covers the polygon with lines at the requested spacing", () => {
    const grid = buildSurveyGrid(square(200), params);
    // 200 m of north-south extent at 40 m spacing is six lines.
    expect(grid.lineCount).toBe(6);
    expect(grid.legs.length).toBe(6);
    expect(grid.waypoints.length).toBeGreaterThan(grid.lineCount * 2);
  });

  it("puts every waypoint inside the boundary", () => {
    const rings = square(200);
    const grid = buildSurveyGrid(rings, params);
    const half = 100;
    for (const w of grid.waypoints) {
      const dx = Math.abs((w.lng - LNG0) * mPerDegLng(LAT0));
      const dy = Math.abs((w.lat - LAT0) * M_PER_DEG_LAT);
      expect(dx).toBeLessThanOrEqual(half + 1);
      expect(dy).toBeLessThanOrEqual(half + 1);
    }
  });

  it("flies a serpentine, so the aircraft turns into the next line", () => {
    const grid = buildSurveyGrid(square(200), params);
    // Consecutive legs alternate direction: the end of one is near the start
    // of the next, rather than the aircraft deadheading back each time.
    for (let i = 1; i < grid.legs.length; i++) {
      const hop = distM(grid.legs[i - 1].b, grid.legs[i].a);
      expect(hop).toBeLessThan(60);
    }
  });

  it("holds the lines inside the boundary when an inset is asked for", () => {
    const plain = buildSurveyGrid(square(200), params);
    const inset = buildSurveyGrid(square(200), { ...params, insetM: 20 });
    expect(inset.lineDistanceM).toBeLessThan(plain.lineDistanceM);
  });

  it("returns an empty grid rather than throwing on an unusable boundary", () => {
    expect(buildSurveyGrid([], params).legs).toEqual([]);
    expect(buildSurveyGrid([[{ lat: LAT0, lng: LNG0 }]], params).legs).toEqual([]);
    // An inset that swallows the field is a state the UI has to show, not a crash.
    expect(buildSurveyGrid(square(20), { ...params, insetM: 200 }).legs).toEqual([]);
  });

  it("reports a flight time from the distance it actually flies, turns included", () => {
    const grid = buildSurveyGrid(square(200), params);
    const stats = gridStats(grid, 6);
    expect(stats.distanceM).toBeCloseTo(grid.lineDistanceM + grid.turnDistanceM, 6);
    expect(stats.flightTimeS).toBeCloseTo(stats.distanceM / 6, 6);
    expect(stats.photoCount).toBe(grid.waypoints.length);
  });
});

describe("resolving a plan", () => {
  it("derives line spacing from side overlap, and says when it was overridden", () => {
    const auto = resolveFlightPlan(square(200), DEFAULT_FLIGHT_PLAN_PARAMS);
    expect(auto.computed.lineSpacingOverridden).toBe(false);
    expect(auto.computed.lineSpacingM).toBeCloseTo(lineSpacingM(camera, 100, 75), 6);

    const manual = resolveFlightPlan(square(200), { ...DEFAULT_FLIGHT_PLAN_PARAMS, lineSpacingM: 20 });
    expect(manual.computed.lineSpacingOverridden).toBe(true);
    expect(manual.computed.lineSpacingM).toBe(20);
    expect(manual.grid.lineCount).toBeGreaterThan(auto.grid.lineCount);
  });

  it("blocks a plan that needs more waypoints than the aircraft accepts", () => {
    // Low and dense: the case where an operator would otherwise get a file the
    // aircraft silently refuses.
    const dense = resolveFlightPlan(square(600), {
      ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 30, frontOverlapPct: 85, sideOverlapPct: 85,
    });
    expect(dense.grid.waypoints.length).toBeGreaterThan(MAX_CONSUMER_WAYPOINTS);
    expect(dense.blocker).toMatch(/needs \d+ waypoints/);
    expect(dense.blocker).toMatch(/Fly higher/);
  });

  it("passes a plan the aircraft can hold", () => {
    const ok = resolveFlightPlan(square(200), DEFAULT_FLIGHT_PLAN_PARAMS);
    expect(ok.grid.waypoints.length).toBeLessThanOrEqual(MAX_CONSUMER_WAYPOINTS);
    expect(ok.blocker).toBeNull();
  });

  it("names the empty case rather than producing a silent zero", () => {
    expect(blockerFor(0)).toMatch(/no flight lines/);
  });
});

describe("the exported KMZ", () => {
  const opts = { createTimeMs: 1_700_000_000_000 };
  const read = (rings: LatLng2[][], params = DEFAULT_FLIGHT_PLAN_PARAMS) =>
    new TextDecoder().decode(generateKmz(rings, params, opts).pkg.files["wpmz/waylines.wpml"]);

  it("is a wpmz package with both documents at the zip root", () => {
    const { pkg } = generateKmz(square(200), DEFAULT_FLIGHT_PLAN_PARAMS, opts);
    expect(Object.keys(pkg.files).sort()).toEqual(["wpmz/template.kml", "wpmz/waylines.wpml"]);
  });

  it("fires the shutter at EVERY waypoint, not only at the turns", () => {
    // The regression this feature exists to prevent.
    const { pkg, resolved } = generateKmz(square(200), DEFAULT_FLIGHT_PLAN_PARAMS, opts);
    const xml = new TextDecoder().decode(pkg.files["wpmz/waylines.wpml"]);
    const shots = xml.match(/<wpml:actionActuatorFunc>takePhoto<\/wpml:actionActuatorFunc>/g) ?? [];
    expect(shots.length).toBe(resolved.grid.waypoints.length);
    expect(shots.length).toBeGreaterThan(resolved.grid.lineCount * 2);
  });

  it("triggers on reaching the point, not on a timer", () => {
    // A timed trigger drifts against ground speed and leaves the overlap to luck.
    const xml = read(square(200));
    expect(xml).toMatch(/<wpml:actionTriggerType>reachPoint<\/wpml:actionTriggerType>/);
    expect(xml).not.toMatch(/multipleTiming/);
  });

  it("commands the gimbal rather than only declaring it", () => {
    const xml = read(square(200));
    expect(xml).toMatch(/<wpml:actionActuatorFunc>gimbalRotate<\/wpml:actionActuatorFunc>/);
    expect(xml).toMatch(/<wpml:gimbalPitchRotateAngle>-90\.0<\/wpml:gimbalPitchRotateAngle>/);
  });

  it("carries an oblique gimbal angle through when one is asked for", () => {
    const xml = read(square(200), { ...DEFAULT_FLIGHT_PLAN_PARAMS, gimbalPitchDeg: -45 });
    expect(xml).toMatch(/<wpml:gimbalPitchRotateAngle>-45\.0<\/wpml:gimbalPitchRotateAngle>/);
  });

  it("names the Air 3S, using the codes read off a file it accepted", () => {
    // 68 / 0 came from a working Air 3S KMZ, not from DJI's published table,
    // which covers enterprise airframes only. If a flight test shows DJI Fly
    // rejecting the file, DJI_AIR_3S goes back to null and this test goes with
    // it; nothing else has to change.
    const xml = read(square(200));
    expect(xml).toMatch(/<wpml:droneEnumValue>68<\/wpml:droneEnumValue>/);
    expect(xml).toMatch(/<wpml:droneSubEnumValue>0<\/wpml:droneSubEnumValue>/);
    expect(DJI_AIR_3S).toEqual({ enumValue: 68, subEnumValue: 0 });
  });

  it("keeps that identity on the Air 3S and off every other airframe", () => {
    // The whole reason the code lives on the camera entry: choosing a different
    // aircraft must not stamp an Air 3S code onto a file meant for something
    // else. There is no verified code for the other two, so they carry none.
    expect(CAMERAS["dji-air-3s-wide"].drone).toEqual(DJI_AIR_3S);
    for (const key of ["dji-mavic-3e-wide", "generic24"]) {
      expect(CAMERAS[key].drone ?? null).toBeNull();
      const xml = read(square(200), { ...DEFAULT_FLIGHT_PLAN_PARAMS, cameraKey: key });
      expect(xml).not.toMatch(/droneEnumValue/);
      expect(xml).not.toMatch(/droneInfo/);
    }
  });

  it("emits the drone identity when the caller supplies a verified one", () => {
    const { pkg } = generateKmz(square(200), DEFAULT_FLIGHT_PLAN_PARAMS, {
      ...opts, drone: { enumValue: 99, subEnumValue: 1 },
    });
    const xml = new TextDecoder().decode(pkg.files["wpmz/waylines.wpml"]);
    expect(xml).toMatch(/<wpml:droneEnumValue>99<\/wpml:droneEnumValue>/);
    expect(xml).toMatch(/<wpml:droneSubEnumValue>1<\/wpml:droneSubEnumValue>/);
    expect(xml).not.toMatch(/<wpml:droneEnumValue>68</);
  });

  it("omits the block entirely when the caller passes an explicit null", () => {
    // The revert path, available per export without editing the table: a wrong
    // code is a silent rejection at import time, and an absent one is not.
    const { pkg } = generateKmz(square(200), DEFAULT_FLIGHT_PLAN_PARAMS, {
      ...opts, drone: null,
    });
    const xml = new TextDecoder().decode(pkg.files["wpmz/waylines.wpml"]);
    expect(xml).not.toMatch(/droneEnumValue/);
    expect(xml).not.toMatch(/droneInfo/);
  });

  it("still emits no spray vocabulary, which remains unconfirmed", () => {
    const xml = read(square(200));
    for (const banned of ["spray", "Spray", "pump", "spreader"]) {
      expect(xml).not.toContain(banned);
    }
  });

  it("refuses an empty plan instead of writing a file that flies nothing", () => {
    expect(() => generateKmz(square(20), { ...DEFAULT_FLIGHT_PLAN_PARAMS, insetM: 200 }, opts))
      .toThrow(EmptyPlanError);
  });

  it("names the file after the field and the day", () => {
    expect(kmzFilename("North Vineyard", new Date("2026-09-23T10:00:00Z")))
      .toBe("north-vineyard-survey-2026-09-23.kmz");
    expect(kmzFilename("", new Date("2026-09-23T10:00:00Z"))).toBe("field-survey-2026-09-23.kmz");
  });
});

// ---------------------------------------------------------------------------
// The file that is actually downloaded
// ---------------------------------------------------------------------------
//
// Everything above reads `pkg.files`, the XML before it is zipped. These read
// `pkg.kmz`, the Blob the download button hands to the browser, unzip it the
// way a viewer would, and count Placemarks in the bytes on disk. That is the
// only way to catch a regression BETWEEN waypoint generation and the file.
//
// The lot is the size of a residential parcel, 57 m on a side, because that is
// where a sparse grid is most visible and where a real report of "waypoints
// only at the turns" came from. It turned out to be altitude: a sample flown
// at 30.48 m (100 ft) beside a plan at 100 m. The grid is 3.3x coarser and
// has a tenth of the photographs, and both files were correct.
describe("the file that is actually downloaded", () => {
  const opts = { createTimeMs: 1_700_000_000_000 };
  const lot = (sideM = 57, rotDeg = 30): LatLng2[][] => {
    const r = (rotDeg * Math.PI) / 180, h = sideM / 2;
    return [[[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => {
      const xr = x * Math.cos(r) - y * Math.sin(r), yr = x * Math.sin(r) + y * Math.cos(r);
      return { lat: LAT0 + yr / M_PER_DEG_LAT, lng: LNG0 + xr / mPerDegLng(LAT0) };
    })];
  };

  // What the browser receives, byte for byte.
  const downloaded = (b: Blob) => new Promise<Uint8Array>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(b);
  });

  type Mark = { lat: number; lng: number; photo: boolean };
  const placemarksIn = (bytes: Uint8Array): Mark[] => {
    const entries = readKmzEntries(bytes);
    const xml = new TextDecoder().decode(entries["wpmz/waylines.wpml"]);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.getElementsByTagName("Placemark")).map(pm => {
      const [lng, lat] = pm.getElementsByTagName("coordinates")[0].textContent!.trim().split(",").map(Number);
      return { lat, lng, photo: /takePhoto/.test(pm.textContent ?? "") };
    });
  };
  const near = (a: LatLng2, b: LatLng2) => Math.abs(a.lat - b.lat) < 2e-6 && Math.abs(a.lng - b.lng) < 2e-6;

  it("holds one Placemark per planned capture, on every leg, interior points included", async () => {
    const { pkg, resolved } = generateKmz(lot(), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 30.48 }, opts);
    const marks = placemarksIn(await downloaded(pkg.kmz));

    // The number the UI states is the number in the file.
    expect(marks.length).toBe(resolved.stats.photoCount);
    expect(marks.every(m => m.photo)).toBe(true);

    // Per leg, not only in total: a leg longer than two intervals has points
    // BETWEEN its ends, in the file, where a viewer will draw them.
    const interval = resolved.computed.captureIntervalM;
    let longLegs = 0;
    for (const leg of resolved.grid.legs) {
      const onLeg = marks.filter(m => leg.captures.some(c => near(c, m)));
      expect(onLeg.length).toBe(leg.captures.length);
      if (distM(leg.a, leg.b) > 2 * interval) {
        longLegs += 1;
        expect(onLeg.length).toBeGreaterThan(2);
      }
    }
    expect(longLegs).toBeGreaterThan(0);
  });

  it("is dense at 100 ft and coarse at 100 m, and says so in both cases", async () => {
    const low = generateKmz(lot(), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 30.48 }, opts);
    const high = generateKmz(lot(), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 100 }, opts);
    const lowMarks = placemarksIn(await downloaded(low.pkg.kmz));
    const highMarks = placemarksIn(await downloaded(high.pkg.kmz));

    // Both files match their own stat. Neither is wrong; they are different plans.
    expect(lowMarks.length).toBe(low.resolved.stats.photoCount);
    expect(highMarks.length).toBe(high.resolved.stats.photoCount);

    // The same footprint arithmetic at a third of the height: roughly a third
    // of the line spacing, a third of the interval, an order of magnitude more
    // photographs. This is the difference the operator saw.
    expect(low.resolved.computed.lineSpacingM).toBeCloseTo(high.resolved.computed.lineSpacingM * 0.3048, 1);
    expect(low.resolved.grid.lineCount).toBeGreaterThanOrEqual(5);
    expect(high.resolved.grid.lineCount).toBeLessThanOrEqual(3);
    expect(lowMarks.length).toBeGreaterThan(highMarks.length * 4);
  });

  it("ships both files DJI requires, under wpmz/, and nothing else", async () => {
    const { pkg } = generateKmz(lot(), DEFAULT_FLIGHT_PLAN_PARAMS, opts);
    const entries = readKmzEntries(await downloaded(pkg.kmz));
    expect(Object.keys(entries).sort()).toEqual(["wpmz/template.kml", "wpmz/waylines.wpml"]);
  });
});
