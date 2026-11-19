// CORES-2 (2026-11-18): a vivid core on no piece of green starts a mark only when asked (CoresAsked.startOnNoGreen,
// LAYERS.coresStartOnNoGreen, off by default), and only at or over the strength asked.
import { describe, expect, it } from "vitest";
import { coresAsked } from "@/lib/fieldTwin/layers/l1Views";
import { LAYERS } from "@/lib/fieldTwin/layers/options";
import { GREEN_POINTS, plantPointsFromGreen } from "@/lib/rowCrop/greenPoints";

// A 400 x 300 photograph of soil with twelve green discs; the mask the plant read uses holds the first eleven only, so the
// twelfth is green to the cores view but on no piece of the mask.
const W = 400, H = 300, R = 6;
const centres: [number, number][] = Array.from({ length: 12 }, (_, i) => [40 + (i % 6) * 60, 80 + Math.floor(i / 6) * 140]);
function photo() {
  const rgba = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 150; rgba[i * 4 + 1] = 135; rgba[i * 4 + 2] = 110; rgba[i * 4 + 3] = 255; }
  centres.forEach(([cx, cy], k) => { for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) { if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue; const q = (y * W + x) * 4; rgba[q] = 50; rgba[q + 1] = 160; rgba[q + 2] = 40; if (k < 11) mask[y * W + x] = 1; } });
  const px = { width: W, height: H, rgba };
  return { px, cache: { px, mask } };
}
const asked = (start: number | null) => ({ finePx: 3, widePx: 12, share: 0.15, reference: "marks" as const, factor: 0.4, ...(start != null ? { startOnNoGreen: start } : {}) });
const o = { ...GREEN_POINTS, workLongSide: 400 };

describe("a core on no green", () => {
  it("is never a mark when the option is off", () => {
    const { px, cache } = photo(), G = plantPointsFromGreen(px, o, cache, asked(null));
    expect(G.points.length).toBe(11);
    expect(G.coresInfo!.kept.some(k => k.where === "none")).toBe(true);
  });
  it("starts a mark at or over the strength asked, and only then", () => {
    const { px, cache } = photo(), on = plantPointsFromGreen(px, o, cache, asked(0.5));
    expect(on.points.length).toBe(12);
    const [x, y] = centres[11], last = on.points[11];
    expect(Math.hypot(last.x - x, last.y - y)).toBeLessThan(3);
    expect(on.foundBy![11]).toBe(2);
    const fresh = photo(), tooHigh = plantPointsFromGreen(fresh.px, o, fresh.cache, asked(50));
    expect(tooHigh.points.length).toBe(11);
  });
  it("L1 asks it only when the option is set", () => {
    expect(coresAsked(200, "marks")!.startOnNoGreen).toBeUndefined();
    const was = LAYERS.coresStartOnNoGreen; LAYERS.coresStartOnNoGreen = 0.8;
    try { expect(coresAsked(200, "marks")!.startOnNoGreen).toBe(0.8); } finally { LAYERS.coresStartOnNoGreen = was; }
  });
});
