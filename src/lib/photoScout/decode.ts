// Decode a photo in the browser to the pixels the pattern pass reads.
//
// Originals are 12 to 48 megapixels; the mask, the index and the component
// pass each hold one number per pixel, so the photo is drawn down to a
// budget. The scale is returned so the pixel size can be corrected: a photo
// drawn at half size has pixels twice as large on the ground. Browser only
// (canvas); nothing in lib/photoScout/pattern.ts needs it.
import type { PhotoPixels } from "./pattern";

export const MAX_EDGE_PX = 4096;

export type DecodedPhoto = {
  pixels: PhotoPixels;
  bitmap: ImageBitmap;
  nativeWidth: number;
  nativeHeight: number;
  /** Decoded width over native width; 1 when nothing was downsized. */
  scale: number;
};

export async function decodePhoto(file: Blob, maxEdge = MAX_EDGE_PX): Promise<DecodedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser gave no drawing context for the photo.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { pixels: { width, height, rgba: data }, bitmap, nativeWidth: bitmap.width, nativeHeight: bitmap.height, scale };
}
