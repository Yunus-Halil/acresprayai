// @vitest-environment node
//
// The source-frame lookup, against the reconstruction of a real scan: Testing
// Field 2, 180 senseFly S.O.D.A. frames, ODM 4.3.2 (fixtures/odm-dd0f6314).
// The photographs themselves are not retained anywhere, so nothing here can
// check a pixel. What it checks is that the geometry is internally consistent
// and agrees with ODM's own independent numbers: the cameras look down, a
// point below a camera lands near its principal point, footprints round-trip,
// the per-point GSD matches ODM's average GSD, and a point in the field is
// seen by several frames with the nearest-centre one ranked first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  frameFootprint, groundAltitudeFromOdm, offNadirDeg, parseCameras, parseOdmOutputs, pixelToGround, projectToFrame,
  UnsupportedCameraError,
} from "@/lib/sourceFrames/odm";
import { selectFrames } from "@/lib/sourceFrames/select";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const stats = read("stats.json");
const groundAlt = groundAltitudeFromOdm(set, stats.odm_processing_statistics.average_gsd)!;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("what ODM left us", () => {
  it("parses one brown lens, 180 posed frames and 180 EXIF records", () => {
    expect(Object.keys(set.cameras)).toHaveLength(1);
    expect(Object.values(set.cameras)[0]).toMatchObject({ projection: "brown", width: 2400, height: 1600 });
    expect(set.shots).toHaveLength(180);
    expect(Object.keys(set.images)).toHaveLength(180);
    expect(set.shots.every(s => set.images[s.filename])).toBe(true);
  });

  it("records that the uploaded frames were downscaled from what the camera produced", () => {
    const m = set.images[set.shots[0].filename];
    expect(m.exifWidth).toBe(5472);
    expect(m.width).toBe(2400);
    expect(m.yaw).toBeNull();
    expect(m.exposureS).toBeCloseTo(0.001);
  });

  it("refuses a lens model it cannot project", () => {
    expect(() => parseCameras({ x: { projection_type: "fisheye", width: 1, height: 1, focal_x: 1 } })).toThrow(UnsupportedCameraError);
  });
});

describe("the pose convention", () => {
  it("cameras look down: a fixed wing without a gimbal sits a few degrees off nadir, never sideways", () => {
    const tilts = set.shots.map(offNadirDeg);
    expect(median(tilts)).toBeLessThan(15);
    expect(Math.max(...tilts)).toBeLessThan(25);
  });

  it("the ground point below each camera lands inside the frame, offset by the tilt", () => {
    for (const shot of set.shots) {
      const p = projectToFrame(set, shot, { ...shot.centre, altM: groundAlt })!;
      expect(p).not.toBeNull();
      expect(p.inside).toBe(true);
      // Height above ground times tan(tilt) over the GSD is the expected offset in pixels.
      const expectedPx = ((shot.centre.altM - groundAlt) * Math.tan((offNadirDeg(shot) * Math.PI) / 180)) / p.gsdM;
      const actualPx = Math.hypot(p.u - 1200, p.v - 800);
      expect(Math.abs(actualPx - expectedPx)).toBeLessThan(0.05 * 2400);
    }
  });

  it("per-point GSD at the frame centre agrees with ODM's own average GSD", () => {
    const gsds = set.shots.map(s => projectToFrame(set, s, { ...s.centre, altM: groundAlt })!.gsdM * 100);
    const odm = stats.odm_processing_statistics.average_gsd as number;
    expect(Math.abs(median(gsds) - odm) / odm).toBeLessThan(0.1);
  });

  it("a point behind the camera does not project", () => {
    const shot = set.shots[0];
    expect(projectToFrame(set, shot, { ...shot.centre, altM: shot.centre.altM + 50 })).toBeNull();
  });
});

describe("footprints", () => {
  it("round-trip: a frame corner on the ground projects back to that corner", () => {
    for (const shot of set.shots.slice(0, 20)) {
      const fp = frameFootprint(set, shot, groundAlt)!;
      expect(fp).not.toBeNull();
      const corners = [[0, 0], [2400, 0], [2400, 1600], [0, 1600]];
      fp.forEach((g, i) => {
        const p = projectToFrame(set, shot, g)!;
        expect(Math.abs(p.u - corners[i][0])).toBeLessThan(0.5);
        expect(Math.abs(p.v - corners[i][1])).toBeLessThan(0.5);
      });
    }
  });

  it("a footprint covers about what the altitude and lens say it should", () => {
    // A tilted frame's far edge is further away than its centre, so the edge
    // length over the pixel count sits above the centre GSD; at 10 degrees of
    // tilt the difference is under 15%.
    const shot = set.shots[0];
    const fp = frameFootprint(set, shot, groundAlt)!;
    const g = pixelToGround(set, shot, 1200, 800, groundAlt)!;
    const widthM = Math.hypot(
      (fp[1].lng - fp[0].lng) * 111_320 * Math.cos((g.lat * Math.PI) / 180),
      (fp[1].lat - fp[0].lat) * 111_320,
    );
    const p = projectToFrame(set, shot, g)!;
    expect(widthM / 2400 / p.gsdM).toBeGreaterThan(0.9);
    expect(widthM / 2400 / p.gsdM).toBeLessThan(1.15);
    expect(widthM).toBeGreaterThan(120);
    expect(widthM).toBeLessThan(200);
  });
});

describe("choosing the frame", () => {
  const centre = { lat: 54.17259, lng: 12.30625, altM: groundAlt };

  it("a point in the field is seen by several overlapping frames", () => {
    const r = selectFrames(set, { centroid: centre, radiusM: 1 });
    expect(r.views).toBeGreaterThanOrEqual(5);
    expect(r.best).not.toBeNull();
    expect(r.candidates.every(c => c.centre.inside)).toBe(true);
  });

  it("ranks a frame that holds the finding near its centre above one that holds it at the edge", () => {
    const r = selectFrames(set, { centroid: centre, radiusM: 1 });
    const edges = r.candidates.map(c => c.centre.edgeDistancePx);
    expect(r.best!.centre.edgeDistancePx).toBeGreaterThan(median(edges));
    expect(r.best!.fullyInside).toBe(true);
  });

  it("reports both the uploaded and the camera-native GSD, and says which terms it could not score", () => {
    const b = selectFrames(set, { centroid: centre, radiusM: 1 }).best!;
    expect(b.gsdM).toBeGreaterThan(0.05);
    expect(b.gsdM).toBeLessThan(0.08);
    expect(b.nativeGsdM!).toBeCloseTo(b.gsdM * (2400 / 5472), 4);
    expect(b.blurPx).not.toBeNull();
    expect(b.blurPx!).toBeLessThan(1);
    expect(b.parts.sharpness).toBeNull();
    expect(b.parts.exposure).toBeNull();
    expect(b.parts.occlusion).toBeNull();
  });

  it("a point outside every footprint has no frames", () => {
    const r = selectFrames(set, { centroid: { lat: 54.0, lng: 12.0, altM: groundAlt }, radiusM: 1 });
    expect(r.views).toBe(0);
    expect(r.best).toBeNull();
  });
});
