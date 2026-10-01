// Cut a finding out of a retained photograph at the photograph's own
// resolution, framed the way the classifier's chips are framed.
//
// The pose was recovered from the frame ODM was given (the 2,400 px copy); the
// retained original is the same frame at `scale` times the size, same lens,
// same principal point in normalised terms, so a pixel scales exactly.
import type { ChipPixels } from "../weedScout/classify/preprocess";

export type CropWindow = { x: number; y: number; size: number; scale: number };

/**
 * The square to cut, in native pixels. `u`, `v` are in the uploaded frame;
 * `scale` is native width over uploaded width; `spanPx` is the side wanted in
 * native pixels. The window is clamped to the frame and never grows past it.
 */
export function cropWindow(u: number, v: number, scale: number, spanPx: number, nativeWidth: number, nativeHeight: number): CropWindow {
  const size = Math.max(2, Math.min(Math.round(spanPx), nativeWidth, nativeHeight));
  const cx = u * scale, cy = v * scale;
  const x = Math.round(Math.min(Math.max(0, cx - size / 2), nativeWidth - size));
  const y = Math.round(Math.min(Math.max(0, cy - size / 2), nativeHeight - size));
  return { x, y, size, scale };
}

export type NativeCrop = {
  dataUrl: string;
  pixels: ChipPixels;
  window: CropWindow;
  /** Ground metres across the crop. */
  spanM: number;
  gsdM: number;
};

/** Browser only. Decodes the frame, cuts the window, returns both a picture and the classifier's pixels. */
export async function cropNative(frame: Blob, u: number, v: number, uploadedGsdM: number, scale: number, spanM: number): Promise<NativeCrop | null> {
  if (typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(frame).catch(() => null);
  if (!bitmap) return null;
  try {
    const gsdM = uploadedGsdM / scale;
    const w = cropWindow(u, v, scale, spanM / gsdM, bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w.size; canvas.height = w.size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, w.x, w.y, w.size, w.size, 0, 0, w.size, w.size);
    const data = ctx.getImageData(0, 0, w.size, w.size);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      pixels: { rgba: data.data, width: w.size, height: w.size, spanM: w.size * gsdM },
      window: w, spanM: w.size * gsdM, gsdM,
    };
  } finally {
    bitmap.close?.();
  }
}
