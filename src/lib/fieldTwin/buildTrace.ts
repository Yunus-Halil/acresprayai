// The last Field Twin build on this device, as far as it got: for the founder's device testing (an iPad that runs out
// of memory reloads the page, and the build is simply gone). A small marker in this browser's storage: when the build
// started, how many photographs, the stage it reached and when it was last heard of. Nothing from the photographs.
// Ended (removed) when the build finishes, fails or is cancelled; one still there on the next visit, with no build
// running in this tab, is a build the browser stopped.
import { storageKey } from "@/lib/storage";
import type { BuildCrop, BuildStage } from "./build/types";

export type BuildTrace = { startedAt: number; photographs: number; crop: BuildCrop; stage: BuildStage | null; stageAt: number; lastAt: number; stages: Partial<Record<BuildStage, number>> };

const KEY = storageKey("twin-build-trace");
const HEARTBEAT_MS = 5_000;
let current: BuildTrace | null = null;
let written = 0;

const write = (t: BuildTrace | null) => { try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch { /* private mode, full: the trace is a convenience */ } };

export function beginTrace(photographs: number, crop: BuildCrop, now = Date.now()): void {
  current = { startedAt: now, photographs, crop, stage: null, stageAt: now, lastAt: now, stages: {} };
  written = now; write(current);
}

/** A progress report: written at once on a new stage, otherwise every few seconds (so the last moment heard of is close). */
export function traceProgress(stage: BuildStage, now = Date.now()): void {
  if (!current) return;
  const fresh = stage !== current.stage;
  if (fresh) { current.stage = stage; current.stageAt = now; current.stages[stage] = now - current.startedAt; }
  current.lastAt = now;
  if (fresh || now - written >= HEARTBEAT_MS) { written = now; write(current); }
}

export function endTrace(): void { current = null; write(null); }

/** A build this browser stopped: a marker left by a build that is not the one running in this tab. */
export function unfinishedTrace(runningHere: boolean): BuildTrace | null {
  if (runningHere) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as BuildTrace;
    return typeof t?.startedAt === "number" && typeof t.lastAt === "number" ? t : null;
  } catch { return null; }
}

export const forgetTrace = () => write(null);

const s = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

/** What a stopped build means, in words. */
export function stoppedBuildText(t: BuildTrace): string {
  const heard = t.lastAt - t.startedAt;
  return `A build of ${t.photographs} photographs (${t.crop}) started ${new Date(t.startedAt).toLocaleString()} did not finish. It was last heard of ${s(heard)} in, during "${t.stage ?? "starting"}". The page was closed or reloaded before it ended; on an iPad that is usually Safari running out of memory.`;
}
