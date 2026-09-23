// A lawn-mower survey grid over one polygon, and the waypoints that fly it.
//
// DIFFERENT JOB FROM lib/mission.ts, WHICH IS WHY IT IS NOT THAT FUNCTION.
// `buildFieldSweep` sweeps MARKED ZONES for spraying: it groups nearby zones,
// limits boom-off hops, and orients every pass along the field's own principal
// axis so the passes lie with the crop rows. A survey grid covers the WHOLE
// polygon at an orientation the operator picked, and nothing about zones,
// grouping or hop limits applies. Forcing one function to do both would mean a
// pile of flags, each meaning "not the other job".
//
// What it does reuse is the geometry that was hard to get right: line-versus-
// ring intersection, the rotation trick that makes parallel lines tractable,
// and the containment tests. Those live in lib/geo.ts and are shared.
//
// THE ROTATION TRICK. Clipping arbitrary parallel lines against a polygon is
// fiddly; clipping HORIZONTAL lines is easy. So the polygon is rotated so that
// the requested flight direction becomes horizontal, the lines are generated
// and clipped there, and the results are rotated back. Every coordinate that
// leaves this module is in real latitude and longitude.
import {
  type LatLng2, M_PER_DEG_LAT, bboxOfRings, centroidOfRings, distM, mPerDegLng,
  rotateLL, segRingIntersections,
} from "../geo";
import { type CameraSpec, pointsAlongLeg } from "./camera";

/**
 * Which way the lines run.
 *
 * Compass directions, not the field's own axis: an operator who says east-west
 * means east-west. `auto` follows the polygon's longest axis, which produces
 * the fewest turns and is usually what someone wants when they have no reason
 * to prefer otherwise.
 */
export type FlightDirection = "ew" | "ns" | "auto";

export type GridParams = {
  direction: FlightDirection;
  /** Distance between neighbouring lines, metres. */
  lineSpacingM: number;
  /** Distance between shutter releases along a line, metres. */
  captureIntervalM: number;
  /**
   * Hold the lines this far inside the boundary, metres. Zero keeps the full
   * extent. Shares the planner's intent: the aircraft should not be flying the
   * fence line.
   */
  insetM?: number;
};

/** One straight line of the grid, already clipped to the polygon. */
export type GridLeg = {
  a: LatLng2;
  b: LatLng2;
  /** Capture positions along this leg, both ends included. */
  captures: LatLng2[];
};

export type SurveyGrid = {
  legs: GridLeg[];
  /** Every capture position in flight order. These become the waypoints. */
  waypoints: LatLng2[];
  /** Bearing the lines run along, degrees clockwise from north. */
  headingDeg: number;
  lineCount: number;
  /** Metres flown along the lines, excluding the hops between them. */
  lineDistanceM: number;
  /** Metres flown turning from one line to the next. */
  turnDistanceM: number;
};

/** Longest axis of the polygon, as a bearing in degrees clockwise from north. */
function longestAxisDeg(rings: LatLng2[][]): number {
  const bb = bboxOfRings(rings);
  const c = centroidOfRings(rings);
  const widthM = (bb.maxLng - bb.minLng) * mPerDegLng(c.lat);
  const heightM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
  // Wider than tall: fly east-west, which is a bearing of 90 degrees.
  return widthM >= heightM ? 90 : 0;
}

export function headingForDirection(direction: FlightDirection, rings: LatLng2[][]): number {
  if (direction === "ew") return 90;
  if (direction === "ns") return 0;
  return longestAxisDeg(rings);
}

/**
 * Build the grid.
 *
 * Returns an empty grid rather than throwing when the polygon is unusable or
 * the spacing swallows it whole: a plan with no lines is a state the UI has to
 * be able to show, and an exception here would just have to be caught and
 * turned back into one.
 */
export function buildSurveyGrid(rings: LatLng2[][], params: GridParams): SurveyGrid {
  const headingDeg = headingForDirection(params.direction, rings);
  const empty: SurveyGrid = {
    legs: [], waypoints: [], headingDeg, lineCount: 0, lineDistanceM: 0, turnDistanceM: 0,
  };
  if (!rings.length || !rings[0] || rings[0].length < 3) return empty;

  const spacing = Math.max(1, params.lineSpacingM);
  const centre = centroidOfRings(rings);

  // Rotate so the flight direction is horizontal. A heading of 90 (east-west)
  // is already horizontal, so the rotation is by (heading - 90).
  const angle = ((headingDeg - 90) * Math.PI) / 180;
  const cosF = Math.cos(-angle), sinF = Math.sin(-angle);
  const cosB = Math.cos(angle), sinB = Math.sin(angle);
  const toGrid = (p: LatLng2) => rotateLL(p, centre, cosF, sinF);
  const fromGrid = (p: LatLng2) => rotateLL(p, centre, cosB, sinB);

  const gridRings = rings.map(r => r.map(toGrid));
  const bb = bboxOfRings(gridRings);

  // Inset in degrees of latitude, which is what the line spacing walks through.
  const inset = Math.max(0, params.insetM ?? 0);
  const insetDegLat = inset / M_PER_DEG_LAT;
  const minLat = bb.minLat + insetDegLat;
  const maxLat = bb.maxLat - insetDegLat;
  if (!(maxLat > minLat)) return empty;

  const spacingDegLat = spacing / M_PER_DEG_LAT;
  const spanDegLat = maxLat - minLat;
  const lineCount = Math.max(1, Math.floor(spanDegLat / spacingDegLat) + 1);
  // Centre the lines in the span rather than starting hard at one edge, so a
  // polygon that is not an exact multiple of the spacing is covered evenly
  // instead of leaving the whole remainder against one side.
  const used = (lineCount - 1) * spacingDegLat;
  const startLat = minLat + (spanDegLat - used) / 2;

  const insetDegLng = inset / mPerDegLng(centre.lat);
  const legs: GridLeg[] = [];

  for (let i = 0; i < lineCount; i++) {
    const lat = startLat + i * spacingDegLat;
    const a = { lat, lng: bb.minLng - 1e-6 };
    const b = { lat, lng: bb.maxLng + 1e-6 };

    // Where this horizontal line crosses the polygon, as parameters along it.
    const ts: number[] = [];
    for (const ring of gridRings) ts.push(...segRingIntersections(a, b, ring));
    ts.sort((x, y) => x - y);
    // Crossings pair up into inside-spans. An odd count means the line grazed a
    // vertex; dropping the tail is safer than pairing across a gap that is
    // outside the polygon.
    for (let k = 0; k + 1 < ts.length; k += 2) {
      const lngA = a.lng + (b.lng - a.lng) * ts[k] + insetDegLng;
      const lngB = a.lng + (b.lng - a.lng) * ts[k + 1] - insetDegLng;
      if (!(lngB > lngA)) continue;
      legs.push({ a: { lat, lng: lngA }, b: { lat, lng: lngB }, captures: [] });
    }
  }
  if (!legs.length) return empty;

  // Serpentine: every other line is flown in reverse, so the aircraft turns
  // into the next line rather than flying back to the same side each time.
  const ordered = legs.map((leg, i) => (i % 2 === 1 ? { ...leg, a: leg.b, b: leg.a } : leg));

  const out: GridLeg[] = [];
  const waypoints: LatLng2[] = [];
  let lineDistanceM = 0;
  let turnDistanceM = 0;
  let previousEnd: LatLng2 | null = null;

  for (const leg of ordered) {
    const a = fromGrid(leg.a);
    const b = fromGrid(leg.b);
    const captures = pointsAlongLeg(a, b, params.captureIntervalM);
    out.push({ a, b, captures });
    lineDistanceM += distM(a, b);
    if (previousEnd) turnDistanceM += distM(previousEnd, a);
    previousEnd = b;
    waypoints.push(...captures);
  }

  return {
    legs: out,
    waypoints,
    headingDeg,
    lineCount: out.length,
    lineDistanceM,
    turnDistanceM,
  };
}

export type GridStats = {
  waypointCount: number;
  /** One photo per waypoint, which is how this grid is flown. */
  photoCount: number;
  distanceM: number;
  /** Seconds in the air, from the distance and the planned speed. Turns included. */
  flightTimeS: number;
};

/**
 * What the flight will cost in time and frames.
 *
 * Deliberately NOT a battery estimate. `computeMissionStats` owns that for
 * spray missions and it needs an aircraft's real specs; this planner knows a
 * camera and a speed, so it reports what those two support and stops there.
 */
export function gridStats(grid: SurveyGrid, speedMs: number): GridStats {
  const distanceM = grid.lineDistanceM + grid.turnDistanceM;
  const speed = Math.max(0.5, speedMs);
  return {
    waypointCount: grid.waypoints.length,
    photoCount: grid.waypoints.length,
    distanceM,
    flightTimeS: distanceM / speed,
  };
}

/** The camera and altitude a grid was built for, kept together for the record. */
export type CaptureContext = { camera: CameraSpec; altitudeM: number };
