// @vitest-environment node
// The in-app benchmark, on the real reconstruction, with the storage read,
// the canvas and the detector replaced: the same statuses as the terminal
// tool, the operator's verdict copied and nothing written, and the page
// rendered from the same record.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ download: async () => ({ data: null, error: { message: "not in this test" } }) }) } } }));

import { type BrowserBenchInput, benchOneInBrowser, runBrowserBench } from "@/lib/sourceFrames/benchBrowser";
import { renderReport } from "@/lib/sourceFrames/benchReport";
import { type ModelResult, SKIPPED } from "@/lib/sourceFrames/benchTypes";
import type { NativeCut } from "@/lib/sourceFrames/crop";
import { groundAltitudeFromOdm, parseOdmOutputs } from "@/lib/sourceFrames/odm";
import type { ScanSources } from "@/lib/sourceFrames/sources";
import { spotSources } from "@/lib/sourceFrames/spot";
import type { Candidate, Region } from "@/lib/weedScout/types";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const groundAltM = groundAltitudeFromOdm(set, read("stats.json").odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const squareRegion = (sideM: number): Region => {
  const dLat = sideM / 2 / 111_320, dLng = sideM / 2 / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180));
  const ring = [
    { lat: CENTRE.lat + dLat, lng: CENTRE.lng - dLng }, { lat: CENTRE.lat + dLat, lng: CENTRE.lng + dLng },
    { lat: CENTRE.lat - dLat, lng: CENTRE.lng + dLng }, { lat: CENTRE.lat - dLat, lng: CENTRE.lng - dLng },
  ];
  return { id: "r", tileIds: [], rings: [ring], centroid: CENTRE, areaM2: sideM * sideM, tileCount: 1, coreTiles: 1, meanStrength: 4, maxStrength: 5, meanFieldZ: [], drivers: [], klass: "thin stand" };
};
const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: "spot-1", tileId: "t", centroid: CENTRE, kind: "not-average region", score: 0.5,
  distanceToRowM: null, rowConfidence: null, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: null, region: squareRegion(3), areaM2: 9, feedback: null, estimate: null, prediction: null,
  chip: PNG_DATA_URL, chipSpanM: 3.6, chipGsdM: 0.087, ...over,
});
const sources = (over: Partial<ScanSources> = {}): ScanSources => ({ set, stats: null, groundAltM, frames: null, reconstruction: "stored", ...over });
const best = spotSources(sources(), candidate()).views[0];
const kept = { [best.filename]: { filename: best.filename, path: `u/s/frames/${best.filename}`, bytes: 10, type: "image/jpeg", lastModified: 0 } };

const ORIGINAL = new Blob([new Uint8Array(1000).fill(7)], { type: "image/jpeg" });
const cut = async (_frame: Blob, box: { x0: number; y0: number; x1: number; y1: number }, uploadedWidth: number): Promise<NativeCut> => {
  const scale = 5472 / uploadedWidth;
  const w = Math.max(400, Math.round((box.x1 - box.x0) * scale * 1.5));
  return { blob: new Blob([new Uint8Array(50)], { type: "image/jpeg" }), width: w, height: w, window: { x: Math.round(box.x0 * scale), y: Math.round(box.y0 * scale), width: w, height: w }, originalWidth: 5472, originalHeight: 3648, scale };
};
const two: ModelResult = { ...SKIPPED, status: "SUCCESS", modelId: "server/1", count: 2, maxConfidence: 0.95, meanConfidence: 0.8, detections: [
  { x: 50, y: 50, width: 20, height: 20, confidence: 0.95, klass: "weed" }, { x: 90, y: 90, width: 10, height: 10, confidence: 0.65, klass: "weed" },
] };

function input(over: Partial<BrowserBenchInput> = {}): BrowserBenchInput {
  return {
    sources: sources({ frames: kept }), candidates: [candidate()], limit: 12,
    scan: { taskId: "task-1", odmUuid: "dd0f6314", userId: "user-1" },
    verdictOf: () => ({ verdict: "weed", verdictSource: "operator (unsaved)", species: null }),
    stored: () => null,
    detect: async (_b, mime) => (mime === "image/jpeg" ? two : { ...SKIPPED, status: "SUCCESS_NO_DETECTIONS", modelId: "server/1" }),
    modelSettings: { provider: "test" },
    deps: {
      downloadFrame: async () => ORIGINAL,
      cut,
      toDataUrl: async b => `data:${b.type};base64,${Buffer.from(await b.arrayBuffer()).toString("base64")}`,
      imageSize: async () => ({ width: 1, height: 1 }),
    },
    ...over,
  };
}

describe("the in-app benchmark", () => {
  it("cuts the best frame's original through the frame list, scores both sides, and copies the verdict without writing", async () => {
    const seen: string[] = [];
    const run = await runBrowserBench(input({ detect: async (b, mime) => { seen.push(mime); return mime === "image/jpeg" ? two : { ...SKIPPED, status: "SUCCESS_NO_DETECTIONS", modelId: "server/1" }; } }));
    expect(run.findings).toHaveLength(1);
    const r = run.findings[0];
    expect(r).toMatchObject({
      status: "SUCCESS", source: "scout_run", selectedFrame: best.filename, matchedBy: "filename", originalSource: "retained-original",
      originalPath: `u/s/frames/${best.filename}`, originalBytes: 1000, originalWidth: 5472, coverage: 1,
      operatorVerdict: { verdict: "weed", verdictSource: "operator (unsaved)" },
      ortho: { status: "OK", width: 1, height: 1, model: { status: "SUCCESS_NO_DETECTIONS" } },
    });
    expect(r.candidateFrames).toBeGreaterThanOrEqual(3);
    expect(r.nativeScale).toBeCloseTo(5472 / 2400, 6);
    expect(r.nativeGsdM!).toBeCloseTo(r.uploadedGsdM! / (5472 / 2400), 9);
    expect(r.originalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.native!.file).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.native!.model.count).toBe(2);
    expect(r.outlineCropPx).toHaveLength(4);
    expect(r.ortho.outlinePx).toHaveLength(4);
    expect(seen.sort()).toEqual(["image/jpeg", "image/png"]);
    expect(run.summary).toMatchObject({ findings: 1, byStatus: { SUCCESS: 1 }, nativeDetections: 2, orthoDetections: 0, orthoScored: 1 });
    expect(run.scan).toMatchObject({ taskId: "task-1", framesKept: 1, posedFrames: 180, originalsSource: "retained-original" });
    const html = renderReport(run);
    expect(html).toContain("spot-1");
    expect(html).toContain(best.filename);
    expect(html).toContain("not ground truth");
  });

  it("names every failure: no frame list, a frame not kept, an unreadable original, an undecodable one, a shape no photo holds", async () => {
    const one = (over: Partial<BrowserBenchInput>, c = candidate()) => benchOneInBrowser(c, input(over));
    expect(await one({ sources: sources({ frames: null }) })).toMatchObject({ status: "NO_MANIFEST", selectedFrame: best.filename });
    const other = set.shots.find(s => s.filename !== best.filename)!.filename;
    expect(await one({ sources: sources({ frames: { [other]: { ...kept[best.filename], filename: other } } }) })).toMatchObject({ status: "NO_NATIVE_SOURCE_FRAME" });
    expect(await one({ deps: { ...input().deps, downloadFrame: async () => null } })).toMatchObject({ status: "ORIGINAL_DOWNLOAD_FAILED" });
    expect(await one({ deps: { ...input().deps, cut: async () => null } })).toMatchObject({ status: "ORIGINAL_DECODE_FAILED", originalBytes: 1000 });
    expect(await one({}, candidate({ centroid: { lat: 54.0, lng: 12.0 }, region: null, kind: "field outlier", chip: null }))).toMatchObject({ status: "PROJECTION_FAILED", candidateFrames: 0, ortho: { status: "NO_ORTHO_CHIP" } });
    expect(await one({ sources: sources({ set: null, reconstruction: "none" }) })).toMatchObject({ status: "RECONSTRUCTION_UNAVAILABLE" });
  });

  it("without a detector the crop still exists as MODEL_SKIPPED; a detector error is API_ERROR with its reason", async () => {
    expect(await benchOneInBrowser(candidate(), input({ detect: null, modelSettings: null }))).toMatchObject({ status: "MODEL_SKIPPED", native: { model: { status: "MODEL_SKIPPED" } }, ortho: { model: { status: "MODEL_SKIPPED" } } });
    const failing: ModelResult = { ...SKIPPED, status: "API_ERROR", modelId: "server/1", error: "ROBOFLOW_API_KEY is not set on the server" };
    const r = await benchOneInBrowser(candidate(), input({ detect: async () => failing }));
    expect(r).toMatchObject({ status: "API_ERROR", reason: "ROBOFLOW_API_KEY is not set on the server" });
    expect(r.native).not.toBeNull();
  });

  it("runs only the first `limit` shapes, best first, and says when there are none", async () => {
    const many = [candidate({ id: "a" }), candidate({ id: "b" }), candidate({ id: "c" })];
    const run = await runBrowserBench(input({ candidates: many, limit: 2 }));
    expect(run.findings.map(r => r.findingId)).toEqual(["a", "b"]);
    const none = await runBrowserBench(input({ candidates: [] }));
    expect(none.findings).toEqual([]);
    expect(none.notes.join(" ")).toMatch(/scan the field first/);
  });
});
