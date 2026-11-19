// How much of the build runs at once (concurrency.ts), how the soil ties are dealt to the helpers (cameras.ts
// partitionByWork), the helpers' rasters dropped once the cameras are aligned, and the rule all of it rests on: the
// cameras do not depend on how many helpers there are or on which finishes first (checked on the public UAV3DCrop
// corn flight when it is on this computer, with helpers that answer in a random order).
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nodePhoto } from "../../scripts/directGeoref/nodePhotos";
import { alignCameras, partitionByWork } from "@/lib/fieldTwin/build/cameras";
import { CONCURRENCY, buildConcurrency, deviceHints } from "@/lib/fieldTwin/build/concurrency";
import { readPhotographs } from "@/lib/fieldTwin/build/photos";
import { type Pool, type PoolResult, type PoolTask, type TaskContext, handleTask } from "@/lib/fieldTwin/build/pool";
import { colourObservations } from "@/lib/fieldTwin/build/weeds";

describe("how much of the build runs at once", () => {
  it("a desktop gets one helper fewer than its cores, at most six, and three corn reads", () => {
    expect(buildConcurrency({ cores: 12, memoryGB: 8, mobile: false })).toMatchObject({ helpers: 6, cornParallel: 3 });
    expect(buildConcurrency({ cores: 12, memoryGB: null, mobile: false })).toMatchObject({ helpers: 6, cornParallel: 3 });
    expect(buildConcurrency({ cores: 4, memoryGB: null, mobile: false })).toMatchObject({ helpers: 3, cornParallel: 3 });
    expect(buildConcurrency({ cores: null, memoryGB: null, mobile: false })).toMatchObject({ helpers: 1, cornParallel: 1 });
  });
  it("a tablet or phone gets at most three helpers and two corn reads, whatever its cores", () => {
    expect(buildConcurrency({ cores: 8, memoryGB: null, mobile: true })).toMatchObject({ helpers: CONCURRENCY.mobile.helpers, cornParallel: CONCURRENCY.mobile.cornParallel });
    expect(buildConcurrency({ cores: 2, memoryGB: null, mobile: true })).toMatchObject({ helpers: 1, cornParallel: 1 });
  });
  it("a browser that says it has little memory gets fewer", () => {
    expect(buildConcurrency({ cores: 12, memoryGB: 4, mobile: false })).toMatchObject({ helpers: 3, cornParallel: 2 });
    expect(buildConcurrency({ cores: 12, memoryGB: 2, mobile: false })).toMatchObject({ helpers: 2, cornParallel: 1 });
    expect(buildConcurrency({ cores: 12, memoryGB: 0.5, mobile: false })).toMatchObject({ helpers: 2, cornParallel: 1 });
  });
  it("helpers asked for (the benchmark) win, and the corn reads never exceed the helpers", () => {
    expect(buildConcurrency({ cores: 12, memoryGB: 8, mobile: false }, { helpers: 3 })).toMatchObject({ helpers: 3, cornParallel: 3 });
    expect(buildConcurrency({ cores: 12, memoryGB: 8, mobile: false }, { helpers: 2 })).toMatchObject({ helpers: 2, cornParallel: 2 });
    expect(buildConcurrency({ cores: 8, memoryGB: null, mobile: true }, { helpers: 1 })).toMatchObject({ helpers: 1, cornParallel: 1 });
  });
  it("tells an iPad from a Mac by its touch screen (iPadOS Safari calls itself a Mac)", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    expect(deviceHints({ userAgent: mac, maxTouchPoints: 5, hardwareConcurrency: 8 })).toEqual({ cores: 8, memoryGB: null, mobile: true });
    expect(deviceHints({ userAgent: mac, maxTouchPoints: 0, hardwareConcurrency: 8 }).mobile).toBe(false);
    expect(deviceHints({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 }).mobile).toBe(true);
    expect(deviceHints({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile", deviceMemory: 8 })).toMatchObject({ mobile: true, memoryGB: 8 });
    expect(deviceHints({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0", deviceMemory: 8, hardwareConcurrency: 12 })).toEqual({ cores: 12, memoryGB: 8, mobile: false });
    expect(deviceHints({})).toEqual({ cores: null, memoryGB: null, mobile: false });
  });
});

describe("the soil ties dealt to the helpers by work", () => {
  it("contiguous runs, in order, each about an equal share of the pairs", () => {
    // Pairs are counted from the first photograph, so early photographs have the most partners.
    const weights = Array.from({ length: 120 }, (_, i) => Math.max(1, 60 - Math.floor(i / 2)));
    const h = partitionByWork(weights, 6);
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeGreaterThanOrEqual(h[i - 1]);
    expect(new Set(h).size).toBe(6);
    const per = [0, 0, 0, 0, 0, 0];
    weights.forEach((w, i) => { per[h[i]] += w; });
    const total = weights.reduce((s, w) => s + w, 0), max = Math.max(...weights);
    for (const p of per) expect(Math.abs(p - total / 6)).toBeLessThanOrEqual(max);
    // The old split, equal counts of first photographs, gave the first helper several times the last one's work.
    const byCount = [0, 0, 0, 0, 0, 0];
    weights.forEach((w, i) => { byCount[Math.min(5, Math.floor(i / 20))] += w; });
    expect(Math.max(...byCount) / Math.min(...byCount)).toBeGreaterThan(3);
    expect(Math.max(...per) / Math.min(...per)).toBeLessThan(1.2);
  });
  it("is the same split every time, and one helper takes everything", () => {
    const w = [5, 3, 9, 1, 1, 7, 2];
    expect(partitionByWork(w, 3)).toEqual(partitionByWork([...w], 3));
    expect(partitionByWork(w, 1)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(partitionByWork([0, 0], 4)).toEqual([0, 0]);
  });
});

/**
 * Helpers that each hold their own rasters and take their own tasks in the order sent (as a worker takes its messages),
 * each after a random delay, so which helper finishes first varies from run to run.
 */
function shuffledPool(n: number, seed: number): Pool & { held: () => number[] } {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const ctxs: TaskContext[] = Array.from({ length: n }, () => ({ rasters: new Map(), photo: () => { throw new Error("no photographs in this test"); }, colour: colourObservations }));
  const busy = Array.from({ length: n }, () => 0);
  const queue: Promise<unknown>[] = Array.from({ length: n }, () => Promise.resolve());
  const runOn = (h: number, task: PoolTask): Promise<PoolResult> => {
    busy[h]++;
    // A raster task's arrays are transferred to a worker: the helper gets its own copy, never the build worker's.
    const t = task.kind === "raster" ? { ...task, grey: new Uint8Array(task.grey), green: new Uint8Array(task.green) } : task;
    const p = queue[h].then(() => new Promise(r => setTimeout(r, Math.floor(rnd() * 4)))).then(() => handleTask(t, ctxs[h])).then(x => x.result).finally(() => { busy[h]--; });
    queue[h] = p.catch(() => undefined);
    return p;
  };
  return {
    size: n, runOn,
    run: task => { let h = 0; for (let i = 1; i < n; i++) if (busy[i] < busy[h]) h = i; return runOn(h, task); },
    close: () => undefined,
    held: () => ctxs.map(c => c.rasters.size),
  };
}

describe("a helper drops its rasters when told", () => {
  it("answers how many it held, then holds none", async () => {
    const ctx: TaskContext = { rasters: new Map(), photo: () => { throw new Error("none"); }, colour: colourObservations };
    await handleTask({ kind: "raster", name: "a", width: 2, height: 1, grey: new Uint8Array([1, 2]), green: new Uint8Array([0, 1]), toOriginal: 4 }, ctx);
    await handleTask({ kind: "raster", name: "b", width: 2, height: 1, grey: new Uint8Array([1, 2]), green: new Uint8Array([0, 1]), toOriginal: 4 }, ctx);
    const r = await handleTask({ kind: "release" }, ctx);
    expect(r.result).toEqual({ kind: "release", rasters: 2 });
    expect(ctx.rasters.size).toBe(0);
  });
});

// The apricot sample flight (DJI photographs with full camera headers; the UAV3DCrop corn set has none to tie on).
const FLIGHT = [resolve(__dirname, "../../samplerowtestingimagery"), "D:/swardus-research/apricot-sample"].find(d => existsSync(d) && readdirSync(d).filter(f => /\.jpe?g$/i.test(f)).length >= 12) ?? null;

describe.skipIf(!FLIGHT)("the cameras do not depend on the helpers (apricot sample flight, 12 photographs)", () => {
  it("1, 2, 3 and 6 helpers answering in a random order give the same cameras and ties; no helper holds a raster after", { timeout: 600_000 }, async () => {
    const files = readdirSync(FLIGHT!).filter(f => /\.jpe?g$/i.test(f)).sort().slice(0, 12);
    const { reads } = await readPhotographs(files.map(f => nodePhoto(join(FLIGHT!, f))), 4, {}, true);
    const cameras = (r: Awaited<ReturnType<typeof alignCameras>>) => JSON.stringify({ frames: [...r.frames.entries()], globals: r.model.globals, report: { ...r.report, tieMsPerHelper: undefined } });
    const inline = await alignCameras(reads, {}, 40, 0, null);
    expect(inline.report.ties).toBeGreaterThan(40);
    const want = cameras(inline);
    for (const [n, seed] of [[2, 1], [3, 7], [6, 42]] as const) {
      const pool = shuffledPool(n, seed);
      const r = await alignCameras(reads, {}, 40, 0, pool);
      expect(cameras(r)).toBe(want);
      expect(r.report.tieMsPerHelper?.length).toBe(n);
      expect(pool.held()).toEqual(Array.from({ length: n }, () => 0));
    }
  });
});
