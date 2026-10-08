// Run the planting-pattern pass where it will not freeze the page.
//
// In a browser with Workers the pass runs in patternWorker.ts and the page
// stays responsive; the pixel buffer is transferred, not copied. Without
// Workers (tests, a locked-down browser) or when the worker cannot start,
// the same function runs inline, yielding between windows. Either way the
// caller gets one PhotoPattern and can stop the run with an AbortSignal.
import { analysePhoto, type PhotoParams, type PhotoPattern, type PhotoPixels } from "./pattern";
import type { PatternWorkerMessage, PatternWorkerRequest } from "./patternWorker";

export type RunPatternOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Force the inline path. Tests. */
  inline?: boolean;
};

class Aborted extends Error {
  constructor() { super("Pattern pass cancelled."); this.name = "Aborted"; }
}

function runInline(px: PhotoPixels, params: PhotoParams, opts: RunPatternOptions): Promise<PhotoPattern> {
  return analysePhoto(px, params, {
    yieldBetweenWindows: true,
    onProgress: (done, total) => { opts.onProgress?.(done, total); return !opts.signal?.aborted; },
  }).then(p => { if (opts.signal?.aborted) throw new Aborted(); return p; });
}

export async function analysePhotoOffThread(px: PhotoPixels, params: PhotoParams, opts: RunPatternOptions = {}): Promise<PhotoPattern> {
  if (opts.signal?.aborted) throw new Aborted();
  if (opts.inline || typeof Worker === "undefined") return runInline(px, params, opts);
  let worker: Worker;
  try {
    worker = new Worker(new URL("./patternWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return runInline(px, params, opts);
  }
  return new Promise<PhotoPattern>((resolve, reject) => {
    let heard = false;
    const cleanup = () => { opts.signal?.removeEventListener("abort", onAbort); worker.terminate(); };
    const onAbort = () => { cleanup(); reject(new Aborted()); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<PatternWorkerMessage>) => {
      const m = e.data;
      heard = true;
      if (m.type === "progress") opts.onProgress?.(m.done, m.total);
      else if (m.type === "result") { cleanup(); resolve(m.pattern); }
      else if (m.type === "error") { cleanup(); reject(new Error(m.message)); }
    };
    worker.onerror = (e) => {
      cleanup();
      // A worker that never spoke could not load; the inline path still can.
      if (!heard) runInline(px, params, opts).then(resolve, reject);
      else reject(new Error(e.message || "The pattern worker failed."));
    };
    const req: PatternWorkerRequest = { type: "run", px, params };
    worker.postMessage(req, [px.rgba.buffer]);
  });
}
