// @vitest-environment node
//
// The photo pass measures each spot in its photo (sizing/): a fresh photo is
// opened again after the pass for the sizes; a photo from the saved reads is
// downloaded for them alone; the sizes land by spot id as the photo lands;
// the pass's own findings carry theirs. The "original" is a cutter that
// paints a disc of known ground size at the pixel the pose predicts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PhotoPattern, PhotoPixels } from "@/lib/photoScout/pattern";
import type { AreaWindow } from "@/lib/sourceFrames/crop";
import { groundAltitudeFromOdm, parseOdmOutputs, pixelToGround, projectToFrame } from "@/lib/sourceFrames/odm";
import { type SavedPhotoRead, runPhotoPass } from "@/lib/weedScout/photoPass";
import type { OpenedOriginal } from "@/lib/weedScout/sizing/measure";
import { DEFAULT_SIZE_THRESHOLDS, unavailableMeasurement } from "@/lib/weedScout/sizing/types";
import type { ScoutParams, ScoutResult } from "@/lib/weedScout/types";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const stats = read("stats.json");
const groundAlt = groundAltitudeFromOdm(set, stats.odm_processing_statistics.average_gsd)!;
const cam = Object.values(set.cameras)[0];
const NATIVE = 5472 / cam.width;

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function scene(W: number, H: number, gsdM: number, discs: { x: number; y: number; rM: number }[]): PhotoPixels {
  const rgba = new Uint8ClampedArray(W * H * 4); const rand = rng(11);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, n = (rand() - 0.5) * 30;
    let r = 150 + n, g = 110 + n, b = 80 + n;
    for (const d of discs) if ((x + 0.5 - d.x) ** 2 + (y + 0.5 - d.y) ** 2 <= (d.rM / gsdM) ** 2) { r = 70 + n * 0.5; g = 150 + n * 0.5; b = 50 + n * 0.5; }
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }
  return { width: W, height: H, rgba };
}

/** A pattern with one block over the whole frame and no blobs: nothing for the pass to find, everything for the sizes. */
function emptyPattern(gsdM: number): PhotoPattern {
  const fit = { centre: { x: (cam.width / 2) * gsdM, y: -(cam.height / 2) * gsdM }, sizeM: cam.width * gsdM, angleDeg: 30, pitchM: 5, phaseM: 0, confidence: 0.9, angleConfidence: 0.9, pitchConfidence: 0.9, vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 5 };
  return {
    width: cam.width, height: cam.height, gsdM, rowSpacingM: null, windowM: 4, minBlobAreaCm2: 4, vegetationFraction: 0.2, canopyClosed: false,
    windows: [{ index: 0, x0: 0, y0: 0, x1: cam.width - 1, y1: cam.height - 1, fit, signal: "vegetation", usable: true, block: 0, own: null, rowLines: [], squareGrid: false, seed: null, onRow: 0, offRow: 0 }],
    blobs: [], blocks: [{ id: 0, angleDeg: 30, pitchM: 5, phaseM: 0, centre: fit.centre, signal: "vegetation", windows: [0], rowLines: [], squareGrid: false, plants: 0, seedSpacingM: null }],
    summary: { windows: 1, usableWindows: 1, brightnessWindows: 0, medianAngleDeg: 30, medianPitchM: 5, pitchKeptFromGiven: 0, plantDiameterM: 0.3, seedSpacingM: null, seedAgreement: null, blobs: 0, specks: 0, onPattern: 0, doubles: 0, betweenPlants: 0, offRow: 0, unplaced: 0, skips: 0, blocks: 1, squareGrid: false },
    notes: [],
  };
}

describe("the photo pass measures the spots in their photos", () => {
  it("opens a fresh photo again after the pass and downloads a saved one, paints each spot its size, and hands the sizes over by spot id", async () => {
    const [a, b] = set.shots;
    // Two spots per photo: at the frame's centre and a quarter in, each with a known disc on the ground.
    const spots = [a, b].flatMap((shot, k) => [[cam.width / 2, cam.height / 2, 0.4 + k * 0.1], [cam.width / 4, cam.height / 4, 0.8]].map(([u, v, dM], j) => {
      const g = pixelToGround(set, shot, u, v, groundAlt)!;
      return { id: `c-${shot.filename}-${j}`, centroid: { lat: g.lat, lng: g.lng }, region: null, blob: null, look: null, dM, shot, u, v,
        sourceImages: { photos: 1, best: shot.filename, coverage: 1, chosen: [shot.filename], nearestOnly: false, kept: true } };
    }));
    // One spot already measured, one unavailable from an earlier run: only the second is measured again.
    const done = { ...spots[0], measurement: { ...unavailableMeasurement("x", DEFAULT_SIZE_THRESHOLDS), status: "measured" as const, canopyDiameterCm: 99 } };
    const retry = { ...spots[1], measurement: unavailableMeasurement("no original photo was kept", DEFAULT_SIZE_THRESHOLDS) };
    const candidates = [done, retry, spots[2], spots[3]];
    const result = { tileM: 3, pattern: null, candidates } as unknown as ScoutResult;
    const frames = Object.fromEntries([a, b].map(s => [s.filename, { filename: s.filename, path: `x/${s.filename}`, bytes: 1, type: "image/jpeg", lastModified: 0 }]));
    const sources = { set, stats: null, groundAltM: groundAlt, frames, reconstruction: "stored" as const };
    const lats = set.shots.map(s => s.centre.lat), lngs = set.shots.map(s => s.centre.lng);
    const boundary = [[{ lat: Math.min(...lats) - 0.001, lng: Math.min(...lngs) - 0.001 }, { lat: Math.min(...lats) - 0.001, lng: Math.max(...lngs) + 0.001 }, { lat: Math.max(...lats) + 0.001, lng: Math.max(...lngs) + 0.001 }, { lat: Math.max(...lats) + 0.001, lng: Math.min(...lngs) - 0.001 }]];
    const gA = projectToFrame(set, a, { ...spots[0].centroid, altM: groundAlt })!.gsdM;
    const saved = new Map<string, SavedPhotoRead>([[a.filename, { pattern: emptyPattern(gA), decodedWidth: cam.width, nativeWidth: Math.round(cam.width * NATIVE) }]]);
    const fetched: string[] = [], opened: string[] = [];
    const bytesOf = new Map<Blob, string>();
    const params = { rowSpacingAuto: true, rowSpacingM: 0.762, minBlobCm2: 1, maxPhotoReads: 10, photoFindings: false, sizeThresholdsCm: { smallMaxCm: 10, mediumMaxCm: 50 } } as unknown as ScoutParams;
    const handed: Record<string, number | null>[] = [];
    const pass = await runPhotoPass({
      result, sources, boundary, params,
      reads: { get: f => saved.get(f), put: () => {} },
      fetchFrame: async e => { fetched.push(e.filename); const blob = new Blob([new Uint8Array(4)]); bytesOf.set(blob, e.filename); return blob; },
      decode: async () => ({ pixels: { width: cam.width, height: cam.height, rgba: new Uint8ClampedArray(0) }, bitmap: undefined as never, nativeWidth: Math.round(cam.width * NATIVE), nativeHeight: Math.round(cam.height * NATIVE), scale: 1 / NATIVE }),
      analyse: async () => emptyPattern(projectToFrame(set, b, { ...spots[2].centroid, altM: groundAlt })!.gsdM),
      open: async (blob): Promise<OpenedOriginal> => {
        const filename = bytesOf.get(blob)!;
        opened.push(filename);
        const shot = filename === a.filename ? a : b;
        const W = Math.round(cam.width * NATIVE), H = Math.round(cam.height * NATIVE);
        return {
          width: W, height: H, close: () => {},
          cut: (win: AreaWindow) => {
            // Every spot of this photo painted at its native pixel, at the pixel size the pose gives there.
            const discs = spots.filter(s => s.shot === shot).map(s => {
              const pr = projectToFrame(set, shot, { ...s.centroid, altM: groundAlt })!;
              return { x: pr.u * NATIVE - win.x, y: pr.v * NATIVE - win.y, rM: s.dM / 2, gsd: pr.gsdM / NATIVE };
            });
            const inWin = discs.filter(d => d.x >= 0 && d.y >= 0 && d.x < win.width && d.y < win.height);
            return scene(win.width, win.height, inWin[0]?.gsd ?? discs[0].gsd, inWin);
          },
        };
      },
      onMeasured: m => handed.push(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.canopyDiameterCm]))),
    });
    // The saved photo was fetched for its sizes and opened; the fresh one was fetched once and opened once.
    expect(fetched).toEqual([a.filename, b.filename]);
    expect(opened).toEqual([a.filename, b.filename]);
    expect(pass.reads.map(r => [r.filename, r.saved ?? false, r.measured])).toEqual([[a.filename, true, 1], [b.filename, false, 2]]);
    // The already-measured spot was left alone; the three others were measured to their painted size.
    expect(Object.keys(pass.measurements).sort()).toEqual([retry.id, spots[2].id, spots[3].id].sort());
    for (const s of [retry, spots[2], spots[3]]) {
      const m = pass.measurements[s.id];
      expect(m.status).toBe("measured");
      expect(m.sourceFrame).toBe(s.shot.filename);
      expect(m.canopyDiameterCm!).toBeGreaterThan(s.dM * 100 * 0.92);
      expect(m.canopyDiameterCm!).toBeLessThan(s.dM * 100 * 1.08);
      expect(m.thresholds).toEqual({ smallMaxCm: 10, mediumMaxCm: 50 });
      expect(m.sizeCategory).toBe(m.canopyDiameterCm! <= 50 ? "medium" : "large");
      expect(m.source!.nativeWidth).toBe(Math.round(cam.width * NATIVE));
    }
    expect(handed).toHaveLength(2);
    expect(Object.keys(handed[0])).toEqual([retry.id]);
    expect(Object.keys(handed[1]).sort()).toEqual([spots[2].id, spots[3].id].sort());
    expect(pass.notes[0]).toMatch(/3 measured there/);
  });

  it("measures nothing, and says so, when the original cannot be opened", async () => {
    const a = set.shots[0];
    const g = pixelToGround(set, a, cam.width / 2, cam.height / 2, groundAlt)!;
    const spot = { id: "c-1", centroid: { lat: g.lat, lng: g.lng }, region: null, blob: null, look: null, sourceImages: { photos: 1, best: a.filename, coverage: 1, chosen: [a.filename], nearestOnly: false, kept: true } };
    const result = { tileM: 3, pattern: null, candidates: [spot] } as unknown as ScoutResult;
    const sources = { set, stats: null, groundAltM: groundAlt, frames: { [a.filename]: { filename: a.filename, path: "x", bytes: 1, type: "image/jpeg", lastModified: 0 } }, reconstruction: "stored" as const };
    const params = { rowSpacingAuto: true, rowSpacingM: 0.762, minBlobCm2: 1, maxPhotoReads: 10, photoFindings: false } as unknown as ScoutParams;
    const pass = await runPhotoPass({
      result, sources, boundary: [[]], params,
      fetchFrame: async () => new Blob([new Uint8Array(4)]),
      decode: async () => ({ pixels: { width: cam.width, height: cam.height, rgba: new Uint8ClampedArray(0) }, bitmap: undefined as never, nativeWidth: cam.width * 2, nativeHeight: cam.height * 2, scale: 0.5 }),
      analyse: async () => emptyPattern(0.03),
      open: async () => null,
    });
    expect(pass.reads[0].measured).toBe(0);
    expect(pass.measurements).toEqual({});
    expect(pass.notes[0]).toMatch(/0 measured there/);
  });
});
