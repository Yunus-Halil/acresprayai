// Plots saved on this device (2026-11-24, his ask: "make sure the saving for those plots works"): what is saved comes
// back exactly, its colour too; each twin keeps its own; a bad entry is left out, never the rest.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlots, nextPlotNumber, savePlots } from "@/lib/fieldTwin/plotStore";
import type { Plot } from "@/lib/fieldTwin/plots";

const ring: Plot["ring"] = [[31.581, -83.586], [31.581, -83.585], [31.5805, -83.585], [31.5805, -83.586]];
const plot = (n: number, colour: string, extra: Partial<Plot> = {}): Plot => ({ uid: `p${n}`, number: n, name: `Plot ${n}`, colour, ring, shape: { tool: "polygon" }, at: "2026-11-24T10:00:00.000Z", updatedAt: "2026-11-24T10:00:00.000Z", ...extra });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("plots saved on this device", () => {
  it("come back exactly as saved: name, colour (purple too), corners and the tool that drew them", () => {
    const box = { lat: 31.58, lng: -83.586, dirDeg: 19.97, a0: 0, a1: 9.1, c0: 0, c1: 3.6 };
    const saved = [plot(1, "#ba68c8", { name: "UMD Plot" }), plot(2, "#4fc3f7", { shape: { tool: "rows", box, rows: 4 } }), plot(3, "#81c784", { shape: { tool: "rectangle", box } })];
    expect(savePlots("field-2026-04-17", saved)).toBe(true);
    expect(loadPlots("field-2026-04-17")).toEqual(saved);
  });
  it("keep a colour that was edited after the first save", () => {
    savePlots("t", [plot(1, "#f5d547")]);
    savePlots("t", loadPlots("t").map(p => ({ ...p, colour: "#ba68c8" })));
    expect(loadPlots("t")[0].colour).toBe("#ba68c8");
  });
  it("are each twin's own", () => {
    savePlots("a", [plot(1, "#ba68c8")]);
    expect(loadPlots("b")).toEqual([]);
    expect(loadPlots("a")).toHaveLength(1);
  });
  it("leave out only an unreadable entry, and come back in number order", () => {
    localStorage.setItem("swathwise:twin-plots:t", JSON.stringify({ version: 1, plots: [plot(2, "#ba68c8"), { uid: "x", number: 9, name: "broken", ring: [[1, 2]] }, plot(1, "#4fc3f7")] }));
    expect(loadPlots("t").map(p => p.number)).toEqual([1, 2]);
    expect(nextPlotNumber(loadPlots("t"))).toBe(3);
  });
  it("say so when the browser blocks storage, and open as none when it cannot be read", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(savePlots("t", [plot(1, "#ba68c8")])).toBe(false);
    vi.restoreAllMocks();
    localStorage.setItem("swathwise:twin-plots:t", "{not json");
    expect(loadPlots("t")).toEqual([]);
  });
});
