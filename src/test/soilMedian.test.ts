// The soil levels' 9 x 9 median (seedlingGreen.ts medianGrid), by selection since 2026-11-05, must return exactly what
// corn-v1.0's full sort returned: the same element, NaN where a window holds no value, on every grid shape.
import { describe, expect, it } from "vitest";
import { medianGrid } from "@/lib/rowCrop/seedlingGreen";

/** corn-v1.0's median, verbatim. */
function medianGridFrozen(v: Float32Array, w: number, h: number, win: number): Float32Array {
  const out = new Float32Array(w * h), r = win >> 1, buf: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    buf.length = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { const q = v[yy * w + xx]; if (Number.isFinite(q)) buf.push(q); }
    if (!buf.length) { out[y * w + x] = NaN; continue; }
    buf.sort((a, b) => a - b); out[y * w + x] = buf[buf.length >> 1];
  }
  return out;
}

const bytes = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

describe("the soil median", () => {
  it("is bit for bit corn-v1.0's on grids with gaps, ties, edges and every window size", () => {
    let s = 3; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const [w, h, win] of [[41, 29, 9], [7, 3, 9], [1, 1, 9], [2, 50, 9], [60, 37, 5], [60, 37, 3], [12, 12, 1], [30, 30, 11]]) {
      for (const style of ["ties", "continuous", "sparse", "constant"]) {
        const v = new Float32Array(w * h);
        for (let i = 0; i < v.length; i++) {
          const gap = rnd() < (style === "sparse" ? 0.8 : 0.1);
          v[i] = gap ? NaN : style === "ties" ? Math.round(rnd() * 8) / 2 : style === "constant" ? 97.5 : 40 + rnd() * 120;
        }
        expect(bytes(medianGrid(v, w, h, win)).equals(bytes(medianGridFrozen(v, w, h, win))), `${w}x${h} win ${win} ${style}`).toBe(true);
      }
    }
  });

  it("gives NaN where a window holds no value", () => {
    const v = new Float32Array(25).fill(NaN);
    expect(Array.from(medianGrid(v, 5, 5, 3)).every(Number.isNaN)).toBe(true);
  });
});
