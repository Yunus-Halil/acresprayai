// Minimal single-band GeoTIFF writer plus its ESRI world file (.tfw).
//
// WHY HAND-ROLLED: same reason as shapefile.ts — rasterio/GDAL cannot run in a
// browser bundle. We only ever emit one shape of raster (uncompressed,
// single-strip, one float32 band, north-up, EPSG:4326), which is a baseline TIFF
// plus four GeoTIFF tags. The reader at the bottom lets the exporter verify its
// own extent rather than trusting the writer.
//
// References: TIFF 6.0 specification (Adobe, 1992) and the OGC GeoTIFF 1.1
// standard — ModelPixelScaleTag (33550), ModelTiepointTag (33922) and
// GeoKeyDirectoryTag (34735).

const TAG = {
  ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259,
  PhotometricInterpretation: 262, StripOffsets: 273, SamplesPerPixel: 277,
  RowsPerStrip: 278, StripByteCounts: 279, PlanarConfiguration: 284,
  SampleFormat: 339, ModelPixelScale: 33550, ModelTiepoint: 33922,
  GeoKeyDirectory: 34735, GdalNoData: 42113,
} as const;

const TYPE = { SHORT: 3, LONG: 4, DOUBLE: 12, ASCII: 2 } as const;
const SIZEOF = { [TYPE.SHORT]: 2, [TYPE.LONG]: 4, [TYPE.DOUBLE]: 8, [TYPE.ASCII]: 1 } as const;

export type GeoRasterSpec = {
  width: number;
  height: number;
  /** Row-major, length must be width*height. Row 0 is the NORTHERNMOST row. */
  pixels: Float32Array;
  /** Longitude of the OUTER west edge of column 0 (not the pixel centre). */
  originLng: number;
  /** Latitude of the OUTER north edge of row 0 (not the pixel centre). */
  originLat: number;
  /** Pixel width in degrees of longitude (positive). */
  pixelWidthDeg: number;
  /** Pixel height in degrees of latitude (positive; the raster runs south). */
  pixelHeightDeg: number;
  /** Value marking "no data". Written to GDAL_NODATA so readers skip it. */
  noData?: number;
};

export type GeoTiffBundle = { tiff: Uint8Array; tfw: string };

type Entry = { tag: number; type: number; values: number[] | string };

/**
 * ESRI world file. Six lines, and the last two are the coordinates of the
 * CENTRE of the top-left pixel — not its corner, which is what ModelTiepointTag
 * carries. Getting that half-pixel wrong shifts the whole prescription map by
 * half a cell in the field, so the offset is applied explicitly here.
 */
export function worldFile(spec: GeoRasterSpec): string {
  const lines = [
    spec.pixelWidthDeg,                                  // A: x scale
    0,                                                   // D: y skew
    0,                                                   // B: x skew
    -spec.pixelHeightDeg,                                // E: y scale, negative = north-up
    spec.originLng + spec.pixelWidthDeg / 2,             // C: x of top-left pixel CENTRE
    spec.originLat - spec.pixelHeightDeg / 2,            // F: y of top-left pixel CENTRE
  ];
  // 12 decimals ≈ sub-micrometre at the equator; plenty, and avoids exponent
  // notation which some world-file readers reject.
  return lines.map(n => n.toFixed(12)).join("\n") + "\n";
}

function entryValueBytes(e: Entry): number {
  return typeof e.values === "string"
    ? e.values.length + 1                                // ASCII is NUL-terminated
    : e.values.length * SIZEOF[e.type as keyof typeof SIZEOF];
}

export function writeGeoTiffFloat32(spec: GeoRasterSpec): GeoTiffBundle {
  const { width, height, pixels } = spec;
  if (pixels.length !== width * height) {
    throw new Error(`geotiff: expected ${width * height} pixels, got ${pixels.length}`);
  }
  const noData = spec.noData ?? -9999;
  const stripBytes = width * height * 4;

  // GeoKeyDirectory: version 1.1.0, then one entry per key, keys ascending.
  // Model type 2 = geographic, raster type 1 = PixelIsArea, GeographicType 4326.
  const geoKeys = [
    1, 1, 0, 3,
    1024, 0, 1, 2,
    1025, 0, 1, 1,
    2048, 0, 1, 4326,
  ];

  // Entries MUST be sorted by tag — readers are allowed to binary-search the IFD.
  const entries: Entry[] = [
    { tag: TAG.ImageWidth, type: TYPE.LONG, values: [width] },
    { tag: TAG.ImageLength, type: TYPE.LONG, values: [height] },
    { tag: TAG.BitsPerSample, type: TYPE.SHORT, values: [32] },
    { tag: TAG.Compression, type: TYPE.SHORT, values: [1] },
    { tag: TAG.PhotometricInterpretation, type: TYPE.SHORT, values: [1] },
    { tag: TAG.StripOffsets, type: TYPE.LONG, values: [0] },        // patched below
    { tag: TAG.SamplesPerPixel, type: TYPE.SHORT, values: [1] },
    { tag: TAG.RowsPerStrip, type: TYPE.LONG, values: [height] },   // single strip
    { tag: TAG.StripByteCounts, type: TYPE.LONG, values: [stripBytes] },
    { tag: TAG.PlanarConfiguration, type: TYPE.SHORT, values: [1] },
    { tag: TAG.SampleFormat, type: TYPE.SHORT, values: [3] },       // 3 = IEEE float
    { tag: TAG.ModelPixelScale, type: TYPE.DOUBLE, values: [spec.pixelWidthDeg, spec.pixelHeightDeg, 0] },
    // Tiepoint maps raster (0,0) — the OUTER top-left corner under PixelIsArea —
    // to its geographic position. Deliberately corner, unlike the .tfw above.
    { tag: TAG.ModelTiepoint, type: TYPE.DOUBLE, values: [0, 0, 0, spec.originLng, spec.originLat, 0] },
    { tag: TAG.GeoKeyDirectory, type: TYPE.SHORT, values: geoKeys },
    { tag: TAG.GdalNoData, type: TYPE.ASCII, values: String(noData) },
  ];

  const ifdOffset = 8;
  const ifdBytes = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdBytes;

  // Values longer than 4 bytes live outside the IFD and must start on an even
  // boundary, so record each one's offset before laying out the strip.
  const outOfLine = new Map<number, number>();
  for (const e of entries) {
    const n = entryValueBytes(e);
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

  bytes[0] = 0x49; bytes[1] = 0x49;              // "II" — little-endian
  view.setUint16(2, 42, true);                   // TIFF magic
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((e, i) => {
    const off = ifdOffset + 2 + i * 12;
    const count = typeof e.values === "string" ? e.values.length + 1 : e.values.length;
    view.setUint16(off, e.tag, true);
    view.setUint16(off + 2, e.type, true);
    view.setUint32(off + 4, count, true);

    const valueOff = outOfLine.get(e.tag);
    // Short values are inlined into the 4-byte value field, left-aligned.
    const dest = valueOff ?? off + 8;
    if (valueOff !== undefined) view.setUint32(off + 8, valueOff, true);

    if (typeof e.values === "string") {
      for (let k = 0; k < e.values.length; k++) bytes[dest + k] = e.values.charCodeAt(k);
      bytes[dest + e.values.length] = 0;
    } else {
      e.values.forEach((v, k) => {
        if (e.type === TYPE.SHORT) view.setUint16(dest + k * 2, v, true);
        else if (e.type === TYPE.LONG) view.setUint32(dest + k * 4, v, true);
        else view.setFloat64(dest + k * 8, v, true);
      });
    }
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true);   // no next IFD

  // StripOffsets is only knowable after layout, so patch its inline value now.
  const stripIdx = entries.findIndex(e => e.tag === TAG.StripOffsets);
  view.setUint32(ifdOffset + 2 + stripIdx * 12 + 8, stripOffset, true);

  for (let i = 0; i < pixels.length; i++) {
    view.setFloat32(stripOffset + i * 4, pixels[i], true);
  }

  return { tiff: bytes, tfw: worldFile(spec) };
}

// ---------------------------------------------------------------------------
// Reader — verification only, and only for rasters this module wrote.
// ---------------------------------------------------------------------------

export type ReadGeoTiff = {
  width: number;
  height: number;
  originLng: number;
  originLat: number;
  pixelWidthDeg: number;
  pixelHeightDeg: number;
  epsg: number | null;
  pixels: Float32Array;
};

export function readGeoTiffFloat32(tiff: Uint8Array): ReadGeoTiff {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (tiff[0] !== 0x49 || tiff[1] !== 0x49) throw new Error("geotiff: not little-endian TIFF");
  if (view.getUint16(2, true) !== 42) throw new Error("geotiff: bad magic");

  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true);
  const tags = new Map<number, { type: number; count: number; offset: number; inline: number }>();
  for (let i = 0; i < count; i++) {
    const off = ifd + 2 + i * 12;
    const tag = view.getUint16(off, true);
    const type = view.getUint16(off + 2, true);
    const n = view.getUint32(off + 4, true);
    const bytes = n * (SIZEOF[type as keyof typeof SIZEOF] ?? 1);
    tags.set(tag, {
      type, count: n,
      offset: bytes > 4 ? view.getUint32(off + 8, true) : off + 8,
      inline: off + 8,
    });
  }

  const num = (tag: number, i = 0): number => {
    const t = tags.get(tag);
    if (!t) throw new Error(`geotiff: missing tag ${tag}`);
    if (t.type === TYPE.SHORT) return view.getUint16(t.offset + i * 2, true);
    if (t.type === TYPE.LONG) return view.getUint32(t.offset + i * 4, true);
    return view.getFloat64(t.offset + i * 8, true);
  };

  const width = num(TAG.ImageWidth);
  const height = num(TAG.ImageLength);
  if (num(TAG.SampleFormat) !== 3 || num(TAG.BitsPerSample) !== 32) {
    throw new Error("geotiff: expected a single float32 band");
  }

  // Pull EPSG out of the GeoKeyDirectory by scanning for GeographicTypeGeoKey.
  let epsg: number | null = null;
  const gk = tags.get(TAG.GeoKeyDirectory);
  if (gk) {
    for (let i = 4; i < gk.count; i += 4) {
      if (view.getUint16(gk.offset + i * 2, true) === 2048) {
        epsg = view.getUint16(gk.offset + (i + 3) * 2, true);
      }
    }
  }

  const stripOffset = num(TAG.StripOffsets);
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = view.getFloat32(stripOffset + i * 4, true);

  return {
    width, height, epsg, pixels,
    pixelWidthDeg: num(TAG.ModelPixelScale, 0),
    pixelHeightDeg: num(TAG.ModelPixelScale, 1),
    originLng: num(TAG.ModelTiepoint, 3),
    originLat: num(TAG.ModelTiepoint, 4),
  };
}
