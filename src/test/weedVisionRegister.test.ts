// @vitest-environment node
// Aligning a photo's outlines to the map: a synthetic field seen through the real camera model of the test
// reconstruction, with a known pose error and a known ground-height error that the aligner must recover.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groundAltitudeFromOdm, parseOdmOutputs, pixelToGround, projectToFrame, toEnu } from "@/lib/sourceFrames/odm";
import type { FrameDetection } from "@/lib/weedVision/frames";
import { type Rgb, alignPhoto, alignPoint, applyAlignment, fitAlignment, phaseCorrelate, prepare } from "@/lib/weedVision/register";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const ALT = groundAltitudeFromOdm(set, read("stats.json").odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };
const shot = set.shots
  .map(s => ({ s, p: projectToFrame(set, s, { ...CENTRE, altM: ALT }) }))
  .filter(x => x.p?.inside)
  .sort((a, b) => a.p!.viewAngleDeg - b.p!.viewAngleDeg)[0].s;
const cam = set.cameras[shot.cameraKey];

/** A broadband field texture like real soil and plants: value noise at 0.6, 0.25 and 0.12 m. (A sum of a few pure waves is ambiguous to phase correlation; real imagery is not.) */
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const lattice = (e: number, n: number, cell: number) => {
  const fx = e / cell, fy = n / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
};
const field = (e: number, n: number) => 0.5 * lattice(e, n, 0.6) + 0.3 * lattice(e + 17, n - 5, 0.25) + 0.2 * lattice(e - 3, n + 11, 0.12) - 0.5;
const colour = (v: number): Rgb => [110, Math.round(120 + 90 * v), 80];
const enu = (lat: number, lng: number, alt = ALT) => { const e = toEnu({ lat, lng, altM: alt }, set.reference); return [e[0], e[1]] as [number, number]; };
const mapAt = (lat: number, lng: number): Rgb => { const [e, n] = enu(lat, lng); return colour(field(e, n)); };

describe("phaseCorrelate", () => {
  it("finds a whole-cell and a sub-cell shift with the sign p(i) = o(i + d)", () => {
    const n = 64;
    const img = (dx: number, dy: number) => { const a = new Array<number | null>(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = field((x + dx) * 0.1, (y + dy) * 0.1); return prepare(a, n)!; };
    const o = img(0, 0);
    const r = phaseCorrelate(img(5, -3), o, n);
    expect(r.dx).toBeCloseTo(5, 0);
    expect(r.dy).toBeCloseTo(-3, 0);
    expect(r.peak).toBeGreaterThan(0.2);
    const s = phaseCorrelate(img(2.5, 1.25), o, n);
    expect(Math.abs(s.dx - 2.5)).toBeLessThan(0.2);
    expect(Math.abs(s.dy - 1.25)).toBeLessThan(0.2);
  });

  it("refuses a flat or mostly missing patch", () => {
    expect(prepare(new Array(64 * 64).fill(0.2), 64)).toBeNull();
    expect(prepare(new Array(64 * 64).fill(null), 64)).toBeNull();
  });
});

describe("alignPhoto", () => {
  it("recovers a pose error: every outline moves by the same 0.7 m", () => {
    const d: [number, number] = [0.55, -0.43];
    // The photo pixel really shows the ground 0.7 m from where the pose puts it.
    const photoAt = (u: number, v: number): Rgb => { const g = pixelToGround(set, shot, u, v, ALT); if (!g) return null; const [e, n] = enu(g.lat, g.lng); return colour(field(e + d[0], n + d[1])); };
    const a = alignPhoto({ set, shot, altM: ALT, photoAt, mapAt, stepM: 0.05 })!;
    expect(a).not.toBeNull();
    expect(a.usedPatches).toBeGreaterThanOrEqual(3);
    expect(Math.abs(a.t[0] - d[0])).toBeLessThan(0.02);
    expect(Math.abs(a.t[1] - d[1])).toBeLessThan(0.02);
    expect(Math.abs(a.k)).toBeLessThan(0.005);
    expect(a.shiftM).toBeCloseTo(Math.hypot(d[0], d[1]), 1);
  });

  it("recovers a ground-height error: outlines move outward from nadir in proportion to their distance", () => {
    const trueAlt = ALT - 0.8;
    const photoAt = (u: number, v: number): Rgb => { const g = pixelToGround(set, shot, u, v, trueAlt); if (!g) return null; const [e, n] = enu(g.lat, g.lng, trueAlt); return colour(field(e, n)); };
    const a = alignPhoto({ set, shot, altM: ALT, photoAt, mapAt, stepM: 0.05 })!;
    expect(a).not.toBeNull();
    expect(a.k).toBeGreaterThan(0);
    // At points across the frame, the aligned estimate lands within 2 cm of the truth.
    for (const [fu, fv] of [[0.2, 0.2], [0.8, 0.3], [0.5, 0.5], [0.3, 0.8]]) {
      const est = pixelToGround(set, shot, fu * cam.width, fv * cam.height, ALT)!;
      const tru = pixelToGround(set, shot, fu * cam.width, fv * cam.height, trueAlt)!;
      const moved = alignPoint(set, ALT, a, est);
      const [me, mn] = enu(moved.lat, moved.lng), [te, tn] = enu(tru.lat, tru.lng, trueAlt), [ee, en] = enu(est.lat, est.lng);
      expect(Math.hypot(me - te, mn - tn)).toBeLessThan(0.02);
      expect(Math.hypot(ee - te, en - tn)).toBeGreaterThan(Math.hypot(me - te, mn - tn)); // it got better, not worse
    }
  });

  it("says nothing when the photo has no texture to match", () => {
    const a = alignPhoto({ set, shot, altM: ALT, photoAt: () => [120, 100, 80], mapAt, stepM: 0.05 });
    expect(a).toBeNull();
  });
});

describe("fitAlignment and applyAlignment", () => {
  it("fits translation alone below three spots, and moves a detection once", () => {
    const f = fitAlignment([{ centre: [10, 10], shift: [0.3, 0.1], peak: 0.5 }], [0, 0])!;
    expect(f.t).toEqual([0.3, 0.1]);
    expect(f.k).toBe(0);
    const det = { id: "a", klass: "weed", ring: [{ ...CENTRE }, { lat: CENTRE.lat + 1e-5, lng: CENTRE.lng }, { lat: CENTRE.lat, lng: CENTRE.lng + 1e-5 }], centre: { ...CENTRE }, gsdM: 0.01, areaM2: 0.04, diameterM: 0.2 } as unknown as FrameDetection;
    const a = { t: [0.3, 0.1] as [number, number], k: 0, nadir: [0, 0] as [number, number], shiftM: 0.32, patches: [], usedPatches: 1, rmsM: 0, stepM: 0.05 };
    const [moved] = applyAlignment(set, ALT, a, [det]);
    const [e0, n0] = enu(CENTRE.lat, CENTRE.lng), [e1, n1] = enu(moved.centre!.lat, moved.centre!.lng);
    expect(e1 - e0).toBeCloseTo(0.3, 3);
    expect(n1 - n0).toBeCloseTo(0.1, 3);
    expect(moved.alignment).toMatchObject({ shiftM: 0.32, patches: 1 });
    const [again] = applyAlignment(set, ALT, a, [moved]);
    expect(again).toBe(moved); // never moved twice
  });
});
