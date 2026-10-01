// Read a few small members out of a very large zip without downloading it.
//
// The mirrored ODM archive is about a gigabyte and the files we want from it
// (camera poses, lens, EXIF, stats) total under 400 KB. A zip keeps its table
// of contents at the end, so three HTTP range requests find any member:
// the end-of-central-directory record, the central directory it points at,
// and the member's own bytes. Storage signed URLs honour Range; nothing here
// needs a server.
import { inflateSync } from "fflate";

export type ZipEntry = {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the local file header. */
  headerOffset: number;
};

export type RangeReader = (start: number, endInclusive: number) => Promise<Uint8Array>;

/** A RangeReader over a URL. */
export function rangeReaderFor(url: string, fetchImpl: typeof fetch = fetch): RangeReader {
  return async (start, end) => {
    const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.status !== 206 && res.status !== 200) throw new Error(`range ${start}-${end}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range returns the whole file; cut it down.
    return res.status === 200 && buf.length > end - start + 1 ? buf.subarray(start, end + 1) : buf;
  };
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;
const findSig = (b: Uint8Array, sig: number[]): number => {
  for (let i = b.length - sig.length; i >= 0; i--) {
    if (b[i] === sig[0] && b[i + 1] === sig[1] && b[i + 2] === sig[2] && b[i + 3] === sig[3]) return i;
  }
  return -1;
};

/** The archive's table of contents, from its tail. Handles zip64 (archives over 4 GB or 65,535 entries). */
export async function listZip(read: RangeReader, totalSize: number): Promise<ZipEntry[]> {
  const tailLen = Math.min(totalSize, 70_000);
  const tail = await read(totalSize - tailLen, totalSize - 1);
  const eocd = findSig(tail, [0x50, 0x4b, 0x05, 0x06]);
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = findSig(tail, [0x50, 0x4b, 0x06, 0x07]);
    if (loc < 0) throw new Error("zip64 archive without a locator");
    const z64Offset = u64(tail, loc + 8);
    const z64 = await read(z64Offset, z64Offset + 55);
    count = u64(z64, 32); cdSize = u64(z64, 40); cdOffset = u64(z64, 48);
  }
  const cd = await read(cdOffset, cdOffset + cdSize - 1);
  const entries: ZipEntry[] = [];
  let o = 0;
  while (o + 46 <= cd.length && u32(cd, o) === 0x02014b50) {
    const method = u16(cd, o + 10);
    let compressedSize = u32(cd, o + 20), size = u32(cd, o + 24), headerOffset = u32(cd, o + 42);
    const nameLen = u16(cd, o + 28), extraLen = u16(cd, o + 30), commentLen = u16(cd, o + 32);
    const name = new TextDecoder().decode(cd.subarray(o + 46, o + 46 + nameLen));
    if (compressedSize === 0xffffffff || size === 0xffffffff || headerOffset === 0xffffffff) {
      let e = o + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = u16(cd, e), len = u16(cd, e + 2);
        if (id === 1) {
          let q = e + 4;
          if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
          if (headerOffset === 0xffffffff) headerOffset = u64(cd, q);
        }
        e += 4 + len;
      }
    }
    entries.push({ name, method, compressedSize, size, headerOffset });
    o += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length !== count) throw new Error(`central directory lists ${count} entries, read ${entries.length}`);
  return entries;
}

/** One member's bytes, inflated. */
export async function readZipEntry(read: RangeReader, entry: ZipEntry): Promise<Uint8Array> {
  const header = await read(entry.headerOffset, entry.headerOffset + 29);
  if (u32(header, 0) !== 0x04034b50) throw new Error(`${entry.name}: bad local header`);
  const start = entry.headerOffset + 30 + u16(header, 26) + u16(header, 28);
  if (entry.compressedSize === 0) return new Uint8Array(0);
  const data = await read(start, start + entry.compressedSize - 1);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data);
  throw new Error(`${entry.name}: compression method ${entry.method} not supported`);
}
