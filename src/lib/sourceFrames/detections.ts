// From a box the detector drew on a native crop to a place on the ground.
//
// Three pixel spaces, in order:
//   crop      what the detector saw: the window cut from the original photo
//   native    the original photo, as the camera wrote it
//   frame     the 2,400 px copy ODM reconstructed from: the space the camera
//             pose and lens are expressed in (odm.ts)
//
//   crop -> native   add the window's offset
//   native -> frame  divide by the scale measured on the decoded original
//   frame -> ground  the ray through that pixel, meeting the flat ground plane
//                    at the scan's estimated height (odm.ts pixelToGround)
//
// The ground is a plane at one height (ODM's average GSD gives it; no DSM),
// so a box lands where its ray meets that plane. The error that makes is
// (distance from the frame centre / flying height) times the height error;
// at the frame edge that is tens of centimetres per metre of height error.
// A detection is an experiment's yardstick: it is drawn on the map so a
// person can see whether the weed in the photo lands where the map says,
// and it decides nothing.
import type { LatLng2 } from "../geo";
import { type LatLngAlt, type Shot, type SourceFrameSet, pixelToGround, toEnu } from "./odm";
import type { AreaWindow } from "./crop";
import type { Detection } from "./benchTypes";

export type PxBox = { u: number; v: number; width: number; height: number };

export type GroundedDetection = {
  id: string;
  /** The finding the closer look was opened for, and its label. */
  findingId: string;
  findingTitle: string;
  /** The photograph the crop came from, by ODM's name. */
  frame: string;
  klass: string;
  confidence: number;
  /** Box centre and size in the crop the detector saw. */
  cropPx: { x: number; y: number; width: number; height: number };
  /** The same box in the original photo's pixels. */
  nativePx: PxBox;
  /** The same box in the uploaded frame's pixels: the camera pose's space. */
  framePx: PxBox;
  /** Where the box centre meets the ground. Null when the ray never does. */
  centre: LatLng2 | null;
  /** The four corners on the ground, clockwise from the top-left of the box. Null when any corner misses. */
  ring: LatLng2[] | null;
  /** The box on the ground, metres, from its corners. Null without a ring. */
  widthM: number | null;
  heightM: number | null;
  status: "ok" | "off_ground";
  /** The ground height the projection assumed, metres above the ellipsoid as ODM wrote it. */
  groundAltM: number;
  detectedAt: string;
};

export type GroundInput = {
  set: SourceFrameSet;
  shot: Shot;
  groundAltM: number;
  /** The crop's window in native pixels. */
  window: AreaWindow;
  /** Native width over uploaded width, measured on the decoded original. */
  scale: number;
  detections: Detection[];
  findingId: string;
  findingTitle: string;
  detectedAt: string;
};

const strip = (p: LatLngAlt): LatLng2 => ({ lat: p.lat, lng: p.lng });

/** Metres between two ground points, on the set's local plane. */
function metresBetween(set: SourceFrameSet, a: LatLng2, b: LatLng2, altM: number): number {
  const p = toEnu({ ...a, altM }, set.reference), q = toEnu({ ...b, altM }, set.reference);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/** Every box, carried from the crop to the ground. Pure; nothing is fetched or stored. */
export function groundDetections(input: GroundInput): GroundedDetection[] {
  const { set, shot, groundAltM, window: win, scale, detections } = input;
  return detections.map((d, i) => {
    const nativePx: PxBox = { u: d.x + win.x, v: d.y + win.y, width: d.width, height: d.height };
    const framePx: PxBox = { u: nativePx.u / scale, v: nativePx.v / scale, width: d.width / scale, height: d.height / scale };
    const centreG = pixelToGround(set, shot, framePx.u, framePx.v, groundAltM);
    const hw = framePx.width / 2, hh = framePx.height / 2;
    const corners = [
      [framePx.u - hw, framePx.v - hh], [framePx.u + hw, framePx.v - hh],
      [framePx.u + hw, framePx.v + hh], [framePx.u - hw, framePx.v + hh],
    ].map(([u, v]) => pixelToGround(set, shot, u, v, groundAltM));
    const ring = corners.every((c): c is LatLngAlt => !!c) ? corners.map(strip) : null;
    return {
      id: `${input.findingId}:${shot.filename}:${i}`,
      findingId: input.findingId, findingTitle: input.findingTitle, frame: shot.filename,
      klass: d.klass, confidence: d.confidence,
      cropPx: { x: d.x, y: d.y, width: d.width, height: d.height },
      nativePx, framePx,
      centre: centreG ? strip(centreG) : null,
      ring,
      widthM: ring ? metresBetween(set, ring[0], ring[1], groundAltM) : null,
      heightM: ring ? metresBetween(set, ring[1], ring[2], groundAltM) : null,
      status: centreG ? "ok" : "off_ground",
      groundAltM,
      detectedAt: input.detectedAt,
    };
  });
}

/** One line per detection for a debug table or a clipboard: every coordinate on the way to the ground. */
export function debugLine(d: GroundedDetection): string {
  const px = (b: PxBox) => `${b.u.toFixed(1)},${b.v.toFixed(1)} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`;
  const ground = d.centre ? `${d.centre.lat.toFixed(7)},${d.centre.lng.toFixed(7)}` : "off ground";
  const size = d.widthM != null && d.heightM != null ? ` ${d.widthM.toFixed(2)}x${d.heightM.toFixed(2)} m` : "";
  return `${d.klass} ${d.confidence.toFixed(2)} | crop ${d.cropPx.x.toFixed(1)},${d.cropPx.y.toFixed(1)} ${d.cropPx.width.toFixed(0)}x${d.cropPx.height.toFixed(0)} | native ${px(d.nativePx)} | frame ${px(d.framePx)} | ${d.frame} | ground ${ground}${size} | plane ${d.groundAltM.toFixed(1)} m`;
}
