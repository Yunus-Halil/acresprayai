// The header of a TIFF photograph (a DJI multispectral band, an RGB TIFF from a camera): the image file
// directories walked for the few tags the twin needs. A TIFF is the same structure a JPEG's EXIF block holds,
// but the directories may sit anywhere in the file (DJI writes them after the pixels), so the caller hands the
// whole file's bytes, not a head. No pixel data is read here.
//
// Read: the size, make and model (IFD0), the XMP packet (tag 700, where DJI writes its drone-dji fields), the
// EXIF sub-directory's focal length and focal-plane resolution, the GPS sub-directory's position and altitude,
// the sample layout (bands and bits), and the ImageDescription.

export type TiffHeader = {
  width: number | null;
  height: number | null;
  make: string | null;
  model: string | null;
  /** The XMP packet as text, or null. */
  xmp: string | null;
  focalMm: number | null;
  focalPlaneXResolution: number | null;
  focalPlaneResolutionUnit: number | null;
  lat: number | null;
  lng: number | null;
  gpsAltitudeM: number | null;
  capturedAt: string | null;
  samplesPerPixel: number | null;
  bitsPerSample: number | null;
  description: string | null;
};

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/** True when the bytes start a TIFF (either byte order). */
export function isTiff(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a));
}

type Entry = { tag: number; type: number; count: number; valueOffset: number };

/** Walk a TIFF's directories. Throws on a file that is not a TIFF or whose directories run past its end. */
export function tiffHeader(bytes: Uint8Array): TiffHeader {
  if (!isTiff(bytes)) throw new Error("not a TIFF file");
  const le = bytes[0] === 0x49;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  const readIfd = (offset: number): Map<number, Entry> => {
    const out = new Map<number, Entry>();
    if (offset <= 0 || offset + 2 > bytes.length) return out;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > bytes.length) break;
      out.set(u16(e), { tag: u16(e), type: u16(e + 2), count: u32(e + 4), valueOffset: e + 8 });
    }
    return out;
  };
  const dataOf = (en: Entry): { start: number; size: number } | null => {
    const size = (TYPE_SIZE[en.type] ?? 1) * en.count;
    const start = size <= 4 ? en.valueOffset : u32(en.valueOffset);
    if (start < 0 || start + size > bytes.length) return null;
    return { start, size };
  };
  const text = (en: Entry | undefined): string | null => {
    if (!en) return null;
    const d = dataOf(en);
    if (!d) return null;
    let s = "";
    for (let i = d.start; i < d.start + d.size; i++) { const c = bytes[i]; if (c === 0) break; s += String.fromCharCode(c); }
    s = s.trim();
    return s || null;
  };
  const number = (en: Entry | undefined, index = 0): number | null => {
    if (!en) return null;
    const d = dataOf(en);
    if (!d) return null;
    const o = d.start + index * (TYPE_SIZE[en.type] ?? 1);
    if (o + (TYPE_SIZE[en.type] ?? 1) > bytes.length) return null;
    switch (en.type) {
      case 1: case 7: return bytes[o];
      case 3: return u16(o);
      case 4: return u32(o);
      case 5: { const den = u32(o + 4); return den ? u32(o) / den : null; }
      case 8: return dv.getInt16(o, le);
      case 9: return dv.getInt32(o, le);
      case 10: { const den = dv.getInt32(o + 4, le); return den ? dv.getInt32(o, le) / den : null; }
      case 11: return dv.getFloat32(o, le);
      case 12: return dv.getFloat64(o, le);
      default: return null;
    }
  };
  const utf8 = (en: Entry | undefined): string | null => {
    if (!en) return null;
    const d = dataOf(en);
    if (!d) return null;
    try { return new TextDecoder("utf-8").decode(bytes.subarray(d.start, d.start + d.size)).replace(/\0+$/, ""); } catch { return null; }
  };
  const dms = (en: Entry | undefined, ref: string | null): number | null => {
    if (!en || en.count < 3) return null;
    const d = number(en, 0), m = number(en, 1), s = number(en, 2);
    if (d == null || m == null || s == null) return null;
    const v = d + m / 60 + s / 3600;
    return ref && /^[SW]/i.test(ref) ? -v : v;
  };

  const ifd0 = readIfd(u32(4));
  const exifPtr = number(ifd0.get(34665)), gpsPtr = number(ifd0.get(34853));
  const exif = exifPtr ? readIfd(exifPtr) : new Map<number, Entry>();
  const gps = gpsPtr ? readIfd(gpsPtr) : new Map<number, Entry>();
  const xmpEntry = ifd0.get(700);
  return {
    width: number(ifd0.get(256)) ?? number(exif.get(40962)),
    height: number(ifd0.get(257)) ?? number(exif.get(40963)),
    make: text(ifd0.get(271)),
    model: text(ifd0.get(272)),
    xmp: xmpEntry ? utf8(xmpEntry) : null,
    focalMm: number(exif.get(37386)),
    focalPlaneXResolution: number(exif.get(41486)),
    focalPlaneResolutionUnit: number(exif.get(41488)),
    lat: dms(gps.get(2), text(gps.get(1))),
    lng: dms(gps.get(4), text(gps.get(3))),
    gpsAltitudeM: (() => { const a = number(gps.get(6)); if (a == null) return null; return number(gps.get(5)) === 1 ? -a : a; })(),
    capturedAt: text(exif.get(36867)) ?? text(ifd0.get(306)),
    samplesPerPixel: number(ifd0.get(277)),
    bitsPerSample: number(ifd0.get(258)),
    description: text(ifd0.get(270)),
  };
}
