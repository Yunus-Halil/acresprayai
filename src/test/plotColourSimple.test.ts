// A plot keeps the colour it was saved with in the Simple view (2026-11-24, his report: "I make my plot purple and
// when I save it turns blue").
import { describe, expect, it } from "vitest";
import { simpleOutline } from "@/components/app/fieldTwin/PlotTools";
import { PLOT_COLOURS } from "@/lib/fieldTwin/plots";

describe("a plot's outline in the Simple view", () => {
  it("is drawn in the plot's own colour, every colour the picker offers", () => {
    for (const c of PLOT_COLOURS) expect(simpleOutline(c, false)).toEqual({ stroke: c, weight: 1.5 });
    expect(simpleOutline("#ba68c8", false).stroke).toBe("#ba68c8");
  });
  it("is brighter and thicker when selected, and still the same hue", () => {
    const on = simpleOutline("#ba68c8", true), rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    expect(on.weight).toBe(3);
    const [r, g, b] = rgb(on.stroke), [r0, g0, b0] = rgb("#ba68c8");
    expect(r).toBeGreaterThan(r0); expect(g).toBeGreaterThan(g0); expect(b).toBeGreaterThan(b0);
    // Purple stays purple: blue and red still well above green.
    expect(Math.min(r, b)).toBeGreaterThan(g);
  });
});
