// The order the aircraft flies, not just the shape it draws.
//
// A survey grid drawn as coloured lines answers "where" and says nothing about
// "in what order". Two plans can draw the identical picture and fly it in
// opposite directions, starting from opposite corners, and the operator finds
// out once the aircraft is already moving.
//
// These tests pin the description that the map badges and the written list both
// read from, so the picture and the words cannot drift apart.
import { describe, expect, it } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng } from "@/lib/geo";
import { DEFAULT_FLIGHT_PLAN_PARAMS, resolveFlightPlan } from "@/lib/flightPlan/generateKmz";
import { bearingDeg, compassPoint, cornerName, routeEnds, routeSteps } from "@/lib/flightPlan/routeSteps";

const LAT0 = 38.95, LNG0 = -77.45;

const square = (sideM: number): LatLng2[][] => {
  const dLat = sideM / M_PER_DEG_LAT, dLng = sideM / mPerDegLng(LAT0);
  return [[
    { lat: LAT0, lng: LNG0 },
    { lat: LAT0, lng: LNG0 + dLng },
    { lat: LAT0 + dLat, lng: LNG0 + dLng },
    { lat: LAT0 + dLat, lng: LNG0 },
  ]];
};

const plan = (sideM: number, altitudeM = 60) =>
  resolveFlightPlan(square(sideM), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM });

describe("bearings, in the words an operator uses", () => {
  const from = { lat: LAT0, lng: LNG0 };
  const at = (northM: number, eastM: number) => ({
    lat: LAT0 + northM / M_PER_DEG_LAT, lng: LNG0 + eastM / mPerDegLng(LAT0),
  });

  it("measures clockwise from north", () => {
    expect(bearingDeg(from, at(100, 0))).toBeCloseTo(0, 1);
    expect(bearingDeg(from, at(0, 100))).toBeCloseTo(90, 1);
    expect(bearingDeg(from, at(-100, 0))).toBeCloseTo(180, 1);
    expect(bearingDeg(from, at(0, -100))).toBeCloseTo(270, 1);
  });

  it("names eight points, because sixteen is precision nobody can fly to", () => {
    expect(compassPoint(0)).toBe("north");
    expect(compassPoint(45)).toBe("north-east");
    expect(compassPoint(90)).toBe("east");
    expect(compassPoint(180)).toBe("south");
    expect(compassPoint(270)).toBe("west");
    // Rounds to the nearest point, and wraps rather than falling off the end.
    expect(compassPoint(350)).toBe("north");
    expect(compassPoint(-90)).toBe("west");
    expect(compassPoint(721)).toBe("north");
  });

  it("names the corner a point sits in", () => {
    const ring = square(100)[0];
    expect(cornerName({ lat: LAT0 + 0.0008, lng: LNG0 }, ring)).toBe("north-west");
    expect(cornerName({ lat: LAT0, lng: LNG0 + 0.0011 }, ring)).toBe("south-east");
  });
});

describe("the route, step by step", () => {
  it("numbers every step once, in flight order, with no gaps", () => {
    const steps = routeSteps(plan(300).grid);
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.map(s => s.n)).toEqual(steps.map((_, i) => i + 1));
  });

  it("alternates line and turn, and ends with the finish", () => {
    const steps = routeSteps(plan(300).grid);
    expect(steps[0].kind).toBe("line");
    expect(steps[1].kind).toBe("turn");
    expect(steps[steps.length - 1].kind).toBe("finish");
    // A turn is only ever between two lines, never at either end of the route.
    steps.forEach((s, i) => {
      if (s.kind !== "turn") return;
      expect(steps[i - 1].kind).toBe("line");
      expect(steps[i + 1].kind).toBe("line");
    });
  });

  it("accounts for every waypoint exactly once, in order", () => {
    // The numbers in the list are the numbers in the exported file. If these
    // drift, the operator checking a waypoint on the remote checks the wrong
    // one. Turnaround points are waypoints too and are numbered with the rest.
    const resolved = plan(300);
    const steps = routeSteps(resolved.grid);
    const lines = steps.filter(s => s.kind === "line");
    expect(lines.map(s => s.photos).reduce((a, b) => a + b, 0))
      .toBe(resolved.stats.photoCount);

    let expected = 1;
    for (const step of steps) {
      if (step.firstWaypoint == null) continue;
      expect(step.firstWaypoint).toBe(expected);
      expected = step.lastWaypoint! + 1;
    }
    expect(expected - 1).toBe(resolved.stats.waypointCount);
  });

  it("gives every line a number matching its place in the grid", () => {
    const resolved = plan(300);
    const lines = routeSteps(resolved.grid).filter(s => s.kind === "line");
    expect(lines.length).toBe(resolved.grid.lineCount);
    expect(lines.map(s => s.lineNumber)).toEqual(lines.map((_, i) => i + 1));
  });

  it("reverses direction on every other line, because the grid is a serpentine", () => {
    // The whole reason direction has to be shown: consecutive lines run
    // opposite ways, and a picture of parallel lines cannot say which.
    const lines = routeSteps(plan(300).grid).filter(s => s.kind === "line");
    expect(lines.length).toBeGreaterThan(2);
    for (let i = 1; i < lines.length; i++) {
      const turn = Math.abs(lines[i].headingDeg! - lines[i - 1].headingDeg!);
      expect(Math.min(turn, 360 - turn)).toBeCloseTo(180, 0);
    }
    expect(new Set(lines.map(s => s.compass)).size).toBe(2);
  });

  it("states a real distance for each turn, and no photos on any of them", () => {
    const resolved = plan(300);
    const turns = routeSteps(resolved.grid).filter(s => s.kind === "turn");
    expect(turns.length).toBe(resolved.grid.lineCount - 1);
    for (const t of turns) {
      expect(t.photos).toBe(0);
      expect(t.distanceM).toBeGreaterThan(0.5);
      expect(t.lineNumber).toBeNull();
      // A turn carries waypoints of its own now: the aircraft flies the arc,
      // it just does not photograph it. They are numbered with the rest,
      // because they are numbered with the rest inside the exported file.
      expect(t.firstWaypoint).not.toBeNull();
      expect(t.lastWaypoint!).toBeGreaterThanOrEqual(t.firstWaypoint!);
    }
    // The turns are the transit the grid already measured. One number, not two.
    const total = turns.reduce((a, t) => a + t.distanceM, 0);
    expect(total).toBeCloseTo(resolved.grid.turnDistanceM, 5);
    // And that is the distance FLOWN, a half circle, not the straight gap.
    // Quoting the gap would understate every turn by a third.
    const gap = distM(resolved.grid.legs[0].b, resolved.grid.legs[1].a);
    expect(turns[0].distanceM).toBeGreaterThan(gap * 1.4);
  });

  it("puts each line's badge where that line actually begins", () => {
    // The map draws a numbered badge at `at`. If it drifted to the far end the
    // numbering would read backwards and look authoritative doing it.
    const resolved = plan(300);
    const lines = routeSteps(resolved.grid).filter(s => s.kind === "line");
    lines.forEach((step, i) => {
      expect(distM(step.at!, resolved.grid.legs[i].a)).toBeLessThan(0.01);
    });
  });

  it("starts where the first line starts and ends where the last one ends", () => {
    const resolved = plan(300);
    const ends = routeEnds(resolved.grid)!;
    expect(distM(ends.start, resolved.grid.legs[0].a)).toBeLessThan(0.01);
    expect(distM(ends.end, resolved.grid.legs[resolved.grid.legs.length - 1].b)).toBeLessThan(0.01);
    // And the start is the first waypoint the file will carry.
    expect(distM(ends.start, resolved.grid.waypoints[0])).toBeLessThan(0.01);
    expect(distM(ends.end, resolved.grid.waypoints[resolved.grid.waypoints.length - 1]))
      .toBeLessThan(0.01);
  });

  it("describes a single-line plan without inventing a turn", () => {
    // A strip narrow enough for one pass. Two steps: fly it, finish.
    const resolved = plan(300);
    const oneLine = resolveFlightPlan(square(300), {
      ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 60, lineSpacingM: 10_000,
    });
    expect(oneLine.grid.lineCount).toBe(1);
    const steps = routeSteps(oneLine.grid);
    expect(steps.map(s => s.kind)).toEqual(["line", "finish"]);
    expect(resolved.grid.lineCount).toBeGreaterThan(1);
  });

  it("has nothing to say about an empty plan, rather than saying something wrong", () => {
    const empty = resolveFlightPlan([], DEFAULT_FLIGHT_PLAN_PARAMS);
    expect(routeSteps(empty.grid)).toEqual([]);
    expect(routeEnds(empty.grid)).toBeNull();
  });
});
