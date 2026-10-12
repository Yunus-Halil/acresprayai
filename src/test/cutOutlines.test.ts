// @vitest-environment node
//
// The closer look draws the vegetation's own outlines, classed by the
// pattern's circles, and falls back to circles only when the cut cannot be
// thresholded.
import { describe, expect, it } from "vitest";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { outlinesInCut } from "@/lib/sourceFrames/patternLook";

function scene(W: number, H: number, discs: { x: number; y: number; r: number }[], soil = true, noise = 20): PhotoPixels {
  const rgba = new Uint8ClampedArray(W * H * 4);
  let s = 3;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, n = (rand() - 0.5) * noise;
    let r = soil ? 150 + n : 70 + n, g = soil ? 110 + n : 150 + n, b = soil ? 80 + n : 50 + n;
    for (const d of discs) if ((x + 0.5 - d.x) ** 2 + (y + 0.5 - d.y) ** 2 <= d.r * d.r) { r = 70 + n; g = 150 + n; b = 50 + n; }
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }
  return { width: W, height: H, rgba };
}

describe("outlinesInCut", () => {
  it("traces each plant and gives it the class of the circle that holds its centre, grey when none does", () => {
    const px = scene(300, 200, [{ x: 60, y: 100, r: 20 }, { x: 150, y: 100, r: 12 }, { x: 240, y: 100, r: 8 }]);
    const out = outlinesInCut(px, 0.01, [{ x: 60, y: 100, r: 22, cls: "on pattern" }, { x: 150, y: 100, r: 14, cls: "off-row" }])!;
    expect(out).toHaveLength(3);
    const byX = [...out].sort((a, b) => a.ring[0].x - b.ring[0].x);
    expect(byX[0].cls).toBe("on pattern");
    expect(byX[1].cls).toBe("off-row");
    expect(byX[2].cls).toBeNull();
    expect(byX[0].areaPx).toBeGreaterThan(Math.PI * 400 * 0.9);
    expect(byX[0].areaPx).toBeLessThan(Math.PI * 400 * 1.1);
    for (const o of out) {
      expect(o.ring.length).toBeGreaterThanOrEqual(8);
      expect(o.ring.length).toBeLessThanOrEqual(160);
    }
    // The outline sits on the disc's edge, not at its equivalent radius.
    for (const p of byX[0].ring) expect(Math.hypot(p.x - 60, p.y - 100)).toBeGreaterThan(17);
    for (const p of byX[0].ring) expect(Math.hypot(p.x - 60, p.y - 100)).toBeLessThan(22);
  });

  it("is null on a cut with nothing to threshold, so circles stand in", () => {
    // One class only: bare soil, or closed canopy. (Heavy pixel noise on one class can still split under Otsu; the same floor guards the sizer.)
    expect(outlinesInCut(scene(100, 100, [], true, 4), 0.01, [])).toBeNull();
    expect(outlinesInCut(scene(100, 100, [], false, 4), 0.01, [])).toBeNull();
  });
});
