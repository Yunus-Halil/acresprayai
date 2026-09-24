// (boundary, params) -> a DJI KMZ. Pure, so it can be tested without a browser,
// a database or an API layer.
//
// This is the seam the whole feature hangs on: everything above it is UI and
// storage, everything below it is geometry and XML. Nothing here reads state,
// takes a clock it was not given, or touches the network.
import type { LatLng2 } from "../geo";
import { ringsAreaM2 } from "../geo";
import {
  MAX_CONSUMER_WAYPOINTS, type WpmlPackage, type WpmlWaypoint, buildWpmlKmzFromWaypoints,
} from "../wpml";
import {
  CAMERAS, DEFAULT_CAMERA_KEY, type DroneIdentity, captureIntervalM, footprintM, lineSpacingM,
} from "./camera";
import { type SurveyGrid, buildSurveyGrid, gridStats } from "./grid";
import {
  DEFAULT_TURNAROUND, minTurnRadiusM, turnIsTight, turnRadiusM, turnaroundExcursionM,
} from "./turnaround";
import type { FlightDirection } from "./grid";

/** Everything the operator chose. Stored verbatim, so a plan can be reopened. */
export type FlightPlanParams = {
  direction: FlightDirection;
  altitudeM: number;
  /** Override for the computed line spacing. Null means "use the overlap". */
  lineSpacingM: number | null;
  frontOverlapPct: number;
  sideOverlapPct: number;
  /** -90 is straight down. */
  gimbalPitchDeg: number;
  speedMs: number;
  /** Key into CAMERAS. */
  cameraKey: string;
  /** Hold the lines this far inside the boundary, metres. */
  insetM: number;
  /**
   * How far past the end of a line the aircraft carries on before it turns,
   * metres. Zero gives a clean half circle, which is already flyable; raising
   * it buys settling distance and flies further outside the boundary.
   */
  turnOvershootM: number;
};

export const DEFAULT_FLIGHT_PLAN_PARAMS: FlightPlanParams = {
  direction: "auto",
  altitudeM: 100,
  lineSpacingM: null,
  frontOverlapPct: 75,
  sideOverlapPct: 75,
  gimbalPitchDeg: -90,
  speedMs: 6,
  cameraKey: DEFAULT_CAMERA_KEY,
  insetM: 0,
  turnOvershootM: 0,
};

/**
 * Aircraft identity for the KMZ.
 *
 * Normally comes from the chosen camera (see `CAMERAS` in camera.ts, where each
 * known airframe carries its own code and its provenance). A caller may pass
 * one to override that, and passing `null` forces the block to be omitted.
 *
 * Where no identity is available the export writes no `droneInfo` at all, which
 * is deliberate: DJI publishes these codes for enterprise airframes only, and a
 * wrong code is a silent rejection at import time where an absent block is not.
 */
export type { DroneIdentity } from "./camera";

export type FlightPlanResolved = {
  params: FlightPlanParams;
  /** What the params work out to, after the camera and altitude have their say. */
  computed: {
    lineSpacingM: number;
    /** True when the operator overrode the overlap-derived spacing. */
    lineSpacingOverridden: boolean;
    captureIntervalM: number;
    footprintAcrossM: number;
    footprintAlongM: number;
    turnRadiusM: number;
    minTurnRadiusM: number;
    turnExcursionM: number;
    turnsAreTight: boolean;
  };
  grid: SurveyGrid;
  stats: ReturnType<typeof gridStats> & { boundaryAreaM2: number };
  /**
   * Why this plan cannot be exported, or null.
   *
   * Checked here rather than only at download, because the operator is adjusting
   * altitude and overlap with a live preview in front of them and a route that
   * is 40 waypoints over the ceiling should say so while they can still fix it,
   * not after they press the button.
   */
  blocker: string | null;
  /**
   * True when the altitude is low enough that the aircraft is flying among
   * things rather than over them. Not a blocker: a low pass is a legitimate
   * plan. It is surfaced so the UI can make the operator say so out loud.
   */
  lowAltitude: boolean;
};

/**
 * Work out the grid and everything the UI needs to describe it.
 *
 * Separate from the KMZ so the live preview and the export cannot disagree:
 * the map draws `grid.legs`, the stats panel reads `stats`, and the exporter
 * turns the same `grid.waypoints` into placemarks.
 */
export function resolveFlightPlan(rings: LatLng2[][], params: FlightPlanParams): FlightPlanResolved {
  const camera = CAMERAS[params.cameraKey] ?? CAMERAS[DEFAULT_CAMERA_KEY];
  const fp = footprintM(camera, params.altitudeM);
  const derivedSpacing = lineSpacingM(camera, params.altitudeM, params.sideOverlapPct);
  const spacing = params.lineSpacingM != null && params.lineSpacingM > 0
    ? params.lineSpacingM
    : derivedSpacing;
  const interval = captureIntervalM(camera, params.altitudeM, params.frontOverlapPct);

  const grid = buildSurveyGrid(rings, {
    direction: params.direction,
    lineSpacingM: spacing,
    captureIntervalM: interval,
    insetM: params.insetM,
    turnaround: { ...DEFAULT_TURNAROUND, overshootM: params.turnOvershootM ?? 0 },
  });

  return {
    params,
    computed: {
      lineSpacingM: spacing,
      lineSpacingOverridden: params.lineSpacingM != null && params.lineSpacingM > 0,
      captureIntervalM: interval,
      footprintAcrossM: fp.acrossTrackM,
      footprintAlongM: fp.alongTrackM,
      /** Radius of the turn the line spacing implies. */
      turnRadiusM: turnRadiusM(spacing),
      /** Tightest turn the aircraft holds at the planned speed. */
      minTurnRadiusM: minTurnRadiusM(params.speedMs),
      /**
       * How far outside the survey lines the turn reaches. The distance beyond
       * the end of every line that has to be clear of trees, poles and
       * buildings, and the only place the route leaves the drawn area.
       */
      turnExcursionM: turnaroundExcursionM(spacing, {
        ...DEFAULT_TURNAROUND, overshootM: params.turnOvershootM ?? 0,
      }),
      /** The turns are tighter than the aircraft can hold at this speed. */
      turnsAreTight: turnIsTight(spacing, params.speedMs),
    },
    grid,
    stats: { ...gridStats(grid, params.speedMs), boundaryAreaM2: ringsAreaM2(rings) },
    blocker: blockerFor(grid.route.length),
    lowAltitude: isLowAltitude(params.altitudeM),
  };
}

/**
 * The one reason a resolved plan cannot become a file.
 *
 * The waypoint ceiling is a real airframe limit, not a formatting preference:
 * `wpml.ts` refuses past it rather than truncating, because a route that
 * quietly loses its last waypoints flies a partial survey the operator believes
 * was complete. Raising the altitude is the first lever because it widens both
 * the footprint and the spacing at once.
 */
export function blockerFor(waypointCount: number): string | null {
  if (waypointCount === 0) {
    return "These settings produce no flight lines over this boundary. Reduce the line spacing, or check the boundary.";
  }
  if (waypointCount > MAX_CONSUMER_WAYPOINTS) {
    return `This plan needs ${waypointCount} waypoints and the aircraft accepts ${MAX_CONSUMER_WAYPOINTS}. ` +
      "Fly higher, reduce the overlap, or split the field into two flights.";
  }
  return null;
}

/**
 * The range of altitudes the planner offers.
 *
 * NOT a safety limit. `LOW_ALTITUDE_M` and the confirmation it triggers are the
 * safety limit, and they warn rather than refuse. This pair is the range in
 * which the arithmetic still describes a survey: DJI's own take-off security
 * height bottoms out at 1.2 m, and below a metre a frame covers less ground
 * than the aircraft is wide.
 *
 * The floor was 5 m, picked for no stated reason, and an operator trying to
 * plan lower met a box that went orange and said nothing. A limit nobody can
 * read is not a limit, it is a fault.
 */
export const MIN_ALTITUDE_M = 1;
export const MAX_ALTITUDE_M = 500;

/**
 * Below this height the aircraft is inside the landscape rather than above it.
 *
 * 20 m is roughly 65 ft, which is under the mature height of the trees that
 * line most field edges, and under the top of a grain leg, a pole or a span of
 * wire. The figure is a judgement, not a regulation: nothing in FAA Part 107
 * sets a floor, and the ceiling (400 ft AGL) is the limit that has a number.
 * It is set where it is because the planner CANNOT see obstacles. It flies
 * straight lines across a polygon from an aerial outline, with no terrain
 * model, no obstacle database and no forward sensing in the plan itself.
 */
export const LOW_ALTITUDE_M = 20;

/** Whether a plan flies low enough to need the operator to confirm it. */
export const isLowAltitude = (altitudeM: number): boolean =>
  Number.isFinite(altitudeM) && altitudeM > 0 && altitudeM < LOW_ALTITUDE_M;

/**
 * What the operator is told, in one place so the card, the panel and the
 * confirmation cannot drift apart.
 *
 * Takes altitudes already formatted in the operator's own units, because this
 * module knows metres and the unit setting belongs to the UI.
 *
 * DELIBERATELY NOT REASSURING, and deliberately not a prescription. It names
 * what the planner does not know rather than promising a safe alternative,
 * because "fly at 30 m instead" would be exactly the kind of confident
 * instruction this planner has no basis for.
 */
export function lowAltitudeCaution(shownAltitude: string, shownThreshold: string): string {
  return `This plan flies at ${shownAltitude}. Below about ${shownThreshold} the aircraft is at the ` +
    "height of mature trees, poles, wires and farm structures. This planner draws straight lines " +
    "over a boundary: it has no terrain model, no obstacle data, and no knowledge of what is " +
    "standing in this field. Walk or overfly the route before flying it.";
}

export class EmptyPlanError extends Error {
  constructor() {
    super("This boundary and these settings produce no flight lines. Check the boundary, or reduce the line spacing.");
    this.name = "EmptyPlanError";
  }
}

export type GenerateKmzOptions = {
  /** Epoch ms stamped into the file. Injectable so tests are deterministic. */
  createTimeMs: number;
  /**
   * Override the chosen camera's aircraft code. `null` forces the `droneInfo`
   * block to be omitted; omitting the field entirely uses the camera's own.
   */
  drone?: DroneIdentity | null;
  author?: string;
};

/**
 * The export.
 *
 * EVERY WAYPOINT CARRIES A SHUTTER RELEASE. That is the whole difference
 * between this and a route that merely flies the right shape. The waypoints
 * were placed at the capture interval in the first place (see camera.ts), so
 * there is no second list of capture points to reconcile against the route:
 * one list, each entry triggering on arrival.
 */
export function generateKmz(
  rings: LatLng2[][],
  params: FlightPlanParams,
  opts: GenerateKmzOptions,
): { pkg: WpmlPackage; resolved: FlightPlanResolved } {
  const resolved = resolveFlightPlan(rings, params);
  if (!resolved.grid.route.length) throw new EmptyPlanError();
  // The caller's override wins, including an explicit null, which is how a
  // caller forces the block to be omitted. Otherwise the chosen airframe's own
  // code, when one has been read off a file that aircraft accepted.
  const camera = CAMERAS[params.cameraKey] ?? CAMERAS[DEFAULT_CAMERA_KEY];
  const droneId = opts.drone !== undefined ? opts.drone : (camera.drone ?? null);

  // The whole route, turns included. A turnaround point is a real waypoint the
  // aircraft flies; it just does not photograph there, because it is outside
  // the survey area and pointing the wrong way.
  const wps: WpmlWaypoint[] = resolved.grid.route.map(p => ({
    lat: p.at.lat,
    lng: p.at.lng,
    alt: params.altitudeM,
    speed: params.speedMs,
    takePhoto: p.photo,
    gimbalPitchDeg: params.gimbalPitchDeg,
  }));

  const pkg = buildWpmlKmzFromWaypoints(wps, {
    author: opts.author ?? "SwathWise",
    createTimeMs: opts.createTimeMs,
    transitSpeed: params.speedMs,
    autoFlightSpeed: params.speedMs,
    // Climb clear of anything at the launch point before the route starts.
    // DJI accepts [1.2, 1500]; 20 m clears a hedge and a parked vehicle.
    takeOffSecurityHeightM: 20,
    finishAction: "goHome",
    exitOnRCLost: "executeLostAction",
    executeRCLostAction: "goBack",
    ...(droneId ? { drone: droneId } : {}),
  });

  return { pkg, resolved };
}

/** A filename a person can find again on a tablet. */
export function kmzFilename(fieldName: string, when: Date): string {
  const safe = (fieldName || "field").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const d = when.toISOString().slice(0, 10);
  return `${safe || "field"}-survey-${d}.kmz`;
}
