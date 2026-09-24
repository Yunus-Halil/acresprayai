// What the aircraft actually does, in order, in words.
//
// A survey grid drawn as coloured lines answers "where" and says nothing about
// "in what order". The operator standing in the field with a remote needs the
// second one: which corner it leaves from, which way it runs, where it ends up.
// Two plans can draw the identical picture and fly it in opposite directions.
//
// This turns the grid into the numbered list the preview shows and the map
// labels, so both are reading one description rather than each inventing their
// own. It computes nothing new: every position and count here already exists on
// the grid, and the arithmetic is bearing and distance between points the
// planner already placed.
import { type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng } from "../geo";
import type { SurveyGrid } from "./grid";
import { pathLengthM } from "./turnaround";

/**
 * Compass bearing from `a` to `b`, degrees clockwise from north.
 *
 * Flat-earth over a field, like the rest of this module: at survey scale the
 * spherical correction is far below the width of one frame.
 */
export function bearingDeg(a: LatLng2, b: LatLng2): number {
  const east = (b.lng - a.lng) * mPerDegLng(a.lat);
  const north = (b.lat - a.lat) * M_PER_DEG_LAT;
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const POINTS = [
  "north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west",
] as const;

/**
 * The bearing as a word.
 *
 * Eight points, not sixteen: "east-north-east" is precision the operator cannot
 * act on, and this is read aloud while looking at a field.
 */
export function compassPoint(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return POINTS[i];
}

/** Which corner of the survey area a point sits in, for naming the start. */
export function cornerName(p: LatLng2, all: LatLng2[]): string {
  if (!all.length) return "";
  const lats = all.map(q => q.lat), lngs = all.map(q => q.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const ns = p.lat >= midLat ? "north" : "south";
  const ew = p.lng >= midLng ? "east" : "west";
  return `${ns}-${ew}`;
}

export type RouteStepKind = "line" | "turn" | "finish";

export type RouteStep = {
  /** Position in the numbered list, 1-based, exactly as the operator reads it. */
  n: number;
  kind: RouteStepKind;
  /** Which survey line this is, 1-based. Null on turns and on the finish. */
  lineNumber: number | null;
  /** Direction of travel, or null where there is none to state. */
  headingDeg: number | null;
  compass: string | null;
  distanceM: number;
  photos: number;
  /** Waypoint numbers this step covers, 1-based and inclusive of both ends. */
  firstWaypoint: number | null;
  lastWaypoint: number | null;
  /** Where the step begins, for putting its badge on the map. */
  at: LatLng2 | null;
};

/**
 * The route as an ordered list of steps.
 *
 * Turns are their own steps rather than a footnote on the line before them,
 * because the transit between two lines is where the aircraft crosses ground it
 * is not photographing, and on a plan with an inset that transit can be the
 * part that passes closest to whatever is standing at the field edge.
 */
export function routeSteps(grid: SurveyGrid): RouteStep[] {
  const steps: RouteStep[] = [];
  let n = 0;
  let waypoint = 0;

  grid.legs.forEach((leg, i) => {
    if (i > 0) {
      const previous = grid.legs[i - 1];
      const arc = grid.turns[i - 1] ?? [];
      // The distance flown, not the distance between the two line ends. With a
      // turnaround the aircraft covers a half circle, which is pi/2 times the
      // straight gap, and quoting the gap would understate every turn.
      const flown = pathLengthM([previous.b, ...arc, leg.a]);
      // A serpentine grid sometimes turns in place, where the end of one line
      // is the start of the next. Nothing travelled, nothing to announce.
      if (flown > 0.5) {
        n += 1;
        steps.push({
          n, kind: "turn", lineNumber: null,
          headingDeg: bearingDeg(previous.b, leg.a),
          compass: compassPoint(bearingDeg(previous.b, leg.a)),
          distanceM: flown, photos: 0,
          // Turnaround points are waypoints in the file and have to be counted,
          // or every line number after the first turn would be wrong.
          firstWaypoint: arc.length ? waypoint + 1 : null,
          lastWaypoint: arc.length ? waypoint + arc.length : null,
          at: previous.b,
        });
      }
      waypoint += arc.length;
    }
    const first = waypoint + 1;
    waypoint += leg.captures.length;
    n += 1;
    steps.push({
      n, kind: "line", lineNumber: i + 1,
      headingDeg: bearingDeg(leg.a, leg.b),
      compass: compassPoint(bearingDeg(leg.a, leg.b)),
      distanceM: distM(leg.a, leg.b),
      photos: leg.captures.length,
      firstWaypoint: first, lastWaypoint: waypoint, at: leg.a,
    });
  });

  if (steps.length) {
    const last = grid.legs[grid.legs.length - 1];
    steps.push({
      n: n + 1, kind: "finish", lineNumber: null,
      headingDeg: null, compass: null, distanceM: 0, photos: 0,
      firstWaypoint: null, lastWaypoint: null, at: last.b,
    });
  }
  return steps;
}

/** Where the aircraft joins the route, and where it leaves it. */
export function routeEnds(grid: SurveyGrid): { start: LatLng2; end: LatLng2 } | null {
  if (!grid.legs.length) return null;
  return { start: grid.legs[0].a, end: grid.legs[grid.legs.length - 1].b };
}
