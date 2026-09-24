// The turn at the end of a line.
//
// The grid used to join the end of one line to the start of the next with a
// bare segment: arrive at speed, reverse direction in zero distance, leave down
// the next line. Nothing flies that. A real aircraft stops, yaws and
// accelerates, at every turn, and the first frames of the next line are taken
// in the middle of that acceleration.
//
// So the turn is a shape now, and that shape is OUTSIDE the survey area. That
// is not a side effect to be minimised, it is the point: the aircraft needs
// room to come round. The tests that matter are the ones that pin how much room
// it takes, because on a small parcel that is a distance somebody has to walk
// and check before taking off.
import { describe, expect, it } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng } from "@/lib/geo";
import { DEFAULT_FLIGHT_PLAN_PARAMS, generateKmz, resolveFlightPlan } from "@/lib/flightPlan/generateKmz";
import { buildSurveyGrid } from "@/lib/flightPlan/grid";
import {
  DEFAULT_TURNAROUND, TURN_BANK_DEG, minTurnRadiusM, pathLengthM, turnIsTight, turnRadiusM,
  turnaroundExcursionM, turnaroundPath,
} from "@/lib/flightPlan/turnaround";
import { readKmzEntries } from "@/lib/wpml";

const LAT0 = 38.95, LNG0 = -77.45;
const at = (northM: number, eastM: number): LatLng2 => ({
  lat: LAT0 + northM / M_PER_DEG_LAT, lng: LNG0 + eastM / mPerDegLng(LAT0),
});

const square = (sideM: number): LatLng2[][] => {
  const dLat = sideM / M_PER_DEG_LAT, dLng = sideM / mPerDegLng(LAT0);
  return [[
    { lat: LAT0, lng: LNG0 },
    { lat: LAT0, lng: LNG0 + dLng },
    { lat: LAT0 + dLat, lng: LNG0 + dLng },
    { lat: LAT0 + dLat, lng: LNG0 },
  ]];
};

describe("how tight a turn the aircraft can hold", () => {
  it("is the standard coordinated-turn radius, and says which bank it assumes", () => {
    // r = v^2 / (g tan bank). At 6 m/s and 20 degrees, about 10 m. Both halves
    // matter: the number is only as good as the bank angle behind it, which is
    // why the constant is exported rather than buried.
    expect(TURN_BANK_DEG).toBe(20);
    expect(minTurnRadiusM(6)).toBeCloseTo(10.1, 1);
    expect(minTurnRadiusM(12)).toBeCloseTo(minTurnRadiusM(6) * 4, 1);
    expect(minTurnRadiusM(0)).toBe(0);
  });

  it("compares it against the turn the line spacing implies, without enforcing it", () => {
    // Wide lines: the half circle is roomy, nothing to say.
    expect(turnRadiusM(40)).toBe(20);
    expect(turnIsTight(40, 6)).toBe(false);
    // Tight lines, as a low flight produces: the aircraft will slow for each
    // turn, so the flight runs longer than the estimate. Worth saying, not
    // worth refusing, and forcing the radius instead would push the aircraft
    // further outside the boundary than the operator asked for.
    expect(turnIsTight(11, 6)).toBe(true);
    // Fly slower and the same spacing becomes comfortable.
    expect(turnIsTight(11, 3)).toBe(false);
  });
});

describe("the turnaround path", () => {
  // A line running east, ending at the origin, with the next line 40 m north.
  const from = at(0, 0);
  const to = at(40, 0);
  const ahead = at(0, 100);

  it("leaves the survey area, which is the whole reason it exists", () => {
    const path = turnaroundPath(from, to, ahead, DEFAULT_TURNAROUND);
    expect(path.length).toBe(DEFAULT_TURNAROUND.arcPoints);
    // Every point is east of the line ends: the aircraft carries on past them
    // and comes back. A turn that stayed inside would be the bare segment.
    const eastM = path.map(p => (p.lng - LNG0) * mPerDegLng(LAT0));
    expect(Math.min(...eastM)).toBeGreaterThan(0);
    // Close to the radius, and slightly short of it: the arc is a polyline of
    // `arcPoints` points, so the furthest one sits just inside the true apex.
    // That is the trade the point count buys, and it is a metre at most here.
    expect(Math.max(...eastM)).toBeGreaterThan(19);
    expect(Math.max(...eastM)).toBeLessThanOrEqual(20);
  });

  it("is a half circle on the gap between the lines", () => {
    const path = turnaroundPath(from, to, ahead, DEFAULT_TURNAROUND);
    const centre = at(20, 0);
    // Every point the same distance from the midpoint of the two line ends.
    for (const p of path) expect(Math.abs(distM(p, centre) - 20)).toBeLessThan(0.1);
    // And the path flown is pi/2 times the straight gap. Quoting the gap would
    // understate the distance and therefore the flight time.
    const flown = pathLengthM([from, ...path, to]);
    expect(flown).toBeGreaterThan(distM(from, to) * 1.4);
    // Chords, so a shade under the true arc, and the shortfall is the error the
    // aircraft will not fly anyway: it rounds the corners between waypoints.
    expect(flown).toBeLessThanOrEqual(Math.PI * 20);
    expect(flown).toBeGreaterThan(Math.PI * 20 * 0.98);
  });

  it("carries on straight first when an overshoot is asked for", () => {
    const path = turnaroundPath(from, to, ahead, { ...DEFAULT_TURNAROUND, overshootM: 15 });
    // Two more points than the bare arc: the run-out and the run-in.
    expect(path.length).toBe(DEFAULT_TURNAROUND.arcPoints + 2);
    // The first is straight ahead of the line end, on its own heading.
    expect(distM(path[0], from)).toBeCloseTo(15, 1);
    expect(path[0].lat).toBeCloseTo(from.lat, 6);
    // The last is straight ahead of the next line's start, so the aircraft is
    // settled and on heading before the first photo of that line.
    expect(distM(path[path.length - 1], to)).toBeCloseTo(15, 1);
    expect(path[path.length - 1].lat).toBeCloseTo(to.lat, 6);
  });

  it("states how far outside the lines it reaches, which is what has to be clear", () => {
    expect(turnaroundExcursionM(40, DEFAULT_TURNAROUND)).toBeCloseTo(20, 5);
    expect(turnaroundExcursionM(40, { ...DEFAULT_TURNAROUND, overshootM: 15 })).toBeCloseTo(35, 5);
  });

  it("has nothing to do when the two lines are the same line", () => {
    expect(turnaroundPath(from, from, ahead, DEFAULT_TURNAROUND)).toEqual([]);
    expect(turnaroundPath(from, to, from, DEFAULT_TURNAROUND)).toEqual([]);
  });

  it("works at any heading, not only along a meridian", () => {
    // The arc is built from the direction of travel rather than from north, so
    // a diagonal grid turns exactly as a north-south one does.
    const a = at(0, 0), b = at(28.28, 28.28), h = at(70.7, -70.7);
    const path = turnaroundPath(a, b, h, DEFAULT_TURNAROUND);
    const centre = at(14.14, 14.14);
    for (const p of path) expect(Math.abs(distM(p, centre) - 20)).toBeLessThan(0.1);
  });
});

describe("the grid with turns in it", () => {
  const plan = (altitudeM = 60) =>
    resolveFlightPlan(square(300), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM });

  it("puts a turn between every pair of lines and none at the ends", () => {
    const g = plan().grid;
    expect(g.lineCount).toBeGreaterThan(2);
    expect(g.turns.length).toBe(g.lineCount - 1);
    for (const t of g.turns) expect(t.length).toBe(DEFAULT_TURNAROUND.arcPoints);
  });

  it("orders the route line, turn, line, and photographs only the lines", () => {
    const g = plan().grid;
    // Every turn point sits between two photographed runs, never at either end.
    expect(g.route[0].photo).toBe(true);
    expect(g.route[g.route.length - 1].photo).toBe(true);
    const runs: boolean[] = [];
    for (const p of g.route) if (runs[runs.length - 1] !== p.photo) runs.push(p.photo);
    expect(runs.length).toBe(g.lineCount * 2 - 1);
    expect(runs.filter(r => r).length).toBe(g.lineCount);
  });

  it("counts waypoints and photos as two different numbers", () => {
    // They used to be the same number. The ceiling is a limit on waypoints;
    // the operator plans, and the reconstruction runs, on photographs.
    const r = plan();
    expect(r.stats.waypointCount).toBe(r.grid.route.length);
    expect(r.stats.photoCount).toBeLessThan(r.stats.waypointCount);
    expect(r.stats.waypointCount - r.stats.photoCount)
      .toBe((r.grid.lineCount - 1) * DEFAULT_TURNAROUND.arcPoints);
  });

  it("charges the turns against the airframe ceiling, because the file carries them", () => {
    // A plan just inside the ceiling on captures alone would be refused by the
    // aircraft if the turn points were not counted, after the operator had
    // already driven to the field.
    const r = plan();
    const bare = buildSurveyGrid(square(300), {
      direction: r.params.direction,
      lineSpacingM: r.computed.lineSpacingM,
      captureIntervalM: r.computed.captureIntervalM,
      insetM: 0,
      turnaround: null,
    });
    expect(bare.route.length).toBeLessThan(r.grid.route.length);
    expect(bare.turns.every(t => t.length === 0)).toBe(true);
  });

  it("measures the distance actually flown, so the time estimate is not short", () => {
    const withTurns = plan();
    const bare = buildSurveyGrid(square(300), {
      direction: withTurns.params.direction,
      lineSpacingM: withTurns.computed.lineSpacingM,
      captureIntervalM: withTurns.computed.captureIntervalM,
      insetM: 0,
      turnaround: null,
    });
    expect(withTurns.grid.turnDistanceM).toBeGreaterThan(bare.turnDistanceM * 1.4);
  });
});

describe("the turns in the exported file", () => {
  // 100 m, stated. At the 100 ft default a 300 m square is over the waypoint
  // ceiling, which is true and is not what these tests are about.
  const PARAMS = { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 100 };

  const downloaded = (b: Blob) => new Promise<Uint8Array>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(b);
  });

  it("writes the turnaround waypoints with the shutter shut", async () => {
    const { pkg, resolved } = generateKmz(square(300), PARAMS, {
      createTimeMs: 1_700_000_000_000,
    });
    const entries = readKmzEntries(await downloaded(pkg.kmz));
    const xml = new TextDecoder().decode(entries["wpmz/waylines.wpml"]);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const marks = Array.from(doc.getElementsByTagName("Placemark"));

    expect(marks.length).toBe(resolved.stats.waypointCount);
    const photos = marks.filter(m => /takePhoto/.test(m.textContent ?? ""));
    expect(photos.length).toBe(resolved.stats.photoCount);

    // A frame taken on the arc is outside the survey area and pointing the
    // wrong way, and the reconstruction would have to throw it out.
    expect(marks.length - photos.length)
      .toBe((resolved.grid.lineCount - 1) * DEFAULT_TURNAROUND.arcPoints);
  });

  it("keeps the turn points in flight order, not appended at the end", async () => {
    const { pkg, resolved } = generateKmz(square(300), PARAMS, {
      createTimeMs: 1_700_000_000_000,
    });
    const entries = readKmzEntries(await downloaded(pkg.kmz));
    const xml = new TextDecoder().decode(entries["wpmz/waylines.wpml"]);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const marks = Array.from(doc.getElementsByTagName("Placemark"));

    marks.forEach((m, i) => {
      const [lng, lat] = m.getElementsByTagName("coordinates")[0].textContent!.trim()
        .split(",").map(Number);
      const point = resolved.grid.route[i];
      expect(distM({ lat, lng }, point.at)).toBeLessThan(0.02);
      expect(/takePhoto/.test(m.textContent ?? "")).toBe(point.photo);
    });
  });
});
