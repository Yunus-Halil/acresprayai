// Reading members out of a zip by range: the table of contents is at the end,
// and a member is found from it without touching the rest of the archive.
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { MIN_WINDOW_PX, areaWindow } from "@/lib/sourceFrames/crop";
import { type RangeReader, listZip, rangeReaderFor, readZipEntry } from "@/lib/sourceFrames/zipRange";

const enc = new TextEncoder();
const archive = zipSync({
  "cameras.json": [enc.encode(JSON.stringify({ cam: { projection_type: "brown" } })), { level: 6 }],
  "odm_report/shots.geojson": [enc.encode(JSON.stringify({ type: "FeatureCollection", features: [] })), { level: 0 }],
  "odm_orthophoto/big.bin": [new Uint8Array(200_000).fill(7), { level: 0 }],
});

const readerOver = (buf: Uint8Array) => {
  const reads: [number, number][] = [];
  const read: RangeReader = async (s, e) => { reads.push([s, e]); return buf.subarray(s, e + 1); };
  return { read, reads };
};

describe("listZip and readZipEntry", () => {
  it("lists every member from the tail and reads one back, deflated or stored", async () => {
    const { read, reads } = readerOver(archive);
    const entries = await listZip(read, archive.length);
    expect(entries.map(e => e.name).sort()).toEqual(["cameras.json", "odm_orthophoto/big.bin", "odm_report/shots.geojson"]);
    const cameras = entries.find(e => e.name === "cameras.json")!;
    expect(cameras.method).toBe(8);
    expect(JSON.parse(new TextDecoder().decode(await readZipEntry(read, cameras)))).toEqual({ cam: { projection_type: "brown" } });
    const shots = entries.find(e => e.name.endsWith("shots.geojson"))!;
    expect(shots.method).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(await readZipEntry(read, shots)))).toMatchObject({ type: "FeatureCollection" });
    // The 200 KB member was never read.
    const bytesRead = reads.reduce((n, [s, e]) => n + (e - s + 1), 0);
    expect(bytesRead).toBeLessThan(80_000);
  });

  it("rangeReaderFor sends a Range header and trims a server that ignored it", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>).Range;
      expect(range).toBe("bytes=2-4");
      return new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6]), { status: 200 });
    });
    const read = rangeReaderFor("https://x/y.zip", fetchImpl as unknown as typeof fetch);
    expect(Array.from(await read(2, 4))).toEqual([2, 3, 4]);
  });

  it("refuses something that is not a zip", async () => {
    const { read } = readerOver(new Uint8Array(100));
    await expect(listZip(read, 100)).rejects.toThrow(/not a zip/);
  });
});

describe("areaWindow", () => {
  it("cuts the area's box at native scale with context around it, centred", () => {
    // A 400 x 200 px box in the uploaded frame, scale 2: 800 x 400 native centred on
    // (2400, 1600), plus 25% of 800 each side: 1200 x 800 starting at (1800, 1200).
    const w = areaWindow({ x0: 1000, y0: 700, x1: 1400, y1: 900 }, 2, 5472, 3648);
    expect(w).toEqual({ x: 1800, y: 1200, width: 1200, height: 800 });
  });

  it("gives a tiny area a minimum window so it has surroundings", () => {
    const w = areaWindow({ x0: 1200, y0: 800, x1: 1201, y1: 801 }, 2.28, 5472, 3648);
    expect(w.width).toBe(MIN_WINDOW_PX);
    expect(w.height).toBe(MIN_WINDOW_PX);
  });

  it("stays inside the frame at its edges and never exceeds it", () => {
    const corner = areaWindow({ x0: 0, y0: 0, x1: 50, y1: 50 }, 2.28, 5472, 3648);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
    const huge = areaWindow({ x0: 0, y0: 0, x1: 2400, y1: 1600 }, 2.28, 5472, 3648);
    expect(huge).toEqual({ x: 0, y: 0, width: 5472, height: 3648 });
  });
});
