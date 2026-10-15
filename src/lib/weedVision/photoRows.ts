// A photograph's rows for the model run, read the way the photo pass reads
// them: from the scan's saved reads when it has one (no decode), else the
// whole original decoded and read here and then saved, so the next run and
// the closer look take the saved read. Browser only (decodePhoto).
import { decodePhoto } from "../photoScout/decode";
import { analysePhotoOffThread } from "../photoScout/runPattern";
import type { PhotoReadStore, photoPassParams } from "../weedScout/photoPass";
import { type RowContext, rowContextFromPattern } from "./rowFilter";

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
