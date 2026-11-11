// Saving the analysis record (src/lib/fieldTwin/analysis.ts) is apart from saving the twin: the twin is saved and the
// tab is free before the record's upload starts, and whatever that upload does (succeeds, fails, never answers) the
// twin stays saved. The record is kept on the device before the upload starts and taken off it once the account has
// it (analysisOutbox.ts). A build makes one only for an account that gets one (analysisAccess.ts); orchard builds are
// never asked for one.
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
let device: ReturnType<typeof memoryStore>;
// The record is packed here as its own bytes (the packing itself is tested with the storage, fieldTwinAnalysisAccess).
const uploadTwinAnalysis = vi.fn((_user: string, _twinId: string, _packed: Blob) => { order.push(`record upload started (session ${getBuildSession().status}, busy ${sessionBusy()}, on the device ${device.map.size})`); return analysisUpload.promise; });
vi.mock("@/lib/fieldTwin/store", async orig => ({
  ...(await orig<typeof import("@/lib/fieldTwin/store")>()),
  packTwinAnalysis: async (json: Blob) => json,
  blobBytes: async () => new TextEncoder().encode("the record"),
  uploadTwinAnalysis: (u: string, t: string, b: Blob) => uploadTwinAnalysis(u, t, b),
}));

const tracked: { name: string; f: Record<string, unknown> }[] = [];
vi.mock("@/lib/pilot/telemetry", async orig => ({ ...(await orig<typeof import("@/lib/pilot/telemetry")>()), track: (name: string, f: Record<string, unknown> = {}) => { tracked.push({ name, f }); } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
  from: () => ({ update: (u: Record<string, unknown>) => { updates.push(u); return { eq: async () => ({ error: null }) }; } }),
} }));

import { __resetBuildSession, getBuildSession, retrySave, sessionBusy, startBuildSession } from "@/lib/fieldTwin/buildSession";
import { TWIN_ANALYSIS_ENABLED } from "@/lib/fieldTwin/analysisConfig";
import { __setPendingStoreForTests, memoryStore } from "@/lib/fieldTwin/analysisOutbox";

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
  device = memoryStore(); __setPendingStoreForTests(device);
  build = { done: deferred(), atlases: deferred(), cancel: vi.fn() };
  analysisUpload = deferred();
  saveBuiltTwin = vi.fn(async (_user: string, twin: { id: string }) => { order.push("twin saved"); return { id: twin.id, storage_key: twin.id, name: "North", status: "ready" }; });
  startTwinBuild.mockClear(); beginSave.mockClear(); uploadTwinAnalysis.mockClear();
});
afterEach(() => { __resetBuildSession(); __setPendingStoreForTests(undefined); });

/** A corn build taken to the end of the twin's own save. */
async function builtAndSaved(crop: "corn" | "orchard", analysis: Blob | null, allowed = false) {
  startBuildSession(files, { name: "North", crop, weeds: "colour", userId: "u1", ...(allowed ? { analysis: true } : {}) });
  const id = (getBuildSession() as { id: string }).id;
  build.done.resolve(result(id, analysis)); build.atlases.resolve(new Map()); await flushAll();
  return id;
}

describe("an account that gets no record (every participant today)", () => {
  it("no build is asked for a record, and nothing is kept or uploaded beside the twin", async () => {
    expect(TWIN_ANALYSIS_ENABLED).toBe(true);
    const id = await builtAndSaved("corn", null);
    // The options are exactly what they were before the record existed.
    expect(startTwinBuild.mock.calls[0][1]).toEqual({ name: "North", id, weeds: "none", helpers: undefined, crop: "corn" });
    expect(getBuildSession().status).toBe("saved");
    expect(uploadTwinAnalysis).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
  });

  it("a record handed back all the same is neither kept nor saved, and the twin is saved the usual way", async () => {
    // Not reachable from the app (such a session never asks for one), but "no record" must mean nothing is stored.
    await builtAndSaved("corn", RECORD);
    expect(getBuildSession().status).toBe("saved");
    expect(uploadTwinAnalysis).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
  });

  it("one build's answer does not carry to the next: a build started without it asks for none", async () => {
    await builtAndSaved("corn", RECORD, true);
    analysisUpload.resolve(10); await flushAll();
    expect(uploadTwinAnalysis).toHaveBeenCalledOnce();
    __resetBuildSession(); build = { done: deferred(), atlases: deferred(), cancel: vi.fn() }; startTwinBuild.mockClear(); uploadTwinAnalysis.mockClear();
    await builtAndSaved("corn", RECORD);
    expect(startTwinBuild.mock.calls[0][1]).not.toHaveProperty("analysis");
    expect(uploadTwinAnalysis).not.toHaveBeenCalled();
  });
});

describe("an account that gets the record", () => {
  it("a corn build is asked for its record; an orchard build never is", async () => {
    await builtAndSaved("corn", RECORD, true);
    expect(startTwinBuild.mock.calls[0][1]).toMatchObject({ crop: "corn", analysis: true });
    __resetBuildSession();
    build = { done: deferred(), atlases: deferred(), cancel: vi.fn() }; startTwinBuild.mockClear(); uploadTwinAnalysis.mockClear();
    device = memoryStore(); __setPendingStoreForTests(device);
    await builtAndSaved("orchard", null, true);
    expect(startTwinBuild.mock.calls[0][1]).not.toHaveProperty("analysis");
    expect(uploadTwinAnalysis).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
  });

  it("the record is on the device before its upload starts, goes up only after the twin is saved and the tab is free, and leaves the device once it has arrived", async () => {
    const id = await builtAndSaved("corn", RECORD, true);
    expect(order).toEqual(["twin saved", "record upload started (session saved, busy false, on the device 1)"]);
    expect(uploadTwinAnalysis).toHaveBeenCalledWith("u1", id, expect.any(Blob));
    expect([...device.map.values()]).toMatchObject([{ key: `u1/${id}`, userId: "u1", twinId: id, storageKey: id, attempts: 0 }]);
    analysisUpload.resolve(1234); await flushAll();
    expect(device.map.size).toBe(0);
    expect(getBuildSession()).toMatchObject({ status: "saved", error: null });
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved", "twin_analysis_saved"]);
    // Sizes and a duration only: no name, no place.
    expect(tracked[3].f).toMatchObject({ twinId: id, outcome: "ok", counts: { bytes: 1234, jsonBytes: RECORD.size } });
    expect(Object.keys(tracked[3].f).sort()).toEqual(["counts", "durationMs", "outcome", "twinId"]);
  });

  it("a failed upload of the record leaves the twin saved (never incomplete, never an error on the page, nothing to retry there) and the record waiting on the device", async () => {
    const id = await builtAndSaved("corn", RECORD, true);
    analysisUpload.reject(new Error("storage blip")); await flushAll();
    const s = getBuildSession();
    expect(s).toMatchObject({ status: "saved", error: null, record: { status: "ready" } });
    expect(sessionBusy()).toBe(false);
    // The twin's record in the account was never written again after it was marked ready.
    expect(updates).toEqual([]);
    expect(saveBuiltTwin).toHaveBeenCalledOnce();
    expect(tracked.at(-1)).toMatchObject({ name: "twin_analysis_failed", f: { outcome: "error", error: "storage blip", detail: { waiting: true } } });
    // Free to be sent on the next visit, with this refusal counted.
    expect([...device.map.values()]).toMatchObject([{ key: `u1/${id}`, attempts: 1, lastTriedAt: 0 }]);
    retrySave(); await flushAll();
    expect(saveBuiltTwin).toHaveBeenCalledOnce();
    expect(uploadTwinAnalysis).toHaveBeenCalledOnce();
  });

  it("an upload that never answers holds nothing open: the twin is saved, the tab may close, and the record is on the device", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    await builtAndSaved("corn", RECORD, true);
    await flushAll(); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(sessionBusy()).toBe(false);
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
    expect(device.map.size).toBe(1);
  });

  it("when the twin's own save fails nothing of the record is kept or goes up; after a retry that succeeds it does", async () => {
    saveBuiltTwin = vi.fn().mockRejectedValueOnce(new Error("storage blip")).mockImplementationOnce(async (_u: string, twin: { id: string }) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "ready" }));
    const id = await builtAndSaved("corn", RECORD, true);
    expect(getBuildSession()).toMatchObject({ status: "save-failed", error: "storage blip" });
    expect(uploadTwinAnalysis).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
    retrySave(); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(uploadTwinAnalysis).toHaveBeenCalledWith("u1", id, expect.any(Blob));
  });

  it("a corn build that could not make a record is saved like any other", async () => {
    await builtAndSaved("corn", null, true);
    expect(getBuildSession().status).toBe("saved");
    expect(uploadTwinAnalysis).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
  });

  it("a device that keeps nothing (no database of its own) still sends the record once; a failure then is recorded as lost, and the twin is saved", async () => {
    __setPendingStoreForTests(null);
    await builtAndSaved("corn", RECORD, true);
    expect(uploadTwinAnalysis).toHaveBeenCalledOnce();
    analysisUpload.reject(new Error("storage blip")); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(tracked.at(-1)).toMatchObject({ name: "twin_analysis_failed", f: { detail: { waiting: false } } });
  });

  it("a device whose database refuses is the same: the record is sent, the twin is saved", async () => {
    __setPendingStoreForTests({ all: async () => { throw new Error("quota"); }, put: async () => { throw new Error("quota"); }, remove: async () => { throw new Error("quota"); } });
    await builtAndSaved("corn", RECORD, true);
    expect(uploadTwinAnalysis).toHaveBeenCalledOnce();
    analysisUpload.resolve(99); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(tracked.at(-1)).toMatchObject({ name: "twin_analysis_saved" });
  });
});
