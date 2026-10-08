// @vitest-environment node
//
// The photo pass's geometry against the reconstruction of a real scan
// (fixtures/odm-dd0f6314, 180 posed frames): which photos are chosen for a
// field, how a photo's blocks and blobs land on the ground, and that one
// plant seen twice is one finding. No pixels: the photographs are not kept.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LatLng2 } from "@/lib/geo";
import type { PhotoPattern } from "@/lib/photoScout/pattern";
import { frameFootprint, groundAltitudeFromOdm, parseOdmOutputs, pixelToGround } from "@/lib/sourceFrames/odm";
import type { FieldPattern } from "@/lib/weedScout/fieldPattern";
import {
  PHOTO_DUPLICATE_M, type PhotoFinding, choosePhotos, dedupeFindings, frameGsdM, groundPhotoFindings, photoCandidate,
} from "@/lib/weedScout/photoPass";
import { localFrame } from "@/lib/weedScout/rows";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const stats = read("stats.json");
const groundAlt = groundAltitudeFromOdm(set, stats.odm_processing_statistics.average_gsd)!;
const cam = Object.values(set.cameras)[0];

/** A field: the box of the camera positions, shrunk by a tenth each side. */
function fieldRing(): LatLng2[] {
  const lats = set.shots.map(s => s.centre.lat), lngs = set.shots.map(s => s.centre.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const dLat = (maxLat - minLat) * 0.1, dLng = (maxLng - minLng) * 0.1;
  return [
    { lat: minLat + dLat, lng: minLng + dLng }, { lat: minLat + dLat, lng: maxLng - dLng },
    { lat: maxLat - dLat, lng: maxLng - dLng }, { lat: maxLat - dLat, lng: minLng + dLng }, { lat: minLat + dLat, lng: minLng + dLng },
  ];
}

/** A photo's pattern as the pass would return it, for one shot: one block across the whole frame, three blobs. */
function fakePattern(gsdM: number, width: number, height: number, angleDeg: number): PhotoPattern {
  const fit = {
    centre: { x: (width / 2) * gsdM, y: -(height / 2) * gsdM }, sizeM: width * gsdM, angleDeg, pitchM: 5, phaseM: 0,
    confidence: 0.9, angleConfidence: 0.9, pitchConfidence: 0.9, vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 5,
  };
  const window = { index: 0, x0: 0, y0: 0, x1: width - 1, y1: height - 1, fit, signal: "vegetation" as const, usable: true, block: 0, own: null, rowLines: [], squareGrid: false, seed: null, onRow: 0, offRow: 0 };
  const blob = (id: number, x: number, y: number, cls: "off-row" | "between plants" | "on pattern" | "unplaced", touchesBorder = false) => ({
    id, x, y, areaPx: 100, areaM2: 100 * gsdM * gsdM, equivDiameterM: 2 * Math.sqrt((100 * gsdM * gsdM) / Math.PI), touchesBorder,
    window: 0, rowIndex: 0, acrossM: cls === "off-row" ? 2 : 0.1, alongM: 0, cls,
  });
  return {
    width, height, gsdM, rowSpacingM: null, windowM: 4, minBlobAreaCm2: 4, vegetationFraction: 0.2, canopyClosed: false,
    windows: [window], blobs: [blob(0, width / 2, height / 2, "off-row"), blob(1, width / 2 + 100, height / 2, "between plants"), blob(2, width / 2 - 100, height / 2, "on pattern"), blob(3, 2, 2, "off-row", true)],
    blocks: [{ id: 0, angleDeg, pitchM: 5, phaseM: 0, centre: fit.centre, signal: "vegetation", windows: [0], rowLines: [], squareGrid: false, plants: 1, seedSpacingM: null }],
    summary: { windows: 1, usableWindows: 1, brightnessWindows: 0, medianAngleDeg: angleDeg, medianPitchM: 5, pitchKeptFromGiven: 0, plantDiameterM: 0.3, seedSpacingM: null, seedAgreement: null, blobs: 4, specks: 0, onPattern: 1, doubles: 0, betweenPlants: 1, offRow: 2, unplaced: 0, skips: 0, blocks: 1, squareGrid: false },
    notes: [],
  };
}

describe("the photo pass on a real reconstruction", () => {
  it("chooses the photos that cover the field, most coverage first, within the budget", () => {
    const ring = fieldRing();
    const all = choosePhotos(set, groundAlt, [ring], 1000);
    expect(all.length).toBeGreaterThan(50);
    expect(all.length).toBeLessThan(set.shots.length);
    const ten = choosePhotos(set, groundAlt, [ring], 10);
    expect(ten).toHaveLength(10);
    expect(ten.map(s => s.filename)).toEqual(all.slice(0, 10).map(s => s.filename));
    // A field nothing flew over chooses nothing.
    const far = ring.map(p => ({ lat: p.lat + 1, lng: p.lng }));
    expect(choosePhotos(set, groundAlt, [far], 10)).toHaveLength(0);
  });

  it("knows the frame's pixel size from its footprint, near ODM's own average", () => {
    const g = frameGsdM(set, set.shots[0], groundAlt)!;
    const odmGsd = stats.odm_processing_statistics.average_gsd / 100;
    expect(g).toBeGreaterThan(odmGsd * 0.6);
    expect(g).toBeLessThan(odmGsd * 1.6);
  });

  it("carries a photo's off-pattern blobs to the ground inside its footprint, and keeps only blocks that agree with the map", () => {
    const shot = set.shots[0];
    const g = frameGsdM(set, shot, groundAlt)!;
    const pattern = fakePattern(g, cam.width, cam.height, 30);
    const alone = groundPhotoFindings({ set, shot, groundAltM: groundAlt, pattern, decodedWidth: cam.width, nativeWidth: cam.width * 2.28, fieldPattern: null });
    expect(alone.blocks).toHaveLength(1);
    expect(alone.blocks[0].matched).toBe(true);
    expect(alone.blocks[0].groundPitchM).toBeGreaterThan(4);
    expect(alone.blocks[0].groundPitchM).toBeLessThan(6.5);
    // Two findings: the off-row and the between-plants blob; not the crop plant, not the one on the photo's edge.
    expect(alone.findings).toHaveLength(2);
    expect(alone.findings.map(f => f.cls).sort()).toEqual(["between plants", "off-row"]);
    const fp = frameFootprint(set, shot, groundAlt)!;
    const lats = fp.map(p => p.lat), lngs = fp.map(p => p.lng);
    for (const f of alone.findings) {
      expect(f.centroid.lat).toBeGreaterThan(Math.min(...lats));
      expect(f.centroid.lat).toBeLessThan(Math.max(...lats));
      expect(f.centroid.lng).toBeGreaterThan(Math.min(...lngs));
      expect(f.centroid.lng).toBeLessThan(Math.max(...lngs));
      expect(f.nativePx.u).toBeCloseTo(f.photoPx.x * 2.28, 3);
    }
    // The blob at the photo's centre lands where the pose puts that pixel.
    const centre = pixelToGround(set, shot, cam.width / 2, cam.height / 2, groundAlt)!;
    const d = localFrame(centre).toXY(alone.findings[0].centroid);
    expect(Math.hypot(d.x, d.y)).toBeLessThan(0.05);
    expect(alone.findings[0].centrality).toBeCloseTo(1, 5);

    // Against a map pattern: agreeing blocks count, a quarter turn does not.
    const fieldWith = (angleDeg: number, pitchM: number): FieldPattern => ({
      z: 21, gsdM: 0.05, windowM: 60, origin: centre, plants: [], lines: [], notes: [],
      windows: [{
        win: { id: "0:0", col: 0, row: 0, fetch: { north: 0, south: 0, east: 0, west: 0 }, owned: { north: 0, south: 0, east: 0, west: 0 } },
        origin: centre, gsdM: 0.05, fitWindows: 1, usableWindows: 1, canopyClosed: false, missingTiles: 0, notes: [], plantDiameterM: 0.3, seedSpacingM: null, seedAgreement: null,
        blocks: [{ windowId: "0:0", id: 0, angleDeg, bearingDeg: 0, pitchM, confidence: 1, plants: 0, seedSpacingM: null, squareGrid: false, fit: pattern.windows[0].fit, rowLines: [], rects: [] }],
      }],
      summary: { windows: 1, windowsWithRows: 1, fitWindows: 1, usableFitWindows: 1, blocks: 1, rowSpacingM: pitchM, bearingDeg: 0, plantSpacingM: null, plantDiameterM: 0.3, plantCount: 0, offPatternCount: 0, seedAgreement: null, squareGrid: false, missingTiles: 0 },
    });
    const ga = alone.blocks[0].groundAngleDeg, gp = alone.blocks[0].groundPitchM;
    expect(groundPhotoFindings({ set, shot, groundAltM: groundAlt, pattern, decodedWidth: cam.width, nativeWidth: cam.width, fieldPattern: fieldWith(ga + 3, gp * 1.05) }).findings).toHaveLength(2);
    expect(groundPhotoFindings({ set, shot, groundAltM: groundAlt, pattern, decodedWidth: cam.width, nativeWidth: cam.width, fieldPattern: fieldWith(ga + 90, gp) }).findings).toHaveLength(0);
    expect(groundPhotoFindings({ set, shot, groundAltM: groundAlt, pattern, decodedWidth: cam.width, nativeWidth: cam.width, fieldPattern: fieldWith(ga, gp * 1.5) }).findings).toHaveLength(0);
  });

  it("keeps one finding per plant, from the photo that holds it nearest its centre, and none the map already has", () => {
    const base: LatLng2 = { lat: 38.9, lng: -77.5 };
    const at = (x: number, y: number) => localFrame(base).toLatLng(x, y);
    const f = (id: string, x: number, y: number, centrality: number, d = 0.2): PhotoFinding => ({
      id, filename: id, centroid: at(x, y), areaM2: Math.PI * (d / 2) ** 2, equivDiameterM: d, cls: "off-row", distanceToRowM: 1,
      photoPx: { x: 0, y: 0 }, nativePx: { u: 0, v: 0 }, centrality, gsdM: 0.01,
    });
    const kept = dedupeFindings([f("a", 0, 0, 0.3), f("b", 0.2, 0.1, 0.9), f("c", 5, 5, 0.5), f("d", 10, 0, 0.5)], [at(10, PHOTO_DUPLICATE_M / 2)]);
    expect(kept.map(k => k.id).sort()).toEqual(["b", "c"]);
    const c = photoCandidate(kept[0], "t1", null);
    expect(c.kind).toBe("off-row vegetation");
    expect(c.sourceImages).toMatchObject({ photos: 1, best: "b", chosen: ["b"], kept: true });
    expect(c.blob?.gsdM).toBe(0.01);
    expect(c.score).toBeLessThanOrEqual(0.6);
  });
});
