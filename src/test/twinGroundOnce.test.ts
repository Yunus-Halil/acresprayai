// The twin's ground painted once (2026-11-23): the two questions a frame asks before it skips the layers underneath.
import { describe, expect, it } from "vitest";
import { coveredAll, rectInRing } from "@/components/app/fieldTwin/TwinCanvasLayer";

/** A grid of gw x gh squares of one unit from (0, 0), `ok` saying which are wholly photographed (with their neighbours). */
function grid(gw: number, gh: number, ok: (i: number, j: number) => boolean) {
  const sat = new Int32Array((gw + 1) * (gh + 1));
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) sat[(j + 1) * (gw + 1) + i + 1] = (ok(i, j) ? 1 : 0) + sat[j * (gw + 1) + i + 1] + sat[(j + 1) * (gw + 1) + i] - sat[j * (gw + 1) + i];
  return { x0: 0, y0: 0, x1: gw, y1: gh, gw, gh, cellX: 1, cellY: 1, sat };
}

describe("is the whole canvas on photographed ground?", () => {
  // Photographed everywhere but one square at (6, 3).
  const G = grid(10, 8, (i, j) => !(i === 6 && j === 3));
  it("says yes only when every square under the rectangle is", () => {
    expect(coveredAll(G, 0.2, 0.2, 5.8, 7.9)).toBe(true);
    expect(coveredAll(G, 7.1, 0, 10, 8)).toBe(true);
    expect(coveredAll(G, 5.5, 2.5, 6.5, 3.5)).toBe(false);
    // Touching the square by a hair is enough to say no.
    expect(coveredAll(G, 2, 3.5, 6.01, 3.6)).toBe(false);
    expect(coveredAll(G, 2, 3.5, 5.99, 3.6)).toBe(true);
  });
  it("says no for a rectangle that leaves the photographs' box, or an empty one", () => {
    expect(coveredAll(G, -0.1, 1, 3, 2)).toBe(false);
    expect(coveredAll(G, 1, 1, 10.1, 2)).toBe(false);
    expect(coveredAll(G, 3, 3, 3, 4)).toBe(false);
  });
});

describe("is the whole canvas inside the block?", () => {
  const ring = (pts: number[][]) => Float64Array.from(pts.flat());
  const square = ring([[0, 0], [10, 0], [10, 10], [0, 10]]);
  // An L: the square without its upper right quarter.
  const ell = ring([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]);
  it("says yes for a rectangle wholly inside", () => {
    expect(rectInRing(square, 1, 1, 9, 9)).toBe(true);
    expect(rectInRing(ell, 1, 1, 4, 9)).toBe(true);
    expect(rectInRing(ell, 1, 1, 9, 4)).toBe(true);
  });
  it("says no when a corner is outside, or an edge of the block runs through it", () => {
    expect(rectInRing(square, 5, 5, 11, 9)).toBe(false);
    expect(rectInRing(square, -1, -1, 11, 11)).toBe(false);
    // All four corners inside the L, its notch reaching in between them.
    const notch = ring([[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]]);
    expect(rectInRing(notch, 1, 1, 9, 3)).toBe(true);
    expect(rectInRing(notch, 1, 1, 9, 9)).toBe(false);
    expect(rectInRing(notch, 3, 2, 7, 6)).toBe(false);
    expect(rectInRing(ell, 4, 4, 6, 6)).toBe(false);
  });
});
