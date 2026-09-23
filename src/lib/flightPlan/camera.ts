// What the camera sees from a given altitude, and how often it has to fire.
//
// THIS IS THE PIECE THAT DID NOT EXIST. The mission planner in lib/mission.ts
// plans a SPRAY route: where the boom opens and closes. A survey route is a
// different job with a different failure mode. A spray pass that is slightly
// too far apart leaves a strip untreated, which is visible. A survey pass whose
// photos are too far apart produces an orthomosaic with holes in it, or one
// that fails to reconstruct at all, and the operator does not find out until
// after the flight, on the ground, with the battery flat.
//
// So the numbers here are the ones that decide whether a flight was worth
// taking off for:
//
//   footprint  what one frame covers on the ground, from the lens and the
//              altitude. Two dimensions, and they are not interchangeable.
//   interval   how far the aircraft may travel between shutter releases and
//              still leave the required overlap along the line of travel.
//   spacing    how far apart the lines may be and still leave the required
//              overlap between neighbouring strips.
//
// ALONG-TRACK VERSUS ACROSS-TRACK IS NOT A DETAIL. A frame is rectangular. Flown
// the conventional way, with the long edge across the direction of travel, the
// SHORT edge is what the front overlap has to cover and the LONG edge is what
// the side overlap has to cover. Swapping them silently inflates the trigger
// interval by half as much again, and the resulting gaps look exactly like a
// windy day. `SENSOR_LONG_EDGE_ACROSS_TRACK` names that assumption rather than
// burying it.
import type { LatLng2 } from "../geo";
import { M_PER_DEG_LAT, mPerDegLng } from "../geo";

/**
 * The flight convention this module assumes: the frame's long edge lies across
 * the direction of travel.
 *
 * True for DJI's own mapping modes and for every mapping planner the author is
 * aware of. It is stated as a constant because if it were ever false, the
 * along-track and across-track footprints below would need to swap, and a wrong
 * answer here is invisible until the imagery fails to stitch.
 */
export const SENSOR_LONG_EDGE_ACROSS_TRACK = true;

/**
 * A camera, described by the two numbers that actually determine footprint.
 *
 * `focalLength35mm` is the 35mm-equivalent focal length, which is how drone
 * makers publish lens specs, and combined with the frame's aspect ratio it is
 * enough: the 35mm frame is 36mm x 24mm by definition, so an equivalent focal
 * length implies the angular field of view without needing the real sensor
 * size, which manufacturers state inconsistently.
 */
export type CameraSpec = {
  /** Display name, for the UI and for the record of what a plan assumed. */
  name: string;
  /** 35mm-equivalent focal length in millimetres. */
  focalLength35mm: number;
  /** Frame aspect ratio, long edge over short edge. 4:3 on most drone cameras. */
  aspect: number;
  /**
   * Where this came from. Following the aircraft directory's convention: a
   * figure with no source is a figure nobody has checked.
   */
  source: string | null;
};

/** The 35mm frame, by definition. Every equivalent focal length is relative to this. */
const FRAME_LONG_MM = 36;

/**
 * Cameras this planner knows.
 *
 * DELIBERATELY SHORT. Each entry is a claim about a real aircraft and needs a
 * source, exactly as `aircraftDirectory.json` requires one. An unknown aircraft
 * is better served by the operator typing a focal length than by this table
 * quietly guessing on their behalf.
 */
export const CAMERAS: Record<string, CameraSpec> = {
  "dji-air-3s-wide": {
    name: "DJI Air 3S, wide camera",
    // 24mm equivalent, 1/1.3-inch sensor, 4:3 native stills.
    focalLength35mm: 24,
    aspect: 4 / 3,
    source: "DJI Air 3S published specifications",
  },
  "dji-mavic-3e-wide": {
    name: "DJI Mavic 3 Enterprise, wide camera",
    focalLength35mm: 24,
    aspect: 4 / 3,
    source: "DJI Mavic 3 Enterprise published specifications",
  },
  generic24: {
    name: "Generic 24mm-equivalent camera",
    focalLength35mm: 24,
    aspect: 4 / 3,
    source: null,
  },
};

export const DEFAULT_CAMERA_KEY = "dji-air-3s-wide";

/** What one frame covers on the ground, in metres, at a given height above it. */
export type Footprint = {
  /** Across the direction of travel: what side overlap has to cover. */
  acrossTrackM: number;
  /** Along the direction of travel: what front overlap has to cover. */
  alongTrackM: number;
};

/**
 * Ground footprint of one frame.
 *
 * Similar triangles: the frame subtends the same angle whatever the distance,
 * so ground width is sensor width x (altitude / focal length), with both
 * expressed in 35mm-equivalent terms.
 */
export function footprintM(camera: CameraSpec, altitudeM: number): Footprint {
  const alt = Math.max(0, altitudeM);
  const longEdgeM = (FRAME_LONG_MM / camera.focalLength35mm) * alt;
  const shortEdgeM = longEdgeM / camera.aspect;
  return SENSOR_LONG_EDGE_ACROSS_TRACK
    ? { acrossTrackM: longEdgeM, alongTrackM: shortEdgeM }
    : { acrossTrackM: shortEdgeM, alongTrackM: longEdgeM };
}

/** Overlap as a fraction, clamped to something physically meaningful. */
const overlapFraction = (percent: number): number => Math.max(0, Math.min(0.95, percent / 100));

/**
 * How far the aircraft may travel between shutter releases.
 *
 * The remaining, non-overlapping part of the along-track footprint. At 75%
 * front overlap each frame advances a quarter of its own length.
 */
export function captureIntervalM(camera: CameraSpec, altitudeM: number, frontOverlapPct: number): number {
  const { alongTrackM } = footprintM(camera, altitudeM);
  return alongTrackM * (1 - overlapFraction(frontOverlapPct));
}

/**
 * How far apart neighbouring lines may be.
 *
 * The same arithmetic across the direction of travel. This is what the line
 * spacing field defaults to; the operator may override it, and overriding it
 * downward is how someone buys extra redundancy over difficult ground.
 */
export function lineSpacingM(camera: CameraSpec, altitudeM: number, sideOverlapPct: number): number {
  const { acrossTrackM } = footprintM(camera, altitudeM);
  return acrossTrackM * (1 - overlapFraction(sideOverlapPct));
}

/**
 * Ground sample distance, centimetres per pixel, when the sensor's pixel count
 * is known. Null when it is not: an invented GSD reads like a measured one.
 */
export function gsdCmPerPx(camera: CameraSpec, altitudeM: number, longEdgePx?: number): number | null {
  if (!longEdgePx || longEdgePx <= 0) return null;
  const { acrossTrackM } = footprintM(camera, altitudeM);
  const edgeM = SENSOR_LONG_EDGE_ACROSS_TRACK ? acrossTrackM : footprintM(camera, altitudeM).alongTrackM;
  return (edgeM / longEdgePx) * 100;
}

// ---------------------------------------------------------------------------
// Walking a line at a fixed interval
// ---------------------------------------------------------------------------

/**
 * Points along a straight leg, every `intervalM`, including both ends.
 *
 * THE POINT OF THE WHOLE MODULE. The previous tool fired the shutter only where
 * the path turned, which on a 400 m leg means two photos covering the ends and
 * nothing in between. These are the positions the camera actually has to fire
 * at, and they become waypoints in their own right, each carrying its own
 * trigger, rather than a second parallel list that the export then has to
 * reconcile against the route.
 *
 * Both ends are always included: the first frame anchors the start of the strip
 * and the last one its end, whatever the leg length happens to be modulo the
 * interval.
 */
export function pointsAlongLeg(a: LatLng2, b: LatLng2, intervalM: number): LatLng2[] {
  const mPerLng = mPerDegLng(a.lat);
  const dxM = (b.lng - a.lng) * mPerLng;
  const dyM = (b.lat - a.lat) * M_PER_DEG_LAT;
  const lengthM = Math.hypot(dxM, dyM);
  if (!(lengthM > 0)) return [a];
  const step = Math.max(0.5, intervalM);
  // Ceil, so the gap between the last interior point and the end is never
  // LARGER than the interval. Rounding down would leave a wider gap at the end
  // of every leg, which is the overlap failing exactly where the operator
  // cannot see it.
  const n = Math.max(1, Math.ceil(lengthM / step));
  const out: LatLng2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}
