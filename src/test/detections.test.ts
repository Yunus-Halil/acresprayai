// @vitest-environment node
// A box the detector drew on a native crop, carried back to the ground
// through the real reconstruction: crop px, native px, frame px, lat/lng.
// The check is a round trip: put a known ground point into the best photo,
// draw a box on it in the crop, and ask where the box lands.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { areaWindow } from "@/lib/sourceFrames/crop";
import { type GroundedDetection, debugLine, groundDetections } from "@/lib/sourceFrames/detections";
import { addDetections, clearDetections, getDetectionLayer, resetDetectionStore, setDetectionsVisible } from "@/lib/sourceFrames/detectionStore";
import { groundAltitudeFromOdm, parseOdmOutputs, projectToFrame, toEnu } from "@/lib/sourceFrames/odm";
import { spotSources } from "@/lib/sourceFrames/spot";
import { pointCandidate } from "../../scripts/bench/scanBench";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const groundAltM = groundAltitudeFromOdm(set, read("stats.json").odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };
const sources = { set, stats: null, groundAltM, frames: null, reconstruction: "stored" as const };
const view = spotSources(sources, pointCandidate({ ...CENTRE, spanM: 3 })).views[0];
const cam = set.cameras[view.shot.cameraKey];
/** The camera's own frame is 5,472 px wide; ODM saw 2,400. */
const SCALE = 5472 / cam.width;
const win = areaWindow(view.box, SCALE, 5472, 3648);

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const p = toEnu({ ...a, altM: groundAltM }, set.reference), q = toEnu({ ...b, altM: groundAltM }, set.reference);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
};

/** A box in the crop, centred where a ground point lands in this photo. */
function boxOn(point: { lat: number; lng: number }, widthPx = 40, heightPx = 30) {
  const p = projectToFrame(set, view.shot, { ...point, altM: groundAltM })!;
  return { x: p.u * SCALE - win.x, y: p.v * SCALE - win.y, width: widthPx, height: heightPx, confidence: 0.91, klass: "weed" };
}

describe("groundDetections", () => {
  it("carries a box from the crop back to the ground point it was drawn on, within centimetres", () => {
    const [d] = groundDetections({
      set, shot: view.shot, groundAltM, window: win, scale: SCALE, detections: [boxOn(CENTRE)],
      findingId: "spot-1", findingTitle: "Spot 1", detectedAt: "2026-10-05T00:00:00Z",
    });
    expect(d.status).toBe("ok");
    expect(d.centre).not.toBeNull();
    expect(metres(d.centre!, CENTRE)).toBeLessThan(0.02);
    // Native pixels are the crop's plus the window; frame pixels are those over the scale.
    expect(d.nativePx.u).toBeCloseTo(d.cropPx.x + win.x, 9);
    expect(d.framePx.u).toBeCloseTo(d.nativePx.u / SCALE, 9);
    expect(d.framePx.width).toBeCloseTo(40 / SCALE, 9);
    // The box on the ground is about its pixel size times the ground sample
    // distance; a tilted camera stretches it a few percent across the frame.
    expect(d.ring).toHaveLength(4);
    expect(d.widthM! / ((40 / SCALE) * view.gsdM)).toBeCloseTo(1, 1);
    expect(d.heightM! / ((30 / SCALE) * view.gsdM)).toBeCloseTo(1, 1);
    expect(d.id).toBe(`spot-1:${view.filename}:0`);
    expect(d.frame).toBe(view.filename);
    expect(debugLine(d)).toMatch(/^weed 0\.91 \| crop .* \| native .* \| frame .* \| .*\.JPG \| ground 54\.17\d+,12\.30\d+ .* m \| plane .* m$/);
  });

  it("two boxes a known distance apart on the ground come back that far apart", () => {
    const east = { lat: CENTRE.lat, lng: CENTRE.lng + 2 / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)) };
    const [a, b] = groundDetections({
      set, shot: view.shot, groundAltM, window: win, scale: SCALE, detections: [boxOn(CENTRE), boxOn(east)],
      findingId: "f", findingTitle: "f", detectedAt: "t",
    });
    expect(metres(a.centre!, b.centre!)).toBeCloseTo(2, 1);
  });

  it("a box whose ray never meets the ground is off_ground, with its pixels still recorded", () => {
    // A camera pointing straight up (the identity rotation looks along +z, which is up): no ground on that ray.
    const up = { ...view.shot, rotation: [0, 0, 0] as [number, number, number] };
    const [d] = groundDetections({
      set, shot: up, groundAltM, window: win, scale: SCALE, detections: [boxOn(CENTRE)],
      findingId: "f", findingTitle: "f", detectedAt: "t",
    });
    expect(d.status).toBe("off_ground");
    expect(d.centre).toBeNull();
    expect(d.ring).toBeNull();
    expect(d.framePx.u).toBeGreaterThan(0);
    expect(debugLine(d)).toContain("off ground");
  });
});

describe("the detection layer", () => {
  beforeEach(() => resetDetectionStore());
  const one = (findingId: string, frame: string, i = 0): GroundedDetection => ({
    id: `${findingId}:${frame}:${i}`, findingId, findingTitle: findingId, frame, klass: "weed", confidence: 0.5,
    cropPx: { x: 0, y: 0, width: 1, height: 1 }, nativePx: { u: 0, v: 0, width: 1, height: 1 }, framePx: { u: 0, v: 0, width: 1, height: 1 },
    centre: CENTRE, ring: null, widthM: null, heightM: null, status: "ok", groundAltM, detectedAt: "t",
  });

  it("files boxes per scan, replaces a photo's boxes when asked again, and toggles without losing them", () => {
    addDetections("scan-1", [one("a", "p1.JPG", 0), one("a", "p1.JPG", 1)]);
    addDetections("scan-1", [one("a", "p2.JPG")]);
    addDetections("scan-2", [one("z", "p9.JPG")]);
    expect(getDetectionLayer("scan-1").detections.map(d => d.id)).toEqual(["a:p1.JPG:0", "a:p1.JPG:1", "a:p2.JPG:0"]);
    addDetections("scan-1", [one("a", "p1.JPG", 0)]);
    expect(getDetectionLayer("scan-1").detections.map(d => d.id)).toEqual(["a:p2.JPG:0", "a:p1.JPG:0"]);
    setDetectionsVisible("scan-1", false);
    expect(getDetectionLayer("scan-1")).toMatchObject({ visible: false });
    expect(getDetectionLayer("scan-1").detections).toHaveLength(2);
    expect(getDetectionLayer("scan-2").detections).toHaveLength(1);
    clearDetections("scan-1");
    expect(getDetectionLayer("scan-1").detections).toEqual([]);
    expect(getDetectionLayer("missing")).toMatchObject({ visible: true, detections: [] });
  });
});
