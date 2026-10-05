// The closer look: the area a finding covers, cut out of the original
// photograph at the camera's own resolution, with the finding's outline drawn
// on it so the operator sees exactly which ground the map flagged.
//
// The pose was recovered from the frame ODM was given (the 2,400 px copy); the
// kept original is the same frame at `scale` times the size, same lens, so a
// pixel scales exactly.

export type AreaWindow = { x: number; y: number; width: number; height: number };

/** Margin around the outline, as a fraction of its larger side, so the edge has context. */
export const CONTEXT_MARGIN = 0.25;
/** Smallest window side in native pixels, so a tiny finding still shows its surroundings. */
export const MIN_WINDOW_PX = 400;

/**
 * The rectangle to cut, in native pixels: the outline's box in the uploaded
 * frame, scaled, grown by the margin, at least MIN_WINDOW_PX a side, clamped
 * to the frame.
 */
export function areaWindow(
  box: { x0: number; y0: number; x1: number; y1: number },
  scale: number, nativeWidth: number, nativeHeight: number, margin = CONTEXT_MARGIN,
): AreaWindow {
  const w = (box.x1 - box.x0) * scale, h = (box.y1 - box.y0) * scale;
  const grow = Math.max(w, h) * margin;
  const side = (len: number) => Math.min(Math.max(len + 2 * grow, MIN_WINDOW_PX), Math.max(nativeWidth, nativeHeight));
  const width = Math.min(side(w), nativeWidth), height = Math.min(side(h), nativeHeight);
  const cx = ((box.x0 + box.x1) / 2) * scale, cy = ((box.y0 + box.y1) / 2) * scale;
  const x = Math.round(Math.min(Math.max(0, cx - width / 2), nativeWidth - width));
  const y = Math.round(Math.min(Math.max(0, cy - height / 2), nativeHeight - height));
  return { x, y, width: Math.round(width), height: Math.round(height) };
}

export type CloserLook = {
  /** Object URL of the rendered JPEG; revoke when done. */
  url: string;
  /** The same window with nothing drawn on it, for a detector. */
  clean: Blob;
  width: number;
  height: number;
  window: AreaWindow;
  /** Ground metres per pixel in this image. */
  gsdM: number;
  /** Native width over uploaded width, as used for this window: measured on the decoded original when `uploadedWidth` was given. */
  scale: number;
  originalWidth: number;
  originalHeight: number;
};

/**
 * Browser only. Decode the original, cut the window, draw the outline, hand
 * back an object URL. With `uploadedWidth` the scale is measured on the
 * decoded original rather than taken from EXIF, so a box drawn on this crop
 * can be carried back to the frame the pose is expressed in.
 */
export async function renderCloserLook(
  frame: Blob, outlinePx: { u: number; v: number }[], box: { x0: number; y0: number; x1: number; y1: number },
  exifScale: number, uploadedGsdM: number, uploadedWidth?: number,
): Promise<CloserLook | null> {
  if (typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(frame).catch(() => null);
  if (!bitmap) return null;
  try {
    const scale = uploadedWidth ? bitmap.width / uploadedWidth : exifScale;
    const win = areaWindow(box, scale, bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = win.width; canvas.height = win.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, win.x, win.y, win.width, win.height, 0, 0, win.width, win.height);
    // The same pixels before anything is drawn on them: what a detector is shown.
    const clean = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!clean) return null;
    if (outlinePx.length >= 3) {
      ctx.lineWidth = Math.max(3, Math.round(win.width / 500));
      ctx.strokeStyle = "#fbbf24";
      ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 2]);
      ctx.beginPath();
      outlinePx.forEach((p, i) => {
        const x = p.u * scale - win.x, y = p.v * scale - win.y;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), clean, width: win.width, height: win.height, window: win, gsdM: uploadedGsdM / scale, scale, originalWidth: bitmap.width, originalHeight: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

export type NativeCut = {
  /** JPEG of the window, clean: no outline, nothing drawn, for a detector or a page. */
  blob: Blob;
  width: number;
  height: number;
  window: AreaWindow;
  originalWidth: number;
  originalHeight: number;
  /** Original width over the uploaded frame's width, measured on the decoded original. */
  scale: number;
};

/**
 * Browser only. Decode the original, measure its scale against the frame ODM
 * saw, cut the window at native resolution and hand back clean pixels. The
 * benchmark's crop; `renderCloserLook` is the operator's view with the outline.
 */
export async function cutNativeWindow(
  frame: Blob, box: { x0: number; y0: number; x1: number; y1: number }, uploadedWidth: number,
): Promise<NativeCut | null> {
  if (typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(frame).catch(() => null);
  if (!bitmap) return null;
  try {
    const scale = bitmap.width / uploadedWidth;
    const win = areaWindow(box, scale, bitmap.width, bitmap.height);
    if (win.width <= 0 || win.height <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = win.width; canvas.height = win.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, win.x, win.y, win.width, win.height, 0, 0, win.width, win.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return null;
    return { blob, width: win.width, height: win.height, window: win, originalWidth: bitmap.width, originalHeight: bitmap.height, scale };
  } finally {
    bitmap.close?.();
  }
}
