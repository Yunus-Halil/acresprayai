// A pool of helper workers for the build's parallel stages: the soil ties (per pair of photographs), the colour
// weed pass (per photograph) and the atlas crops (per photograph). The build worker owns the pool; without one
// (Node, tests, a browser with one core) every task runs inline through the same handler, so the result is the
// same either way.
//
// Memory rule: a helper holds the grey rasters it was sent and nothing else. The ties are partitioned by their
// first photograph, so each helper receives only the rasters of its own first photographs and their partners
// (about a tenth to a quarter of the flight each), never the whole flight.
import { type GeorefFrame, type GreenOptions, type GreyRaster, type Observation, type SoilTieOptions, type SoilTie, findSoilTies, windowCacheFor } from "../../directGeoref";
import type { CrownRef } from "./weeds";

export type PoolTask =
  /** Keep a photograph's grey raster for later tie tasks. */
  | { kind: "raster"; name: string; width: number; height: number; grey: Uint8Array; green: Uint8Array; toOriginal: number }
  /** Soil ties for pairs that share a first photograph (frames given with the task: they change between rounds). */
  | { kind: "ties"; a: string; frames: [string, GeorefFrame][]; partners: string[]; opts: SoilTieOptions }
  /** The colour weed pass on one photograph: green patches at a decode, as observations. */
  | { kind: "colour"; name: string; file: Blob; frame: GeorefFrame; down: number; minM2: number; crowns: CrownRef[]; green: Partial<GreenOptions> }
  /** Crops of one photograph for the atlases. */
  | { kind: "crops"; name: string; file: Blob; reqs: { x0: number; y0: number; size: number; out: number }[] };

export type PoolResult =
  | { kind: "raster" }
  | { kind: "ties"; ties: SoilTie[]; rejected: Record<string, number>; pairsWithTies: number }
  | { kind: "colour"; name: string; observations: Observation[] }
  | { kind: "crops"; name: string; cells: Uint8ClampedArray[] };

export type Pool = {
  /** Helpers in the pool (1 for the inline pool). */
  size: number;
  /** Run a task on any helper. */
  run(task: PoolTask): Promise<PoolResult>;
  /** Run a task on one particular helper (rasters go where their ties will run). */
  runOn(helper: number, task: PoolTask): Promise<PoolResult>;
  close(): void;
};

/** What a helper does with a task; the inline pool and the worker helper share it. */
export type TaskContext = {
  rasters: Map<string, GreyRaster>;
  /** Opens a photograph's file for decoding (the browser's PhotoSource, injected so this module stays free of DOM types). */
  photo: (file: Blob, name: string) => { decode(down: number): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>; crops(reqs: { x0: number; y0: number; size: number; out: number }[]): Promise<Uint8ClampedArray[]> };
  colour: (name: string, frame: GeorefFrame, px: { width: number; height: number; rgba: Uint8ClampedArray }, minM2: number, crowns: CrownRef[], green: Partial<GreenOptions>) => Observation[];
};

export async function handleTask(task: PoolTask, ctx: TaskContext): Promise<{ result: PoolResult; transfer: ArrayBuffer[] }> {
  switch (task.kind) {
    case "raster":
      ctx.rasters.set(task.name, { width: task.width, height: task.height, grey: task.grey, green: task.green, toOriginal: task.toOriginal });
      return { result: { kind: "raster" }, transfer: [] };
    case "ties": {
      const frames = new Map(task.frames);
      const fa = frames.get(task.a), ra = ctx.rasters.get(task.a);
      const ties: SoilTie[] = [], rejected: Record<string, number> = {};
      let pairsWithTies = 0;
      if (fa && ra) {
        const memo = windowCacheFor(task.a, task.opts.fineRes ?? 0.04, task.opts.fineN ?? 64);
        for (const b of task.partners) {
          const fb = frames.get(b), rb = ctx.rasters.get(b);
          if (!fb || !rb) continue;
          const r = findSoilTies(fa, ra, fb, rb, task.opts, memo);
          ties.push(...r.ties);
          if (r.ties.length) pairsWithTies++;
          for (const [k, v] of Object.entries(r.rejected)) rejected[k] = (rejected[k] ?? 0) + v;
        }
      }
      return { result: { kind: "ties", ties, rejected, pairsWithTies }, transfer: [] };
    }
    case "colour": {
      const px = await ctx.photo(task.file, task.name).decode(task.down);
      return { result: { kind: "colour", name: task.name, observations: ctx.colour(task.name, task.frame, px, task.minM2, task.crowns, task.green) }, transfer: [] };
    }
    case "crops": {
      const cells = await ctx.photo(task.file, task.name).crops(task.reqs);
      return { result: { kind: "crops", name: task.name, cells }, transfer: cells.map(c => c.buffer as ArrayBuffer) };
    }
  }
}

/** Everything inline, in order: the pool of one. */
export function inlinePool(ctx: TaskContext): Pool {
  return { size: 1, run: async t => (await handleTask(t, ctx)).result, runOn: async (_h, t) => (await handleTask(t, ctx)).result, close: () => undefined };
}

export type HelperMessage = { id: number; result: PoolResult } | { id: number; error: string };

/** A pool of `n` helper workers made by `spawn` (a module worker running helper.ts). */
export function workerPool(n: number, spawn: () => Worker): Pool {
  const workers = Array.from({ length: Math.max(1, n) }, spawn);
  const pending = new Map<number, { resolve: (r: PoolResult) => void; reject: (e: Error) => void; helper: number }>();
  const busy = workers.map(() => 0);
  let next = 1;
  workers.forEach((w, h) => {
    w.onmessage = (e: MessageEvent<HelperMessage>) => {
      const m = e.data, p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id); busy[h]--;
      if ("error" in m) p.reject(new Error(m.error)); else p.resolve(m.result);
    };
    w.onerror = e => { for (const [id, p] of pending) if (p.helper === h) { pending.delete(id); p.reject(new Error(e.message || "a helper worker failed")); } };
  });
  const transferOf = (t: PoolTask): ArrayBuffer[] => (t.kind === "raster" ? [t.grey.buffer as ArrayBuffer, t.green.buffer as ArrayBuffer] : []);
  const runOn = (h: number, task: PoolTask) => new Promise<PoolResult>((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject, helper: h }); busy[h]++;
    workers[h].postMessage({ id, task }, transferOf(task));
  });
  return {
    size: workers.length,
    runOn,
    run: task => { let h = 0; for (let i = 1; i < busy.length; i++) if (busy[i] < busy[h]) h = i; return runOn(h, task); },
    close: () => { for (const w of workers) w.terminate(); for (const p of pending.values()) p.reject(new Error("the pool was closed")); pending.clear(); },
  };
}
