// The orchard frames of the 2026-10-19 two-stage trial as harness fixtures (docs/features/two-stage-trial-2026-10-19.md;
// outputs on D:\swardus-research\weed-vision-lab-outputs\two-stage-trial-2026-10-19): per frame its zoom 22 raster,
// its fitted planting layout (layout-rows.json) and the RF-DETR windows run over it with the crop painted out
// (window-cache-layout.json), replayed from disk, so nothing calls the model. The layout predates the "expected"
// state's name; its "probable" and "ambiguous" plants are what the fitter now calls expected (c4454c2).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FieldRows } from "../../../src/lib/weedVision/fieldRows";
import type { FrameDetection } from "../../../src/lib/weedVision/frames";
import { latLngOfPx } from "../../../src/lib/weedVision/mapRun";
import { type LoadedFixture, asPlant } from "./fixture";

export const TRIAL_DIR = "D:/swardus-research/weed-vision-lab-outputs/two-stage-trial-2026-10-19";

/** The frame's stand-in map placement (meta.json): the photo's native pixel (x, y) is zoom 23 global (X0 + x * scale, Y0 + y * scale). */
export type TrialMeta = { frame: string; lat: number; lng: number; gsd_m: number; mpp23: number; scale_to_z23: number; z23: { X0: number; Y0: number; w: number; h: number }; z22: { X0: number; Y0: number; w: number; h: number } };

export const trialMeta = (frame: string, dir = TRIAL_DIR): TrialMeta => JSON.parse(readFileSync(join(dir, frame, "meta.json"), "utf8"));

export function trialFixture(frame: string, dir = TRIAL_DIR): LoadedFixture {
  const d = join(dir, frame);
  const meta = trialMeta(frame, dir);
  const { X0, Y0, w, h } = meta.z23;
  const ring = [latLngOfPx(X0, Y0, 23), latLngOfPx(X0 + w, Y0, 23), latLngOfPx(X0 + w, Y0 + h, 23), latLngOfPx(X0, Y0 + h, 23)];
  const rows: FieldRows = JSON.parse(readFileSync(join(d, "layout-rows.json"), "utf8"));
  for (const c of rows.ctx.crops) if ((c.state as string) === "probable" || (c.state as string) === "ambiguous") c.state = "expected";
  const cache: [string, { detections: FrameDetection[] }][] = JSON.parse(readFileSync(join(d, "window-cache-layout.json"), "utf8"));
  const plants = cache.flatMap(([, run]) => run.detections).filter(p => p.klass === "weed").map(asPlant);
  const raster = { z: 22, left: meta.z22.X0, top: meta.z22.Y0, width: meta.z22.w, height: meta.z22.h, rgba: new Uint8ClampedArray(readFileSync(join(d, "z22.rgba"))) };
  return { name: frame, crop: null, ring, raster, rows, plants, photoBased: false, truth: [] };
}
