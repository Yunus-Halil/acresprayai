// The full-resolution seedling pass: thin small plants standing alone on soil are found; corn leaves (thick) and the
// pieces joined to them are not.
import { describe, expect, it } from "vitest";
import { fineSeedlings } from "@/lib/rowCrop/fineSeedlings";

function scene() {
  const W = 400, H = 300, rgba = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, c: [number, number, number]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const n = ((x * 7 + y * 13) % 9) - 4; put(x, y, [95 + n, 92 + n, 80 + n]); }
  const leaf: [number, number, number] = [70, 150, 50];
  // A corn leaf: 40 px long, 14 px wide (7 cm at 0.5 cm), with a thin tip joined to it.
  for (let y = 100; y < 114; y++) for (let x = 40; x < 140; x++) put(x, y, leaf);
  for (let x = 140; x < 160; x++) put(x, 106, leaf);
  // Grass seedlings: three thin blades, 1 to 2 px wide, pale green, on open soil.
  const sprout = (cx: number, cy: number) => { for (let k = -6; k <= 6; k++) { put(cx + k, cy, [170, 205, 130]); put(cx, cy + k, [170, 205, 130]); put(cx + k, cy + k, [170, 205, 130]); } };
  sprout(260, 60); sprout(300, 220); sprout(220, 160);
  // A sprout touching the leaf's edge: not judged (a leaf piece and a seedling look alike there).
  sprout(90, 120);
  return { width: W, height: H, rgba };
}

describe("fine seedlings", () => {
  it("finds thin plants alone on the soil and leaves the corn and what touches it", () => {
    const { seedlings } = fineSeedlings(scene(), 0.005, () => true);
    const near = (x: number, y: number) => seedlings.some(s => Math.hypot(s.x - x, s.y - y) < 6);
    expect(near(260, 60)).toBe(true);
    expect(near(300, 220)).toBe(true);
    expect(near(220, 160)).toBe(true);
    expect(near(90, 120)).toBe(false);
    expect(seedlings.every(s => !(s.y >= 95 && s.y <= 118 && s.x >= 35 && s.x <= 165))).toBe(true);
  });

  it("judges only where it is told to", () => {
    const { seedlings } = fineSeedlings(scene(), 0.005, x => x < 250);
    expect(seedlings.every(s => s.x < 250)).toBe(true);
  });
});
