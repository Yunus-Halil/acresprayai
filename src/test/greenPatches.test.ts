// The colour tier's rules (directGeoref/green.ts): the soil-relative threshold under uneven light, the small-patch
// contrast rule, the split of a strip at its plants, and the reconciliation by outline overlap with absorption of
// pieces (directGeoref/reconcile.ts).
import { describe, expect, it } from "vitest";
import { GREEN_DEFAULTS, greenMask, greenPatches, splitAtPeaks } from "@/lib/directGeoref/green";
import { type GeorefFrame, type Intrinsics, type Observation, TAKEOFF_DATUM, UNCALIBRATED_BORESIGHT, reconcile, takeoffPlane } from "@/lib/directGeoref";
import type { PhotoPixels } from "@/lib/photoScout/pattern";

/** A picture of soil with painted plants; the right half darker (shadow), bluer soil there. */
function picture(W: number, H: number, paint: (x: number, y: number) => [number, number, number] | null): PhotoPixels {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const shade = x >= W / 2 ? 0.45 : 1;
    const p = paint(x, y);
    const [r, g, b] = p ?? (x >= W / 2 ? [120, 110, 105] : [150, 115, 85]); // soil: ExGR about -0.24 lit, bluer in shadow
    rgba[o] = Math.round(r * shade); rgba[o + 1] = Math.round(g * shade); rgba[o + 2] = Math.round(b * shade); rgba[o + 3] = 255;
  }
  return { width: W, height: H, rgba };
}
const LEAF: [number, number, number] = [70, 140, 50];
/** A faint plant: leaf blended half with soil, as a small plant in a 4 cm pixel reads. */
const FAINT: [number, number, number] = [122, 124, 80];
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

describe("green patches by rules", () => {
  it("finds a faint plant against its own soil that the fixed zero threshold misses, lit or in shadow", () => {
    const W = 256, H = 128;
    const px = picture(W, H, (x, y) => (disc(40, 64, 2)(x, y) || disc(200, 64, 2)(x, y) ? FAINT : disc(100, 30, 5)(x, y) ? LEAF : null));
    const fixed = greenPatches(px, 4, { ...GREEN_DEFAULTS, index: "exgr", cellPx: 1, minCells: 2 });
    const soil = greenPatches(px, 4, { ...GREEN_DEFAULTS, index: "exgr-soil", cellPx: 1, minCells: 2, soilTilePx: 32 });
    const at = (list: ReturnType<typeof greenPatches>, x: number, y: number) => list.some(o => Math.hypot(o.u / 4 - x, o.v / 4 - y) < 4);
    expect(at(fixed, 100, 30)).toBe(true);
    expect(at(fixed, 40, 64)).toBe(false); expect(at(fixed, 200, 64)).toBe(false);
    expect(at(soil, 100, 30)).toBe(true);
    expect(at(soil, 40, 64)).toBe(true); expect(at(soil, 200, 64)).toBe(true);
    // Nothing on the plain soil, lit or shadowed.
    expect(soil.length).toBe(3);
    const mask = greenMask(px, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 32 });
    let soilGreen = 0; for (let i = 0; i < W * H; i++) if (mask[i] && !px.rgba[i * 4 + 3]) soilGreen++;
    expect(soilGreen).toBe(0);
  });

  it("drops a speck that barely clears the soil, keeps a small plant that stands well above it", () => {
    const W = 128, H = 64;
    // A 2-pixel speck just over the margin, a 2-pixel leaf, a 9-pixel faint patch (large enough to pass unquestioned).
    const SPECK: [number, number, number] = [128, 120, 78];
    const px = picture(W, H, (x, y) => (y === 20 && (x === 20 || x === 21) ? SPECK : y === 40 && (x === 20 || x === 21) ? LEAF : x >= 50 && x < 53 && y >= 20 && y < 23 ? FAINT : null));
    const base = { ...GREEN_DEFAULTS, index: "exgr-soil" as const, cellPx: 1, minCells: 2, soilTilePx: 32, soilMargin: 0.08 };
    const loose = greenPatches(px, 1, base);
    const strict = greenPatches(px, 1, { ...base, smallCells: 4, smallMargin: 0.25 });
    const at = (list: ReturnType<typeof greenPatches>, x: number, y: number) => list.some(o => Math.hypot(o.u - x, o.v - y) < 3);
    expect(at(loose, 21, 20.5)).toBe(true);
    expect(at(strict, 21, 20.5)).toBe(false);
    expect(at(strict, 21, 40.5)).toBe(true);
    expect(at(strict, 51.5, 21.5)).toBe(true);
  });

  it("splits a strip of touching plants at its peaks, one object per plant, and leaves a single plant whole", () => {
    const W = 200, H = 60;
    // Three discs of radius 6 whose centres are 11 px apart (touching), and one disc alone.
    const px = picture(W, H, (x, y) => (disc(30, 30, 6)(x, y) || disc(41, 30, 6)(x, y) || disc(52, 30, 6)(x, y) || disc(150, 30, 6)(x, y) ? LEAF : null));
    const whole = greenPatches(px, 1, { ...GREEN_DEFAULTS, index: "exgr", cellPx: 1, minCells: 2 });
    expect(whole.length).toBe(2);
    const split = greenPatches(px, 1, { ...GREEN_DEFAULTS, index: "exgr", cellPx: 1, minCells: 2, pixelM: 0.04, splitM2: 0.3, peakSepM: 0.3 });
    expect(split.length).toBe(4);
    const xs = split.map(o => o.u).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(30.5, 0); expect(xs[1]).toBeCloseTo(41.5, 0); expect(xs[2]).toBeCloseTo(52.5, 0); expect(xs[3]).toBeCloseTo(150.5, 0);
    // The split keeps every cell: the pieces' areas add up to the strip's.
    expect(split.slice(0, 3).reduce((s, o) => s + o.cells, 0)).toBe(whole.find(o => o.u < 100)!.cells);
    // Two peaks closer than the separation are one plant.
    const cells: number[] = []; for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) cells.push(y * 50 + x);
    expect(splitAtPeaks(cells, 50, 20).length).toBe(1);
  });
});

describe("reconciliation by outline overlap", () => {
  const K: Intrinsics = { width: 5472, height: 3648, fx: 3666.666504, fy: 3666.666504, cx: 2736, cy: 1824, distortion: null, basis: "test" };
  const frameOf = (name: string, lat: number, lng: number): GeorefFrame => ({ name, intrinsics: K, ground: takeoffPlane(), pose: { lat, lng, altM: 36, datum: TAKEOFF_DATUM, attitude: { yawDeg: 0, pitchDeg: -90, rollDeg: 0, basis: "test" }, boresight: UNCALIBRATED_BORESIGHT, basis: "test" } });
  it("joins a patch one photograph sees whole and another sees as three pieces into one plant seen twice", () => {
    const LAT = 33.88, LNG = -5.42;
    const A = frameOf("A", LAT, LNG), B = frameOf("B", LAT + 10 / 111_320, LNG);
    const px = 36 / 3666.666504; // metres per pixel at 36 m
    const sq = (u: number, v: number, half: number): [number, number][] => [[u - half, v - half], [u + half, v - half], [u + half, v + half], [u - half, v + half]];
    // The plant: 1 m across, 5 m east of A's nadir on the ground; B is 10 m north, so it sits 10 m south of B's nadir.
    const ob = (frame: string, id: number, u: number, v: number, halfPx: number): Observation => ({ frame, id, u, v, sizeM: 2 * halfPx * px, areaM2: (2 * halfPx * px) ** 2, touchesEdge: false, data: { poly: sq(u, v, halfPx) } });
    const obs: Observation[] = [
      ob("A", 1, 2736 + 500, 1824, 50),
      ob("B", 1, 2736 + 500 - 20, 1824 + 1000 - 20, 15), ob("B", 2, 2736 + 500 + 20, 1824 + 1000 - 20, 15), ob("B", 3, 2736 + 500, 1824 + 1000 + 25, 15),
      ob("A", 2, 2736 - 1500, 1824, 20), // another plant, seen once
    ];
    const frames = new Map([["A", A], ["B", B]]);
    const rays = reconcile(obs, frames, { maxHeightM: 6 });
    const overlap = reconcile(obs, frames, { maxHeightM: 6, linkBy: "overlap", absorb: true });
    expect(rays.filter(o => o.seenBy >= 2).length).toBeLessThanOrEqual(1);
    expect(rays.length).toBeGreaterThanOrEqual(3);
    expect(overlap.length).toBe(2);
    const plant = overlap.find(o => o.members.length === 4)!;
    expect(plant).toBeDefined();
    expect(plant.seenBy).toBe(2);
    expect(plant.coveredBy).toBeGreaterThanOrEqual(2);
    // Its size is per photograph: A's 1 m square, B's three pieces summed (0.09 x 3 = 0.27 m2 -> 0.59 m across), then the median.
    expect(plant.areaM2).toBeGreaterThan(0.25); expect(plant.areaM2).toBeLessThan(1.05);
    expect(overlap.find(o => o.members.length === 1)!.seenBy).toBe(1);
  });
});
