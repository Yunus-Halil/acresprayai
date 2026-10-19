// The model run on the field map itself: positions come from the map's own pixels, exactly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import type { WeedInstance, WeedVisionResult } from "@/lib/weedVision/client";
import type { SavedFrameRun } from "@/lib/weedVision/frameRunCache";
import { getFrameRun, resetFrameRunStore, restoreFrameRun, setFrameRunBoundary, setFrameRunMap, startMapRun, unalignedFrames } from "@/lib/weedVision/frameRunStore";
import { type MapChunk, MAP_CHUNK_PX, MAP_OVERLAP_PX, chooseMapZoom, chunkCanvas, groundMapResult, isMapRunKey, latLngOfPx, mapRunKey, mapTiling, mercatorPx, metresPerPixel, planMapChunks, upscaleFor } from "@/lib/weedVision/mapRun";
import { compactDetection } from "@/lib/weedVision/frameRunCache";
import type { RowContext } from "@/lib/weedVision/rowFilter";

const LAT = 37.6, LNG = -78.4; // Virginia
const Z = 23;
const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };

/** An instance at (x, y) in the enlarged chunk's pixels (centres at integers), a small square outline. */
function inst(id: number, x: number, y: number, klass: "weed" | "crop" = "weed"): WeedInstance {
  const r = 6;
  return { id, centroid_px: [x, y], bbox_px: [x - r, y - r, x + r, y + r], area_px: 4 * r * r, max_span_px: 2 * r, span_endpoints_px: [[x - r, y], [x + r, y]], perpendicular_span_px: 2 * r, obb: { length_px: 2 * r, width_px: 2 * r, angle_deg: 0 }, equivalent_diameter_px: 2 * r, solidity: 1, pieces: 1, touches_border: false, tiny: false, score: 0.8, score_kind: "detector_confidence", polygons_px: [[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]], flags: [], class: klass, fused_from_tiles: 1 };
}
const result = (instances: WeedInstance[], crops: WeedInstance[] = []): WeedVisionResult => ({ instances, crop_instances: crops, image: { width: 100, height: 100 }, algorithm: { name: "rfdetr_seg_large" }, timings_ms: { total: 5 } } as unknown as WeedVisionResult);

describe("map pixels and places", () => {
  it("round-trips a point through Web Mercator pixels to well under a millimetre", () => {
    const [X, Y] = mercatorPx(LAT, LNG, Z);
    const g = latLngOfPx(X, Y, Z);
    expect(Math.abs(g.lat - LAT) * 111_320).toBeLessThan(1e-4);
    expect(Math.abs(g.lng - LNG) * 111_320 * Math.cos((LAT * Math.PI) / 180)).toBeLessThan(1e-4);
  });

  it("reads the map only when it is sharp enough, and enlarges it to the photos' sharpness", () => {
    expect(chooseMapZoom(23, LAT)?.z).toBe(23);
    expect(chooseMapZoom(22, LAT)?.z).toBe(22); // ~3 cm
    expect(chooseMapZoom(21, LAT)).toBeNull(); // ~6 cm: the photographs instead
    expect(chooseMapZoom(25, LAT)?.z).toBe(23);
    const mpp = metresPerPixel(LAT, 23);
    expect(upscaleFor(mpp, 0.01)).toBe(1.5); // 1.48 cm map, 1 cm photos
    expect(upscaleFor(mpp, 0.02)).toBe(1);
    expect(upscaleFor(mpp, 0.004)).toBe(2);
  });

  it("covers the field with chunks whose own squares hold every point of it once", () => {
    const d = 0.0006; // about 60 m
    const ring = [{ lat: LAT - d, lng: LNG - d }, { lat: LAT - d, lng: LNG + d }, { lat: LAT + d, lng: LNG + d }, { lat: LAT + d, lng: LNG - d }];
    const chunks = planMapChunks([ring], Z);
    expect(chunks.length).toBeGreaterThan(20);
    for (const [fy, fx] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.33, 0.77]]) {
      const [X, Y] = mercatorPx(LAT - d + 2 * d * fy, LNG - d + 2 * d * fx, Z);
      const owners = chunks.filter(c => X >= c.x0 && X < c.x0 + c.size && Y >= c.y0 && Y < c.y0 + c.size);
      expect(owners).toHaveLength(1);
    }
    expect(new Set(chunks.map(c => c.name)).size).toBe(chunks.length);
  });
});

describe("groundMapResult", () => {
  const [X, Y] = mercatorPx(LAT, LNG, Z);
  const chunk: MapChunk = { name: "map/z23/c", z: Z, x0: Math.floor(X) - 700, y0: Math.floor(Y) - 500, size: MAP_CHUNK_PX, overlap: MAP_OVERLAP_PX };
  const cv = chunkCanvas(chunk);

  it("puts a weed exactly where its map pixel is, at any enlargement", () => {
    for (const s of [1, 1.5, 2]) {
      // The pixel whose top-left corner is (X0, Y0) on the map, in the enlarged image: its centre.
      const X0 = Math.floor(X), Y0 = Math.floor(Y);
      const jx = (X0 + 0.5 - cv.left) * s - 0.5, jy = (Y0 + 0.5 - cv.top) * s - 0.5;
      const [d] = groundMapResult({ chunk, result: result([inst(1, jx, jy)]), upscale: s, rows: null, lat: LAT });
      const want = latLngOfPx(X0 + 0.5, Y0 + 0.5, Z);
      expect(Math.abs(d.centre!.lat - want.lat) * 111_320).toBeLessThan(1e-6);
      expect(Math.abs(d.centre!.lng - want.lng) * 111_320).toBeLessThan(1e-6);
      expect(d.alignment?.v).toBe(2); // nothing to align
      expect(d.diameterM).toBeCloseTo((12 * metresPerPixel(LAT, Z)) / s, 6);
    }
  });

  it("keeps only the weeds whose centre is in the chunk's own square, so the overlap counts nothing twice", () => {
    const inOverlap = inst(1, MAP_OVERLAP_PX / 2, 400);
    const inCore = inst(2, MAP_OVERLAP_PX + 10, 400);
    const pastFar = inst(3, MAP_OVERLAP_PX + MAP_CHUNK_PX + 5, 400);
    const dets = groundMapResult({ chunk, result: result([inOverlap, inCore, pastFar]), upscale: 1, rows: null, lat: LAT });
    expect(dets.map(d => d.instanceId)).toEqual([2]);
  });

  it("tags each weed against the chunk's rows, in canvas pixels", () => {
    const rows: RowContext = { lines: [{ x1: 0, y1: 500, x2: 2000, y2: 500 }], crops: [], bandPx: 10, gsdM: 0.015 };
    const s = 2;
    const on = inst(1, (500 + 0.5) * s - 0.5 + 0, (500 + 0.5) * s - 0.5);
    const off = inst(2, (500 + 0.5) * s - 0.5, (560 + 0.5) * s - 0.5);
    const crop = inst(3, 1100, 1100, "crop");
    const dets = groundMapResult({ chunk, result: result([on, off], [crop]), upscale: s, rows, lat: LAT });
    expect(dets.find(d => d.instanceId === 1)?.rowStatus).toBe("on-row");
    expect(dets.find(d => d.instanceId === 2)?.rowStatus).toBe("off-row");
    expect(dets.find(d => d.klass === "crop")?.rowStatus).toBeUndefined();
  });
});

describe("startMapRun", () => {
  beforeEach(() => resetFrameRunStore());
  afterEach(() => resetFrameRunStore());

  const d = 0.00025; // about 25 m: a few chunks
  const ring = [{ lat: LAT - d, lng: LNG - d }, { lat: LAT - d, lng: LNG + d }, { lat: LAT + d, lng: LNG + d }, { lat: LAT + d, lng: LNG - d }];

  function deps(store = new Map<string, SavedFrameRun>()) {
    const detect = vi.fn(async () => ({ ok: true as const, value: result([inst(1, 400, 400), inst(2, 900, 700)]) }));
    return {
      detect, store,
      deps: {
        detect,
        download: async () => null,
        mapChunk: vi.fn(async () => ({ pixels: { width: 4, height: 4, rgba: new Uint8ClampedArray(64) }, image: new Blob([new Uint8Array(4)]), coverage: 1 })),
        mapRows: vi.fn(async () => null),
        cache: {
          load: async (_scan: string, key: string) => new Map([...store.entries()].filter(([k]) => k.startsWith(`${key}|`)).map(([k, v]) => [k.slice(key.length + 1), v])),
          save: async ({ paramsKey, run }: { paramsKey: string; run: SavedFrameRun }) => { store.set(`${paramsKey}|${run.filename}`, run); return { ok: true as const }; },
          remove: async () => ({ ok: true as const }),
        },
      },
    };
  }

  it("needs the map, then reads it chunk by chunk with no photos, saves each chunk, and restores without a reconstruction", async () => {
    const f = deps();
    startMapRun("scan-m", { userId: "u", params: PARAMS, algorithmLabel: "RF-DETR", modelSha: "abc", photoGsdM: 0.01, passParams: { rowSpacingM: "auto", windowM: 6, minBlobAreaCm2: 1 }, deps: f.deps as never });
    expect(getFrameRun("scan-m").error).toMatch(/not sharp enough/);

    setFrameRunMap("scan-m", { tile: (z, x, y) => `t/${z}/${x}/${y}.png`, maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("scan-m", [ring]);
    expect(getFrameRun("scan-m").mapAvailable?.z).toBe(23);
    startMapRun("scan-m", { userId: "u", params: PARAMS, algorithmLabel: "RF-DETR", modelSha: "abc", photoGsdM: 0.01, passParams: { rowSpacingM: "auto", windowM: 6, minBlobAreaCm2: 1 }, deps: f.deps as never });
    await vi.waitFor(() => expect(getFrameRun("scan-m").running).toBe(false));
    const s = getFrameRun("scan-m");
    const chunks = Object.keys(s.frames).length;
    expect(chunks).toBeGreaterThan(1);
    expect(f.detect).toHaveBeenCalledTimes(chunks);
    expect(isMapRunKey(s.paramsKey)).toBe(true);
    // Sent at the chunk's own pixels with tiles shrunk by the enlargement it stands for (1.5 at 1 cm photos).
    const sent = { ...PARAMS, ...mapTiling(PARAMS, 1.5) };
    expect(sent.tile).toBe(680);
    expect(s.paramsKey).toBe(mapRunKey(sent, "abc", 23, 1));
    expect((f.deps.mapChunk.mock.calls as unknown as unknown[][]).every(c => c[2] === 1)).toBe(true);
    expect((f.detect.mock.calls as unknown as unknown[][]).every(c => (c[2] as { tile: number; geometry: string }).tile === 680 && (c[2] as { geometry: string }).geometry === "lite")).toBe(true);
    expect(s.plants.length).toBeGreaterThan(0);
    expect(s.plants.every(p => p.frame.startsWith("map/") && p.seenIn.length === 1)).toBe(true);
    expect(unalignedFrames("scan-m")).toHaveLength(0); // nothing to align
    expect(s.note).toMatch(/read off the field map/);
    expect(f.store.size).toBe(chunks);
    const shown = s.plants.length;

    // Again, from the saved chunks, with no photos or reconstruction at all.
    resetFrameRunStore();
    setFrameRunMap("scan-m", { tile: () => "", maxNative: 23, lat: LAT, lng: LNG });
    setFrameRunBoundary("scan-m", [ring]);
    expect(await restoreFrameRun("scan-m", { sources: null, params: PARAMS, paramsKey: mapRunKey({ ...PARAMS, ...mapTiling(PARAMS, 1.5) }, "abc", 23, 1), modelSha: "abc", algorithmLabel: "RF-DETR", deps: f.deps as never })).toBe(true);
    expect(getFrameRun("scan-m").plants).toHaveLength(shown);
    expect(getFrameRun("scan-m").hotspots).not.toBeNull();
  });
});

describe("profile-driven changes (2026-10-19)", () => {
  it("shrinks the tile by the enlargement it replaces, so the model's sampling is unchanged", () => {
    // RF-DETR resizes every tile to 504 px: model pixels per chunk pixel = upscale x 504 / tile, before and after.
    for (const up of [1, 1.25, 1.5, 1.75, 2]) {
      const t = mapTiling(PARAMS, up);
      expect(t.tile % 8).toBe(0);
      expect(Math.abs(504 / t.tile - (up * 504) / PARAMS.tile) / ((up * 504) / PARAMS.tile)).toBeLessThan(0.01);
      expect(Math.abs(t.overlap - PARAMS.overlap / up)).toBeLessThanOrEqual(0.5);
    }
    expect(mapTiling(PARAMS, 1)).toEqual({ tile: 1024, overlap: 256 }); // unenlarged runs keep their key
    expect(mapTiling({ tile: 512, overlap: 128 }, 4).tile).toBe(256); // the service's floor
  });

  it("stores a map plant without its chunk-pixel outline, rounded to about a centimetre, and far smaller", () => {
    const chunk: MapChunk = { name: "map/z23/1_1", z: Z, x0: 0, y0: 0, size: MAP_CHUNK_PX, overlap: MAP_OVERLAP_PX };
    const many = Array.from({ length: 40 }, (_, k) => [500 + 30 * Math.cos(k / 6.3), 500 + 30 * Math.sin(k / 6.3)] as [number, number]);
    const big = { ...inst(1, 500, 500), polygons_px: [many] };
    const [d] = groundMapResult({ chunk, result: result([big]), upscale: 1, rows: null, lat: LAT });
    const c = compactDetection(d);
    expect(c.nativePolygon).toEqual([]);
    expect(c.ring).toHaveLength(d.ring!.length);
    c.ring!.forEach((q, i) => { expect(Math.abs(q.lat - d.ring![i].lat) * 111_320).toBeLessThan(0.006); expect(Math.abs(q.lng - d.ring![i].lng) * 111_320).toBeLessThan(0.006); });
    expect(c.centre!.lat).toBeCloseTo(d.centre!.lat, 6);
    expect(c.areaM2! / d.areaM2!).toBeCloseTo(1, 4);
    expect(JSON.stringify(c).length).toBeLessThan(0.6 * JSON.stringify(d).length);
    const photo = compactDetection({ ...d, frame: "DJI_0001.JPG" });
    expect(photo.nativePolygon).toHaveLength(d.nativePolygon.length); // re-placing a photo outline needs it
  });
});
