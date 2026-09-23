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
import { CAMERAS, DEFAULT_CAMERA_KEY, captureIntervalM, footprintM, lineSpacingM } from "./camera";
import { type SurveyGrid, buildSurveyGrid, gridStats } from "./grid";
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
};

/**
 * Aircraft identity for the KMZ.
 *
 * UNKNOWN BY DEFAULT, ON PURPOSE. DJI publishes `droneEnumValue` only for its
 * enterprise airframes; no public table covers the consumer Air and Mini
 * series. `buildWpmlKmz` omits the whole `droneInfo` block when this is absent,
 * which is the existing behaviour and the safe one: a wrong code is a silent
 * rejection at import time, and an absent one is not.
 *
 * Fill it in from a known-working KMZ produced by the target aircraft, never
 * from a guess.
 */
export type DroneIdentity = { enumValue: number; subEnumValue: number } | null;

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
  });

  return {
    params,
    computed: {
      lineSpacingM: spacing,
      lineSpacingOverridden: params.lineSpacingM != null && params.lineSpacingM > 0,
      captureIntervalM: interval,
      footprintAcrossM: fp.acrossTrackM,
      footprintAlongM: fp.alongTrackM,
    },
    grid,
    stats: { ...gridStats(grid, params.speedMs), boundaryAreaM2: ringsAreaM2(rings) },
    blocker: blockerFor(grid.waypoints.length),
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

export class EmptyPlanError extends Error {
  constructor() {
    super("This boundary and these settings produce no flight lines. Check the boundary, or reduce the line spacing.");
    this.name = "EmptyPlanError";
  }
}

export type GenerateKmzOptions = {
  /** Epoch ms stamped into the file. Injectable so tests are deterministic. */
  createTimeMs: number;
  drone?: DroneIdentity;
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
  if (!resolved.grid.waypoints.length) throw new EmptyPlanError();

  const wps: WpmlWaypoint[] = resolved.grid.waypoints.map(p => ({
    lat: p.lat,
    lng: p.lng,
    alt: params.altitudeM,
    speed: params.speedMs,
    takePhoto: true,
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
    ...(opts.drone ? { drone: opts.drone } : {}),
  });

  return { pkg, resolved };
}

/** A filename a person can find again on a tablet. */
export function kmzFilename(fieldName: string, when: Date): string {
  const safe = (fieldName || "field").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const d = when.toISOString().slice(0, 10);
  return `${safe || "field"}-survey-${d}.kmz`;
}
