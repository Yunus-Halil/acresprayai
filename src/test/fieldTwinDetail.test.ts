// The detail dial: three distinct stops, recognised back from their layers, and the one rule behind the count
// badges (a badge summarises findings only where they are not drawn as themselves).
import { describe, expect, it } from "vitest";
import { HEAT_STOPS, buildHeatRaster, heatColour, heatScaleFor } from "@/lib/fieldTwin/heatmap";
import { fieldIntelligence } from "@/lib/fieldTwin/intelligence";
import { syntheticTwin } from "@/lib/fieldTwin/synthetic";
import { DEFAULT_LAYERS, DETAIL_PRESETS, DETAIL_STOPS, badgesAllowed, detailOf } from "@/lib/fieldTwin/style";

describe("detail dial", () => {
  it("has three distinct stops, each recognised from its layers, and Simple is the default", () => {
    for (const stop of DETAIL_STOPS) expect(detailOf(DETAIL_PRESETS[stop])).toBe(stop);
    expect(detailOf(DEFAULT_LAYERS)).toBe("simple");
    expect(new Set(DETAIL_STOPS.map(s => JSON.stringify(DETAIL_PRESETS[s]))).size).toBe(3);
  });
  it("Simple draws the pressure and the emphasised findings but no crowns, discs or other vegetation; Full draws everything", () => {
    const s = DETAIL_PRESETS.simple, f = DETAIL_PRESETS.full;
    expect(s.pressure && s.zones && s.weeds && s.structure).toBe(true);
    expect(s.crowns || s.clusters || s.vegetation).toBe(false);
    expect(s.markers).toBe("emphasised");
    expect(f.crowns && f.clusters && f.vegetation).toBe(true);
    expect(f.markers).toBe("all");
    expect(DETAIL_PRESETS.standard.markers).toBe("summary");
  });
  it("a layer toggled by hand turns the dial to Custom", () => {
    expect(detailOf({ ...DETAIL_PRESETS.simple, crowns: true })).toBe("custom");
    expect(detailOf({ ...DETAIL_PRESETS.full, clusters: false })).toBe("custom");
    // Full with summary markers is exactly Standard: the dial says so.
    expect(detailOf({ ...DETAIL_PRESETS.full, markers: "summary" })).toBe("standard");
  });
  it("count badges only where the findings are not drawn as themselves; Full always, Simple never", () => {
    expect(badgesAllowed("summary", false)).toBe(true);
    expect(badgesAllowed("summary", true)).toBe(false);
    expect(badgesAllowed("all", true)).toBe(true);
    expect(badgesAllowed("emphasised", false)).toBe(false);
  });
});

describe("heat scale set by the field", () => {
  const fixed = HEAT_STOPS.map(st => st.pct);
  it("a clean field keeps the fixed bands: no red spot is invented", () => {
    const intel = fieldIntelligence(syntheticTwin({ weeds: 300, seed: 3, density: 0.05 }));
    const sc = heatScaleFor(intel, "field");
    expect(sc.quantiles![3]).toBeLessThan(fixed[4]);
    expect(sc.stops).toEqual(fixed);
    expect(sc.stretched).toBe(false);
    expect(heatScaleFor(intel, "fixed").stops).toEqual(fixed);
  });
  it("a saturated field raises the stops to its own percentiles, strictly increasing, never below the fixed bands", () => {
    const intel = fieldIntelligence(syntheticTwin({ weeds: 200000, seed: 7, density: 2 }));
    const sc = heatScaleFor(intel, "field");
    expect(sc.quantiles![3]).toBeGreaterThan(fixed[4]);
    expect(sc.stretched).toBe(true);
    for (let i = 1; i < sc.stops.length; i++) { expect(sc.stops[i]).toBeGreaterThanOrEqual(fixed[i]); expect(sc.stops[i]).toBeGreaterThan(sc.stops[i - 1]); }
    expect(sc.stops[4]).toBeCloseTo(Math.round(sc.quantiles![3] * 10) / 10, 6);
    // The worst 1 % of the block's observed ground is red, the median ground is the first colour: the field reads as spots.
    const fine = buildHeatRaster(intel, intel.grid.cellM, sc)!, fixedRaster = buildHeatRaster(intel, intel.grid.cellM)!;
    const red = (r: typeof fine) => { let n = 0; for (let o = 0; o < r.data.length; o += 4) if (r.data[o] === HEAT_STOPS[4].rgb[0] && r.data[o + 1] === HEAT_STOPS[4].rgb[1] && r.data[o + 3] > 0) n++; return n; };
    expect(red(fine)).toBeLessThan(fine.painted * 0.03);
    expect(red(fixedRaster)).toBeGreaterThan(3 * red(fine));
    expect(heatColour(sc.stops[4], sc.stops)).toEqual(heatColour(100));
    expect(heatColour(sc.stops[0], sc.stops)).toEqual(heatColour(0));
  });
});
