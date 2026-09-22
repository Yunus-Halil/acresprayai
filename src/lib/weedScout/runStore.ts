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
import { type RunOptions, runWeedScout } from "./pipeline";
import type { ScoutInputs, ScoutProgress, ScoutResult } from "./types";

export type ScoutSession = {
  running: boolean;
  progress: ScoutProgress | null;
  result: ScoutResult | null;
  error: string | null;
  selectedId: string | null;
  /** The operator's edits for this run, by spot id. */
  verdicts: Record<string, Verdict>;
  identifications: Record<string, Identification>;
  notes: Record<string, string>;
  /** Spots applied to Field View during this session, spot id to annotation id. */
  localApplied: Record<string, string>;
};

export const EMPTY_SESSION: ScoutSession = {
  running: false, progress: null, result: null, error: null, selectedId: null,
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
export function startRun(taskId: string, inputs: ScoutInputs, opts: Omit<RunOptions, "onProgress" | "signal">): void {
  if (getSession(taskId).running) return;
  const ctrl = new AbortController();
  controllers.set(taskId, ctrl);
  patchSession(taskId, {
    running: true, progress: null, result: null, error: null, selectedId: null,
    verdicts: {}, identifications: {}, notes: {},
  });
  runWeedScout(inputs, {
    ...opts,
    signal: ctrl.signal,
    onProgress: (p) => { if (controllers.get(taskId) === ctrl) patchSession(taskId, { progress: p }); },
  }).then(result => {
    if (controllers.get(taskId) !== ctrl) return;
    patchSession(taskId, { running: false, progress: null, result });
  }).catch((e: unknown) => {
    if (controllers.get(taskId) !== ctrl) return;
    const aborted = (e as Error)?.name === "Aborted";
    patchSession(taskId, { running: false, progress: null, error: aborted ? null : ((e as Error)?.message ?? String(e)) });
  }).finally(() => {
    if (controllers.get(taskId) === ctrl) controllers.delete(taskId);
  });
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
