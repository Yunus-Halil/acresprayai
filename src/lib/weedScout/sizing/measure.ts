// A spot carried into its original photo and measured there.
//
// The map put the plant at a lat/lng. The pose ODM recovered for the photo
// (sourceFrames/odm.ts) says which native pixel that is and how much ground
// one pixel covers THERE (depth over focal length: the far corner of a tilted
// frame has coarser pixels than its centre). A window around that pixel is
// cut from the original at the camera's own resolution, and segment.ts
// measures the plant in it. The crop plants the photo pass placed in the
// same photo (the spot's look) are handed over so a weed that leans on a
// tree is flagged and a tree is never measured as a weed.
//
// Pure given a cutter: the one thing that touches pixels is the function
// that cuts a window, so the same code runs on an ImageBitmap in the
// browser, on a decoded JPEG in the benchmark, and on a painted disc in a
// test. The flat-ground assumption is the pose's own (see odm.ts); its error
// at the plant is (distance from the frame centre over flying height) times
// the ground height error, and the view angle is recorded so a reader can
// see how far from nadir the plant was.
import type { PhotoPixels } from "../../photoScout/pattern";
import type { AreaWindow } from "../../sourceFrames/crop";
import { type Shot, type SourceFrameSet, projectToFrame } from "../../sourceFrames/odm";
import type { PhotoLook } from "../../sourceFrames/patternLook";
import type { Candidate } from "../types";
import { segmentWeed, vegetationThreshold } from "./segment";
import { type SizeThresholds, type WeedMeasurement, unavailableMeasurement } from "./types";

/** Cut a window of the original, in its native pixels; null when it cannot be cut. */
export type NativeCutter = (window: AreaWindow) => PhotoPixels | null;

/** The window is this many expected plant diameters a side... */
export const WINDOW_DIAMETERS = 6;
/** ...never under this many metres, so a small plant has soil around it... */
export const MIN_WINDOW_M = 1.0;
/** ...and never over this, so a canopy the window cannot hold is reported as such rather than read at any cost. */
export const MAX_WINDOW_M = 8.0;
/** The first window is at most this wide; a plant running past it gets one wider try. */
export const FIRST_WINDOW_MAX_M = 4.0;
/** When nothing says how big the plant is expected to be, metres. */
export const DEFAULT_EXPECTED_M = 0.2;
/** The soil-to-plant threshold is found on this many metres around the spot: the pass's own window, so the mask is the pass's mask at native resolution. */
export const CONTEXT_M = 4;

export type MeasureSpotInput = {
  set: SourceFrameSet;
  shot: Shot;
  groundAltM: number;
  nativeWidth: number;
  nativeHeight: number;
  candidate: Pick<Candidate, "centroid" | "blob">;
  /** The spot's look in this photo, for the crop's positions. Ignored when it is another photo's. */
  look: PhotoLook | null | undefined;
  thresholds: SizeThresholds;
  cut: NativeCutter;
};

/** A square window of `sidePx` about a point, clamped to the frame. */
export function squareWindow(centre: { x: number; y: number }, sidePx: number, width: number, height: number): AreaWindow {
  const side = Math.max(16, Math.round(sidePx));
  const w = Math.min(side, width), h = Math.min(side, height);
  const x = Math.round(Math.min(Math.max(0, centre.x - w / 2), width - w));
  const y = Math.round(Math.min(Math.max(0, centre.y - h / 2), height - h));
  return { x, y, width: w, height: h };
}

/** How big the plant is expected to be, metres, from the map's blob or the look's ring. */
export function expectedDiameterM(candidate: Pick<Candidate, "blob">, look: PhotoLook | null | undefined): number {
  if (candidate.blob && candidate.blob.equivDiameterM > 0) return candidate.blob.equivDiameterM;
  if (look?.focus?.matched && look.focus.r > 0) return 2 * look.focus.r * look.gsdM;
  return DEFAULT_EXPECTED_M;
}

export function measureSpotInPhoto(input: MeasureSpotInput): WeedMeasurement {
  const { set, shot, groundAltM, nativeWidth, nativeHeight, candidate, thresholds } = input;
  const cam = set.cameras[shot.cameraKey];
  if (!cam) return unavailableMeasurement("the photo's camera is not in the reconstruction", thresholds, shot.filename);
  if (!(nativeWidth > 0) || !(nativeHeight > 0)) return unavailableMeasurement("the original's size is not known", thresholds, shot.filename);
  const pr = projectToFrame(set, shot, { ...candidate.centroid, altM: groundAltM });
  if (!pr || !pr.inside) return unavailableMeasurement("the spot does not fall inside this photo", thresholds, shot.filename);
  const nativeScale = nativeWidth / cam.width;
  const gsdM = pr.gsdM / nativeScale;
  if (!(gsdM > 0)) return unavailableMeasurement("no pixel size could be read from the pose", thresholds, shot.filename);
  const centre = { x: pr.u * nativeScale, y: pr.v * nativeScale };
  const look = input.look && input.look.filename === shot.filename ? input.look : null;
  // The threshold from the pass's scale around the spot, found once; the window's own when the context has no contrast.
  const contextPx = input.cut(squareWindow(centre, CONTEXT_M / gsdM, nativeWidth, nativeHeight));
  const context = contextPx ? vegetationThreshold(contextPx) : null;
  let sideM = Math.min(FIRST_WINDOW_MAX_M, Math.max(MIN_WINDOW_M, WINDOW_DIAMETERS * expectedDiameterM(candidate, look)));
  for (let attempt = 0; ; attempt++) {
    const win = squareWindow(centre, sideM / gsdM, nativeWidth, nativeHeight);
    const px = input.cut(win);
    if (!px) return unavailableMeasurement("the window could not be cut from the photo", thresholds, shot.filename);
    const cropCircles = look
      ? look.circles.filter(c => c.cls === "on pattern" || c.cls === "double").map(c => ({ x: look.window.x + c.x - win.x, y: look.window.y + c.y - win.y, r: c.r }))
      : null;
    const out = segmentWeed({
      px, centre: { x: centre.x - win.x, y: centre.y - win.y }, gsdM, thresholds, cropCircles, context,
      photoEdge: { left: win.x === 0, top: win.y === 0, right: win.x + win.width >= nativeWidth, bottom: win.y + win.height >= nativeHeight },
      viewAngleDeg: pr.viewAngleDeg,
    });
    if (out.wider && attempt === 0 && sideM < MAX_WINDOW_M) { sideM = Math.min(MAX_WINDOW_M, sideM * 2); continue; }
    const m = out.measurement;
    return {
      ...m,
      sourceFrame: shot.filename,
      source: { frame: shot.filename, nativeWidth, nativeHeight, window: win, viewAngleDeg: +pr.viewAngleDeg.toFixed(1), groundAltM },
      outlinePx: m.outlinePx ? m.outlinePx.map(p => ({ x: p.x + win.x, y: p.y + win.y })) : null,
      centrePx: m.centrePx ? { x: +(m.centrePx.x + win.x).toFixed(1), y: +(m.centrePx.y + win.y).toFixed(1) } : null,
    };
  }
}

/** Whether a spot still wants measuring: nothing yet, or nothing could be read last time (a photo may have arrived since). */
export const wantsMeasurement = (c: Pick<Candidate, "measurement" | "region">): boolean =>
  !c.region && (!c.measurement || c.measurement.status === "unavailable");

/** Browser only. A cutter over a decoded original. */
export function cutterFromBitmap(bitmap: { width: number; height: number } & CanvasImageSource): NativeCutter {
  if (typeof document === "undefined") return () => null;
  return (win) => {
    const w = Math.min(win.width, bitmap.width - win.x), h = Math.min(win.height, bitmap.height - win.y);
    if (w <= 0 || h <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, win.x, win.y, w, h, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, rgba: data };
  };
}

export type OpenedOriginal = { cut: NativeCutter; width: number; height: number; close: () => void };

/** Browser only. Decode an original once; cut from it as often as needed; close it. */
export async function openOriginal(frame: Blob): Promise<OpenedOriginal | null> {
  if (typeof createImageBitmap === "undefined") return null;
  const bitmap = await createImageBitmap(frame, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) return null;
  return { cut: cutterFromBitmap(bitmap), width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
}
