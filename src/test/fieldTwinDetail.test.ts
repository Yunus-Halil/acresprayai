// The detail dial: three distinct stops, recognised back from their layers, and the one rule behind the count
// badges (a badge summarises findings only where they are not drawn as themselves).
import { describe, expect, it } from "vitest";
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
