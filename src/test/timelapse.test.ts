// Timeline maths for the History tab timelapse.
//
// The opacity split is the whole feature: get it wrong and the map either goes
// blank mid-transition or jumps between scans instead of fading.
import { describe, expect, it } from "vitest";
import { TRANSITION_MS, advance, atEnd, crossfade, isPlayable, layerOpacities } from "@/lib/timelapse";

describe("crossfade between the two nearest scans", () => {
  it("shows only the first scan at the start", () => {
    expect(crossfade(0, 3)).toMatchObject({ lower: 0, upper: 1, lowerOpacity: 1, upperOpacity: 0 });
  });

  it("splits evenly at the midpoint", () => {
    expect(crossfade(0.5, 3)).toMatchObject({ lower: 0, upper: 1, lowerOpacity: 0.5, upperOpacity: 0.5 });
  });

  it("splits 70/30 at 30% of the way across", () => {
    const f = crossfade(0.3, 3);
    expect(f.lowerOpacity).toBeCloseTo(0.7, 10);
    expect(f.upperOpacity).toBeCloseTo(0.3, 10);
  });

  it("hands over completely on arrival at the next scan", () => {
    expect(crossfade(1, 3)).toMatchObject({ lower: 1, upper: 2, lowerOpacity: 1, upperOpacity: 0 });
  });

  it("always sums to one, so the map never dips to nothing", () => {
    for (const p of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1, 1.5, 2]) {
      const f = crossfade(p, 3);
      expect(f.lowerOpacity + f.upperOpacity).toBeCloseTo(1, 10);
    }
  });

  it("clamps rather than wrapping past either end", () => {
    expect(crossfade(-5, 3)).toMatchObject({ lower: 0, lowerOpacity: 1 });
    expect(crossfade(99, 3)).toMatchObject({ lower: 2, upper: 2, lowerOpacity: 1 });
  });
});

describe("layerOpacities", () => {
  it("gives every other scan zero, so only two layers are ever drawn", () => {
    expect(layerOpacities(0, 4)).toEqual([1, 0, 0, 0]);
    expect(layerOpacities(2.5, 4)).toEqual([0, 0, 0.5, 0.5]);
    expect(layerOpacities(3, 4)).toEqual([0, 0, 0, 1]);
  });

  it("does not double up the last scan at the end of the timeline", () => {
    // lower and upper collapse onto the same index there; adding both would
    // set opacity 1 twice and, worse, hide the bug behind a correct-looking
    // final frame.
    const o = layerOpacities(2, 3);
    expect(o).toEqual([0, 0, 1]);
    expect(o.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("is all zero when there is nothing to play", () => {
    expect(layerOpacities(0, 0)).toEqual([]);
  });
});

describe("playback", () => {
  it("takes one transition-length per scan at 1x", () => {
    expect(advance(0, 3, TRANSITION_MS, 1)).toBeCloseTo(1, 10);
  });

  it("covers twice the ground at 2x", () => {
    expect(advance(0, 3, TRANSITION_MS, 2)).toBeCloseTo(2, 10);
  });

  it("stops at the last scan instead of looping", () => {
    expect(advance(2.9, 3, TRANSITION_MS * 10, 1)).toBe(2);
    expect(advance(2, 3, TRANSITION_MS, 1)).toBe(2);
  });

  it("goes nowhere with a single scan", () => {
    expect(advance(0, 1, TRANSITION_MS, 1)).toBe(0);
  });

  it("knows when it has finished", () => {
    expect(atEnd(0, 3)).toBe(false);
    expect(atEnd(2, 3)).toBe(true);
    expect(atEnd(0, 1)).toBe(true);
  });
});

describe("which scans can be frames", () => {
  const base = { status: "completed", tiles_baked: true, odm_uuid: "uuid-1" };

  it("accepts a completed, fully baked scan", () => {
    expect(isPlayable(base)).toBe(true);
  });

  it.each([
    ["still processing", { ...base, status: "processing" }],
    ["failed", { ...base, status: "failed" }],
    ["tiles not baked", { ...base, tiles_baked: false }],
    ["tiles unknown", { ...base, tiles_baked: null }],
    ["no odm uuid to build a tile URL from", { ...base, odm_uuid: null }],
  ])("rejects a scan that is %s, rather than fading to an empty frame", (_label, scan) => {
    expect(isPlayable(scan)).toBe(false);
  });
});
