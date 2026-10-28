// The page's side of the build: start the worker, relay its progress, hand back the twin and its files.
import { type TwinBundle, parseTwin } from "../types";
import type { BuildReport } from "./pipeline";
import type { BuildProgress } from "./types";
import type { BuildWorkerMessage, BuildWorkerRequest } from "./worker";

export type BuildRun = {
  /** Resolves with the twin, its files (twin.json and the atlases) and the report; rejects on error or cancel. */
  done: Promise<{ twin: TwinBundle; files: Map<string, Blob>; report: BuildReport }>;
  cancel: () => void;
};

export class BuildAborted extends Error { constructor() { super("The build was cancelled."); this.name = "Aborted"; } }

export function startTwinBuild(files: File[], options: { name: string; id?: string; withWeeds: boolean }, hooks: { onProgress?: (p: BuildProgress) => void; onLog?: (line: string) => void } = {}): BuildRun {
  if (typeof Worker === "undefined") throw new Error("this browser cannot run the build off the main thread (no Worker)");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  const done = new Promise<{ twin: TwinBundle; files: Map<string, Blob>; report: BuildReport }>((resolve, reject) => {
    const finish = () => { settled = true; worker.terminate(); };
    worker.onmessage = (e: MessageEvent<BuildWorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") hooks.onProgress?.(m.progress);
      else if (m.type === "log") hooks.onLog?.(m.line);
      else if (m.type === "result") {
        finish();
        const parsed = parseTwin(JSON.parse(m.twinJson));
        if ("reason" in parsed) { reject(new Error(parsed.reason)); return; }
        resolve({ twin: parsed.twin, files: new Map(m.files), report: m.report });
      } else if (m.type === "cancelled") { finish(); reject(new BuildAborted()); }
      else if (m.type === "error") { finish(); reject(new Error(m.message)); }
    };
    worker.onerror = e => { finish(); reject(new Error(e.message || "The build worker failed to start.")); };
  });
  const req: BuildWorkerRequest = { type: "build", files, name: options.name, id: options.id, withWeeds: options.withWeeds };
  worker.postMessage(req);
  return { done, cancel: () => { if (!settled) { const c: BuildWorkerRequest = { type: "cancel" }; worker.postMessage(c); } } };
}
