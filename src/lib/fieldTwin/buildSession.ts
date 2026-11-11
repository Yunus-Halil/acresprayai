// The one Field Twin build this tab is running, kept outside any page: moving around the app does not lose it, the
// browser asks before the tab is closed while it runs or saves, and the save starts by itself the moment the twin
// is built (no "save" button to forget). The pages read it with useBuildSession().
//
//   building -> saving -> saved
//      |          |
//      |          +-> save-failed  (retrySave() while the tab still holds the files)
//      +-> failed / cancelled
import { useSyncExternalStore } from "react";
import { type BuildResult, type BuildRun, BuildAborted, startTwinBuild } from "./build/runBuild";
import type { BuildCrop, BuildProgress, BuildStage } from "./build/types";
import { TWIN_ANALYSIS_ENABLED } from "./analysisConfig";
import { saveAnalysisRecord } from "./analysisOutbox";
import { type TwinRecord, beginSave, saveBuiltTwin } from "./registry";
import type { TwinBundle } from "./types";
import { track } from "@/lib/pilot/telemetry";

export type BuildSessionState =
  | { status: "idle" }
  | {
      status: "building" | "saving" | "saved" | "failed" | "save-failed" | "cancelled";
      id: string; name: string; crop: BuildCrop; photographs: number; startedAt: number;
      progress: BuildProgress | null; stagesDone: BuildStage[];
      result: BuildResult | null; record: TwinRecord | null;
      save: { done: number; total: number } | null;
      error: string | null;
      buildMs: number | null;
    };

let state: BuildSessionState = { status: "idle" };
let run: BuildRun | null = null;
let userId: string | null = null;
/** Whether the account that started this build gets an analysis record (analysisAccess.ts). */
let analysisAsked = false;
const listeners = new Set<() => void>();
const set = (next: BuildSessionState) => { state = next; for (const l of listeners) l(); syncUnloadGuard(); };
const patch = (p: Partial<Exclude<BuildSessionState, { status: "idle" }>>) => { if (state.status !== "idle") set({ ...state, ...p }); };

export const getBuildSession = () => state;
/** Hear every change of the session (outside React). Returns the way to stop hearing. */
export function onBuildSessionChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function useBuildSession(): BuildSessionState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, getBuildSession, getBuildSession);
}
/** True while closing the tab would lose work. */
export const sessionBusy = (s: BuildSessionState = state) => s.status === "building" || s.status === "saving" || s.status === "save-failed";

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!sessionBusy()) return;
  e.preventDefault();
  // Browsers show their own wording; the value is required by some to show the prompt at all.
  e.returnValue = "Your Field Twin is not saved yet.";
}
let guarded = false;
function syncUnloadGuard() {
  if (typeof window === "undefined") return;
  const want = sessionBusy();
  if (want && !guarded) { window.addEventListener("beforeunload", onBeforeUnload); guarded = true; }
  else if (!want && guarded) { window.removeEventListener("beforeunload", onBeforeUnload); guarded = false; }
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export type StartOptions = { name: string; crop: BuildCrop; weeds: "model" | "colour" | "none"; helpers?: number; userId: string; /** This account's corn builds make and save their analysis record (analysisAccess.ts). Default: none. */ analysis?: boolean };

/** Start a build of `files`. Only one at a time: a running build must finish, fail or be cancelled first. */
export function startBuildSession(files: File[], o: StartOptions): void {
  if (sessionBusy()) throw new Error("A Field Twin is already being built in this tab.");
  const id = newId();
  userId = o.userId;
  analysisAsked = o.analysis === true;
  const startedAt = Date.now();
  set({ status: "building", id, name: o.name, crop: o.crop, photographs: files.length, startedAt, progress: null, stagesDone: [], result: null, record: null, save: null, error: null, buildMs: null });
  track("twin_build_started", { twinId: id, counts: { photographs: files.length }, detail: { crop: o.crop } });
  try {
    run = startTwinBuild(files, { name: o.name, id, weeds: o.crop === "corn" ? "none" : o.weeds, helpers: o.helpers, crop: o.crop, ...(analysisWanted(o.crop) ? { analysis: true } : {}) }, {
      onProgress: p => {
        if (state.status !== "building") return;
        const prev = state.progress;
        const stagesDone = prev && prev.stage !== p.stage && !state.stagesDone.includes(prev.stage) ? [...state.stagesDone, prev.stage] : state.stagesDone;
        patch({ progress: p, stagesDone });
      },
    });
  } catch (e) {
    fail("failed", (e as Error).message);
    return;
  }
  const mine = run;
  mine.done.then(result => {
    if (run !== mine) return;
    const buildMs = result.report.totalMs ?? Date.now() - startedAt;
    patch({ status: "saving", result, buildMs, save: { done: 0, total: result.twin.atlases.length + 1 } });
    track("twin_build_finished", {
      twinId: id, durationMs: buildMs, outcome: "ok",
      counts: { photographs: result.report.photographs.given, used: result.report.photographs.read, refused: result.report.photographs.refused.length, atlases: result.twin.atlases.length },
      stages: result.report.timings as Record<string, number>, detail: { crop: o.crop, camera: result.twin.source.camera },
    });
    void save(result);
  }).catch(e => {
    if (run !== mine) return;
    if (e instanceof BuildAborted) { fail("cancelled", "The build was cancelled."); return; }
    fail("failed", (e as Error).message);
  });
}

function fail(status: "failed" | "cancelled", message: string) {
  if (state.status === "idle") return;
  const durationMs = Date.now() - state.startedAt;
  track(status === "cancelled" ? "twin_build_cancelled" : "twin_build_failed", { twinId: state.id, durationMs, outcome: status === "cancelled" ? "cancelled" : "error", error: message, detail: { crop: state.crop, stage: state.progress?.stage ?? null }, counts: { photographs: state.photographs } });
  patch({ status, error: message });
  run = null;
}

/** The session moved on (cleared, or a new build) while a save was awaiting. */
const stale = (id: string) => { const now = getBuildSession(); return now.status === "idle" || now.id !== id; };

async function save(result: BuildResult) {
  if (!userId || state.status === "idle") return;
  const id = state.id;
  try {
    // The record first, so the twin is listed (as saving) at once and the viewer can open it from this tab.
    const record = state.record ?? await beginSave(result.twin, state.buildMs);
    patch({ record });
    const files = await result.atlases; // the evidence crops, cut in the background
    const saved = await saveBuiltTwin(userId, result.twin, files, state.buildMs, (done, total) => patch({ save: { done, total } }), record);
    if (stale(id)) return;
    patch({ status: "saved", record: saved, save: null });
    track("twin_saved", { twinId: saved.id, durationMs: Date.now() - state.startedAt, outcome: "ok", counts: { files: result.twin.atlases.length + 1 } });
    // Only now, with the twin saved and the session no longer busy: the analysis record, on its own (onto the device,
    // then to the account; analysisOutbox.ts). It never touches this session: the twin is "saved" before it starts
    // and stays so whatever happens to it, and the tab is free to close.
    if (result.analysis && analysisWanted(state.crop)) void saveAnalysisRecord(userId, saved, result.analysis);
  } catch (e) {
    if (stale(id)) return;
    const message = (e as Error).message;
    patch({ status: "save-failed", error: message });
    track("twin_save_failed", { twinId: id, outcome: "error", error: message });
  }
}

/**
 * Whether a build of this crop is asked for its analysis record (analysis.ts): corn only, only while the record is
 * switched on, and only for an account that gets one (the page that starts the build says so).
 */
const analysisWanted = (crop: BuildCrop) => crop === "corn" && TWIN_ANALYSIS_ENABLED && analysisAsked;

/** Try the save again (the files are still in this tab). */
export function retrySave(): void {
  if (state.status !== "save-failed" || !state.result) return;
  patch({ status: "saving", error: null });
  void save(state.result);
}

export function cancelBuild(): void {
  if (state.status === "building") run?.cancel();
}

/** Forget a finished, failed or cancelled build. A build still running or saving is kept. */
export function clearBuildSession(): void {
  if (sessionBusy()) return;
  run = null;
  set({ status: "idle" });
}

/**
 * Give up on a build whose save keeps failing. Its record in the account is already marked not saved (registry.ts),
 * and is listed as such with Delete; the photographs are untouched on the device.
 */
export function discardBuildSession(): void {
  if (state.status !== "save-failed") return;
  track("twin_build_cancelled", { twinId: state.id, outcome: "cancelled", detail: { crop: state.crop, stage: "save" } });
  run = null;
  set({ status: "idle" });
}

/**
 * The app is now open as `currentUser`. A build this tab holds for another account is not theirs: it is stopped and
 * forgotten, so nothing of it can be shown or saved under the wrong account. The same account: nothing happens.
 */
export function releaseSessionOfOtherAccount(currentUser: string | null): void {
  if (state.status === "idle" || userId === null || userId === currentUser) return;
  try { if (state.status === "building") run?.cancel(); } catch { /* already gone */ }
  run = null; userId = null; analysisAsked = false;
  set({ status: "idle" });
}

/** The in-memory twin and files of this tab's build, when it is the twin `id` (the viewer opens it before the save ends). */
export function sessionTwin(id: string): { twin: TwinBundle; files: Map<string, Blob>; pending: Promise<Map<string, Blob>> } | null {
  if (state.status === "idle" || !state.result || state.result.twin.id !== id) return null;
  return { twin: state.result.twin, files: state.result.files, pending: state.result.atlases };
}

/** Tests only. */
export function __resetBuildSession() { run = null; userId = null; analysisAsked = false; set({ status: "idle" }); }
