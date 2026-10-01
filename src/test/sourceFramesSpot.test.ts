// @vitest-environment node
// What the popup is told about a spot's source frames, from the real
// reconstruction: pixel counts in each layer, and plain reasons when there is
// nothing to say.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groundAltitudeFromOdm, parseOdmOutputs } from "@/lib/sourceFrames/odm";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import { spotSources } from "@/lib/sourceFrames/spot";
import type { Blob as ScoutBlob, Candidate } from "@/lib/weedScout/types";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const stats = read("stats.json");
const groundAltM = groundAltitudeFromOdm(set, stats.odm_processing_statistics.average_gsd);

const blob = (d: number): ScoutBlob => ({
  id: "b", tileId: "t", centroid: { lat: 54.17259, lng: 12.30625 }, areaM2: Math.PI * (d / 2) ** 2, equivDiameterM: d,
  widthM: d, heightM: d, extent: 0.7, chromaR: 0.3, chromaG: 0.4, chromaB: 0.3, exgMean: 0.2, brightness: 120,
  gsdM: 0.087, touchesBorder: false,
});
const spot = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", tileId: "t", centroid: { lat: 54.17259, lng: 12.30625 }, kind: "off-row vegetation", score: 0.5,
  distanceToRowM: 0.3, rowConfidence: 0.9, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: blob(0.3), region: null, areaM2: 0.07, feedback: null, estimate: null, prediction: null,
  chip: "data:image/png;base64,AAAA", chipSpanM: 1.2, chipGsdM: 0.087, ...over,
});
const sources = (over: Partial<ScanSources> = {}): ScanSources =>
  ({ set, stats, groundAltM, frames: null, reconstruction: "stored", ...over });

describe("spotSources", () => {
  it("says a 30 cm spot gets 3 px in the ortho chip, 5 in the uploaded frame and 11 in the camera's", () => {
    const s = spotSources(sources(), spot());
    expect(s.unavailable).toBeNull();
    expect(s.views).toBeGreaterThanOrEqual(5);
    expect(s.targetPx.ortho!).toBeCloseTo(0.3 / 0.087, 1);
    expect(s.targetPx.uploaded!).toBeGreaterThan(4);
    expect(s.targetPx.uploaded!).toBeLessThan(6);
    expect(s.targetPx.native!).toBeGreaterThan(10);
    expect(s.targetPx.native!).toBeLessThan(13);
    expect(s.nativeScale!).toBeCloseTo(5472 / 2400, 3);
    expect(s.frameKept).toBe(false);
  });

  it("knows when the best frame's original was kept", () => {
    const s = spotSources(sources(), spot());
    const kept = spotSources(sources({ frames: { [s.best!.filename]: { filename: s.best!.filename, path: "p", bytes: 1, type: "image/jpeg", lastModified: 0 } } }), spot());
    expect(kept.frameKept).toBe(true);
  });

  it("gives a reason instead of a number when it cannot answer", () => {
    expect(spotSources(null, spot()).unavailable).toBe("no reconstruction");
    expect(spotSources(sources({ set: null, reconstruction: "none" }), spot()).unavailable).toBe("no reconstruction");
    expect(spotSources(sources({ groundAltM: null }), spot()).unavailable).toBe("no ground height");
    expect(spotSources(sources(), spot({ centroid: { lat: 54.0, lng: 12.0 } })).unavailable).toBe("not seen by any frame");
  });

  it("uses a region's area for its size when it has no plant blob", () => {
    const s = spotSources(sources(), spot({ blob: null, areaM2: 50, chipGsdM: 0.35 }));
    expect(s.unavailable).toBeNull();
    expect(s.targetPx.uploaded!).toBeGreaterThan(100);
  });
});
