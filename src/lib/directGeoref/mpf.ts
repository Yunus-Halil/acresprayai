// The preview a camera already wrote into its JPEG: the Multi-Picture Format (CIPA DC-007) APP2 segment indexes
// extra images stored after the main one. DJI writes a 960 x 640 preview this way (the Phantom 4 RTK: 250 KB at
// the end of an 8.8 MB file, 5.7 cm pixels at 36 m), which is all the row reader, the green patches, the soil
// ties and the evidence raster need. Decoding it costs milliseconds; decoding the 20 MP frame costs a second.
//
// The index sits in the first few tens of kilobytes (the header the build reads anyway); only the preview's own
// bytes are read from the end of the file.

export type MpfEntry = { /** Byte offset of the image in the file. */ offset: number; size: number; /** The MP type attribute (the low 24 bits: 0x010001 large thumbnail, 0x030000 primary, ...). */ attribute: number };

/** The MPF index of a JPEG's leading bytes: every listed image except the primary, or null without an MPF segment. */
export function mpfEntries(head: Uint8Array): MpfEntry[] | null {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= head.length && head[i] === 0xff) {
    const marker = head[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xff) { i++; continue; }
    const len = (head[i + 2] << 8) | head[i + 3];
    if (len < 2) break;
    const start = i + 4;
    if (marker === 0xe2 && head.length >= start + 4 && head[start] === 0x4d && head[start + 1] === 0x50 && head[start + 2] === 0x46 && head[start + 3] === 0) {
      return parseMp(head, start + 4, Math.min(head.length, i + 2 + len));
    }
    i += 2 + len;
  }
  return null;
}

function parseMp(b: Uint8Array, base: number, end: number): MpfEntry[] | null {
  if (base + 8 > end) return null;
  const little = b[base] === 0x49 && b[base + 1] === 0x49;
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  if (u16(base + 2) !== 42) return null;
  const ifd = base + u32(base + 4);
  if (ifd + 2 > end) return null;
  const n = u16(ifd);
  let count = 0, entriesAt = -1;
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + 12 * k;
    if (e + 12 > end) return null;
    const tag = u16(e), cnt = u32(e + 4);
    if (tag === 0xb001) count = u32(e + 8);
    else if (tag === 0xb002) { entriesAt = base + u32(e + 8); if (!count) count = cnt / 16; }
  }
  if (entriesAt < 0 || count <= 0) return null;
  const out: MpfEntry[] = [];
  for (let k = 0; k < count; k++) {
    const e = entriesAt + 16 * k;
    if (e + 16 > end) break;
    const attribute = u32(e), size = u32(e + 4), rel = u32(e + 8);
    // The primary image is listed with offset 0; every other offset counts from the MP header (the byte order mark).
    if (rel === 0 || size === 0) continue;
    out.push({ offset: base + rel, size, attribute });
  }
  return out;
}

/** The largest preview the MPF index lists, or null. */
export function mpfPreview(head: Uint8Array): MpfEntry | null {
  const entries = mpfEntries(head);
  if (!entries || !entries.length) return null;
  return entries.reduce((a, b) => (b.size > a.size ? b : a));
}
