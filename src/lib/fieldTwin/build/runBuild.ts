// The page's side of the build: start the worker, relay its progress, hand back the twin and its files.
import { type TwinBundle, parseTwin } from "../types";
import type { BuildReport } from "./pipeline";
import type { BuildProgress } from "./types";
import type { BuildWorkerMessage, BuildWorkerRequest } from "./worker";

export type BuildResult = {
  twin: TwinBundle;
  /** twin.json at once; the atlases are added to this same map as they are cut (see `atlases`). */
  files: Map<string, Blob>;
  report: BuildReport;
  /** Resolves with the same map once every atlas is in (rejects on error or cancel). */
  atlases: Promise<Map<string, Blob>>;
  /** How many atlases are in, of how many; `onAtlas` is called on each. */
  progress: { done: number; total: number };
  onAtlas: (cb: (done: number, total: number) => void) => void;
};

export type BuildRun = {
  /** Resolves with the twin and its report as soon as the twin is complete; the atlases follow. Rejects on error or cancel. */
  done: Promise<BuildResult>;
  cancel: () => void;
};

export class BuildAborted extends Error { constructor() { super("The build was cancelled."); this.name = "Aborted"; } }

export function startTwinBuild(files: File[], options: { name: string; id?: string; weeds: "model" | "colour" | "none"; helpers?: number }, hooks: { onProgress?: (p: BuildProgress) => void; onLog?: (line: string) => void } = {}): BuildRun {
  if (typeof Worker === "undefined") throw new Error("this browser cannot run the build off the main thread (no Worker)");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  const bundleFiles = new Map<string, Blob>();
  const progress = { done: 0, total: 0 };
  const listeners: ((done: number, total: number) => void)[] = [];
  let atlasesResolve: (m: Map<string, Blob>) => void = () => undefined, atlasesReject: (e: Error) => void = () => undefined;
  const atlases = new Promise<Map<string, Blob>>((res, rej) => { atlasesResolve = res; atlasesReject = rej; });
  atlases.catch(() => undefined);
  const done = new Promise<BuildResult>((resolve, reject) => {
    const finish = () => { settled = true; worker.terminate(); };
    const fail = (e: Error) => { finish(); reject(e); atlasesReject(e); };
    worker.onmessage = (e: MessageEvent<BuildWorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") hooks.onProgress?.(m.progress);
      else if (m.type === "log") hooks.onLog?.(m.line);
      else if (m.type === "result") {
        const parsed = parseTwin(JSON.parse(m.twinJson));
        if ("reason" in parsed) { fail(new Error(parsed.reason)); return; }
        for (const [k, v] of m.files) bundleFiles.set(k, v);
        progress.total = parsed.twin.atlases.length;
        resolve({ twin: parsed.twin, files: bundleFiles, report: m.report, atlases, progress, onAtlas: cb => { listeners.push(cb); } });
        if (!progress.total) { finish(); atlasesResolve(bundleFiles); }
      } else if (m.type === "atlas") {
        bundleFiles.set(m.file, m.blob); progress.done = m.index + 1; progress.total = m.total;
        for (const cb of listeners) cb(progress.done, progress.total);
      } else if (m.type === "atlases-done") { finish(); atlasesResolve(bundleFiles); }
      else if (m.type === "cancelled") fail(new BuildAborted());
      else if (m.type === "error") fail(new Error(m.message));
    };
    worker.onerror = e => fail(new Error(e.message || "The build worker failed to start."));
  });
  const req: BuildWorkerRequest = { type: "build", files, name: options.name, id: options.id, weeds: options.weeds, helpers: options.helpers };
  worker.postMessage(req);
  return { done, cancel: () => { if (!settled) { const c: BuildWorkerRequest = { type: "cancel" }; worker.postMessage(c); } } };
}
