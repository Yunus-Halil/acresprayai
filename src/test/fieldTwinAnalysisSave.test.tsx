// Saving the analysis record (src/lib/fieldTwin/analysis.ts) is apart from saving the twin: the twin is saved and the
// tab is free before the record's upload starts, and whatever that upload does (succeeds, fails, never answers) the
// twin stays saved. As shipped the record is off: no build is asked for one and nothing is uploaded. Orchard builds
// are never asked for one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };
const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); promise.catch(() => undefined); return { promise, resolve, reject }; };
let build: { done: Deferred<unknown>; atlases: Deferred<Map<string, Blob>>; cancel: ReturnType<typeof vi.fn> };
const startTwinBuild = vi.fn((_files: File[], _opts: Record<string, unknown>) => ({ done: build.done.promise, cancel: build.cancel }));
vi.mock("@/lib/fieldTwin/build/runBuild", async orig => ({ ...(await orig<typeof import("@/lib/fieldTwin/build/runBuild")>()), startTwinBuild: (f: File[], o: Record<string, unknown>) => startTwinBuild(f, o) }));

const order: string[] = [];
const updates: Record<string, unknown>[] = [];
const beginSave = vi.fn(async (twin: { id: string }, _ms?: number | null) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "saving" }));
let saveBuiltTwin = vi.fn(async (_user: string, twin: { id: string }) => { order.push("twin saved"); return { id: twin.id, storage_key: twin.id, name: "North", status: "ready" }; });
vi.mock("@/lib/fieldTwin/registry", async orig => ({
  ...(await orig<typeof import("@/lib/fieldTwin/registry")>()),
  beginSave: (t: { id: string }, ms: number | null) => beginSave(t, ms),
  saveBuiltTwin: (...a: unknown[]) => (saveBuiltTwin as unknown as (...x: unknown[]) => unknown)(...a),
}));

let analysisUpload: Deferred<number>;
const saveTwinAnalysis = vi.fn((_user: string, _twinId: string, _json: Blob) => { order.push(`record upload started (session ${getBuildSession().status}, busy ${sessionBusy()})`); return analysisUpload.promise; });
vi.mock("@/lib/fieldTwin/store", async orig => ({ ...(await orig<typeof import("@/lib/fieldTwin/store")>()), saveTwinAnalysis: (u: string, t: string, j: Blob) => saveTwinAnalysis(u, t, j) }));

const tracked: { name: string; f: Record<string, unknown> }[] = [];
vi.mock("@/lib/pilot/telemetry", async orig => ({ ...(await orig<typeof import("@/lib/pilot/telemetry")>()), track: (name: string, f: Record<string, unknown> = {}) => { tracked.push({ name, f }); } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: (u: Record<string, unknown>) => { updates.push(u); return { eq: async () => ({ error: null }) }; } }) } }));

import { __resetBuildSession, __setAnalysisForTests, getBuildSession, retrySave, sessionBusy, startBuildSession } from "@/lib/fieldTwin/buildSession";
import { TWIN_ANALYSIS_ENABLED } from "@/lib/fieldTwin/analysisConfig";

const RECORD = new Blob(['{"format":"swardus-twin-analysis-v1"}'], { type: "application/json" });
const result = (id: string, analysis: Blob | null) => ({
  twin: { id, name: "North", source: { photographs: 3, camera: "DJI FC6310R", capturedAt: null }, atlases: [{ file: "atlas-0.jpg" }] },
  files: new Map<string, Blob>(), report: { totalMs: 61_000, timings: { photographs: 1000 }, photographs: { given: 3, read: 3, refused: [] } },
  atlases: build.atlases.promise, progress: { done: 0, total: 1 }, onAtlas: () => undefined, analysis,
});
const files = [new File(["a"], "DJI_0001.JPG"), new File(["b"], "DJI_0002.JPG"), new File(["c"], "DJI_0003.JPG")];
const flushAll = async () => { for (let k = 0; k < 6; k++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  __resetBuildSession(); tracked.length = 0; order.length = 0; updates.length = 0;
  build = { done: deferred(), atlases: deferred(), cancel: vi.fn() };
  analysisUpload = deferred();
  saveBuiltTwin = vi.fn(async (_user: string, twin: { id: string }) => { order.push("twin saved"); return { id: twin.id, storage_key: twin.id, name: "North", status: "ready" }; });
  startTwinBuild.mockClear(); beginSave.mockClear(); saveTwinAnalysis.mockClear();
});
afterEach(() => { __resetBuildSession(); });

/** A corn build taken to the end of the twin's own save. */
async function builtAndSaved(crop: "corn" | "orchard", analysis: Blob | null) {
  startBuildSession(files, { name: "North", crop, weeds: "colour", userId: "u1" });
  const id = (getBuildSession() as { id: string }).id;
  build.done.resolve(result(id, analysis)); build.atlases.resolve(new Map()); await flushAll();
  return id;
}

describe("as shipped: the record is off", () => {
  it("no build is asked for a record, and nothing is uploaded beside the twin", async () => {
    expect(TWIN_ANALYSIS_ENABLED).toBe(false);
    const id = await builtAndSaved("corn", null);
    // The options are exactly what they were before the record existed.
    expect(startTwinBuild.mock.calls[0][1]).toEqual({ name: "North", id, weeds: "none", helpers: undefined, crop: "corn" });
    expect(getBuildSession().status).toBe("saved");
    expect(saveTwinAnalysis).not.toHaveBeenCalled();
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
  });

  it("a record handed back while it is off is not saved, and the twin is saved the usual way", async () => {
    // Not reachable from the app (an off session never asks for one), but off must mean nothing is stored.
    await builtAndSaved("corn", RECORD);
    expect(getBuildSession().status).toBe("saved");
    expect(saveTwinAnalysis).not.toHaveBeenCalled();
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
  });
});

describe("switched on", () => {
  beforeEach(() => { __setAnalysisForTests(true); });

  it("a corn build is asked for its record; an orchard build never is", async () => {
    await builtAndSaved("corn", RECORD);
    expect(startTwinBuild.mock.calls[0][1]).toMatchObject({ crop: "corn", analysis: true });
    __resetBuildSession(); __setAnalysisForTests(true);
    build = { done: deferred(), atlases: deferred(), cancel: vi.fn() }; startTwinBuild.mockClear(); saveTwinAnalysis.mockClear();
    await builtAndSaved("orchard", null);
    expect(startTwinBuild.mock.calls[0][1]).not.toHaveProperty("analysis");
    expect(saveTwinAnalysis).not.toHaveBeenCalled();
  });

  it("the record goes up only after the twin is saved and the tab is free, into the twin's own folder", async () => {
    const id = await builtAndSaved("corn", RECORD);
    expect(order).toEqual(["twin saved", "record upload started (session saved, busy false)"]);
    expect(saveTwinAnalysis).toHaveBeenCalledWith("u1", id, RECORD);
    analysisUpload.resolve(1234); await flushAll();
    expect(getBuildSession()).toMatchObject({ status: "saved", error: null });
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved", "twin_analysis_saved"]);
    // Sizes and a duration only: no name, no place.
    expect(tracked[3].f).toMatchObject({ twinId: id, outcome: "ok", counts: { bytes: 1234, jsonBytes: RECORD.size } });
    expect(Object.keys(tracked[3].f).sort()).toEqual(["counts", "durationMs", "outcome", "twinId"]);
  });

  it("a failed upload of the record leaves the twin saved: never incomplete, never an error on the page, nothing to retry", async () => {
    await builtAndSaved("corn", RECORD);
    analysisUpload.reject(new Error("storage blip")); await flushAll();
    const s = getBuildSession();
    expect(s).toMatchObject({ status: "saved", error: null, record: { status: "ready" } });
    expect(sessionBusy()).toBe(false);
    // The twin's record in the account was never written again after it was marked ready.
    expect(updates).toEqual([]);
    expect(saveBuiltTwin).toHaveBeenCalledOnce();
    expect(tracked.at(-1)).toMatchObject({ name: "twin_analysis_failed", f: { outcome: "error", error: "storage blip" } });
    retrySave(); await flushAll();
    expect(saveBuiltTwin).toHaveBeenCalledOnce();
  });

  it("an upload that never answers holds nothing open: the twin is saved and the tab may close", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    await builtAndSaved("corn", RECORD);
    await flushAll(); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(sessionBusy()).toBe(false);
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
  });

  it("when the twin's own save fails nothing of the record goes up; after a retry that succeeds it does", async () => {
    saveBuiltTwin = vi.fn().mockRejectedValueOnce(new Error("storage blip")).mockImplementationOnce(async (_u: string, twin: { id: string }) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "ready" }));
    const id = await builtAndSaved("corn", RECORD);
    expect(getBuildSession()).toMatchObject({ status: "save-failed", error: "storage blip" });
    expect(saveTwinAnalysis).not.toHaveBeenCalled();
    retrySave(); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(saveTwinAnalysis).toHaveBeenCalledWith("u1", id, RECORD);
  });

  it("a corn build that could not make a record is saved like any other", async () => {
    await builtAndSaved("corn", null);
    expect(getBuildSession().status).toBe("saved");
    expect(saveTwinAnalysis).not.toHaveBeenCalled();
  });
});
