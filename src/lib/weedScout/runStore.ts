// The scout's run and review, kept outside the tab so leaving the tab does
// not end them.
//
// The workspace mounts one tab at a time. When the run lived in the tab's
// own state, opening Field View mid-scan unmounted the component, and its
// cleanup aborted the pipeline and dropped every keep / remove decision made
// so far. Nothing about a run needs the component: it reads tiles and does
// arithmetic. So the run, its progress, its result and the operator's edits
// live here, per scan, for the life of the page. The tab subscribes, and a
// run only stops when the operator presses Stop or the page goes away.
//
// Held in memory only, on purpose: the archive is the durable record and
// "Save all" is how a review reaches it.
import { useSyncExternalStore } from "react";
import type { Identification } from "../weedCatalog/identification";
import type { Verdict } from "./observations";
import type { PatternLive } from "./fieldPattern";
import { type RunOptions, runWeedScout } from "./pipeline";
import { runPhotoPass } from "./photoPass";
import { loadRun, saveRun } from "./runCache";
import type { ScoutInputs, ScoutProgress, ScoutResult } from "./types";

/** The photo pass after the map pass: where it is, what it has found, and what it said when it finished. */
export type PhotoPassState = { running: boolean; done: number; total: number; found: number; looks: number; note: string | null };

export type ScoutSession = {
  running: boolean;
  progress: ScoutProgress | null;
  result: ScoutResult | null;
  error: string | null;
  photo: PhotoPassState | null;
  /** The pattern pass as it runs, window by window; null once the result holds the whole pattern. */
  live: PatternLive | null;
  /** What saving the run said, when it said anything. */
  cache: string | null;
  selectedId: string | null;
  /** The operator's edits for this run, by spot id. */
  verdicts: Record<string, Verdict>;
  identifications: Record<string, Identification>;
  notes: Record<string, string>;
  /** Spots applied to Field View during this session, spot id to annotation id. */
  localApplied: Record<string, string>;
};

export const EMPTY_SESSION: ScoutSession = {
  running: false, progress: null, result: null, error: null, photo: null, live: null, cache: null, selectedId: null,
  verdicts: {}, identifications: {}, notes: {}, localApplied: {},
};

const sessions = new Map<string, ScoutSession>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function getSession(taskId: string): ScoutSession {
  return sessions.get(taskId) ?? EMPTY_SESSION;
}

export function patchSession(taskId: string, patch: Partial<ScoutSession> | ((s: ScoutSession) => Partial<ScoutSession>)): void {
  const cur = getSession(taskId);
  const p = typeof patch === "function" ? patch(cur) : patch;
  sessions.set(taskId, { ...cur, ...p });
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The session for a scan, re-rendering the caller whenever it changes. */
export function useScoutSession(taskId: string): ScoutSession {
  return useSyncExternalStore(subscribe, () => getSession(taskId), () => getSession(taskId));
}

/**
 * Start a run for a scan. A run already in progress for that scan is left
 * alone (the caller sees `running` and offers Stop). Edits from the previous
 * run are cleared: they were keyed to spots that may no longer exist.
 */
/** Where to save the run, when the operator is signed in. */
export type PersistTo = { userId: string; fieldId: string | null };

export function startRun(taskId: string, inputs: ScoutInputs, opts: Omit<RunOptions, "onProgress" | "signal"> & { persist?: PersistTo }): void {
  if (getSession(taskId).running) return;
  const ctrl = new AbortController();
  controllers.set(taskId, ctrl);
  patchSession(taskId, {
    running: true, progress: null, result: null, error: null, photo: null, live: null, cache: null, selectedId: null,
    verdicts: {}, identifications: {}, notes: {},
  });
  const persist = async (what: string) => {
    if (!opts.persist) return;
    const s = getSession(taskId);
    if (!s.result) return;
    const out = await saveRun({ userId: opts.persist.userId, fieldId: opts.persist.fieldId, scanId: taskId, result: s.result, params: inputs.params });
    if (mine()) patchSession(taskId, { cache: out.ok ? `Saved ${what}.` : `The run could not be saved (${"error" in out ? out.error : "unknown"}); it is still here until you leave.` });
  };
  const mine = () => controllers.get(taskId) === ctrl;
  runWeedScout(inputs, {
    ...opts,
    signal: ctrl.signal,
    onProgress: (p) => { if (mine()) patchSession(taskId, { progress: p }); },
    onPatternWindow: (live) => { if (mine()) patchSession(taskId, { live }); },
  }).then(async result => {
    if (!mine()) return;
    patchSession(taskId, { running: false, progress: null, result, live: null });
    await persist("the scan");
    // The photos, after the map pass has shown its result. The review can
    // start now; findings from the photos join the list as they land, and
    // Stop ends this too. Not on a connection the browser says to spare.
    const sources = opts.sources;
    if (!inputs.params.photoPass || !sources?.set || !sources.frames || sources.groundAltM == null) return;
    if (frugalConnection()) { patchSession(taskId, { photo: { running: false, done: 0, total: 0, found: 0, looks: 0, note: "The photos were not read: the browser asks to spare this connection." } }); return; }
    patchSession(taskId, { photo: { running: true, done: 0, total: 0, found: 0, looks: 0, note: null } });
    try {
      const pass = await runPhotoPass({
        result, sources, boundary: inputs.boundary, params: inputs.params,
        crop: opts.crop, growthStage: opts.growthStage, unitSystem: opts.unitSystem, signal: ctrl.signal,
        onProgress: p => { if (mine()) patchSession(taskId, s => ({ photo: { ...(s.photo ?? { running: true, note: null }), running: true, done: p.done, total: p.total, found: p.found, looks: p.looks } })); },
        onFound: found => { if (mine()) patchSession(taskId, s => ({ result: s.result ? { ...s.result, candidates: [...s.result.candidates, ...found] } : s.result })); },
        // The map pass's spots get their look as their photo is read; the closer look opens on it.
        onLook: looks => { if (mine()) patchSession(taskId, s => ({ result: s.result ? { ...s.result, candidates: s.result.candidates.map(c => looks[c.id] ? { ...c, look: looks[c.id] } : c) } : s.result })); },
      });
      if (!mine()) return;
      patchSession(taskId, s => ({
        photo: { running: false, done: pass.reads.length, total: pass.reads.length, found: pass.candidates.length, looks: Object.keys(pass.looks).length, note: pass.notes.join(" ") },
        result: s.result ? { ...s.result, notes: [...s.result.notes, ...pass.notes] } : s.result,
      }));
      if (pass.candidates.length || Object.keys(pass.looks).length) await persist("the scan and the photos");
    } catch (e) {
      if (!mine()) return;
      const aborted = (e as Error)?.name === "Aborted";
      patchSession(taskId, s => ({ photo: { ...(s.photo ?? { done: 0, total: 0, found: 0, looks: 0 }), running: false, note: aborted ? "Reading the photos was stopped." : `Reading the photos failed: ${(e as Error)?.message ?? String(e)}` } }));
    }
  }).catch((e: unknown) => {
    if (!mine()) return;
    const aborted = (e as Error)?.name === "Aborted";
    patchSession(taskId, { running: false, progress: null, error: aborted ? null : ((e as Error)?.message ?? String(e)) });
  }).finally(() => {
    if (mine()) controllers.delete(taskId);
  });
}

/** The browser's own word that this connection is to be spared. */
function frugalConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return conn?.saveData === true || (conn?.effectiveType ? /^(slow-)?2g$/.test(conn.effectiveType) : false);
}

/**
 * The last saved run for a scan, into the session, when nothing is running
 * and nothing is loaded. The chips are not kept, so spots open without one
 * until the scan is run again.
 */
export async function restoreRun(taskId: string): Promise<boolean> {
  const s = getSession(taskId);
  if (s.running || s.result) return false;
  const result = await loadRun(taskId);
  const now = getSession(taskId);
  if (!result || now.running || now.result) return false;
  patchSession(taskId, { result, cache: null });
  return true;
}

/** Stop a run. Only the operator calls this; leaving the tab does not. */
export function stopRun(taskId: string): void {
  controllers.get(taskId)?.abort();
}

/** Test seam. */
export function resetScoutSessions(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  sessions.clear();
  emit();
}
