// TIFF photographs for the twin builder: an RGB TIFF from a camera, or a DJI multispectral shot read from its blue,
// green and red band files as one photograph. Decoded with geotiff.js (no browser decoder reads TIFF), the
// header taken from the TIFF's own directories (tiffHeader.ts: the drone-dji XMP block sits there as in a JPEG),
// and the whole thing handed to the pipeline as a PhotoSource like any JPEG.
//
// Pixels: 8-bit samples are taken as they are; 16-bit bands (DJI's multispectral TIFs are radiometric 16-bit) are
// stretched per band to their 99.5th percentile and gamma-encoded (1 / 2.2), so the chromaticity the colour rules
// read looks like a camera JPEG's. A band set is aligned by DJI's RelativeOpticalCenterX/Y (each band's optical
// centre offset against the others, pixels): a band's pixel for the reference grid is read at the band's own
// coordinates shifted by its offset less the reference band's. The sign of that shift is this module's reading of
// DJI's guide and is to be checked by eye on a real set.
//
// No preview (TIFFs carry none the twin can use), so the pipeline decodes at the quarter size; `bytes()` is a JPEG
// re-encoded from the full decode, which is what the weed model's service and the helper pool expect.
import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";
import { tiffHeader } from "../../directGeoref/tiffHeader";
import type { PhotoPixels } from "../../photoScout/pattern";
import type { Codec, PhotoSource } from "./types";

const xmpNumber = (xmp: string | null, name: string): number | null => { if (!xmp) return null; const m = new RegExp(`drone-dji:${name}(?:="([^"]*)"|>([^<]*)<)`).exec(xmp); const v = m ? Number(m[1] ?? m[2]) : NaN; return Number.isFinite(v) ? v : null; };

type Band = { file: Blob; name: string; bytes?: Uint8Array; image?: GeoTIFFImage; width?: number; height?: number; scale?: number[]; shiftX: number; shiftY: number };

/** A Blob's bytes: its own arrayBuffer when it has one, else through a FileReader (a browser's Blob in a test runner has neither Response nor stream support for it). */
const bytesOf = async (b: Blob): Promise<Uint8Array> => {
  if (typeof b.arrayBuffer === "function") return new Uint8Array(await b.arrayBuffer());
  if (typeof FileReader !== "undefined") return new Promise<Uint8Array>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => reject(r.error ?? new Error("the file could not be read")); r.readAsArrayBuffer(b); });
  return new Uint8Array(await new Response(b).arrayBuffer());
};

async function imageOf(band: Band): Promise<GeoTIFFImage> {
  if (band.image) return band.image;
  band.bytes ??= await bytesOf(band.file);
  const tiff = await fromArrayBuffer(band.bytes.buffer.slice(band.bytes.byteOffset, band.bytes.byteOffset + band.bytes.byteLength) as ArrayBuffer);
  band.image = await tiff.getImage(0);
  band.width = band.image.getWidth(); band.height = band.image.getHeight();
  return band.image;
}

/** Per-sample scale to 8 bits: 1 for 8-bit data; for wider samples, 255 over the 99.5th percentile of a thinned read. */
async function scalesOf(band: Band, samples: number): Promise<number[]> {
  if (band.scale) return band.scale;
  const img = await imageOf(band);
  const bits = img.getBitsPerSample(0);
  if (bits <= 8) return (band.scale = Array.from({ length: samples }, () => 1));
  const w = Math.min(256, band.width!), h = Math.min(256, band.height!);
  const data = (await img.readRasters({ interleave: true, width: w, height: h })) as unknown as ArrayLike<number>;
  const out: number[] = [];
  for (let sIdx = 0; sIdx < samples; sIdx++) {
    const vals: number[] = [];
    for (let i = sIdx; i < data.length; i += samples) vals.push(data[i]);
    vals.sort((a, b) => a - b);
    const p = vals[Math.min(vals.length - 1, Math.floor(0.995 * vals.length))] || 1;
    out.push(255 / p);
  }
  return (band.scale = out);
}

const GAMMA = new Uint8ClampedArray(4096);
for (let i = 0; i < 4096; i++) GAMMA[i] = Math.round(255 * Math.pow(i / 4095, 1 / 2.2));
/** A sample scaled to 8 bits; a 16-bit band is also gamma-encoded. */
const to8 = (v: number, scale: number, wide: boolean): number => { const x = v * scale; if (!wide) return x < 0 ? 0 : x > 255 ? 255 : x; const k = Math.round((x / 255) * 4095); return GAMMA[k < 0 ? 0 : k > 4095 ? 4095 : k]; };

/** Read a window of the band(s) into RGBA at `outW` x `outH` (bilinear when shrinking). `bands` is one RGB image or three single-sample bands. */
async function readRgba(bands: Band[], window: [number, number, number, number] | null, outW: number, outH: number): Promise<PhotoPixels> {
  const rgba = new Uint8ClampedArray(outW * outH * 4).fill(255);
  if (bands.length === 1) {
    const img = await imageOf(bands[0]);
    const spp = img.getSamplesPerPixel(), wide = img.getBitsPerSample(0) > 8;
    const sc = await scalesOf(bands[0], spp);
    const data = (await img.readRasters({ interleave: true, window: window ?? undefined, width: outW, height: outH, resampleMethod: "bilinear" })) as unknown as ArrayLike<number>;
    for (let i = 0; i < outW * outH; i++) { const o = i * spp; rgba[i * 4] = to8(data[o], sc[0], wide); rgba[i * 4 + 1] = to8(data[o + 1], sc[1], wide); rgba[i * 4 + 2] = to8(data[o + 2], sc[2], wide); }
    return { width: outW, height: outH, rgba };
  }
  // Red, green, blue bands each read at their own shifted window.
  for (const [k, band] of bands.entries()) {
    const img = await imageOf(band);
    const wide = img.getBitsPerSample(0) > 8;
    const sc = (await scalesOf(band, 1))[0];
    const W = band.width!, H = band.height!;
    const win: [number, number, number, number] = window ? [window[0] + band.shiftX, window[1] + band.shiftY, window[2] + band.shiftX, window[3] + band.shiftY] : [band.shiftX, band.shiftY, W + band.shiftX, H + band.shiftY];
    // geotiff.js reads inside the image only: clamp the window and place the read where it belongs in the output.
    const cw: [number, number, number, number] = [Math.max(0, win[0]), Math.max(0, win[1]), Math.min(W, win[2]), Math.min(H, win[3])];
    if (cw[2] <= cw[0] || cw[3] <= cw[1]) continue;
    const sx = outW / (win[2] - win[0]), sy = outH / (win[3] - win[1]);
    const rw = Math.max(1, Math.round((cw[2] - cw[0]) * sx)), rh = Math.max(1, Math.round((cw[3] - cw[1]) * sy));
    const ox = Math.round((cw[0] - win[0]) * sx), oy = Math.round((cw[1] - win[1]) * sy);
    const data = (await img.readRasters({ interleave: true, window: cw, width: rw, height: rh, resampleMethod: "bilinear" })) as unknown as ArrayLike<number>;
    const spp = img.getSamplesPerPixel();
    for (let y = 0; y < rh; y++) { const yy = y + oy; if (yy < 0 || yy >= outH) continue; for (let x = 0; x < rw; x++) { const xx = x + ox; if (xx < 0 || xx >= outW) continue; rgba[(yy * outW + xx) * 4 + k] = to8(data[(y * rw + x) * spp], sc, wide); } }
  }
  return { width: outW, height: outH, rgba };
}

/** A PhotoSource that refuses with a reason (the pipeline records it against the photograph's name). */
export function refusedPhoto(name: string, reason: string): PhotoSource {
  const no = async (): Promise<never> => { throw new Error(reason); };
  return { name, header: no, bytes: no, decode: no, preview: async () => null, crops: no };
}

function source(name: string, bands: Band[], headerBand: Band, codec: Codec | null): PhotoSource {
  let jpeg: Promise<Blob | Uint8Array> | null = null;
  const size = async () => { const img = await imageOf(bands[0]); return { w: img.getWidth(), h: img.getHeight() }; };
  return {
    name,
    async header() {
      headerBand.bytes ??= await bytesOf(headerBand.file);
      const h = tiffHeader(headerBand.bytes);
      if (bands.length === 1 && (h.samplesPerPixel ?? 1) < 3) throw new Error(`a TIFF with ${h.samplesPerPixel ?? 1} band${(h.samplesPerPixel ?? 1) === 1 ? "" : "s"}: no colour to read; for a DJI multispectral shot give its blue, green and red band files together`);
      return headerBand.bytes;
    },
    async bytes() {
      if (!codec) throw new Error("no JPEG encoder for a TIFF photograph here");
      jpeg ??= (async () => { const { w, h } = await size(); const px = await readRgba(bands, null, w, h); return codec.encodeJpeg(px.rgba, w, h, 0.92); })();
      return jpeg;
    },
    async preview() { return null; },
    async decode(down: number) {
      const { w, h } = await size();
      const ow = Math.max(1, Math.floor(w / Math.max(1, down))), oh = Math.max(1, Math.floor(h / Math.max(1, down)));
      return readRgba(bands, null, ow, oh);
    },
    async crops(reqs) {
      const { w, h } = await size();
      const out: Uint8ClampedArray[] = [];
      for (const r of reqs) {
        const x0 = Math.max(0, Math.min(w - 1, r.x0)), y0 = Math.max(0, Math.min(h - 1, r.y0));
        const x1 = Math.max(x0 + 1, Math.min(w, r.x0 + r.size)), y1 = Math.max(y0 + 1, Math.min(h, r.y0 + r.size));
        out.push((await readRgba(bands, [x0, y0, x1, y1], r.out, r.out)).rgba);
      }
      return out;
    },
  };
}

/** An RGB TIFF photograph. */
export function tiffPhoto(file: Blob, name: string, codec: Codec | null): PhotoSource {
  const band: Band = { file, name, shiftX: 0, shiftY: 0 };
  return source(name.replace(/\.[^.]+$/, ""), [band], band, codec);
}

/** A DJI multispectral shot from its band files: one photograph with the red, green and blue bands as its colour. The blue band is the reference grid and the header. */
export async function bandSetPhoto(name: string, files: { blue: Blob; green: Blob; red: Blob }, codec: Codec | null): Promise<PhotoSource> {
  const mk = (file: Blob, n: string): Band => ({ file, name: n, shiftX: 0, shiftY: 0 });
  const red = mk(files.red, "red"), green = mk(files.green, "green"), blue = mk(files.blue, "blue");
  const roc = async (b: Band) => { b.bytes ??= await bytesOf(b.file); const h = tiffHeader(b.bytes); return { x: xmpNumber(h.xmp, "RelativeOpticalCenterX") ?? 0, y: xmpNumber(h.xmp, "RelativeOpticalCenterY") ?? 0 }; };
  const ref = await roc(blue);
  for (const b of [red, green]) { const o = await roc(b); b.shiftX = Math.round(o.x - ref.x); b.shiftY = Math.round(o.y - ref.y); }
  return source(name, [red, green, blue], blue, codec);
}

/** DJI band file names: Phantom 4 Multispectral `DJI_0011_1.TIF` (1 blue, 2 green, 3 red, 4 red edge, 5 NIR) and Mavic 3 Multispectral `DJI_..._MS_G.TIF` (G, R, RE, NIR: no blue). */
export function djiBandOf(fileName: string): { shot: string; band: "blue" | "green" | "red" | "rededge" | "nir" } | null {
  const p4 = /^(.*?)_([1-5])\.tiff?$/i.exec(fileName);
  if (p4) return { shot: p4[1], band: (["blue", "green", "red", "rededge", "nir"] as const)[Number(p4[2]) - 1] };
  const m3 = /^(.*?)_MS_(G|R|RE|NIR)\.tiff?$/i.exec(fileName);
  if (m3) return { shot: m3[1], band: ({ G: "green", R: "red", RE: "rededge", NIR: "nir" } as const)[m3[2].toUpperCase() as "G" | "R" | "RE" | "NIR"] };
  return null;
}
