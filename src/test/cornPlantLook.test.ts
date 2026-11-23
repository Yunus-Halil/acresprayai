// Each corn plant's own look (cornPlantLook.ts): the leaf line measured under a mark, the plants' looks from their
// photographs' marks, the packing for the twin; the drawn line (cornRender.ts lineLeaves, plantOwnTints); and which
// photographs marked a plant (plantMarks.ts).
import { describe, expect, it } from "vitest";
import { IDENTITY, enuFromCamera, mulM, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { MARK_LOOK_BYTES, PLANT_LOOK, type PhotoLooks, lookRgb, measureMarkLooks, packLooks, plantLooks, unpackLooks } from "@/lib/fieldTwin/cornPlantLook";
import { CORN_RENDER, lineLeaves, plantOwnTints } from "@/lib/fieldTwin/cornRender";
import { packPlantMarks, plantMarksReader } from "@/lib/fieldTwin/plantMarks";

const W = 200, H = 160, SOIL = [150, 140, 118], LEAF = [70, 96, 44];
/** A tan photograph with leaves drawn as thick lines: [x0, y0, x1, y1][]. */
function photo(lines: [number, number, number, number][], leaf = LEAF) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[4 * i] = SOIL[0] + ((i * 7) % 5) - 2; rgba[4 * i + 1] = SOIL[1] + ((i * 3) % 5) - 2; rgba[4 * i + 2] = SOIL[2]; rgba[4 * i + 3] = 255; }
  for (const [x0, y0, x1, y1] of lines) for (let t = 0; t <= 200; t++) {
    const x = x0 + ((x1 - x0) * t) / 200, y = y0 + ((y1 - y0) * t) / 200;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = ((Math.round(y) + dy) * W + Math.round(x) + dx) * 4; rgba[q] = leaf[0]; rgba[q + 1] = leaf[1]; rgba[q + 2] = leaf[2]; }
  }
  return { width: W, height: H, rgba };
}
const at = (L: Uint8Array, k: number) => ({ dir: L[k * MARK_LOOK_BYTES], lenPx: L[k * MARK_LOOK_BYTES + 1] / 4, elong: L[k * MARK_LOOK_BYTES + 2] / 10, rgb: [L[k * MARK_LOOK_BYTES + 3], L[k * MARK_LOOK_BYTES + 4], L[k * MARK_LOOK_BYTES + 5]] });
const GSD = 0.005; // 5 mm a pixel: the window reaches 15 px each way

describe("the green under a mark", () => {
  it("gives the leaf line's direction, its length and its colour", () => {
    // A leaf line 20 px long lying along x, another at 45 degrees, a third straight down the frame.
    const px = photo([[40, 40, 60, 40], [100, 40, 114, 54], [160, 30, 160, 50]]);
    const L = measureMarkLooks(px, [[50, 40], [107, 47], [160, 40]], GSD);
    const a = at(L, 0), b = at(L, 1), c = at(L, 2);
    expect(Math.min(a.dir, 180 - a.dir)).toBeLessThanOrEqual(3);
    expect(Math.abs(b.dir - 45)).toBeLessThanOrEqual(4);
    expect(Math.abs(c.dir - 90)).toBeLessThanOrEqual(3);
    expect(a.lenPx).toBeGreaterThan(19); expect(a.lenPx).toBeLessThan(25);
    expect(a.elong).toBeGreaterThan(3);
    for (const q of [a, b, c]) { expect(Math.abs(q.rgb[0] - LEAF[0])).toBeLessThanOrEqual(6); expect(Math.abs(q.rgb[1] - LEAF[1])).toBeLessThanOrEqual(6); }
  });
  it("gives nothing for a mark on bare soil, or one too near the frame's edge for its window", () => {
    const px = photo([[40, 40, 60, 40]]);
    const L = measureMarkLooks(px, [[120, 100], [3, 3]], GSD);
    expect(L[0]).toBe(255); expect(L[MARK_LOOK_BYTES]).toBe(255);
  });
  it("keeps to its own plant: a neighbour's leaves beyond the window do not turn the line", () => {
    // The plant lies along x; a neighbour 30 px below it lies down the frame, not touching.
    const px = photo([[90, 60, 110, 60], [100, 85, 100, 110]]);
    const a = at(measureMarkLooks(px, [[100, 60]], GSD), 0);
    expect(Math.min(a.dir, 180 - a.dir)).toBeLessThanOrEqual(3);
  });
  it("reads a leaf darker than its soil, by its tint at the soil's brightness", () => {
    const a = at(measureMarkLooks(photo([[40, 40, 60, 40]], [62, 66, 44]), [[50, 40]], GSD), 0);
    expect(a.dir).not.toBe(255); expect(Math.min(a.dir, 180 - a.dir)).toBeLessThanOrEqual(4);
  });
});

/** A camera straight down, north up (as plantPhotos.test.tsx builds its cameras): pixel x is east, pixel y is south. */
const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const frame = (name: string): GeorefFrame => ({ name, intrinsics: { width: W, height: H, fx: 10 / GSD, fy: 10 / GSD, cx: W / 2, cy: H / 2, distortion: null, basis: "t" }, pose: { lat: 38, lng: -77, altM: 10, datum: "t", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "t" }, ground: { kind: "flat", altM: 0, datum: "t", basis: "t" } }) as GeorefFrame;
const look = (dir: number, lenPx: number, elong: number, rgb = LEAF): number[] => [dir, Math.round(lenPx * 4), Math.round(elong * 10), ...rgb];
const looksOf = (list: number[][]): PhotoLooks => ({ plants: Uint8Array.from(list.flat()), low: new Uint8Array(0) });

describe("a plant's look from the photographs that marked it", () => {
  const frames = new Map(["a", "b", "c"].map(n => [n, frame(n)])), origin = { lat: 38, lng: -77, altM: 0 };
  const reads = new Map(["a", "b", "c"].map(n => [n, { scale: 1 }]));
  const S = (photo: string, k: number) => ({ photo, u: 100, v: 80, k });
  it("is the direction they agree on, as a compass bearing, with the median length and colour", () => {
    // Along the photograph's x is east: bearing 90. Three photographs within a few degrees of it.
    const looks = new Map([["a", looksOf([look(0, 20, 3.2)])], ["b", looksOf([look(6, 24, 3.0)])], ["c", looksOf([look(176, 22, 2.8)])]]);
    const [p] = plantLooks([[S("a", 0), S("b", 0), S("c", 0)]], looks, reads, frames, origin);
    expect(Math.abs(p.dirDeg! - 90)).toBeLessThanOrEqual(5);
    expect(p.shape).toBe(0);
    expect(p.sizeM!).toBeCloseTo(22 * GSD, 2);
    expect(p.rgb).toEqual(LEAF);
  });
  it("gives no direction where the photographs disagree, and still a size and a colour", () => {
    const looks = new Map([["a", looksOf([look(0, 20, 3)])], ["b", looksOf([look(60, 20, 3)])], ["c", looksOf([look(120, 20, 3)])]]);
    const [p] = plantLooks([[S("a", 0), S("b", 0), S("c", 0)]], looks, reads, frames, origin);
    expect(p.dirDeg).toBeNull(); expect(p.sizeM).not.toBeNull(); expect(p.rgb).not.toBeNull();
  });
  it("takes one photograph's direction only when it is a clear line", () => {
    const one = (elong: number) => plantLooks([[S("a", 0)]], new Map([["a", looksOf([look(90, 20, elong)])]]), reads, frames, origin)[0];
    expect(one(PLANT_LOOK.loneElong + 0.5).dirDeg).not.toBeNull();
    expect(one(PLANT_LOOK.loneElong - 0.5).dirDeg).toBeNull();
    // Down the photograph is south: bearing 0 (a line has no head: 0 and 180 are one direction).
    const d = one(3).dirDeg!; expect(Math.min(d, 180 - d)).toBeLessThanOrEqual(1);
  });
  it("gives nothing for a plant none of whose marks was measured (a lower-bar candidate, a mark on no green)", () => {
    const looks = new Map([["a", looksOf([[255, 0, 0, 0, 0, 0]])]]);
    expect(plantLooks([[S("a", 0)], [S("a", -1)], []], looks, reads, frames, origin)).toEqual([0, 1, 2].map(() => ({ dirDeg: null, shape: 1, sizeM: null, rgb: null })));
  });
});

describe("the looks packed for the twin", () => {
  it("come back as they went in, to two degrees, half a centimetre and a few levels of colour", () => {
    const L = [{ dirDeg: 91, shape: 0 as const, sizeM: 0.123, rgb: [70, 96, 44] as [number, number, number] }, { dirDeg: 178.9, shape: 1 as const, sizeM: 0.08, rgb: [0, 0, 0] as [number, number, number] }, { dirDeg: null, shape: 1 as const, sizeM: null, rgb: null }];
    const P = packLooks(L), U = unpackLooks(P, 3)!;
    expect(P.version).toBe(1);
    expect((U.dir[0] % 90) * 2).toBe(92); expect(U.dir[0] >= 90).toBe(false);
    expect(U.dir[1] >= 90).toBe(true); expect([0, 178]).toContain((U.dir[1] % 90) * 2);
    expect(U.dir[2]).toBe(255); expect(U.size[2]).toBe(0); expect(U.colour[2]).toBe(0);
    expect(U.size[0] / 200).toBeCloseTo(0.125, 3);
    // The colour comes back exactly (2026-11-23: three bytes a plant beside the 5-6-5 colour).
    expect(U.fine).toBe(true);
    expect(lookRgb(U.colour[0])).toEqual([70, 96, 44]);
    // A measured black still reads as a colour (0 means none).
    expect(U.colour[1]).not.toBe(0);
  });
  it("open as they always did on a twin built before the finer colour, and when the finer colour is not these plants'", () => {
    const L = [{ dirDeg: 91, shape: 0 as const, sizeM: 0.123, rgb: [70, 96, 44] as [number, number, number] }, { dirDeg: null, shape: 1 as const, sizeM: null, rgb: null }];
    const P = packLooks(L), { rgb: _fine, ...old } = P;
    void _fine;
    for (const twin of [old, { ...P, rgb: "AAAA" }, { ...P, rgb: "***" }]) {
      const U = unpackLooks(twin, 2)!;
      expect(U.fine).toBe(false);
      // The middle of each 5-6-5 step, as the views drew it before: within a few levels of what was measured.
      expect(lookRgb(U.colour[0])).toEqual([(70 >> 3) * 8 + 4, (96 >> 2) * 4 + 2, (44 >> 3) * 8 + 4]);
      expect(U.colour[1]).toBe(0);
    }
    // The 5-6-5 colour is still written: the app as it was before reads only that.
    expect(atob(P.colour).length).toBe(4); expect(atob(P.rgb!).length).toBe(6);
  });
  it("keep two plants apart that the 5-6-5 colour stored as one", () => {
    // A dark seedling and one a little yellower (red 68 against 71): one step of red in five bits holds both.
    const P = packLooks([{ dirDeg: null, shape: 1, sizeM: 0.1, rgb: [68, 66, 36] }, { dirDeg: null, shape: 1, sizeM: 0.1, rgb: [71, 66, 36] }]);
    const { rgb: _f, ...old } = P; void _f;
    const before = unpackLooks(old, 2)!, now = unpackLooks(P, 2)!;
    expect(before.colour[0]).toBe(before.colour[1]);
    expect(lookRgb(now.colour[0])[0]).toBe(68); expect(lookRgb(now.colour[1])[0]).toBe(71);
  });
  it("are refused when they are not this twin's plants", () => {
    const P = packLooks([{ dirDeg: 10, shape: 0, sizeM: 0.1, rgb: [1, 2, 3] }]);
    expect(unpackLooks(P, 2)).toBeNull(); expect(unpackLooks(null, 1)).toBeNull(); expect(unpackLooks({ ...P, version: 2 } as never, 1)).toBeNull(); expect(unpackLooks({ ...P, dir: "***" }, 1)).toBeNull();
  });
});

describe("the drawn line and the plants' own tints", () => {
  it("draws a measured plant as two opposed leaves along its line, a third beside it past a small seedling, a second pair when fuller", () => {
    const small = lineLeaves(0.06, 0, false), line = lineLeaves(0.12, 0, false), full = lineLeaves(0.12, 1, false), flipped = lineLeaves(0.12, 0, true);
    expect(small.map(l => l.angle)).toEqual([0, Math.PI]);
    expect(line).toHaveLength(3); expect(Math.abs(line[2].angle)).toBeLessThan(0.5);
    expect(full).toHaveLength(4);
    expect(flipped[0].angle).toBe(Math.PI); expect(flipped[0].length).toBe(1);
  });
  it("cuts the plants' own colours into a few tints by brightness, and leaves the others alone", () => {
    const colour = Uint16Array.from([0, 0x2104, 0x4208, 0x630c, 0x8410, 0xa514]);
    const T = plantOwnTints(colour, lookRgb, k => k !== 5, 2);
    expect(T.palette).toHaveLength(2);
    expect(Array.from(T.plant)).toEqual([255, 0, 0, 1, 1, 255]);
    expect(T.palette[0][1]).toBeLessThan(T.palette[1][1]);
    expect(plantOwnTints(new Uint16Array(3), lookRgb, () => true).palette).toEqual([]);
    expect(CORN_RENDER.lookRotations * 15).toBe(180);
  });
});

describe("which photographs marked each plant", () => {
  it("comes back from the record plant by plant", () => {
    const plants = [[{ photo: "A", u: 10.4, v: 20.6 }, { photo: "B", u: 4000, v: 3000 }], [], [{ photo: "B", u: 1, v: 2 }]];
    const P = packPlantMarks(plants), read = plantMarksReader(JSON.parse(JSON.stringify(P)))!;
    expect(P.photos).toEqual(["A", "B"]);
    expect(read(0)).toEqual([{ photo: "A", u: 10, v: 21 }, { photo: "B", u: 4000, v: 3000 }]);
    expect(read(1)).toEqual([]); expect(read(2)).toEqual([{ photo: "B", u: 1, v: 2 }]);
    expect(read(3)).toEqual([]); expect(read(-1)).toEqual([]);
  });
  it("is not read from a record that does not carry it, or a broken one", () => {
    expect(plantMarksReader(undefined)).toBeNull(); expect(plantMarksReader({ version: 2 } as never)).toBeNull();
    expect(plantMarksReader({ version: 1, photos: ["A"], start: "***", marks: "" })).toBeNull();
  });
});
