// The detector's boxes on the map, for the life of the page.
//
// Held in memory per scan, like the scout's run (weedScout/runStore.ts), so
// the boxes drawn from a closer look in Weed Scout are the same boxes Field
// View shows, and leaving a tab does not lose them. Nothing here is saved:
// the detector is an experimental yardstick, and its word reaches no table,
// no verdict and no treatment. Asking again about the same photo of the same
// finding replaces that photo's boxes rather than stacking them.
import { useSyncExternalStore } from "react";
import type { GroundedDetection } from "./detections";

export type DetectionLayer = {
  /** The developer toggle: whether the map draws the boxes. */
  visible: boolean;
  detections: GroundedDetection[];
};

export const EMPTY_LAYER: DetectionLayer = { visible: true, detections: [] };

const layers = new Map<string, DetectionLayer>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const getDetectionLayer = (taskId: string): DetectionLayer => layers.get(taskId) ?? EMPTY_LAYER;

function patch(taskId: string, p: Partial<DetectionLayer>) {
  layers.set(taskId, { ...getDetectionLayer(taskId), ...p });
  emit();
}

/** Add a closer look's boxes, replacing any earlier boxes from the same finding and photo. */
export function addDetections(taskId: string, list: GroundedDetection[]): void {
  if (!list.length) return;
  const replaced = new Set(list.map(d => `${d.findingId}:${d.frame}`));
  const kept = getDetectionLayer(taskId).detections.filter(d => !replaced.has(`${d.findingId}:${d.frame}`));
  patch(taskId, { detections: [...kept, ...list] });
}

export function clearDetections(taskId: string): void {
  patch(taskId, { detections: [] });
}

export function setDetectionsVisible(taskId: string, visible: boolean): void {
  patch(taskId, { visible });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The scan's detection layer, re-rendering the caller whenever it changes. */
export function useDetectionLayer(taskId: string): DetectionLayer {
  return useSyncExternalStore(subscribe, () => getDetectionLayer(taskId), () => getDetectionLayer(taskId));
}

/** For tests. */
export function resetDetectionStore(): void {
  layers.clear();
  emit();
}
