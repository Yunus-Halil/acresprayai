// The review survives leaving the tab, and the archive changes what is
// proposed, not just the order.
import { afterEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("@/lib/weedScout/pipeline", () => ({ runWeedScout: runMock }));

import { defaultVerdict } from "@/components/app/workspace/WeedScoutTab";
import { getSession, patchSession, resetScoutSessions, startRun, stopRun } from "@/lib/weedScout/runStore";
import type { Candidate, ScoutInputs } from "@/lib/weedScout/types";

const plant = (over: Partial<Candidate> = {}): Candidate => ({
  id: "s", tileId: "t", centroid: { lat: 38, lng: -77 }, kind: "off-row vegetation", score: 0.7,
  distanceToRowM: 0.3, rowConfidence: 0.8, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: null, region: null, areaM2: 0.01, feedback: null, estimate: null, chip: null, chipSpanM: null, chipGsdM: null, ...over,
});
const region = (klass: Candidate["region"] extends infer R ? (R extends { klass: infer K } ? K : never) : never, feedback: Candidate["feedback"] = null): Candidate => plant({
  kind: "not-average region", feedback,
  region: { id: "r", tileIds: ["t"], rings: [[]], centroid: { lat: 38, lng: -77 }, areaM2: 50, tileCount: 5, coreTiles: 3, meanStrength: 4, maxStrength: 5, meanFieldZ: [], drivers: [], klass },
});

describe("defaultVerdict", () => {
  it("starts plants and vegetation regions as weeds, ground as unsure", () => {
    expect(defaultVerdict(plant())).toBe("weed");
    expect(defaultVerdict(region("dense vegetation"))).toBe("weed");
    expect(defaultVerdict(region("bare or dry ground"))).toBe("unsure");
    expect(defaultVerdict(plant({ kind: "field outlier" }))).toBe("unsure");
  });
  it("lets the operator's past verdicts override the default", () => {
    const dismissed = { confirmed: 0, dismissed: 4, species: [], factor: 0.4 };
    const confirmed = { confirmed: 4, dismissed: 0, species: [], factor: 1.25 };
    const mixed = { confirmed: 2, dismissed: 2, species: [], factor: 1 };
    expect(defaultVerdict(plant({ feedback: dismissed }))).toBe("not_weed");
    expect(defaultVerdict(region("bare or dry ground", confirmed))).toBe("weed");
    expect(defaultVerdict(plant({ feedback: mixed }))).toBe("weed");
  });
});

describe("runStore", () => {
  afterEach(() => { resetScoutSessions(); runMock.mockReset(); });
  const inputs = { boundary: [], tileUrl: "x", maxNative: 20, params: {} } as unknown as ScoutInputs;

  it("keeps a run going and lands its result without any component alive", async () => {
    let resolve: (v: unknown) => void = () => {};
    runMock.mockImplementation(() => new Promise(r => { resolve = r; }));
    startRun("scan-1", inputs, { context: null, crop: "", growthStage: null, fieldId: null, unitSystem: "metric" });
    expect(getSession("scan-1").running).toBe(true);
    // Nothing subscribed, nothing mounted: the run is untouched.
    resolve({ candidates: [] });
    await Promise.resolve(); await Promise.resolve();
    expect(getSession("scan-1").running).toBe(false);
    expect(getSession("scan-1").result).toEqual({ candidates: [] });
  });

  it("keeps the operator's edits across a remount, and clears them for a new run", () => {
    patchSession("scan-1", { verdicts: { a: "not_weed" }, selectedId: "a" });
    expect(getSession("scan-1").verdicts.a).toBe("not_weed");
    runMock.mockImplementation(() => new Promise(() => {}));
    startRun("scan-1", inputs, { context: null, crop: "", growthStage: null, fieldId: null, unitSystem: "metric" });
    expect(getSession("scan-1").verdicts).toEqual({});
    expect(getSession("scan-1").selectedId).toBeNull();
  });

  it("stops only when asked, and an abort is not an error", async () => {
    runMock.mockImplementation((_i: unknown, opts: { signal: AbortSignal }) => new Promise((_res, rej) => {
      opts.signal.addEventListener("abort", () => { const e = new Error("stopped"); e.name = "Aborted"; rej(e); });
    }));
    startRun("scan-2", inputs, { context: null, crop: "", growthStage: null, fieldId: null, unitSystem: "metric" });
    expect(getSession("scan-2").running).toBe(true);
    stopRun("scan-2");
    await Promise.resolve(); await Promise.resolve();
    expect(getSession("scan-2").running).toBe(false);
    expect(getSession("scan-2").error).toBeNull();
  });

  it("does not start a second run over a live one", () => {
    runMock.mockImplementation(() => new Promise(() => {}));
    startRun("scan-3", inputs, { context: null, crop: "", growthStage: null, fieldId: null, unitSystem: "metric" });
    startRun("scan-3", inputs, { context: null, crop: "", growthStage: null, fieldId: null, unitSystem: "metric" });
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
