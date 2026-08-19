// Minimal ESRI shapefile writer — polygons in WGS84, nothing else.
//
// WHY HAND-ROLLED: the usual answer is geopandas or pyshp, but this app is a
// browser bundle. There is no Python runtime and no GDAL, and the Supabase edge
// functions are Deno, so a native geospatial stack is not reachable from any
// code path a farmer's "Export" button can run. The shapefile trio is a
// fixed-layout binary format documented in the public ESRI whitepaper, and the
// polygon subset we need is a couple hundred lines. Round-tripping is covered by
// the readers below plus src/test/djiExport.test.ts, so the writer is verified
// against a reader rather than trusted.
//
// Reference: ESRI Shapefile Technical Description (July 1998) — main file
// header, Polygon record contents, and the .shx index.
import type { LatLng2 } from "./geo";

/**
 * Canonical ESRI-flavour WKT for EPSG:4326, quoted verbatim from the EPSG
 * registry's ESRI export rather than composed by hand. Every shapefile consumer
 * in agriculture (DJI, XAG, ArcGIS, QGIS) recognises this exact string; the
 * OGC-flavour `GEOGCS["WGS 84",DATUM["WGS_1984",...]]` variant is accepted less
 * consistently by older readers, and the Agras controller is an older reader.
 */
export const WGS84_ESRI_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",' +
  'SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const SHAPE_TYPE_POLYGON = 5;

export type DbfField =
  | { name: string; type: "C"; length: number }
  | { name: string; type: "N"; length: number; decimals: number };

export type ShpFeature = {
  /** Ring vertices. Closure and winding order are fixed up on write. */
  ring: LatLng2[];
  attrs: Record<string, string | number>;
};

export type ShapefileBundle = {
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
  prj: Uint8Array;
};

/** Signed area in coordinate units. Positive = counter-clockwise (x=lng, y=lat). */
function signedArea(ring: LatLng2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.lng * q.lat - q.lng * p.lat;
  }
  return a / 2;
}

/**
 * ESRI requires outer rings CLOCKWISE with the first vertex repeated last.
 * Readers that honour the spec — DJI's included — treat a counter-clockwise
 * outer ring as a hole, which is exactly how a boundary imports as an empty
 * field with no error message.
 */
function normalizeOuterRing(ring: LatLng2[]): LatLng2[] {
  const pts = ring.slice();
  const first = pts[0], last = pts[pts.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) pts.push({ ...first });
  if (signedArea(pts) > 0) pts.reverse();
  return pts;
}

function ringBbox(ring: LatLng2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.lng < minX) minX = p.lng;
    if (p.lng > maxX) maxX = p.lng;
    if (p.lat < minY) minY = p.lat;
    if (p.lat > maxY) maxY = p.lat;
  }
  return { minX, minY, maxX, maxY };
}

/** 100-byte main header, shared by .shp and .shx — only the length differs. */
function writeHeader(
  view: DataView,
  fileLengthWords: number,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  view.setInt32(0, 9994, false);              // file code, big-endian
  view.setInt32(24, fileLengthWords, false);  // length in 16-bit words, big-endian
  view.setInt32(28, 1000, true);              // version, little-endian
  view.setInt32(32, SHAPE_TYPE_POLYGON, true);
  view.setFloat64(36, bbox.minX, true);
  view.setFloat64(44, bbox.minY, true);
  view.setFloat64(52, bbox.maxX, true);
  view.setFloat64(60, bbox.maxY, true);
  // Zmin/Zmax/Mmin/Mmax stay zero — these are 2D polygons.
}

function encodeAscii(s: string, length: number, align: "left" | "right"): Uint8Array {
  const out = new Uint8Array(length).fill(0x20);
  const clipped = s.slice(0, length);
  const start = align === "right" ? length - clipped.length : 0;
  for (let i = 0; i < clipped.length; i++) {
    // dBase III is single-byte. Anything non-ASCII becomes "?" rather than
    // shifting the fixed-width record and corrupting every later field.
    const c = clipped.charCodeAt(i);
    out[start + i] = c < 128 ? c : 0x3f;
  }
  return out;
}

function buildDbf(
  fields: DbfField[],
  rows: Record<string, string | number>[],
  when: Date,
): Uint8Array {
  const headerLen = 32 + fields.length * 32 + 1;
  const recordLen = 1 + fields.reduce((n, f) => n + f.length, 0);
  const total = headerLen + rows.length * recordLen + 1;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  bytes[0] = 0x03;                            // dBase III, no memo file
  bytes[1] = when.getFullYear() - 1900;
  bytes[2] = when.getMonth() + 1;
  bytes[3] = when.getDate();
  view.setInt32(4, rows.length, true);
  view.setInt16(8, headerLen, true);
  view.setInt16(10, recordLen, true);

  fields.forEach((f, i) => {
    const off = 32 + i * 32;
    // Field names are 10 chars + NUL terminator. Longer names get truncated by
    // every reader, so callers must keep them short enough to stay unique.
    const name = encodeAscii(f.name.toUpperCase(), 10, "left");
    for (let k = 0; k < 10; k++) bytes[off + k] = name[k] === 0x20 ? 0 : name[k];
    bytes[off + 11] = f.type.charCodeAt(0);
    bytes[off + 16] = f.length;
    bytes[off + 17] = f.type === "N" ? f.decimals : 0;
  });
  bytes[headerLen - 1] = 0x0d;                // field descriptor terminator

  rows.forEach((row, r) => {
    let off = headerLen + r * recordLen;
    bytes[off++] = 0x20;                      // record not deleted
    for (const f of fields) {
      const raw = row[f.name];
      const text = f.type === "N"
        ? Number(raw ?? 0).toFixed(f.decimals)
        : String(raw ?? "");
      // Numerics are right-aligned per dBase convention; text is left-aligned.
      bytes.set(encodeAscii(text, f.length, f.type === "N" ? "right" : "left"), off);
      off += f.length;
    }
  });
  bytes[total - 1] = 0x1a;                    // EOF marker
  return bytes;
}

/**
 * Write a polygon shapefile. One feature per ring — a fragmented field becomes
 * several single-part polygons rather than one multi-part record, which is what
 * the Agras controller expects when it offers per-area selection on import.
 */
export function writePolygonShapefile(
  features: ShpFeature[],
  fields: DbfField[],
  when: Date = new Date(),
): ShapefileBundle {
  if (!features.length) throw new Error("shapefile: refusing to write zero features");

  const rings = features.map(f => normalizeOuterRing(f.ring));
  for (const r of rings) {
    if (r.length < 4) throw new Error("shapefile: a polygon ring needs at least 3 distinct vertices");
  }

  // Record content = type + bbox + numParts + numPoints + part index + points.
  const contentBytes = rings.map(r => 4 + 32 + 4 + 4 + 4 + 16 * r.length);
  const shpLength = 100 + contentBytes.reduce((n, c) => n + 8 + c, 0);
  const shxLength = 100 + rings.length * 8;

  const shpBuf = new ArrayBuffer(shpLength);
  const shxBuf = new ArrayBuffer(shxLength);
  const shp = new DataView(shpBuf);
  const shx = new DataView(shxBuf);

  const bbox = ringBbox(rings.flat());
  writeHeader(shp, shpLength / 2, bbox);
  writeHeader(shx, shxLength / 2, bbox);

  let off = 100;
  rings.forEach((ring, i) => {
    const content = contentBytes[i];
    // .shx entries are measured in 16-bit words, like the header lengths.
    shx.setInt32(100 + i * 8, off / 2, false);
    shx.setInt32(100 + i * 8 + 4, content / 2, false);

    shp.setInt32(off, i + 1, false);          // record number, 1-based
    shp.setInt32(off + 4, content / 2, false);
    let p = off + 8;
    shp.setInt32(p, SHAPE_TYPE_POLYGON, true); p += 4;
    const bb = ringBbox(ring);
    shp.setFloat64(p, bb.minX, true); p += 8;
    shp.setFloat64(p, bb.minY, true); p += 8;
    shp.setFloat64(p, bb.maxX, true); p += 8;
    shp.setFloat64(p, bb.maxY, true); p += 8;
    shp.setInt32(p, 1, true); p += 4;         // one part per record
    shp.setInt32(p, ring.length, true); p += 4;
    shp.setInt32(p, 0, true); p += 4;         // part 0 starts at point 0
    for (const pt of ring) {
      shp.setFloat64(p, pt.lng, true); p += 8;
      shp.setFloat64(p, pt.lat, true); p += 8;
    }
    off += 8 + content;
  });

  return {
    shp: new Uint8Array(shpBuf),
    shx: new Uint8Array(shxBuf),
    dbf: buildDbf(fields, features.map(f => f.attrs), when),
    prj: new TextEncoder().encode(WGS84_ESRI_WKT),
  };
}

// ---------------------------------------------------------------------------
// Readers — these exist so the exporter can prove its own output round-trips.
// Not intended as general-purpose shapefile parsers.
// ---------------------------------------------------------------------------

export type ReadShapefile = {
  shapeType: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  polygons: LatLng2[][];
};

/** Parse back a .shp we wrote, so export can assert the geometry survived. */
export function readPolygonShapefile(shp: Uint8Array): ReadShapefile {
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (view.getInt32(0, false) !== 9994) throw new Error("shapefile: bad file code");
  const lengthWords = view.getInt32(24, false);
  if (lengthWords * 2 !== shp.byteLength) {
    throw new Error(`shapefile: header says ${lengthWords * 2} bytes, file is ${shp.byteLength}`);
  }
  const shapeType = view.getInt32(32, true);
  const bbox = {
    minX: view.getFloat64(36, true), minY: view.getFloat64(44, true),
    maxX: view.getFloat64(52, true), maxY: view.getFloat64(60, true),
  };

  const polygons: LatLng2[][] = [];
  let off = 100;
  while (off < shp.byteLength) {
    const content = view.getInt32(off + 4, false) * 2;
    let p = off + 8 + 4 + 32;                 // skip shape type + record bbox
    const numParts = view.getInt32(p, true); p += 4;
    const numPoints = view.getInt32(p, true); p += 4;
    p += numParts * 4;                        // part start indices — always [0]
    const ring: LatLng2[] = [];
    for (let i = 0; i < numPoints; i++) {
      ring.push({ lng: view.getFloat64(p, true), lat: view.getFloat64(p + 8, true) });
      p += 16;
    }
    polygons.push(ring);
    off += 8 + content;
  }
  return { shapeType, bbox, polygons };
}

/** Parse back a .dbf we wrote. Every field comes back as a trimmed string. */
export function readDbf(dbf: Uint8Array): Record<string, string>[] {
  const view = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const numRecords = view.getInt32(4, true);
  const headerLen = view.getInt16(8, true);
  const recordLen = view.getInt16(10, true);

  const fields: { name: string; length: number }[] = [];
  for (let off = 32; off < headerLen - 1; off += 32) {
    let name = "";
    for (let i = 0; i < 11; i++) {
      const c = dbf[off + i];
      if (c === 0 || c === 0x20) break;
      name += String.fromCharCode(c);
    }
    fields.push({ name, length: dbf[off + 16] });
  }

  const rows: Record<string, string>[] = [];
  for (let r = 0; r < numRecords; r++) {
    let off = headerLen + r * recordLen + 1;  // +1 skips the deletion flag
    const row: Record<string, string> = {};
    for (const f of fields) {
      let s = "";
      for (let i = 0; i < f.length; i++) s += String.fromCharCode(dbf[off + i]);
      row[f.name] = s.trim();
      off += f.length;
    }
    rows.push(row);
  }
  return rows;
}
