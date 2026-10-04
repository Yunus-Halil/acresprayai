// @vitest-environment node
// Step two of the two-step look, on the real reconstruction: an area the map
// flagged, and the original photos that hold it, best first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groundAltitudeFromOdm, parseOdmOutputs } from "@/lib/sourceFrames/odm";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import { findingOutline, ringCandidate, sourceImagesNote, sourceImagesOf, spotSources } from "@/lib/sourceFrames/spot";
import type { Candidate, Region } from "@/lib/weedScout/types";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const groundAltM = groundAltitudeFromOdm(set, read("stats.json").odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };

/** A square region `sideM` across around the field centre. */
const squareRegion = (sideM: number): Region => {
  const dLat = sideM / 2 / 111_320, dLng = sideM / 2 / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180));
  const ring = [
    { lat: CENTRE.lat + dLat, lng: CENTRE.lng - dLng }, { lat: CENTRE.lat + dLat, lng: CENTRE.lng + dLng },
    { lat: CENTRE.lat - dLat, lng: CENTRE.lng + dLng }, { lat: CENTRE.lat - dLat, lng: CENTRE.lng - dLng },
  ];
  return { id: "r", tileIds: [], rings: [ring], centroid: CENTRE, areaM2: sideM * sideM, tileCount: 1, coreTiles: 1, meanStrength: 4, maxStrength: 5, meanFieldZ: [], drivers: [], klass: "bare or dry ground" };
};
const finding = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c", tileId: "t", centroid: CENTRE, kind: "not-average region", score: 0.5,
  distanceToRowM: null, rowConfidence: null, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: null, region: squareRegion(20), areaM2: 400, feedback: null, estimate: null, prediction: null,
  chip: null, chipSpanM: 24, chipGsdM: 0.087, ...over,
});
const sources = (over: Partial<ScanSources> = {}): ScanSources =>
  ({ set, stats: null, groundAltM, frames: null, reconstruction: "stored", ...over });
const keptAll = Object.fromEntries(set.shots.map(s => [s.filename, { filename: s.filename, path: `p/${s.filename}`, bytes: 1, type: "image/jpeg", lastModified: 0 }]));

describe("the photos that hold a flagged area", () => {
  it("a 20 m area is held whole by several photos, the best one first", () => {
    const s = spotSources(sources(), finding());
    expect(s.unavailable).toBeNull();
    expect(s.views.length).toBeGreaterThanOrEqual(3);
    expect(s.views[0].coverage).toBe(1);
    expect(s.views.map(v => v.score)).toEqual([...s.views.map(v => v.score)].sort((a, b) => b - a));
    // The outline lands inside the best frame, and its box is a sensible size: 20 m at ~6.3 cm/px.
    const b = s.views[0].box;
    expect(b.x1 - b.x0).toBeGreaterThan(250);
    expect(b.x1 - b.x0).toBeLessThan(450);
  });

  it("an area bigger than any one photo is still shown, with the coverage it got", () => {
    const s = spotSources(sources(), finding({ region: squareRegion(300), areaM2: 90_000 }));
    expect(s.views.length).toBeGreaterThan(0);
    expect(s.views[0].coverage).toBeLessThan(1);
    expect(s.views[0].coverage).toBeGreaterThan(0);
  });

  it("a small shape needs one photo; a shape wider than a photo needs several, capped at six", () => {
    const small = spotSources(sources(), finding());
    expect(small.chosen).toHaveLength(1);
    expect(small.chosen[0].filename).toBe(small.views[0].filename);
    const big = spotSources(sources(), finding({ region: squareRegion(300), areaM2: 90_000 }));
    expect(big.chosen.length).toBeGreaterThan(1);
    expect(big.chosen.length).toBeLessThanOrEqual(6);
    // Together the chosen photos hold more of the outline than the best one alone.
    const union = big.chosen[0].insideMask.map((_, i) => big.chosen.some(v => v.insideMask[i]));
    expect(union.filter(Boolean).length).toBeGreaterThan(big.chosen[0].insideMask.filter(Boolean).length);
  });

  it("only chosen photos whose originals were kept can be opened", () => {
    expect(spotSources(sources(), finding()).lookable).toEqual([]);
    const s = spotSources(sources({ frames: keptAll }), finding());
    expect(s.lookable.map(v => v.filename)).toEqual(s.chosen.map(v => v.filename));
  });

  it("reports the map's detail against the photo's", () => {
    const s = spotSources(sources(), finding());
    expect(s.orthoGsdM).toBe(0.087);
    expect(s.nativeScale!).toBeCloseTo(5472 / 2400, 3);
    expect(s.nativeGsdM!).toBeGreaterThan(0.02);
    expect(s.nativeGsdM!).toBeLessThan(0.035);
  });

  it("gives a reason instead of a view when it cannot answer", () => {
    expect(spotSources(null, finding()).unavailable).toBe("no reconstruction");
    expect(spotSources(sources({ set: null, reconstruction: "none" }), finding()).unavailable).toBe("no reconstruction");
    expect(spotSources(sources({ groundAltM: null }), finding()).unavailable).toBe("no ground height");
  });

  it("a shape no photo holds gets the nearest photos instead, and says so", () => {
    const far = { lat: 54.1660, lng: 12.3062 };
    const shifted = squareRegion(20).rings[0].map(p => ({ lat: p.lat - (CENTRE.lat - far.lat), lng: p.lng }));
    const s = spotSources(sources(), finding({ centroid: far, region: { ...squareRegion(20), rings: [shifted] } }));
    expect(s.unavailable).toBeNull();
    expect(s.views).toEqual([]);
    expect(s.nearestOnly).toBe(true);
    expect(s.chosen).toHaveLength(2);
    expect(s.chosen[0].coverage).toBe(0);
    expect(sourceImagesOf(s)).toMatchObject({ photos: 0, nearestOnly: true, chosen: s.chosen.map(v => v.filename) });
  });
});

describe("what the scan stores and says about step three", () => {
  it("stores the short form on a shape, and says none when there are no camera positions", () => {
    const s = sourceImagesOf(spotSources(sources({ frames: keptAll }), finding()));
    expect(s).toMatchObject({ photos: expect.any(Number), kept: true, coverage: 1 });
    expect(s!.best).toMatch(/\.JPG$/);
    expect(sourceImagesOf(spotSources(null, finding()))).toBeNull();
    expect(sourceImagesOf(spotSources(sources(), finding({ centroid: { lat: 54.0, lng: 12.0 }, region: null, kind: "field outlier" })))).toMatchObject({ photos: 0, best: null, kept: false, nearestOnly: true });
  });

  it("writes one honest line for the run notes", () => {
    const src = sources({ frames: keptAll });
    const shapes = [finding(), finding({ id: "far", centroid: { lat: 54.0, lng: 12.0 }, region: null, kind: "field outlier" })]
      .map(c => ({ ...c, sourceImages: sourceImagesOf(spotSources(src, c)) }));
    expect(sourceImagesNote(shapes, src)).toMatch(/^Source images: 1 of 2 shapes matched to original photos; 1 held whole by one photo; 1 photo to check per shape; 1 not held by any photo, given the nearest instead\. 2 can be opened at full resolution\.$/);
    expect(shapes[0].sourceImages).toMatchObject({ chosen: [shapes[0].sourceImages!.best] });
    expect(sourceImagesNote(shapes, sources({ set: null, reconstruction: "none" }))).toMatch(/no camera positions for this scan/);
    expect(sourceImagesNote(shapes, null)).toMatch(/had not loaded/);
    const unkept = [finding()].map(c => ({ ...c, sourceImages: sourceImagesOf(spotSources(sources(), c)) }));
    expect(sourceImagesNote(unkept, sources())).toMatch(/None can be opened: the originals were not kept/);
  });
});

describe("findingOutline", () => {
  it("uses a region's ring, thinned to at most 64 points", () => {
    const ring = Array.from({ length: 500 }, (_, i) => ({ lat: CENTRE.lat + Math.sin(i / 80) * 1e-4, lng: CENTRE.lng + Math.cos(i / 80) * 1e-4 }));
    const out = findingOutline(finding({ region: { ...squareRegion(10), rings: [ring] } }), groundAltM);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out[0]).toEqual({ ...ring[0], altM: groundAltM });
  });

  it("gives a point finding a square at least 3 m across", () => {
    const out = findingOutline(finding({ region: null, kind: "field outlier", chipSpanM: null }), groundAltM);
    expect(out).toHaveLength(4);
    const widthM = (out[1].lng - out[0].lng) * 111_320 * Math.cos((CENTRE.lat * Math.PI) / 180);
    expect(widthM).toBeGreaterThanOrEqual(2.99);
  });
});

describe("ringCandidate: a shape the operator drew, read like a scout spot", () => {
  it("takes the ring as its outline and is held by the same photos as a scout region there", () => {
    const ring = squareRegion(20).rings[0];
    const c = ringCandidate("drawn-1", ring);
    expect(c.region?.rings[0]).toBe(ring);
    expect(c.centroid.lat).toBeCloseTo(CENTRE.lat, 6);
    expect(c.centroid.lng).toBeCloseTo(CENTRE.lng, 6);
    const drawn = spotSources(sources({ frames: keptAll }), c);
    const scout = spotSources(sources({ frames: keptAll }), finding());
    expect(drawn.unavailable).toBeNull();
    expect(drawn.views[0].filename).toBe(scout.views[0].filename);
    expect(drawn.lookable.length).toBe(drawn.chosen.length);
  });

  it("a ring with fewer than three points is a point, not a region", () => {
    expect(ringCandidate("p", [CENTRE]).region).toBeNull();
  });
});
