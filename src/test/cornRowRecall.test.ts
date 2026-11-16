// Plants along the rows, found again at a lower bar (2026-11-16): the per-photograph candidates (greenPoints.ts
// rowPlantPoints, seedlingGreen.ts SEEDLING_ROW) and how the field takes them (plantsFirst.ts rowCandidates, reconstruct
// tiers). The rules these tests hold:
//  - the whole-frame mask and its marks are untouched; without candidates everything reads exactly as before;
//  - a candidate is kept only on a row, never within the exclusion distance of a dot the stricter marks made;
//  - one photograph alone counts only where it sees sharply, joins a row, and never makes one;
//  - a piece is split only along the row, never because it is wide across it.
import { describe, expect, it } from "vitest";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { type GeorefFrame, UNCALIBRATED_BORESIGHT, groundToPixel } from "@/lib/directGeoref/projection";
import { type Dot, type PhotoShift, PLANTS_FIRST, ROW_RECALL, SEQUENCE, projectSightings, reconstruct, rowCandidates } from "@/lib/fieldTwin/plantsFirst";
import { ROW_POINTS, rowPlantPoints } from "@/lib/rowCrop/greenPoints";
import { SEEDLING_GREEN, SEEDLING_ROW, seedlingMask } from "@/lib/rowCrop/seedlingGreen";
import { rowAngleOf } from "@/lib/rowCrop/cornV1";

describe("the lower bar along rows", () => {
  it("is the whole-frame mask's rules with only the dark-leaf bar lowered, and only ever adds pixels", () => {
    expect({ ...SEEDLING_ROW, dark: null }).toEqual({ ...SEEDLING_GREEN, dark: null });
    expect(SEEDLING_ROW.dark!.strongTint).toBeLessThan(SEEDLING_GREEN.dark!.strongTint);
    expect(SEEDLING_GREEN.dark).toEqual({ strongTint: 24, weakTint: 15, maxGain: 2.5, minL: 40 });
    // Pale sand; a leaf whose tint at the soil's brightness is between the two bars: unseen at 24, seen at 14.
    const W = 400, H = 300, rgba = new Uint8ClampedArray(W * H * 4), leaf: number[] = [];
    let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < W * H; i++) { const n = (rnd() - 0.5) * 16; rgba[i * 4] = 185 + n; rgba[i * 4 + 1] = 170 + n; rgba[i * 4 + 2] = 145 + n; rgba[i * 4 + 3] = 255; }
    for (let x = 40; x < W - 4; x += 60) for (let y = 20; y < H - 4; y += 24) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (y + dy) * W + x + dx; rgba[i * 4] = 90; rgba[i * 4 + 1] = 98; rgba[i * 4 + 2] = 80; leaf.push(i); }
    const px: PhotoPixels = { width: W, height: H, rgba };
    const strict = seedlingMask(px, SEEDLING_GREEN), low = seedlingMask(px, SEEDLING_ROW);
    for (let i = 0; i < strict.length; i++) if (strict[i] && !low[i]) throw new Error(`pixel ${i} lost at the lower bar`);
    const share = (m: Uint8Array) => leaf.filter(i => m[i]).length / leaf.length;
    expect(share(strict)).toBeLessThan(0.1);
    expect(share(low)).toBeGreaterThan(0.9);
  });
});

describe("row candidates in one photograph", () => {
  const W = 600, H = 400;
  const blank = () => new Uint8Array(W * H);
  const rect = (m: Uint8Array, x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m[y * W + x] = 1; };
  // 1 cm a pixel: a plant spacing (0.15 m) is 15 px, the split starts over 22.5 px along the row.
  const GSD = 0.01, down = Math.PI / 2;

  it("keeps two seedlings two pixels apart as two, at the photo's own pixel", () => {
    const m = blank(); rect(m, 100, 100, 7, 7); rect(m, 100, 109, 7, 7);
    const p = rowPlantPoints(m, W, H, down, GSD);
    expect(p.length).toBe(2);
  });

  it("splits a piece only along the row: long along it gives a point per plant spacing, wide across it stays one", () => {
    const m = blank();
    rect(m, 100, 50, 6, 46);   // 46 px along a vertical row: three plants touching
    rect(m, 300, 50, 46, 6);   // 46 px ACROSS the row: one plant with its leaves spread
    for (let k = 0; k < 12; k++) rect(m, 420 + (k % 4) * 20, 200 + Math.floor(k / 4) * 20, 7, 7); // ordinary plants, so the long pieces do not size the typical one
    const p = rowPlantPoints(m, W, H, down, GSD);
    const near = (x: number, y0: number, y1: number) => p.filter(q => Math.abs(q.x - x) < 8 && q.y >= y0 && q.y <= y1);
    expect(near(103, 50, 96).length).toBe(3);
    expect(p.filter(q => q.y >= 50 && q.y <= 56 && q.x >= 300 && q.x <= 346).length).toBe(1);
    // The three points stand along the row, a plant spacing apart.
    const ys = near(103, 50, 96).map(q => q.y).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeGreaterThan(10); expect(ys[2] - ys[1]).toBeGreaterThan(10);
    // The same photograph read across (rows horizontal): now the other piece is the long one.
    const q = rowPlantPoints(m, W, H, 0, GSD);
    expect(q.filter(t => t.y >= 50 && t.y <= 56 && t.x >= 300 && t.x <= 346).length).toBe(3);
    expect(q.filter(t => Math.abs(t.x - 103) < 8 && t.y >= 50 && t.y <= 96).length).toBe(1);
  });

  it("drops specks, and without a row direction cuts a long piece along its own length", () => {
    const m = blank(); rect(m, 50, 50, 3, 3); rect(m, 100, 50, 6, 46); for (let k = 0; k < 6; k++) rect(m, 300 + k * 20, 200, 7, 7);
    expect(ROW_POINTS.minPiecePx).toBeGreaterThan(9);
    const p = rowPlantPoints(m, W, H, null, GSD);
    expect(p.some(q => Math.abs(q.x - 51) < 3 && Math.abs(q.y - 51) < 3)).toBe(false);
    expect(p.filter(q => Math.abs(q.x - 103) < 8).length).toBe(3);
    expect(p.filter(q => q.y >= 200 && q.y <= 207).length).toBe(6);
  });

  it("reads the photograph's row direction from its rows, whichever way each was drawn", () => {
    expect(rowAngleOf([])).toBeNull();
    const a = rowAngleOf([{ points: [[100, 0], [102, 900]] }, { points: [[300, 900], [298, 0]] }, { points: [[500, 10], [503, 880]] }])!;
    expect(Math.abs(Math.sin(a))).toBeGreaterThan(0.999);
  });
});

// A camera looking straight down from 20 m over the origin: 4000 x 3000 px, 0.5 cm a pixel at the centre.
const ORIGIN = { lat: 40, lng: -90, altM: 0 };
const cam = (name: string, eastM: number): GeorefFrame => ({
  name,
  intrinsics: { width: 4000, height: 3000, fx: 4000, fy: 4000, cx: 2000, cy: 1500, distortion: null, basis: "test" } as GeorefFrame["intrinsics"],
  pose: { lat: 40, lng: -90 + eastM / (111320 * Math.cos((40 * Math.PI) / 180)), altM: 20, datum: "test", attitude: { yawDeg: 0, pitchDeg: -90, rollDeg: 0, basis: "test" }, boresight: UNCALIBRATED_BORESIGHT, basis: "test" },
  ground: { kind: "flat", altM: 0, datum: "test", basis: "test" },
});
const NONE: PhotoShift = { e: [0, 0, 0], n: [0, 0, 0], u0: 0, v0: 0, cells: 1 };
const ll = (e: number, n: number) => ({ lat: 40 + n / 110574, lng: -90 + e / (111320 * Math.cos((40 * Math.PI) / 180)) });

describe("candidates for the rows, over the field", () => {
  const frames = new Map([["a", cam("a", 0)], ["b", cam("b", 1)]]);
  /** Where a ground point (metres east / north of the origin) lands in a photograph, rounded as a read stores it. */
  const at = (name: string, e: number, n: number): [number, number] => { const p = ll(e, n), h = groundToPixel(frames.get(name)!, p.lat, p.lng, 0)!; return [Math.round(h.u), Math.round(h.v)]; };
  // The rows run north (90 degrees from east).
  const DIR = 90;

  it("leaves out a candidate beside an existing dot, joins two photographs' marks along the row, and takes one photograph only where it sees sharply", () => {
    // The stricter marks: one plant at (0.5, 0.5) both photographs marked (a dot), one at (0.5, 2) only photograph a marked.
    const strict = [{ name: "a", scale: 1, plants: [at("a", 0.5, 0.5), at("a", 0.5, 2)] }, { name: "b", scale: 1, plants: [at("b", 0.5, 0.5)] }];
    const { sights, photos } = projectSightings(strict, frames, ORIGIN);
    const dot: Dot = { e: 0.5, n: 0.5, members: [0, 2], photos: 2, spreadM: 0 };
    const low = [
      { name: "a", scale: 1, plants: [at("a", 0.5, 0.54), at("a", 0.5, 1.0), at("a", 0.5, 2.0), at("a", 0.5, 3.0), at("a", 9.5, 7.0)] },
      { name: "b", scale: 1, plants: [at("b", 0.5, 1.07), at("b", 0.53, 3.5)] },
    ];
    const C = rowCandidates(low, frames, ORIGIN, photos, [NONE, NONE], sights, [dot], DIR);
    const has = (e: number, n: number, tol = 0.02) => C.dots.findIndex(d => Math.hypot(d.e - e, d.n - n) < tol);
    // 4 cm from the dot: that plant again.
    expect(C.dots.some(d => Math.hypot(d.e - 0.5, d.n - 0.5) < ROW_RECALL.exclM)).toBe(false);
    // 7 cm apart along the row in two photographs (over the 6 cm gate of the stricter marks): one plant, two photographs.
    const pair = has(0.5, 1.035, 0.03); expect(pair).toBeGreaterThanOrEqual(0); expect(C.dots[pair].photos).toBe(2); expect(C.tier[pair]).toBe(1);
    // The stricter mark one photograph made, and the lower bar's mark of the same plant in that photograph: once.
    expect(C.dots.filter(d => Math.hypot(d.e - 0.5, d.n - 2) < 0.05).length).toBe(1);
    // One photograph, near the middle of its frame: kept, tier 2. One photograph, at its corner: not kept.
    const lone = has(0.5, 3.0, 0.03); expect(lone).toBeGreaterThanOrEqual(0); expect(C.tier[lone]).toBe(2);
    expect(has(9.5, 7.0, 0.1)).toBe(-1);
    // Too far apart across the row to be one plant: photograph b's mark at (0.53, 3.5) stays its own.
    expect(C.dots.every(d => d.members.length === 0)).toBe(true);
  });
});

describe("the rows take candidates, and nothing else changes", () => {
  // Six rows 0.9 m apart running east, a plant every 0.15 m over 24 m, each seen by 5 of 8 photographs; row 2 has a
  // 1.8 m stretch with no plant.
  const S = 0.9, SEED = 0.15;
  const strict: Dot[] = [];
  for (let r = 0; r < 6; r++) for (let k = 0; k * SEED <= 24; k++) { const a = k * SEED; if (r === 2 && a > 9.05 && a < 10.85) continue; strict.push({ e: a, n: r * S, members: [], photos: 5, spreadM: 0.01 }); }
  const dot = (e: number, n: number, photos: number): Dot => ({ e, n, members: [], photos, spreadM: 0.01 });
  const run = (extra: Dot[], tiers: number[]) => {
    const all = [...strict, ...extra], covered = new Int32Array(all.length).fill(8);
    const tier = extra.length ? Uint8Array.from([...strict.map(() => 0), ...tiers]) : null;
    return reconstruct(all, covered, 0, S, PLANTS_FIRST, SEQUENCE, tier ? Uint8Array.from(tier, t => (t ? 1 : 0)) : null, tier);
  };
  const n0 = strict.length;

  it("a candidate on a row at the plant spacing is a probable plant; between the rows, or beside a plant, it is not on a row", () => {
    const extra = [
      dot(9.15, 2 * S, 2), dot(9.3, 2 * S, 2), dot(9.45, 2 * S, 1),   // in the gap of row 2, at the spacing
      dot(5.0, 0.45, 3),                                              // between rows 0 and 1
      dot(12.03, 3 * S, 1),                                           // 3 cm from a plant of row 3
    ];
    const R = run(extra, [1, 1, 2, 1, 2]);
    expect([0, 1, 2].map(k => R.rowOf[n0 + k] >= 0)).toEqual([true, true, true]);
    expect([0, 1, 2].map(k => R.certainty[n0 + k])).toEqual([1, 1, 1]);
    expect(R.rowOf[n0 + 3]).toBe(-1);
    expect(R.rowOf[n0 + 4]).toBe(-1);
  });

  it("the dots of the stricter marks are placed exactly as without candidates", () => {
    const base = run([], []);
    const extra = [dot(9.15, 2 * S, 2), dot(9.3, 2 * S, 2), dot(5.0, 0.45, 3), dot(12.03, 3 * S, 1)];
    const R = run(extra, [1, 1, 1, 2]);
    expect(Array.from(R.certainty.slice(0, n0))).toEqual(Array.from(base.certainty));
    expect(Array.from(R.rowOf.slice(0, n0)).map(v => v >= 0)).toEqual(Array.from(base.rowOf).map(v => v >= 0));
    expect(R.geometry.certainRows).toBe(base.geometry.certainRows);
    expect(R.geometry.spacingM).toBe(base.geometry.spacingM);
  });

  it("one photograph's marks never make a row; two photographs' marks can, in a slot of the planter's pattern", () => {
    // A seventh slot, one spacing beyond the last row, a plant every 0.15 m over 6 m.
    const line = (photos: number) => Array.from({ length: 41 }, (_, k) => dot(3 + k * SEED, 6 * S, photos));
    const one = run(line(1), line(1).map(() => 2));
    expect(Array.from(one.rowOf.slice(n0)).every(v => v === -1)).toBe(true);
    const two = run(line(2), line(2).map(() => 1));
    expect(Array.from(two.rowOf.slice(n0)).filter(v => v >= 0).length).toBeGreaterThan(30);
    expect(two.rows.some(r => r.kind === "geometry")).toBe(true);
    // Never a certain plant, whatever the photographs.
    expect(Array.from(two.certainty.slice(n0)).every(v => v !== 0)).toBe(true);
  });
});
