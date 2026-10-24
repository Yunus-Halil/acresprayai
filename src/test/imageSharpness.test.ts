// The edge-width measure the resolution audit rests on, checked against edges of known blur: a step blurred by a
// Gaussian of sigma s has a 10-90% rise of 2.563 s.
import { describe, expect, it } from "vitest";
import { type Gray, edgeWidthPx } from "@/lib/imageSharpness";

/** Stripes 32 px wide at a slant, blurred by a Gaussian of sigma s (sampled finely, so the step is exact). */
function blurredStripes(sigma: number, size = 256): Gray {
  const data = new Float32Array(size * size);
  const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x * 0.97 + y * 0.24, p = ((u % 64) + 64) % 64;
    // Signed distance to the nearest edge, positive inside the bright stripe [32, 64).
    const e = Math.min(Math.abs(p - 32), p, 64 - p), signed = p >= 32 ? e : -e;
    const v = 0.5 * (1 + erf(signed / (sigma * Math.SQRT2)));
    data[y * size + x] = 100 * v;
  }
  return { width: size, height: size, data };
}

describe("edgeWidthPx", () => {
  for (const sigma of [0.8, 1.2, 2]) {
    it(`reads a sigma ${sigma} edge as about ${(2.563 * sigma).toFixed(2)} px`, () => {
      const r = edgeWidthPx(blurredStripes(sigma));
      expect(r).not.toBeNull();
      expect(r!.widthPx).toBeGreaterThan(2.563 * sigma - 0.6);
      expect(r!.widthPx).toBeLessThan(2.563 * sigma + 0.6);
    });
  }

  it("widens monotonically with blur and refuses an image with no edges", () => {
    const w = [0.8, 1.2, 2].map(s => edgeWidthPx(blurredStripes(s))!.widthPx);
    expect(w[0]).toBeLessThan(w[1]);
    expect(w[1]).toBeLessThan(w[2]);
    expect(edgeWidthPx({ width: 64, height: 64, data: new Float32Array(64 * 64).fill(50) })).toBeNull();
  });
});
