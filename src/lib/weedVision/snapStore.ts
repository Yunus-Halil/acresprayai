// The outlines' snaps onto the map (snap.ts), worked through in the
// background: the outlines in view first, then every other one shown, a
// few milliseconds at a time between frames so the map never stalls. The
// map layer reads the result and redraws at most every PUBLISH_MS.
import { useSyncExternalStore } from "react";
import type { GroundPlant } from "./frames";
import { frameRunMapOf } from "./frameRunStore";
import { isMapFrame } from "./mapRun";
import { type Snap, SNAP_MAX_FROM_MAP_M, SNAP_MAX_FROM_PHOTO_M, snapOutline, snapZoom } from "./snap";

/** A plant's snap key: its id and where it stands, so a plant placed again is snapped again. */
export const snapKey = (p: Pick<GroundPlant, "id" | "centre">): string => `${p.id}@${p.centre ? `${p.centre.lat.toFixed(7)},${p.centre.lng.toFixed(7)}` : "-"}`;

/** Work per slice, milliseconds, before handing the thread back. */
export const SLICE_MS = 8;
/** The layer hears about new snaps at most this often. */
export const PUBLISH_MS = 400;

type TaskSnaps = {
  done: Map<string, Snap | null>;
  /** Waiting, in order; the view's outlines are put at the front. */
  queue: Map<string, GroundPlant>;
  version: number;
  running: boolean;
  lastPublish: number;
  timer: ReturnType<typeof setTimeout> | null;
};
const tasks = new Map<string, TaskSnaps>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
function taskOf(taskId: string): TaskSnaps {
  let t = tasks.get(taskId);
  if (!t) { t = { done: new Map(), queue: new Map(), version: 0, running: false, lastPublish: 0, timer: null }; tasks.set(taskId, t); }
  return t;
}

/** The snap of a plant, when worked out: a shift, or null for "stays where it is". */
export function snapOf(taskId: string, p: Pick<GroundPlant, "id" | "centre">): Snap | null | undefined {
  return tasks.get(taskId)?.done.get(snapKey(p));
}

/** A plant moved by its snap (the same object when it has none). */
export function snapped<P extends Pick<GroundPlant, "id" | "centre" | "ring">>(taskId: string, p: P): P {
  const s = snapOf(taskId, p);
  if (!s) return p;
  return { ...p, centre: p.centre && { lat: p.centre.lat + s.dLat, lng: p.centre.lng + s.dLng }, ring: p.ring && p.ring.map(q => ({ lat: q.lat + s.dLat, lng: q.lng + s.dLng })) };
}

function publish(taskId: string, force = false): void {
  const t = taskOf(taskId);
  const due = () => { t.timer = null; t.lastPublish = Date.now(); t.version++; emit(); };
  if (force || Date.now() - t.lastPublish >= PUBLISH_MS) { if (t.timer) { clearTimeout(t.timer); t.timer = null; } due(); return; }
  if (!t.timer) t.timer = setTimeout(due, PUBLISH_MS - (Date.now() - t.lastPublish));
}

/** The snapper: the next outline each time, SLICE_MS of work, then the thread back. */
type Snapper = typeof snapOutline;
let snapper: Snapper = snapOutline;
/** For tests: the snapping itself. */
export function setSnapper(s: Snapper | null): void { snapper = s ?? snapOutline; }

async function run(taskId: string): Promise<void> {
  const t = taskOf(taskId);
  if (t.running) return;
  t.running = true;
  try {
    while (t.queue.size) {
      const map = frameRunMapOf(taskId);
      if (!map) break;
      const z = snapZoom(map.maxNative, map.lat);
      const start = performance.now();
      while (t.queue.size && performance.now() - start < SLICE_MS) {
        const [key, p] = t.queue.entries().next().value as [string, GroundPlant];
        t.queue.delete(key);
        if (t.done.has(key) || !p.centre || !p.ring) { if (!t.done.has(key)) t.done.set(key, null); continue; }
        let s: Snap | null = null;
        try { s = await snapper({ ring: p.ring, centre: p.centre, maxShiftM: isMapFrame(p.frame) ? SNAP_MAX_FROM_MAP_M : SNAP_MAX_FROM_PHOTO_M, tile: map.tile, z }); } catch { s = null; }
        t.done.set(key, s);
        if (s) publish(taskId);
      }
      // The thread back to the page between slices.
      await new Promise(res => setTimeout(res, 0));
    }
  } finally {
    t.running = false;
    publish(taskId, true);
  }
}

/** Ask for plants to be snapped: `first` puts them at the front (the outlines in view). Already snapped ones are skipped. */
export function requestSnaps(taskId: string, plants: GroundPlant[], first = false): void {
  const t = taskOf(taskId);
  const fresh: [string, GroundPlant][] = [];
  for (const p of plants) {
    if (!p.ring || !p.centre) continue;
    const k = snapKey(p);
    if (t.done.has(k)) continue;
    if (first) t.queue.delete(k);
    else if (t.queue.has(k)) continue;
    fresh.push([k, p]);
  }
  if (!fresh.length) return;
  if (first) {
    const rest = [...t.queue.entries()];
    t.queue.clear();
    for (const [k, p] of [...fresh, ...rest]) t.queue.set(k, p);
  } else for (const [k, p] of fresh) t.queue.set(k, p);
  void run(taskId);
}

/** How far the snapping has got for a scan. */
export function snapProgress(taskId: string): { done: number; waiting: number; moved: number } {
  const t = tasks.get(taskId);
  if (!t) return { done: 0, waiting: 0, moved: 0 };
  let moved = 0;
  for (const s of t.done.values()) if (s) moved++;
  return { done: t.done.size, waiting: t.queue.size, moved };
}

function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** A number that changes whenever new snaps for the scan are ready. */
export function useSnapVersion(taskId: string): number {
  return useSyncExternalStore(subscribe, () => tasks.get(taskId)?.version ?? 0, () => tasks.get(taskId)?.version ?? 0);
}

/** For tests. */
export function resetSnaps(): void {
  for (const t of tasks.values()) if (t.timer) clearTimeout(t.timer);
  tasks.clear();
}
