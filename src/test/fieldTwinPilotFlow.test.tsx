// The participant's Field Twin flow around the build: the session that survives navigation and saves by itself,
// the registry's statuses, telemetry that never carries field data, and the review bar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---- the build and the registry, controllable ----------------------------------------------------------------
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };
const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); promise.catch(() => undefined); return { promise, resolve, reject }; };
let build: { done: Deferred<unknown>; atlases: Deferred<Map<string, Blob>>; cancel: ReturnType<typeof vi.fn> };
const startTwinBuild = vi.fn((_files: File[], _opts: unknown) => ({ done: build.done.promise, cancel: build.cancel }));
vi.mock("@/lib/fieldTwin/build/runBuild", async orig => ({ ...(await orig<typeof import("@/lib/fieldTwin/build/runBuild")>()), startTwinBuild: (f: File[], o: unknown) => startTwinBuild(f, o) }));

const beginSave = vi.fn(async (twin: { id: string }, _ms?: number | null) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "saving" }));
let saveBuiltTwin = vi.fn(async (..._a: unknown[]) => ({ id: "twin-1", storage_key: "twin-1", name: "North", status: "ready" }));
vi.mock("@/lib/fieldTwin/registry", async orig => ({
  ...(await orig<typeof import("@/lib/fieldTwin/registry")>()),
  beginSave: (t: { id: string }, ms: number | null) => beginSave(t, ms),
  saveBuiltTwin: (...a: unknown[]) => saveBuiltTwin(...a),
}));

const tracked: { name: string; f: Record<string, unknown> }[] = [];
vi.mock("@/lib/pilot/telemetry", async orig => ({ ...(await orig<typeof import("@/lib/pilot/telemetry")>()), track: (name: string, f: Record<string, unknown> = {}) => { tracked.push({ name, f }); } }));

import { __resetBuildSession, cancelBuild, getBuildSession, retrySave, startBuildSession } from "@/lib/fieldTwin/buildSession";
import { BuildAborted } from "@/lib/fieldTwin/build/runBuild";
import { effectiveStatus, factsFromTwin, STALE_SAVE_MS } from "@/lib/fieldTwin/registry";
import { scrub } from "@/lib/pilot/telemetry";
import ReviewBar, { reviewTargetOf } from "@/components/app/fieldTwin/ReviewBar";
import { syntheticTwin } from "@/lib/fieldTwin/synthetic";
const synthetic = syntheticTwin({ weeds: 30, seed: 2 });
import { plainBuildError } from "@/pages/app/TwinNew";

const result = (id: string) => ({
  twin: { id, name: "North", source: { photographs: 3, camera: "DJI FC6310R", capturedAt: null }, atlases: [{ file: "atlas-0.jpg" }] },
  files: new Map<string, Blob>(), report: { totalMs: 61_000, timings: { photographs: 1000 }, photographs: { given: 3, read: 3, refused: [] } },
  atlases: build.atlases.promise, progress: { done: 0, total: 1 }, onAtlas: () => undefined,
});
const files = [new File(["a"], "DJI_0001.JPG"), new File(["b"], "DJI_0002.JPG"), new File(["c"], "DJI_0003.JPG")];
const flushAll = async () => { for (let k = 0; k < 6; k++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  __resetBuildSession(); tracked.length = 0;
  build = { done: deferred(), atlases: deferred(), cancel: vi.fn() };
  saveBuiltTwin = vi.fn(async () => ({ id: "twin-1", storage_key: "twin-1", name: "North", status: "ready" }));
  startTwinBuild.mockClear(); beginSave.mockClear();
});
afterEach(() => { __resetBuildSession(); });

describe("the build session", () => {
  it("builds, saves by itself, and ends saved; the browser guards the tab only while there is work to lose", async () => {
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    startBuildSession(files, { name: "North", crop: "corn", weeds: "colour", userId: "u1" });
    expect(getBuildSession().status).toBe("building");
    expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    const id = (getBuildSession() as { id: string }).id;
    // Corn never runs an orchard weed pass, whatever was asked.
    expect(startTwinBuild.mock.calls[0][1]).toMatchObject({ crop: "corn", weeds: "none", id });
    build.done.resolve(result(id)); await flushAll();
    expect(getBuildSession().status).toBe("saving");
    expect(beginSave).toHaveBeenCalledOnce();
    build.atlases.resolve(new Map()); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(tracked.map(t => t.name)).toEqual(["twin_build_started", "twin_build_finished", "twin_saved"]);
    expect(tracked[1].f).toMatchObject({ durationMs: 61_000, outcome: "ok", counts: { photographs: 3, used: 3, refused: 0, atlases: 1 } });
  });

  it("a failed save keeps the twin in the tab and can be tried again", async () => {
    saveBuiltTwin = vi.fn().mockRejectedValueOnce(new Error("storage blip")).mockResolvedValueOnce({ id: "x", storage_key: "x", name: "North", status: "ready" });
    startBuildSession(files, { name: "North", crop: "orchard", weeds: "colour", userId: "u1" });
    const id = (getBuildSession() as { id: string }).id;
    build.done.resolve(result(id)); build.atlases.resolve(new Map()); await flushAll();
    expect(getBuildSession()).toMatchObject({ status: "save-failed", error: "storage blip" });
    retrySave(); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(beginSave).toHaveBeenCalledOnce();
    expect(tracked.some(t => t.name === "twin_save_failed")).toBe(true);
  });

  it("cancel and failure are recorded with their stage, and nothing is saved", async () => {
    startBuildSession(files, { name: "North", crop: "orchard", weeds: "colour", userId: "u1" });
    cancelBuild();
    expect(build.cancel).toHaveBeenCalled();
    build.done.reject(new BuildAborted()); await flushAll();
    expect(getBuildSession().status).toBe("cancelled");
    expect(beginSave).not.toHaveBeenCalled();
    __resetBuildSession(); build = { done: deferred(), atlases: deferred(), cancel: vi.fn() };
    startBuildSession(files, { name: "North", crop: "orchard", weeds: "colour", userId: "u1" });
    build.done.reject(new Error("RangeError: Array buffer allocation failed")); await flushAll();
    expect(getBuildSession()).toMatchObject({ status: "failed" });
    expect(tracked.map(t => t.name)).toContain("twin_build_failed");
  });

  it("one build at a time", () => {
    startBuildSession(files, { name: "North", crop: "orchard", weeds: "colour", userId: "u1" });
    expect(() => startBuildSession(files, { name: "Second", crop: "orchard", weeds: "colour", userId: "u1" })).toThrow(/already being built/);
  });

  it("build errors in plain words", () => {
    expect(plainBuildError("RangeError: Array buffer allocation failed")).toMatch(/ran out of memory/);
    expect(plainBuildError("no photograph holds a camera (no camera position in the file)")).toMatch(/could not place enough/);
  });
});

describe("the registry", () => {
  it("a save left 'saving' for long is shown as not saved completely", () => {
    const now = Date.now();
    expect(effectiveStatus({ status: "saving", updated_at: new Date(now - 60_000).toISOString() }, now)).toBe("saving");
    expect(effectiveStatus({ status: "saving", updated_at: new Date(now - STALE_SAVE_MS - 1).toISOString() }, now)).toBe("incomplete");
    expect(effectiveStatus({ status: "ready", updated_at: new Date(0).toISOString() }, now)).toBe("ready");
  });
  it("the record's facts come from the twin", () => {
    const f = factsFromTwin(synthetic);
    expect(f).toMatchObject({ name: synthetic.name, crop: "orchard", photographs: synthetic.source.photographs });
    expect(["rtk", "gnss", "local"]).toContain(f.placement);
  });
});

describe("telemetry never carries field data", () => {
  it("scrubs coordinates, file names and paths out of error text", () => {
    const s = scrub("photo DJI_0042.JPG at 38.9871234, -76.9412345 failed in C:/Users/ryan/flights/north/x")!;
    expect(s).not.toMatch(/DJI_0042|38\.98|76\.94|ryan/);
    expect(s).toContain("<file>");
    expect(s).toContain("<num>");
  });
});

describe("the review bar", () => {
  it("knows what each selection is, and groups are not reviewable", () => {
    const w = synthetic.weeds[0];
    expect(reviewTargetOf({ kind: "weed", id: w.id }, synthetic, null)).toMatchObject({ kind: "weed", id: String(w.id), status: w.status });
    expect(reviewTargetOf({ kind: "group", lat: 0, lng: 0, count: 3 }, synthetic, null)).toBeNull();
    expect(reviewTargetOf(null, synthetic, null)).toBeNull();
  });

  it("saves an answer, takes it back on a second press, and says when reviews are not possible yet", async () => {
    const onSave = vi.fn(async () => ({})), onClear = vi.fn(async () => ({}));
    const target = { kind: "weed" as const, id: "7", status: "verified", question: "Is this really a weed?" };
    const { rerender } = render(<ReviewBar target={target} reviews={new Map()} onSave={onSave} onClear={onClear} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Wrong" })); });
    expect(onSave).toHaveBeenCalledWith({ kind: "weed", id: "7", verdict: "wrong", note: null, algorithmStatus: "verified" });
    const saved = new Map([["weed:7", { finding_kind: "weed" as const, finding_id: "7", verdict: "wrong" as const, note: null, algorithm_status: "verified", payload: null, updated_at: "" }]]);
    rerender(<ReviewBar target={target} reviews={saved} onSave={onSave} onClear={onClear} />);
    expect(screen.getByRole("button", { name: "Wrong" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Wrong" })); });
    expect(onClear).toHaveBeenCalledWith("weed", "7");
    rerender(<ReviewBar target={target} reviews={new Map()} onSave={onSave} onClear={onClear} disabledReason="Reviews open once the twin is saved to your account." />);
    expect(screen.getByRole("button", { name: "Correct" })).toBeDisabled();
    expect(screen.getByText(/Reviews open once/)).toBeInTheDocument();
  });

  it("a failed save says so instead of pretending", async () => {
    const onSave = vi.fn(async () => { throw new Error("offline"); });
    render(<ReviewBar target={{ kind: "corn_weed", id: "3", status: "confirmed", question: "q" }} reviews={new Map()} onSave={onSave} onClear={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Correct" })); });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not saved: offline"));
  });
});
