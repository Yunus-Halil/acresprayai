// Stage 1: every photograph read once. Its DJI header, a quarter-size decode, the green patches in it (the
// ties' and the calibration's material) and a grey raster with its green mask for the soil ties.
// The port of scripts/directGeoref/run.ts's per-photo loop; nothing is written anywhere.
import { type DjiPhotoMeta, type GreyRaster, type PixelObject, parseDjiHeader, vegetationObjects } from "../../directGeoref";
import type { PhotoPixels } from "../../photoScout/pattern";
import { vegetationMask } from "../../weedVision/fieldRows";
import { type BuildHooks, type PhotoSource, checkCancelled } from "./types";

export type PhotoRead = {
  name: string;
  meta: DjiPhotoMeta;
  /** The decoded picture's dimensions (the camera's preview, or the `down` decode). */
  viewW: number;
  viewH: number;
  /** Original pixels per decoded pixel, measured (5.7 for the DJI preview, 4 for a quarter decode). */
  down: number;
  /** Where the pixels came from. */
  source: "preview" | "decode";
  objects: PixelObject[];
  /** Grey as bytes (a quarter-size photograph is 1.25 MB this way, five times less than floats); the ties read it by index. */
  grey: GreyRaster;
};

/** A grey raster with its green mask, bytes rather than floats. */
export function greyRasterBytes(px: PhotoPixels, toOriginal: number): GreyRaster {
  const n = px.width * px.height, grey = new Uint8Array(n);
  for (let i = 0; i < n; i++) grey[i] = Math.round(0.299 * px.rgba[i * 4] + 0.587 * px.rgba[i * 4 + 1] + 0.114 * px.rgba[i * 4 + 2]);
  return { width: px.width, height: px.height, grey, green: vegetationMask(px), toOriginal };
}

export type PhotoRefusal = { name: string; reason: string };

/** Read every photograph: the ones whose header holds no camera are refused with the reason and left out. `metas` replaces the headers (photographs placed by matching). */
export async function readPhotographs(photos: PhotoSource[], down: number, hooks: BuildHooks = {}, usePreview = true, metas?: Map<string, DjiPhotoMeta>): Promise<{ reads: PhotoRead[]; refused: PhotoRefusal[] }> {
  const reads: PhotoRead[] = [], refused: PhotoRefusal[] = [];
  const t0 = Date.now();
  for (const [i, p] of photos.entries()) {
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "photographs", done: i, total: photos.length, message: p.name, elapsedMs: Date.now() - t0 });
    let meta: DjiPhotoMeta;
    try { meta = metas?.get(p.name) ?? parseDjiHeader(await p.header()); } catch (e) { refused.push({ name: p.name, reason: `header unreadable: ${(e as Error).message}` }); continue; }
    if (meta.lat == null || meta.lng == null) { refused.push({ name: p.name, reason: "no camera position in the file" }); continue; }
    if (meta.relativeAltitudeM == null) { refused.push({ name: p.name, reason: "no RelativeAltitude in the file" }); continue; }
    if (meta.gimbalYawDeg == null || meta.gimbalPitchDeg == null) { refused.push({ name: p.name, reason: "no gimbal yaw/pitch in the file" }); continue; }
    let px: PhotoPixels | null = null, source: PhotoRead["source"] = "decode";
    try {
      if (usePreview) { px = await p.preview(); if (px) source = "preview"; }
      if (!px) px = await p.decode(down);
    } catch (e) { refused.push({ name: p.name, reason: `could not decode: ${(e as Error).message}` }); continue; }
    // The ratio of original to decoded pixels: the header's size over the picture's; a header without a size
    // takes the decode factor (a preview needs the header's size, so it is refused without one).
    if (!meta.width || !meta.height) { if (source === "preview") { refused.push({ name: p.name, reason: "the header has no image size, so the preview's scale is unknown" }); continue; } meta.width = px.width * down; meta.height = px.height * down; }
    const ratio = meta.width / px.width;
    if (Math.abs(meta.height / px.height - ratio) > 0.02) { refused.push({ name: p.name, reason: `the decoded picture (${px.width} x ${px.height}) is not a uniform rescale of the header's ${meta.width} x ${meta.height}` }); continue; }
    const objects = vegetationObjects(px, ratio);
    reads.push({ name: p.name, meta, viewW: px.width, viewH: px.height, down: ratio, source, objects, grey: greyRasterBytes(px, ratio) });
    hooks.log?.(`${p.name}: ${objects.length} green patches`);
  }
  hooks.onProgress?.({ stage: "photographs", done: photos.length, total: photos.length, message: `${reads.length} photographs read`, elapsedMs: Date.now() - t0 });
  return { reads, refused };
}
