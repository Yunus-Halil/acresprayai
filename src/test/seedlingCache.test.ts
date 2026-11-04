// The shared seedling mask (seedlingGreen.ts SeedlingCache, 2026-11-05): computed once per photograph and read by both
// the emergence reader and Corn V1's plant read. It must answer only for its own photograph, and Corn V1 with it must
// give exactly corn-v1.0's output (where each read computed the mask itself).
import { describe, expect, it } from "vitest";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { SEEDLING_GREEN, seedlingCache, seedlingMask, sharedSeedlingMask, sharedSoilLevels, soilLevels } from "@/lib/rowCrop/seedlingGreen";
import { readCornAdaptive } from "@/lib/rowCrop/adaptive";
import { fuseCornV1, readCornV1 } from "@/lib/rowCrop/cornV1";
import { plantPointsFromGreen } from "@/lib/rowCrop/greenPoints";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import { cropProfileFor } from "@/lib/cropProfiles/registry";
import { compactCornRead } from "@/lib/fieldTwin/cornField";

/** Bare soil at 1 cm a pixel, a 2 cm seedling every 16 cm on rows 76 cm apart (the emergence tests' stand). */
function seedlingStand(seed = 11): PhotoPixels {
  const W = 1600, H = 1200, rgba = new Uint8ClampedArray(W * H * 4);
  let s = seed; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H; i++) { const n = (rnd() - 0.5) * 24; rgba[i * 4] = 128 + n; rgba[i * 4 + 1] = 108 + n; rgba[i * 4 + 2] = 88 + n; rgba[i * 4 + 3] = 255; }
  for (let x = 30; x < W; x += 76) for (let y = 8 + rnd() * 8; y < H; y += 16) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.round(x + (rnd() - 0.5) * 2) + dx, yy = Math.round(y) + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = (yy * W + xx) * 4; rgba[o] = 70; rgba[o + 1] = 150; rgba[o + 2] = 55; }
  return { width: W, height: H, rgba };
}

describe("the shared seedling mask", { timeout: 60_000 }, () => {
  const px = seedlingStand(), other = seedlingStand(29);

  it("computes once per photograph, the same as computing it directly, and never answers for another photograph", () => {
    const cache = seedlingCache(px);
    const m1 = sharedSeedlingMask(cache, px), m2 = sharedSeedlingMask(cache, px);
    expect(m2).toBe(m1);
    expect(sharedSoilLevels(cache, px)).toBe(cache.levels);
    expect(Buffer.from(m1).equals(Buffer.from(seedlingMask(px, SEEDLING_GREEN, soilLevels(px, SEEDLING_GREEN))))).toBe(true);
    const mo = sharedSeedlingMask(cache, other);
    expect(mo).not.toBe(m1);
    expect(Buffer.from(mo).equals(Buffer.from(seedlingMask(other, SEEDLING_GREEN)))).toBe(true);
    expect(cache.mask).toBe(m1);
  });

  it("gives Corn V1 exactly corn-v1.0's output on a seedling stand the emergence reader reads", () => {
    const P = rowCropParamsFor(cropProfileFor("corn")!, 0.01);
    const ad = readCornAdaptive(px, P);
    expect(ad.plans.some(p => p.read && p.stage === "emergence")).toBe(true);
    const frozen = fuseCornV1(ad, plantPointsFromGreen(px).points, P, { enteredCrop: "corn", source: "green" });
    const shared = readCornV1(px, P, { enteredCrop: "corn" });
    expect(JSON.stringify(compactCornRead("t", shared))).toBe(JSON.stringify(compactCornRead("t", frozen)));
    expect({ ...shared.summary, ms: null }).toEqual({ ...frozen.summary, ms: null });
  });
});
