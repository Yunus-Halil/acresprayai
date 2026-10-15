// @vitest-environment node
// A model's instances in a photograph, carried to the ground through the real
// reconstruction, and the same plant seen from two photographs merged to one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groundAltitudeFromOdm, parseOdmOutputs, projectToFrame } from "@/lib/sourceFrames/odm";
import type { WeedInstance, WeedVisionResult } from "@/lib/weedVision/client";
import { betterView, countByClass, frameRunKey, groundFrameResult, mergeAcrossFrames, metresBetween, thinPolygon } from "@/lib/weedVision/frames";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const groundAltM = groundAltitudeFromOdm(set, read("stats.json").odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };
const NATIVE_W = 5472, NATIVE_H = 3648;

/** The shots that see a ground point near their centre, best first. */
function shotsSeeing(point: { lat: number; lng: number }) {
  return set.shots
    .map(shot => ({ shot, p: projectToFrame(set, shot, { ...point, altM: groundAltM }) }))
    .filter(x => x.p && x.p.inside && x.p.edgeDistancePx > 200)
    .sort((a, b) => a.p!.viewAngleDeg - b.p!.viewAngleDeg);
}

/** A disc-shaped instance in native pixels around where a ground point lands in a shot. */
function instanceAt(shot: typeof set.shots[number], point: { lat: number; lng: number }, id: number, radiusPx: number, klass: "weed" | "crop", score = 0.8): WeedInstance {
  const cam = set.cameras[shot.cameraKey];
  const scale = NATIVE_W / cam.width;
  const p = projectToFrame(set, shot, { ...point, altM: groundAltM })!;
  const cx = p.u * scale, cy = p.v * scale;
  const poly: [number, number][] = Array.from({ length: 24 }, (_, i) => { const a = (2 * Math.PI * i) / 24; return [cx + radiusPx * Math.cos(a), cy + radiusPx * Math.sin(a)]; });
  const area = Math.PI * radiusPx * radiusPx;
  return {
    id, centroid_px: [cx, cy], bbox_px: [cx - radiusPx, cy - radiusPx, cx + radiusPx, cy + radiusPx], area_px: area, max_span_px: 2 * radiusPx,
    span_endpoints_px: [[cx - radiusPx, cy], [cx + radiusPx, cy]], perpendicular_span_px: 2 * radiusPx, obb: { length_px: 2 * radiusPx, width_px: 2 * radiusPx, angle_deg: 0 },
    equivalent_diameter_px: 2 * radiusPx, solidity: 1, pieces: 1, touches_border: false, tiny: false, score, score_kind: "detector_confidence", polygons_px: [poly], flags: [], class: klass, fused_from_tiles: 1,
  };
}

function resultFor(shot: typeof set.shots[number], weeds: WeedInstance[], crops: WeedInstance[]): WeedVisionResult {
  return {
    schema_version: "weed-vision-preview-result-1", run_id: "r", research_only: true,
    image: { filename: shot.filename, format: "JPEG", bytes: 1, width: NATIVE_W, height: NATIVE_H, exif: {}, coordinate_system: "original" },
    processing: { scale: 1, width: NATIVE_W, height: NATIVE_H, tiles: 1, tile_px: 1024, overlap_px: 256 },
    algorithm: { name: "rfdetr_seg_large", label: "RF-DETR", family: "rfdetr", benchmark: "", description: "", requested: "rfdetr_seg_large", model: "rfdetr" },
    model: null, versions: { service: "s", lab: "l" }, classes: ["crop", "weed"], count: weeds.length, instances: weeds, crop_instances: crops, crop_regions_px: null,
    pixel_fractions: { weed: null, crop: null }, timings_ms: { total: 10 }, memory: { peak_working_set_mb: null }, warnings: [], measurement_note: "",
  };
}

describe("groundFrameResult", () => {
  it("puts an instance's outline on the ground where it was drawn, with a size from the camera's ground sampling", () => {
    const [{ shot, p }] = shotsSeeing(CENTRE);
    const cam = set.cameras[shot.cameraKey];
    const scale = NATIVE_W / cam.width;
    const r = 60; // native px
    const dets = groundFrameResult({ set, shot, groundAltM, result: resultFor(shot, [instanceAt(shot, CENTRE, 7, r, "weed", 0.77)], [instanceAt(shot, CENTRE, 1, 300, "crop")]) });
    expect(dets).toHaveLength(2);
    const w = dets.find(d => d.klass === "weed")!;
    expect(w.id).toBe(`${shot.filename}#weed7`);
    expect(w.status).toBe("ok");
    expect(metresBetween(set, w.centre!, CENTRE, groundAltM)).toBeLessThan(0.02);
    expect(w.ring).toHaveLength(24);
    // Diameter on the ground is 2r native px times the native ground sampling distance.
    const nativeGsd = p!.gsdM / scale;
    expect(w.diameterM! / (2 * r * nativeGsd)).toBeCloseTo(1, 1);
    expect(w.areaM2! / (Math.PI * r * r * nativeGsd * nativeGsd)).toBeCloseTo(1, 1);
    expect(w.score).toBe(0.77);
    expect(w.viewAngleDeg).toBeCloseTo(p!.viewAngleDeg, 3);
    const c = dets.find(d => d.klass === "crop")!;
    expect(c.id).toBe(`${shot.filename}#crop1`);
    expect(c.diameterM!).toBeGreaterThan(w.diameterM!);
  });

  it("thins long polygons and keeps short ones", () => {
    const long = Array.from({ length: 200 }, (_, i) => [i, i] as [number, number]);
    expect(thinPolygon(long, 40)).toHaveLength(40);
    expect(thinPolygon(long, 40)[0]).toEqual([0, 0]);
    expect(thinPolygon(long.slice(0, 10), 40)).toHaveLength(10);
  });
});

describe("mergeAcrossFrames", () => {
  it("collapses the same plant seen from two photographs into one, keeping the more nadir view and listing both photos", () => {
    const seen = shotsSeeing(CENTRE);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const [a, b] = seen;
    const da = groundFrameResult({ set, shot: a.shot, groundAltM, result: resultFor(a.shot, [instanceAt(a.shot, CENTRE, 1, 60, "weed", 0.6)], []) });
    const db = groundFrameResult({ set, shot: b.shot, groundAltM, result: resultFor(b.shot, [instanceAt(b.shot, CENTRE, 1, 60, "weed", 0.9)], []) });
    const plants = mergeAcrossFrames(set, groundAltM, [...db, ...da]);
    expect(plants).toHaveLength(1);
    expect(plants[0].frame).toBe(a.shot.filename); // the better view, not the higher score
    expect(plants[0].seenIn).toEqual([a.shot.filename, b.shot.filename]);
    expect(plants[0].duplicates).toBe(1);
    expect(betterView(da[0], db[0])).toBe(true);
  });

  it("keeps two plants of the same class a metre apart, and a crop and a weed in the same place, separate", () => {
    const [a, b] = shotsSeeing(CENTRE);
    const east = { lat: CENTRE.lat, lng: CENTRE.lng + 1.0 / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)) };
    // 4 px radius: a plant about 20 cm across at this scan's sampling, so the merge radius is the 0.3 m floor and a metre is far.
    const da = groundFrameResult({ set, shot: a.shot, groundAltM, result: resultFor(a.shot, [instanceAt(a.shot, CENTRE, 1, 4, "weed")], [instanceAt(a.shot, CENTRE, 1, 4, "crop")]) });
    const db = groundFrameResult({ set, shot: b.shot, groundAltM, result: resultFor(b.shot, [instanceAt(b.shot, east, 1, 4, "weed")], []) });
    expect(da[0].diameterM!).toBeLessThan(0.4);
    const plants = mergeAcrossFrames(set, groundAltM, [...da, ...db]);
    expect(plants).toHaveLength(3);
    expect(countByClass(plants)).toEqual({ weed: 2, crop: 1 });
  });

  it("never merges two detections from the same photograph", () => {
    const [a] = shotsSeeing(CENTRE);
    const da = groundFrameResult({ set, shot: a.shot, groundAltM, result: resultFor(a.shot, [instanceAt(a.shot, CENTRE, 1, 60, "weed"), instanceAt(a.shot, CENTRE, 2, 60, "weed")], []) });
    expect(mergeAcrossFrames(set, groundAltM, da)).toHaveLength(2);
  });
});

describe("frameRunKey", () => {
  it("changes with any setting and with the checkpoint", () => {
    const p = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };
    const k = frameRunKey(p, "abcdef0123456789abcdef");
    expect(k).toBe("frame-detect-v1|rfdetr_seg_large|t0.5|tile1024|ov256|s1|mabcdef0123456789");
    expect(frameRunKey({ ...p, threshold: 0.3 }, "abcdef0123456789abcdef")).not.toBe(k);
    expect(frameRunKey(p, "ffff")).not.toBe(k);
    expect(frameRunKey(p, null)).toContain("|mnone");
  });
});
