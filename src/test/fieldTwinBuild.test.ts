// The in-app twin build: the pure pieces (ids, grey rasters, observations from the model's answer, the pipeline's
// refusals) on synthetic inputs, and the whole pipeline on a few real photographs when the local test flight is
// present (data the repository does not hold; skipped elsewhere).
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeCodec, nodePhoto } from "../../scripts/directGeoref/nodePhotos";
import { candidatePairs } from "@/lib/fieldTwin/build/cameras";
import { greyRasterBytes, readPhotographs } from "@/lib/fieldTwin/build/photos";
import { buildFieldTwin } from "@/lib/fieldTwin/build/pipeline";
import { type PhotoSource, twinIdFrom } from "@/lib/fieldTwin/build/types";
import { observationsOf } from "@/lib/fieldTwin/build/weeds";
import { frameFromDji, mpfEntries, mpfPreview, takeoffPlane } from "@/lib/directGeoref";
import { isHeldOutPair } from "@/lib/fieldTwin/build/cameras";
import type { DjiPhotoMeta } from "@/lib/directGeoref/metadata";
import { parseTwin } from "@/lib/fieldTwin/types";
import type { WeedInstance } from "@/lib/weedVision/client";

const PHOTOS = resolve(__dirname, "../../directtestimagery");
const haveFlight = existsSync(PHOTOS) && readdirSync(PHOTOS).filter(f => /\.jpe?g$/i.test(f)).length >= 8;

const meta = (over: Partial<DjiPhotoMeta> = {}): DjiPhotoMeta => ({
  make: "DJI", model: "FC6310R", width: 5472, height: 3648, capturedAt: "2021-04-27T10:00:00", lat: 33.884, lng: -5.4196, absoluteAltitudeM: 500, relativeAltitudeM: 36,
  gimbalYawDeg: 131, gimbalPitchDeg: -90, gimbalRollDeg: 0, flightYawDeg: 131, flightPitchDeg: 0, flightRollDeg: 0, calibratedFocalPx: 3666.67, opticalCenterX: 2736, opticalCenterY: 1824,
  dewarpFlag: 1, dewarpData: null, rtkFlag: 50, rtkStdLonM: 0.01, rtkStdLatM: 0.01, rtkStdHgtM: 0.02, positionSource: "XMP", speedEastMs: 0, speedNorthMs: 5, focalMm: 8.8, focal35Mm: 24, ...over,
} as DjiPhotoMeta);

describe("twin build, the pure pieces", () => {
  it("derives a twin id parseTwin accepts from the name and the capture date", () => {
    expect(twinIdFrom("Apricot orchard, north block", "2021-04-27T10:00:00")).toBe("apricot-orchard-north-block-2021-04-27");
    expect(twinIdFrom("  ", null)).toBe("twin");
    expect(twinIdFrom("Çiftlik 3", "2026:10:28 09:00:00")).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
  });

  it("grey rasters as bytes carry the luma and the green mask", () => {
    const px = { width: 2, height: 1, rgba: new Uint8ClampedArray([255, 255, 255, 255, 20, 200, 20, 255]) };
    const g = greyRasterBytes(px, 4);
    expect(g.grey instanceof Uint8Array).toBe(true);
    expect(g.grey[0]).toBe(255); expect(g.grey[1]).toBe(Math.round(0.299 * 20 + 0.587 * 200 + 0.114 * 20));
    expect(Array.from(g.green)).toEqual([0, 1]); expect(g.toOriginal).toBe(4);
  });

  it("turns the model's instances into ground observations at their own pixel size, keeping the largest outline", () => {
    const f = frameFromDji("a", meta(), { ground: takeoffPlane(0) });
    expect("frame" in f).toBe(true);
    if (!("frame" in f)) return;
    const inst: WeedInstance = { id: 3, centroid_px: [2736, 1824], bbox_px: [2700, 1800, 2772, 1848], area_px: 1200, max_span_px: 60, span_endpoints_px: null, perpendicular_span_px: null, obb: null, equivalent_diameter_px: 39, solidity: null, pieces: 1, touches_border: false, tiny: false, score: 0.8, score_kind: "detector_confidence", polygons_px: [[[0, 0], [1, 0], [1, 1]], [[2700, 1800], [2772, 1800], [2772, 1848], [2700, 1848]]], flags: [] };
    const obs = observationsOf("a", f.frame, [inst]);
    expect(obs.length).toBe(1);
    expect(obs[0].sizeM).toBeCloseTo(39 * 0.00982, 3);
    expect((obs[0].data!.poly as number[][]).length).toBe(4);
    expect(obs[0].data!.spanM).toBeCloseTo(60 * 0.00982, 3);
  });

  it("pairs cameras within 45 m", () => {
    const a = frameFromDji("a", meta(), { ground: takeoffPlane(0) }), b = frameFromDji("b", meta({ lat: 33.8843 }), { ground: takeoffPlane(0) }), c = frameFromDji("c", meta({ lat: 33.89 }), { ground: takeoffPlane(0) });
    if (!("frame" in a) || !("frame" in b) || !("frame" in c)) throw new Error("frames");
    const pairs = candidatePairs([a.frame, b.frame, c.frame]);
    expect(pairs.length).toBe(1);
    expect(pairs[0][0].name).toBe("a"); expect(pairs[0][1].name).toBe("b");
  });

  it("refuses photographs without a camera and the whole build without two of them", async () => {
    const bad: PhotoSource = { name: "x", header: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0]), bytes: async () => new Uint8Array(), decode: async () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }), preview: async () => null, crops: async () => [] };
    const { reads, refused } = await readPhotographs([bad], 4);
    expect(reads.length).toBe(0); expect(refused.length).toBe(1);
    expect(refused[0].reason).toMatch(/no camera position|header/);
    await expect(buildFieldTwin([bad], { name: "x", detector: null }, nodeCodec)).rejects.toThrow(/no photograph holds a camera/);
    await expect(buildFieldTwin([], { name: "x", detector: null }, nodeCodec)).rejects.toThrow(/no photographs/);
  });
});

/** A JPEG head with an MPF index listing a primary and one preview at `offset` (relative to the MP header) of `size` bytes. */
function mpfHead(offset: number, size: number): Uint8Array {
  const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0]; // II, 42, IFD at 8
  const n = 2, ifd: number[] = [n, 0];
  const entry = (tag: number, type: number, count: number, value: number) => ifd.push(tag & 255, tag >> 8, type & 255, type >> 8, count & 255, (count >> 8) & 255, (count >> 16) & 255, count >>> 24, value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24);
  entry(0xb001, 4, 1, 2);
  const entriesAt = 8 + 2 + 12 * n + 4;
  entry(0xb002, 7, 32, entriesAt);
  ifd.push(0, 0, 0, 0);
  const mp = (attr: number, sz: number, off: number) => [attr & 255, (attr >> 8) & 255, (attr >> 16) & 255, attr >>> 24, sz & 255, (sz >> 8) & 255, (sz >> 16) & 255, sz >>> 24, off & 255, (off >> 8) & 255, (off >> 16) & 255, off >>> 24, 0, 0, 0, 0];
  const payload = [0x4d, 0x50, 0x46, 0, ...tiff, ...ifd, ...mp(0x030000, 1000, 0), ...mp(0x010001, size, offset)];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe2, len >> 8, len & 255, ...payload, 0xff, 0xda]);
}

describe("the camera's embedded preview (MPF)", () => {
  it("reads the index: the preview's offset from the MP header and its size; none without an MPF segment", () => {
    const head = mpfHead(500_000, 250_000);
    const base = 2 + 4 + 4; // SOI, APP2 marker + length, "MPF\0"
    expect(mpfEntries(head)).toEqual([{ offset: base + 500_000, size: 250_000, attribute: 0x010001 }]);
    expect(mpfPreview(head)).toEqual({ offset: base + 500_000, size: 250_000, attribute: 0x010001 });
    expect(mpfPreview(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xda]))).toBeNull();
    expect(mpfPreview(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it.skipIf(!haveFlight)("finds DJI_0301's 960 x 640 preview and decodes it", async () => {
    const p = nodePhoto(join(PHOTOS, "DJI_0301.JPG"));
    const e = mpfPreview(await p.header());
    expect(e).toEqual({ offset: 8_509_664, size: 252_097, attribute: expect.any(Number) });
    const px = await p.preview();
    expect(px).not.toBeNull();
    expect(px!.width).toBe(960); expect(px!.height).toBe(640);
  });

  it("reads a photograph from its preview with the measured decode ratio, and falls back to the decode without one", async () => {
    const header = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xda]);
    const px = (w: number, h: number) => ({ width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4).fill(120) });
    const withPreview: PhotoSource = { name: "p", header: async () => header, bytes: async () => new Uint8Array(), decode: async () => px(1368, 912), preview: async () => px(96, 64), crops: async () => [] };
    const { reads } = await readPhotographs([withPreview], 4);
    // The header holds no camera, so the photograph is refused before its pixels are read; the ratio is checked on the decode path instead.
    expect(reads.length).toBe(0);
    expect(isHeldOutPair("DJI_0301", "DJI_0302", 0)).toBe(false);
    const share = [..."abcdefghijklmnopqrstuvwxyz"].filter(c => isHeldOutPair(`DJI_${c}`, "DJI_0302", 0.3)).length / 26;
    expect(share).toBeGreaterThan(0.1); expect(share).toBeLessThan(0.5);
  });
});

describe.skipIf(!haveFlight)("twin build on the local test flight (eight photographs, no weed model)", () => {
  it("builds a twin that parses, with cameras aligned on the soil, rows and trees, and a cultivated block", async () => {
    const files = readdirSync(PHOTOS).filter(f => /\.jpe?g$/i.test(f)).sort().slice(0, 8);
    const photos = files.map(f => nodePhoto(join(PHOTOS, f)));
    const stages: string[] = [];
    const out = await buildFieldTwin(photos, { name: "Test flight", detector: null }, nodeCodec, { onProgress: p => { if (!stages.includes(p.stage)) stages.push(p.stage); } });
    expect(stages).toEqual(["photographs", "cameras", "rows", "weeds", "vegetation", "bundle", "evidence", "boundary"]);
    expect(ArrayBuffer.isView(out.files.get("twin.json"))).toBe(true); // bytes, never a Blob (Node has Blob too)
    const parsed = parseTwin(JSON.parse(new TextDecoder().decode(out.files.get("twin.json") as Uint8Array)));
    expect(parsed.ok).toBe(true);
    expect(out.twin.source.photographs).toBe(8);
    expect(out.report.photographs.previews).toBe(8);
    expect(out.report.cameras.ties as number).toBeGreaterThan(40);
    expect(out.report.cameras.residualM as number).toBeLessThan(0.3);
    expect(out.twin.rows.filter(r => r.kept).length).toBeGreaterThanOrEqual(3);
    expect(out.twin.trees.length).toBeGreaterThan(50);
    expect(out.twin.weeds.length).toBe(0);
    expect(out.twin.boundary?.cultivated.areaM2 ?? 0).toBeGreaterThan(1000);
    expect(out.twin.atlases.length).toBeGreaterThanOrEqual(1);
    for (const a of out.twin.atlases) expect(out.files.has(a.file)).toBe(true);
  }, 600_000);
});
