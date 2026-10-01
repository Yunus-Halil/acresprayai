// Reading members out of a zip by range: the table of contents is at the end,
// and a member is found from it without touching the rest of the archive.
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { cropWindow } from "@/lib/sourceFrames/crop";
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

describe("cropWindow", () => {
  it("centres the native window on the scaled pixel and clamps it to the frame", () => {
    // A point at (1200, 800) in a 2400 px frame, scale 2.28, 100 px window.
    const w = cropWindow(1200, 800, 2.28, 100, 5472, 3648);
    expect(w).toEqual({ x: 2686, y: 1774, size: 100, scale: 2.28 });
    const edge = cropWindow(5, 5, 2.28, 100, 5472, 3648);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    const far = cropWindow(2399, 1599, 2.28, 100, 5472, 3648);
    expect(far.x + far.size).toBeLessThanOrEqual(5472);
    expect(far.y + far.size).toBeLessThanOrEqual(3648);
  });

  it("never asks for a window larger than the frame", () => {
    expect(cropWindow(10, 10, 1, 9999, 640, 480).size).toBe(480);
  });
});
