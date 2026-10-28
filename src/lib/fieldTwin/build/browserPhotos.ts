// Photographs and JPEG encoding in a browser (a worker or the page): createImageBitmap and OffscreenCanvas.
//
// A photograph is decoded in full only when asked (crops for the atlases, the full-size pixels); the quarter-size
// decode the detectors and the soil ties read is kept as a small JPEG and decoded again from that, so seventy
// 20-megapixel photographs never sit decoded in memory together.
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
  let size: { w: number; h: number } | null = null;
  const full = async (): Promise<ImageBitmap> => { const b = await createImageBitmap(file); size = { w: b.width, h: b.height }; return b; };
  return {
    name: base,
    header: async () => new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()),
    bytes: async () => file,
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
  void size;
}

export const browserCodec: Codec = {
  async encodeJpeg(rgba, width, height, quality) {
    const c = canvasOf(width, height), g = c.getContext("2d")!;
    const data = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    g.putImageData(new ImageData(data, width, height), 0, 0);
    return c.convertToBlob({ type: "image/jpeg", quality });
  },
};
