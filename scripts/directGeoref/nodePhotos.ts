// Photographs and JPEG encoding in Node for the in-app build pipeline (src/lib/fieldTwin/build): jpeg-js through
// scripts/bench/images, with the quarter-size decode cached per photograph (Node has the memory for it).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import type { Codec, PhotoSource } from "../../src/lib/fieldTwin/build/types";

function boxDown(img: { width: number; height: number; data: Uint8Array }, k: number): PhotoPixels {
  const W = Math.floor(img.width / k), H = Math.floor(img.height / k), out = new Uint8ClampedArray(W * H * 4), kk = k * k;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < k; dy++) { let o = ((y * k + dy) * img.width + x * k) * 4; for (let dx = 0; dx < k; dx++, o += 4) { r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; } }
    const p = (y * W + x) * 4;
    out[p] = r / kk; out[p + 1] = g / kk; out[p + 2] = b / kk; out[p + 3] = 255;
  }
  return { width: W, height: H, rgba: out };
}

export function nodePhoto(path: string): PhotoSource {
  const small = new Map<number, PhotoPixels>();
  const full = () => decodeImage(new Uint8Array(readFileSync(path)));
  return {
    name: basename(path).replace(/\.[^.]+$/, ""),
    header: async () => new Uint8Array(readFileSync(path)).subarray(0, 1 << 20),
    bytes: async () => new Uint8Array(readFileSync(path)),
    async decode(down) {
      const img = full();
      if (down <= 1) return { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
      const c = small.get(down);
      if (c) return c;
      const px = boxDown(img, down);
      small.set(down, px);
      return px;
    },
    async crops(reqs) {
      if (!reqs.length) return [];
      const img = full();
      return reqs.map(r => {
        const out = new Uint8ClampedArray(r.out * r.out * 4), s = r.size / r.out, k = Math.max(1, Math.floor(s));
        for (let y = 0; y < r.out; y++) for (let x = 0; x < r.out; x++) {
          const sx0 = Math.floor(r.x0 + x * s), sy0 = Math.floor(r.y0 + y * s);
          let R = 0, G = 0, B = 0, n = 0;
          for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
            const xx = Math.min(img.width - 1, Math.max(0, sx0 + dx)), yy = Math.min(img.height - 1, Math.max(0, sy0 + dy)), o = (yy * img.width + xx) * 4;
            R += img.data[o]; G += img.data[o + 1]; B += img.data[o + 2]; n++;
          }
          const o = (y * r.out + x) * 4;
          out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n; out[o + 3] = 255;
        }
        return out;
      });
    },
  };
}

export const nodeCodec: Codec = {
  async encodeJpeg(rgba, width, height, quality) {
    return encodeJpeg({ width, height, data: rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength) }, Math.round(quality * 100));
  },
};
