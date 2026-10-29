// TIFF photographs for the twin builder: the header walker on a TIFF written here (directories after the pixels,
// as DJI writes them, XMP in tag 700), the DJI header parsed from it, the file grouper (JPEGs, RGB TIFFs, DJI band
// sets by name, shots without blue refused), and the decode through geotiff.js of an RGB TIFF and of a band set.
import { describe, expect, it } from "vitest";
import { parseDjiHeader } from "@/lib/directGeoref";
import { isTiff, tiffHeader } from "@/lib/directGeoref/tiffHeader";
import { groupPhotoFiles } from "@/lib/fieldTwin/build/browserPhotos";
import { bandSetPhoto, djiBandOf, tiffPhoto } from "@/lib/fieldTwin/build/tiffPhotos";

/** A little-endian, uncompressed TIFF: `samples` per pixel, 8 or 16 bits, the pixels first and the directory after them, with XMP (700), Make, ImageDescription, and an EXIF sub-directory holding the focal length. */
function writeTiff(width: number, height: number, samples: number, bits: 8 | 16, pixel: (x: number, y: number, s: number) => number, xmp: string): Uint8Array {
  const bytesPerSample = bits / 8;
  const dataSize = width * height * samples * bytesPerSample;
  const xmpBytes = new TextEncoder().encode(xmp);
  const make = "DJI\0\0\0\0\0", desc = "test\0"; // over four bytes, so they sit at an offset as a camera writes them
  const entries0 = 13, entriesExif = 1;
  const ifd0At = 8 + dataSize;
  const ifd0Size = 2 + entries0 * 12 + 4;
  const exifAt = ifd0At + ifd0Size, exifSize = 2 + entriesExif * 12 + 4;
  const bpsAt = exifAt + exifSize; // BitsPerSample array when samples > 2
  const bpsSize = samples > 2 ? samples * 2 : 0;
  const xmpAt = bpsAt + bpsSize, makeAt = xmpAt + xmpBytes.length, descAt = makeAt + make.length, focalAt = descAt + desc.length;
  const total = focalAt + 8;
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, ifd0At, true);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let s = 0; s < samples; s++) {
    const o = 8 + ((y * width + x) * samples + s) * bytesPerSample;
    if (bits === 8) u8[o] = pixel(x, y, s); else dv.setUint16(o, pixel(x, y, s), true);
  }
  const entry = (at: number, tag: number, type: number, count: number, value: number) => { dv.setUint16(at, tag, true); dv.setUint16(at + 2, type, true); dv.setUint32(at + 4, count, true); if (type === 3 && count === 1) dv.setUint16(at + 8, value, true); else dv.setUint32(at + 8, value, true); };
  dv.setUint16(ifd0At, entries0, true);
  let e = ifd0At + 2;
  entry(e, 256, 4, 1, width); e += 12;
  entry(e, 257, 4, 1, height); e += 12;
  if (samples > 2) { entry(e, 258, 3, samples, bpsAt); } else { entry(e, 258, 3, 1, bits); } e += 12;
  entry(e, 259, 3, 1, 1); e += 12;                       // no compression
  entry(e, 262, 3, 1, samples >= 3 ? 2 : 1); e += 12;    // RGB or black-is-zero
  entry(e, 270, 2, desc.length, descAt); e += 12;
  entry(e, 271, 2, make.length, makeAt); e += 12;
  entry(e, 273, 4, 1, 8); e += 12;                       // strip offset
  entry(e, 277, 3, 1, samples); e += 12;
  entry(e, 278, 4, 1, height); e += 12;                  // rows per strip
  entry(e, 279, 4, 1, dataSize); e += 12;                // strip byte count
  entry(e, 700, 1, xmpBytes.length, xmpAt); e += 12;
  entry(e, 34665, 4, 1, exifAt); e += 12;
  dv.setUint32(e, 0, true);
  dv.setUint16(exifAt, entriesExif, true);
  entry(exifAt + 2, 37386, 5, 1, focalAt);
  dv.setUint32(exifAt + 2 + 12, 0, true);
  if (samples > 2) for (let s = 0; s < samples; s++) dv.setUint16(bpsAt + s * 2, bits, true);
  u8.set(xmpBytes, xmpAt);
  u8.set(new TextEncoder().encode(make), makeAt);
  u8.set(new TextEncoder().encode(desc), descAt);
  dv.setUint32(focalAt, 574, true); dv.setUint32(focalAt + 4, 100, true); // 5.74 mm
  return u8;
}

const XMP = (extra = "") => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" drone-dji:GpsLatitude="+33.88413971" drone-dji:GpsLongtitude="-5.41963858" drone-dji:AbsoluteAltitude="+450.1" drone-dji:RelativeAltitude="+36.0" drone-dji:GimbalRollDegree="+0.00" drone-dji:GimbalYawDegree="+130.9" drone-dji:GimbalPitchDegree="-90.00" drone-dji:CalibratedFocalLength="1913.33" drone-dji:CalibratedOpticalCenterX="800.0" drone-dji:CalibratedOpticalCenterY="650.0" drone-dji:DewarpFlag="1" ${extra}/></rdf:RDF></x:xmpmeta>`;
const fileOf = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name, { type: "image/tiff" });

describe("TIFF photographs", () => {
  it("walks a TIFF whose directories follow the pixels and reads the DJI header from its XMP", () => {
    const t = writeTiff(16, 12, 3, 8, (x, y, s) => (s === 1 ? 200 : 60), XMP());
    expect(isTiff(t)).toBe(true);
    const h = tiffHeader(t);
    expect(h.width).toBe(16); expect(h.height).toBe(12); expect(h.samplesPerPixel).toBe(3); expect(h.bitsPerSample).toBe(8);
    expect(h.make).toBe("DJI"); expect(h.description).toBe("test"); expect(h.focalMm).toBeCloseTo(5.74, 6);
    expect(h.xmp).toContain("drone-dji:GpsLatitude");
    const m = parseDjiHeader(t);
    expect(m.lat).toBeCloseTo(33.88413971, 8); expect(m.lng).toBeCloseTo(-5.41963858, 8);
    expect(m.relativeAltitudeM).toBe(36); expect(m.gimbalPitchDeg).toBe(-90); expect(m.calibratedFocalPx).toBeCloseTo(1913.33, 2);
    expect(m.width).toBe(16); expect(m.make).toBe("DJI"); expect(m.focalMm).toBeCloseTo(5.74, 6);
    expect(() => tiffHeader(new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0]))).toThrow(/not a TIFF/);
  });

  it("names DJI band files and groups a shot's blue, green and red into one photograph, refusing a shot without blue", async () => {
    expect(djiBandOf("DJI_0011_1.TIF")).toEqual({ shot: "DJI_0011", band: "blue" });
    expect(djiBandOf("DJI_0011_5.TIF")).toEqual({ shot: "DJI_0011", band: "nir" });
    expect(djiBandOf("DJI_20240501120000_0007_MS_NIR.TIF")).toEqual({ shot: "DJI_20240501120000_0007", band: "nir" });
    expect(djiBandOf("DJI_0301.JPG")).toBeNull(); expect(djiBandOf("ortho.tif")).toBeNull();
    const t = writeTiff(8, 8, 1, 16, () => 1000, XMP());
    const files = [fileOf(t, "DJI_0011_3.TIF"), fileOf(t, "DJI_0011_1.TIF"), fileOf(t, "DJI_0011_2.TIF"), fileOf(t, "DJI_0011_5.TIF"), fileOf(t, "DJI_0020_MS_G.TIF"), fileOf(t, "DJI_0020_MS_R.TIF"), fileOf(writeTiff(8, 8, 3, 8, () => 100, XMP()), "camera.tif"), new File([new Uint8Array([0xff, 0xd8])], "DJI_0010.JPG")];
    const photos = groupPhotoFiles(files, null);
    expect(photos.map(p => p.name).sort()).toEqual(["DJI_0010", "DJI_0011", "DJI_0020", "camera"]);
    await expect(photos[3].header()).rejects.toThrow(/without a blue band/);
    const single = groupPhotoFiles([fileOf(t, "lonely.tif")], null);
    await expect(single[0].header()).rejects.toThrow(/1 band/);
  });

  it("decodes an RGB TIFF and a 16-bit band set to RGBA, at the quarter size and as crops", async () => {
    const rgb = tiffPhoto(fileOf(writeTiff(32, 16, 3, 8, (x, y, s) => (s === 0 ? 150 : s === 1 ? (x < 16 ? 110 : 200) : 80), XMP()), "camera.tif"), "camera.tif", null);
    const full = await rgb.decode(1);
    expect(full.width).toBe(32); expect(full.height).toBe(16);
    expect(Array.from(full.rgba.slice(0, 4))).toEqual([150, 110, 80, 255]);
    expect(full.rgba[(5 * 32 + 20) * 4 + 1]).toBe(200);
    const quarter = await rgb.decode(4);
    expect(quarter.width).toBe(8); expect(quarter.height).toBe(4);
    expect(quarter.rgba[(1 * 8 + 1) * 4 + 1]).toBeCloseTo(110, -1); expect(quarter.rgba[(1 * 8 + 6) * 4 + 1]).toBeCloseTo(200, -1);
    const [crop] = await rgb.crops([{ x0: 16, y0: 0, size: 16, out: 4 }]);
    expect(crop.length).toBe(4 * 4 * 4); expect(crop[1]).toBeCloseTo(200, -1);
    expect(await rgb.preview()).toBeNull();
    // A band set: 16-bit bands, the red band offset by 2 px in x against the blue reference (its RelativeOpticalCenterX).
    const band = (v: (x: number, y: number) => number, roc: string) => fileOf(writeTiff(32, 16, 1, 16, v, XMP(roc)), "b.tif");
    const set = await bandSetPhoto("shot", { blue: band(() => 2000, 'drone-dji:RelativeOpticalCenterX="0" drone-dji:RelativeOpticalCenterY="0"'), green: band(() => 8000, 'drone-dji:RelativeOpticalCenterX="0" drone-dji:RelativeOpticalCenterY="0"'), red: band(x => (x >= 18 ? 8000 : 1000), 'drone-dji:RelativeOpticalCenterX="2" drone-dji:RelativeOpticalCenterY="0"') }, null);
    const px = await set.decode(1);
    expect(px.width).toBe(32);
    // Green everywhere bright (stretched to its own 99.5th percentile), blue the same level: equal after the stretch.
    expect(px.rgba[1]).toBe(px.rgba[2]);
    // The red step at x = 18 in the red band lands at x = 16 on the reference grid (shifted by its offset).
    const red = (x: number) => px.rgba[(4 * 32 + x) * 4];
    expect(red(15)).toBeLessThan(red(16)); expect(red(16)).toBe(red(31));
    const h = parseDjiHeader(await set.header());
    expect(h.lat).toBeCloseTo(33.88413971, 8);
  });
});
