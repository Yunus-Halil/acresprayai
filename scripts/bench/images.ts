// Pixels in Node: decode the kept original, cut the window, encode the crop.
//
// Pure JavaScript codecs on purpose (jpeg-js, pngjs): no native build on a
// developer's machine, and a test can make an "original" of its own. A
// 20-megapixel JPEG decodes in a few seconds, which a benchmark of a dozen
// findings can afford. The crop is cut from the decoded original exactly;
// nothing is resampled on the way to the model.
import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { AreaWindow } from "@/lib/sourceFrames/crop";

export type Rgba = { width: number; height: number; data: Uint8Array };

export type ImageKind = "jpeg" | "png";

/** What the bytes are, from their signature; the manifest's MIME type is not trusted over the bytes. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

/** Decode a JPEG or PNG to RGBA. Throws on anything else or on a broken file. */
export function decodeImage(bytes: Uint8Array): Rgba {
  const kind = sniffImage(bytes);
  if (kind === "jpeg") {
    const img = jpeg.decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048, maxResolutionInMP: 400,
    });
    return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  }
  if (kind === "png") {
    const img = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  }
  throw new Error("not a JPEG or PNG");
}

/** Only the window's size is read here; a caller must have clamped it to the frame. */
export function cropRgba(img: Rgba, win: AreaWindow): Rgba {
  const x0 = Math.max(0, Math.floor(win.x)), y0 = Math.max(0, Math.floor(win.y));
  const w = Math.min(img.width - x0, Math.round(win.width)), h = Math.min(img.height - y0, Math.round(win.height));
  if (w <= 0 || h <= 0) throw new Error("window lies outside the image");
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y0 + row) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

export function encodeJpeg(img: Rgba, quality = 92): Uint8Array {
  const out = jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) }, quality);
  return new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength);
}

export function encodePng(img: Rgba): Uint8Array {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const out = PNG.sync.write(png);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Width and height of a PNG or JPEG without decoding the pixels. Null when the bytes are neither. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const kind = sniffImage(bytes);
  if (kind === "png" && bytes.length >= 24) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (kind === "jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}
