// The dark-leaf rule of the seedling mask (seedlingGreen.ts, 2026-11-12). The first flight of someone else's corn
// (olive V1-V2 seedlings on pale sand) showed leaves about 66 grey levels darker than the soil beside them; the
// shipped mask compared absolute tint, which shrinks with brightness, and passed 0.04 % of the leaf pixels. The rule
// compares the tint at the soil's brightness. It only adds: every pixel corn-v1.0's mask keeps is kept, and a stand
// of pale seedlings (the stands the mask was made on) reads exactly as before.
import { describe, expect, it } from "vitest";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { SEEDLING_GREEN, SEEDLING_RELAXED, SEEDLING_V1, seedlingCache, seedlingMask } from "@/lib/rowCrop/seedlingGreen";
import { GREEN_POINTS, plantPointsFromGreen } from "@/lib/rowCrop/greenPoints";
import type { AdaptiveRead } from "@/lib/rowCrop/adaptive";
import { cornV1PlantPoints } from "@/lib/rowCrop/cornV1";

/** Soil with brightness noise, a 3 x 3 seedling of one colour every 16 px on rows 76 px apart. Returns the seedling pixels too. */
function stand(soil: [number, number, number], leaf: [number, number, number], seed = 5): { px: PhotoPixels; leafPx: number[] } {
  const W = 1200, H = 900, rgba = new Uint8ClampedArray(W * H * 4), leafPx: number[] = [];
  let s = seed; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H; i++) { const n = (rnd() - 0.5) * 24; rgba[i * 4] = soil[0] + n; rgba[i * 4 + 1] = soil[1] + n; rgba[i * 4 + 2] = soil[2] + n; rgba[i * 4 + 3] = 255; }
  for (let x = 30; x < W - 2; x += 76) for (let y = 10; y < H - 2; y += 16) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = (y + dy) * W + x + dx, o = i * 4; rgba[o] = leaf[0]; rgba[o + 1] = leaf[1]; rgba[o + 2] = leaf[2]; leafPx.push(i); }
  return { px: { width: W, height: H, rgba }, leafPx };
}
const share = (mask: Uint8Array, idx: number[]) => idx.filter(i => mask[i]).length / idx.length;

describe("the seedling mask on leaves darker than their soil", { timeout: 60_000 }, () => {
  // Pale sand (brightness 172, tint 5) and an olive leaf (brightness 105, tint 20): 15 levels of tint over the soil,
  // under strongTint; at the soil's brightness the same leaf shows 33.
  const dark = stand([185, 170, 145], [100, 112, 84]);
  // The stand the mask was made on: a leaf lighter and far greener than its soil.
  const pale = stand([128, 108, 88], [70, 150, 55]);

  it("finds dark leaves corn-v1.0's mask cannot see, and marks no soil for it", () => {
    const v1 = seedlingMask(dark.px, SEEDLING_V1), now = seedlingMask(dark.px, SEEDLING_GREEN);
    expect(share(v1, dark.leafPx)).toBeLessThan(0.02);
    expect(share(now, dark.leafPx)).toBeGreaterThan(0.98);
    const leaf = new Set(dark.leafPx);
    let soilMarked = 0; for (let i = 0; i < now.length; i++) if (now[i] && !leaf.has(i)) soilMarked++;
    expect(soilMarked / (now.length - leaf.size)).toBeLessThan(0.001);
  });

  it("only adds: every pixel corn-v1.0's mask keeps is kept, and pale seedlings read exactly as before", () => {
    for (const st of [dark, pale]) { const v1 = seedlingMask(st.px, SEEDLING_V1), now = seedlingMask(st.px, SEEDLING_GREEN); for (let i = 0; i < v1.length; i++) if (v1[i] && !now[i]) throw new Error(`pixel ${i} lost`); }
    expect(Buffer.from(seedlingMask(pale.px, SEEDLING_GREEN)).equals(Buffer.from(seedlingMask(pale.px, SEEDLING_V1)))).toBe(true);
    expect(share(seedlingMask(pale.px, SEEDLING_GREEN), pale.leafPx)).toBeGreaterThan(0.98);
  });

  it("locates the dark stand's plants for Corn V1's plant read, where the shipped mask located none", () => {
    const planted = dark.leafPx.length / 9;
    expect(plantPointsFromGreen(dark.px, GREEN_POINTS, seedlingCache(dark.px, SEEDLING_V1)).points.length).toBeLessThan(0.02 * planted);
    const now = plantPointsFromGreen(dark.px, GREEN_POINTS, seedlingCache(dark.px)).points.length;
    expect(now).toBeGreaterThan(0.95 * planted);
    expect(now).toBeLessThan(1.05 * planted);
  });

  it("is kept from Corn V1's plant read where the green read reads bands or a canopy and no seedling stand", () => {
    const planted = dark.leafPx.length / 9;
    const green = (...plans: [string, number][]) => ({ plans: plans.map(([stage, ownedShare]) => ({ stage, ownedShare })) }) as unknown as AdaptiveRead;
    // A seedling stand, a frame the green read took for bare soil (where dark seedlings go unseen), a sliver of bands: the rule applies.
    for (const g of [green(["emergence", 0.6]), green(), green(["establishment", 0.03]), green(["emergence", 0.3], ["mid", 0.5])]) expect(cornV1PlantPoints(dark.px, g, seedlingCache(dark.px)).length).toBeGreaterThan(0.95 * planted);
    // Bands or a canopy over the frame and no seedling stand: the plant read keeps corn-v1.0's mask.
    for (const g of [green(["establishment", 0.8]), green(["mid", 0.7]), green(["late", 0.5]), green(["establishment", 0.1], ["mid", 0.15])]) expect(cornV1PlantPoints(dark.px, g, seedlingCache(dark.px)).length).toBeLessThan(0.02 * planted);
    // The baseline never uses the rule, whatever the green read found.
    expect(cornV1PlantPoints(dark.px, green(["emergence", 0.6]), seedlingCache(dark.px, SEEDLING_V1)).length).toBeLessThan(0.02 * planted);
  });

  it("is off in the narrow second looks, which were chosen and measured without it", () => {
    expect(SEEDLING_RELAXED.dark).toBeNull();
    expect(SEEDLING_V1.dark).toBeNull();
    expect(SEEDLING_GREEN.dark).toEqual({ strongTint: 24, weakTint: 15, maxGain: 2.5, minL: 40 });
  });
});
