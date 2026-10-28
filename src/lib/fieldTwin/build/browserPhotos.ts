// Photographs and JPEG encoding in a browser (a worker or the page): createImageBitmap and OffscreenCanvas.
//
// A photograph is decoded in full only when asked (crops for the atlases, the full-size pixels); the quarter-size
// decode the detectors and the soil ties read is kept as a small JPEG and decoded again from that, so seventy
// 20-megapixel photographs never sit decoded in memory together.
import { mpfPreview } from "../../directGeoref/mpf";
import type { PhotoPixels } from "../../photoScout/pattern";
import type { Codec, PhotoSource } from "./types";

const HEADER_BYTES = 1 << 20;

function canvasOf(w: number, h: number): OffscreenCanvas {
  if (typeof OffscreenCanvas === "undefined") throw new Error("this browser has no OffscreenCanvas");
  return new OffscreenCanvas(w, h);
}

async function toPixels(bitmap: ImageBitmap, w: number, h: number): Promise<PhotoPixels> {
  const c = canvasOf(w, h), g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("no 2d context");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  return { width: w, height: h, rgba: d.data };
}

/** A PhotoSource over a File (or Blob with a name). */
export function browserPhoto(file: Blob, name: string): PhotoSource {
  const base = name.replace(/\.[^.]+$/, "");
  const small = new Map<number, Blob>();
  let previewBlob: Blob | null | undefined;
  const full = async (): Promise<ImageBitmap> => createImageBitmap(file);
  const header = async () => new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  return {
    name: base,
    header,
    bytes: async () => file,
    async preview() {
      // The camera's own preview: a slice of the file's tail, decoded in milliseconds. The slice is kept, not the pixels.
      if (previewBlob === undefined) { const e = mpfPreview(await header()); previewBlob = e ? file.slice(e.offset, e.offset + e.size, "image/jpeg") : null; }
      if (!previewBlob) return null;
      try { const b = await createImageBitmap(previewBlob); try { return await toPixels(b, b.width, b.height); } finally { b.close(); } } catch { previewBlob = null; return null; }
    },
    async decode(down: number): Promise<PhotoPixels> {
      if (down <= 1) { const b = await full(); try { return await toPixels(b, b.width, b.height); } finally { b.close(); } }
      const cached = small.get(down);
      if (cached) { const b = await createImageBitmap(cached); try { return await toPixels(b, b.width, b.height); } finally { b.close(); } }
      const b = await full();
      try {
        const w = Math.floor(b.width / down), h = Math.floor(b.height / down);
        const c = canvasOf(w, h), g = c.getContext("2d", { willReadFrequently: true })!;
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(b, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h);
        small.set(down, await c.convertToBlob({ type: "image/jpeg", quality: 0.9 }));
        return { width: w, height: h, rgba: d.data };
      } finally { b.close(); }
    },
    async crops(reqs) {
      if (!reqs.length) return [];
      const b = await full();
      try {
        const out: Uint8ClampedArray[] = [];
        for (const r of reqs) {
          const c = canvasOf(r.out, r.out), g = c.getContext("2d", { willReadFrequently: true })!;
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
          g.drawImage(b, r.x0, r.y0, r.size, r.size, 0, 0, r.out, r.out);
          out.push(g.getImageData(0, 0, r.out, r.out).data);
        }
        return out;
      } finally { b.close(); }
    },
  };
}

export const browserCodec: Codec = {
  async encodeJpeg(rgba, width, height, quality) {
    const c = canvasOf(width, height), g = c.getContext("2d")!;
    const data = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    g.putImageData(new ImageData(data, width, height), 0, 0);
    return c.convertToBlob({ type: "image/jpeg", quality });
  },
};
