// A photograph's rows for the model run, read the way the photo pass reads
// them: from the scan's saved reads when it has one (no decode), else the
// whole original decoded and read here and then saved, so the next run and
// the closer look take the saved read. Browser only (decodePhoto).
import { decodePhoto } from "../photoScout/decode";
import { analysePhotoOffThread } from "../photoScout/runPattern";
import { type Shot, pixelToGround, projectToFrame } from "../sourceFrames/odm";
import type { ScanSources } from "../sourceFrames/scan";
import { type PhotoReadStore, photoPassParams } from "../weedScout/photoPass";
import type { ScoutParams } from "../weedScout/types";
import { type RowContext, rowContextFromPattern } from "./rowFilter";

/** The row reader a model run uses: the saved read of a photo, else read now with the scout's settings and the frame's ground sampling. */
export function makeRowContextFor(sources: ScanSources | null, store: PhotoReadStore | null, passParams: Pick<ScoutParams, "rowSpacingAuto" | "rowSpacingM" | "minBlobCm2"> | null) {
  return (filename: string, blob: Blob, shot: Shot, onProgress: (f: number) => void, signal: AbortSignal): Promise<RowContext | null> | null => {
    const set = sources?.set;
    if (!set || sources.groundAltM == null) return null;
    const cam = set.cameras[shot.cameraKey];
    const centre = pixelToGround(set, shot, cam.width / 2, cam.height / 2, sources.groundAltM);
    const pr = centre ? projectToFrame(set, shot, centre) : null;
    if (!pr) return null;
    return rowContextForPhoto({ blob, filename, frameGsdM: pr.gsdM, frameWidth: cam.width, passParams: photoPassParams(passParams ?? { rowSpacingAuto: true, rowSpacingM: 0.762, minBlobCm2: 1 }), store, onProgress, signal });
  };
}

export type PhotoRowsInput = {
  blob: Blob;
  filename: string;
  /** Ground metres per pixel of the frame ODM posed (cam.width wide), at the frame's centre. */
  frameGsdM: number;
  frameWidth: number;
  passParams: ReturnType<typeof photoPassParams>;
  store: PhotoReadStore | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/** The rows and crop plants of one photograph in its original pixels, or null when none were read. */
export async function rowContextForPhoto(input: PhotoRowsInput): Promise<RowContext | null> {
  const saved = input.store?.get(input.filename);
  if (saved) return rowContextFromPattern(saved.pattern, saved.nativeWidth / saved.decodedWidth);
  if (typeof createImageBitmap === "undefined") return null;
  const decoded = await decodePhoto(input.blob);
  decoded.bitmap.close?.();
  const nativeScale = decoded.nativeWidth / decoded.pixels.width;
  // Native metres per pixel from the posed frame's, then the decoded copy's.
  const nativeGsdM = (input.frameGsdM * input.frameWidth) / decoded.nativeWidth;
  const pattern = await analysePhotoOffThread(
    decoded.pixels,
    { gsdM: nativeGsdM * nativeScale, ...input.passParams },
    { onProgress: (done, total) => input.onProgress?.(total ? done / total : 0), transfer: true, signal: input.signal },
  );
  void input.store?.put(input.filename, { pattern, decodedWidth: decoded.pixels.width, nativeWidth: decoded.nativeWidth });
  return rowContextFromPattern(pattern, nativeScale);
}
