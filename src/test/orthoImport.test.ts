// readOrthoMetadata against real, hand-built GeoTIFF byte streams.
//
// These are minimal but genuine TIFF files, run through the actual geotiff.js
// parser this module uses in the app - not mocks of it. That matters here
// specifically: the whole point of this module is to refuse a file before it
// reaches the pipeline, and a mocked parser would only prove the refusal
// logic agrees with itself, not that it agrees with what a real GeoTIFF
// reader reports.
import { describe, expect, it } from "vitest";
import { defaultThreeBandMapping, readOrthoMetadata } from "@/lib/orthoImport";

// ---------------------------------------------------------------------------
// A minimal, uncompressed, single-strip TIFF builder - just enough of the
// spec for geotiff.js to parse the header. Photometric interpretation 1
// (BlackIsZero) is used for every band count so nothing here assumes 3 bands
// the way an RGB-photometric file would.
// ---------------------------------------------------------------------------
const TAG = {
  ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259,
  PhotometricInterpretation: 262, StripOffsets: 273, SamplesPerPixel: 277,
  RowsPerStrip: 278, StripByteCounts: 279, PlanarConfiguration: 284,
  SampleFormat: 339, ModelPixelScale: 33550, ModelTiepoint: 33922,
  ModelTransformation: 34264, GeoKeyDirectory: 34735,
} as const;
const TYPE = { SHORT: 3, LONG: 4, DOUBLE: 12 } as const;
const SIZEOF = { [TYPE.SHORT]: 2, [TYPE.LONG]: 4, [TYPE.DOUBLE]: 8 } as const;

type Entry = { tag: number; type: number; values: number[] };

// GeoTIFF GTModelTypeGeoKey values.
const MODEL_PROJECTED = 1;
const MODEL_GEOGRAPHIC = 2;

function geoKeyDirectory(keys: [id: number, value: number][]): number[] {
  const out = [1, 1, 0, keys.length];
  for (const [id, value] of keys) out.push(id, 0, 1, value);
  return out;
}

type TiffSpec = {
  width: number;
  height: number;
  bands: number;
  /** [pixelWidth, pixelHeight] in CRS units. Ignored when `transform` is given. */
  scale?: [number, number];
  /** Full 16-value ModelTransformation, replacing pixelScale+tiepoint entirely. */
  transform?: number[];
  geoKeys?: [number, number][];
  /** Omit ALL georeferencing tags, including the GeoKeyDirectory. */
  noGeoreferencing?: boolean;
};

function buildTiff(spec: TiffSpec): Uint8Array {
  const { width, height, bands } = spec;
  const bytesPerSample = 1;
  const stripBytes = width * height * bands * bytesPerSample;

  const entries: Entry[] = [
    { tag: TAG.ImageWidth, type: TYPE.LONG, values: [width] },
    { tag: TAG.ImageLength, type: TYPE.LONG, values: [height] },
    { tag: TAG.BitsPerSample, type: TYPE.SHORT, values: Array(bands).fill(8) },
    { tag: TAG.Compression, type: TYPE.SHORT, values: [1] },
    { tag: TAG.PhotometricInterpretation, type: TYPE.SHORT, values: [1] },
    { tag: TAG.StripOffsets, type: TYPE.LONG, values: [0] }, // patched below
    { tag: TAG.SamplesPerPixel, type: TYPE.SHORT, values: [bands] },
    { tag: TAG.RowsPerStrip, type: TYPE.LONG, values: [height] },
    { tag: TAG.StripByteCounts, type: TYPE.LONG, values: [stripBytes] },
    { tag: TAG.PlanarConfiguration, type: TYPE.SHORT, values: [1] },
    { tag: TAG.SampleFormat, type: TYPE.SHORT, values: Array(bands).fill(1) },
  ];

  if (!spec.noGeoreferencing) {
    if (spec.transform) {
      entries.push({ tag: TAG.ModelTransformation, type: TYPE.DOUBLE, values: spec.transform });
    } else {
      const [pw, ph] = spec.scale ?? [1, 1];
      entries.push({ tag: TAG.ModelPixelScale, type: TYPE.DOUBLE, values: [pw, ph, 0] });
      entries.push({ tag: TAG.ModelTiepoint, type: TYPE.DOUBLE, values: [0, 0, 0, 500000, 4000000, 0] });
    }
    if (spec.geoKeys) {
      entries.push({ tag: TAG.GeoKeyDirectory, type: TYPE.SHORT, values: geoKeyDirectory(spec.geoKeys) });
    }
  }
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = 8;
  const ifdBytes = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdBytes;

  const outOfLine = new Map<number, number>();
  for (const e of entries) {
    const n = e.values.length * SIZEOF[e.type as keyof typeof SIZEOF];
    if (n > 4) {
      outOfLine.set(e.tag, cursor);
      cursor += n + (n % 2);
    }
  }
  const stripOffset = cursor;
  const total = stripOffset + stripBytes;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  bytes[0] = 0x49; bytes[1] = 0x49; // "II", little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);

  entries.forEach((e, i) => {
    const off = ifdOffset + 2 + i * 12;
    view.setUint16(off, e.tag, true);
    view.setUint16(off + 2, e.type, true);
    view.setUint32(off + 4, e.values.length, true);
    const valueOff = outOfLine.get(e.tag);
    const dest = valueOff ?? off + 8;
    if (valueOff !== undefined) view.setUint32(off + 8, valueOff, true);
    e.values.forEach((v, k) => {
      if (e.type === TYPE.SHORT) view.setUint16(dest + k * 2, v, true);
      else if (e.type === TYPE.LONG) view.setUint32(dest + k * 4, v, true);
      else view.setFloat64(dest + k * 8, v, true);
    });
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true); // no next IFD

  const stripIdx = entries.findIndex(e => e.tag === TAG.StripOffsets);
  view.setUint32(ifdOffset + 2 + stripIdx * 12 + 8, stripOffset, true);
  // Pixel content is irrelevant to header validation; leave it zeroed.

  return bytes;
}

const toFile = (bytes: Uint8Array, name = "ortho.tif") => new File([bytes], name, { type: "image/tiff" });

const PROJECTED_METRES: [number, number][] = [[1024, MODEL_PROJECTED], [3072, 32615], [3076, 9001]];

describe("readOrthoMetadata: refuses at the door", () => {
  it("accepts a well-formed 3-band projected file and reports what it read", async () => {
    const file = toFile(buildTiff({
      width: 200, height: 150, bands: 3, scale: [0.05, 0.05], geoKeys: PROJECTED_METRES,
    }));
    const result = await readOrthoMetadata(file);
    if ("reason" in result) throw new Error(`unexpectedly refused: ${result.reason}`);
    expect(result.widthPx).toBe(200);
    expect(result.heightPx).toBe(150);
    expect(result.bandCount).toBe(3);
    expect(result.gsdM).toBeCloseTo(0.05, 6);
    expect(result.epsg).toBe(32615);
    expect(result.crsLabel).toBe("EPSG:32615");
    expect(result.dtype).toBe("8-bit");
  });

  it("reports a 5-band file's band count without guessing a mapping for it", async () => {
    const file = toFile(buildTiff({
      width: 64, height: 64, bands: 5, scale: [0.08, 0.08], geoKeys: PROJECTED_METRES,
    }));
    const result = await readOrthoMetadata(file);
    if ("reason" in result) throw new Error(`unexpectedly refused: ${result.reason}`);
    expect(result.bandCount).toBe(5);
    // The UI's own default is 3-band only - a 5-band file gets no default mapping.
    expect(defaultThreeBandMapping()).toEqual({ red: 1, green: 2, blue: 3 });
  });

  it("refuses a file with no georeferencing at all", async () => {
    const file = toFile(buildTiff({ width: 32, height: 32, bands: 3, noGeoreferencing: true }));
    const result = await readOrthoMetadata(file);
    if (!("reason" in result)) throw new Error("should have been refused");
    expect(result.reason).toMatch(/no georeferencing/i);
  });

  it("refuses a geographic CRS (degrees), naming it specifically", async () => {
    const file = toFile(buildTiff({
      width: 32, height: 32, bands: 3,
      scale: [0.0000005, 0.0000005],
      geoKeys: [[1024, MODEL_GEOGRAPHIC], [2048, 4326]],
    }));
    const result = await readOrthoMetadata(file);
    if (!("reason" in result)) throw new Error("should have been refused");
    expect(result.reason).toMatch(/geographic CRS/i);
    expect(result.reason).toMatch(/UTM/i);
  });

  it("refuses a projected CRS not in metres", async () => {
    const file = toFile(buildTiff({
      width: 32, height: 32, bands: 3, scale: [0.16, 0.16],
      geoKeys: [[1024, MODEL_PROJECTED], [3072, 2229], [3076, 9002]], // 9002 = US survey foot
    }));
    const result = await readOrthoMetadata(file);
    if (!("reason" in result)) throw new Error("should have been refused");
    expect(result.reason).toMatch(/not in metres/i);
  });

  it("refuses non-square pixels", async () => {
    const file = toFile(buildTiff({
      width: 32, height: 32, bands: 3, scale: [0.05, 0.08], geoKeys: PROJECTED_METRES,
    }));
    const result = await readOrthoMetadata(file);
    if (!("reason" in result)) throw new Error("should have been refused");
    expect(result.reason).toMatch(/non-square pixels/i);
    expect(result.reason).toMatch(/0\.050/);
    expect(result.reason).toMatch(/0\.080/);
  });

  it("refuses a rotated (non north-up) transform", async () => {
    // a=pixel width, b=shear, e=shear, f=-pixel height; a visibly rotated frame.
    const transform = [0.05, 0.02, 0, 500000, 0.02, -0.05, 0, 4000000, 0, 0, 1, 0, 0, 0, 0, 1];
    const file = toFile(buildTiff({
      width: 32, height: 32, bands: 3, transform, geoKeys: PROJECTED_METRES,
    }));
    const result = await readOrthoMetadata(file);
    if (!("reason" in result)) throw new Error("should have been refused");
    expect(result.reason).toMatch(/rotated transform/i);
  });

  it("accepts an unrotated ModelTransformation the same as pixel-scale + tiepoint", async () => {
    const transform = [0.05, 0, 0, 500000, 0, -0.05, 0, 4000000, 0, 0, 1, 0, 0, 0, 0, 1];
    const file = toFile(buildTiff({
      width: 32, height: 32, bands: 3, transform, geoKeys: PROJECTED_METRES,
    }));
    const result = await readOrthoMetadata(file);
    if ("reason" in result) throw new Error(`unexpectedly refused: ${result.reason}`);
    expect(result.gsdM).toBeCloseTo(0.05, 6);
  });

  it("refuses a file that is not a TIFF at all", async () => {
    const file = toFile(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    const result = await readOrthoMetadata(file);
    if (!("reason" in result)) throw new Error("should have been refused");
    expect(result.reason).toMatch(/could not be read as a TIFF/i);
  });
});
