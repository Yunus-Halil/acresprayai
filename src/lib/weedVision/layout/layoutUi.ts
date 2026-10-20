// The operator's side of the planting layout: marking three plants on the map,
// accepting a proposal, saving the result for the field. Kept per scan outside
// the tab like the run stores.
import { useSyncExternalStore } from "react";
import type { LatLng2 } from "../../geo";
import { frameRunFieldRows, frameRunLayoutOf, getFrameRun, refinedLayoutBlocks, rereadFieldRows, setFrameRunLayout } from "../frameRunStore";
import { deleteFieldLayout, saveFieldLayout } from "./fieldLayoutStore";
import { type PlantingLayout, proposeFromRows } from "./readLayout";

/** An expected position the operator picked on the map, to say what is there. */
export type PickedPosition = { lat: number; lng: number; kind: "plant" | "gap"; state: string; uncertain: boolean };

export type LayoutUi = {
  /** The position picked for a verdict, if any. */
  picked: PickedPosition | null;
  /** Marking a planting: the plants clicked so far (three make one). */
  clicking: boolean;
  clicks: LatLng2[];
  /** Rows drawn on the map. */
  show: boolean;
  /** The layout in use differs from the field's saved one. */
  unsaved: boolean;
  saving: boolean;
  /** Where the last save went ("field": the field's table; "browser": this browser only). */
  savedTo: "field" | "browser" | null;
  error: string | null;
};
const EMPTY: LayoutUi = { picked: null, clicking: false, clicks: [], show: false, unsaved: false, saving: false, savedTo: null, error: null };
const state = new Map<string, LayoutUi>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getLayoutUi = (taskId: string): LayoutUi => state.get(taskId) ?? EMPTY;
function patch(taskId: string, p: Partial<LayoutUi>): void { state.set(taskId, { ...getLayoutUi(taskId), ...p }); for (const l of listeners) l(); }
export function useLayoutUi(taskId: string): LayoutUi { return useSyncExternalStore(subscribe, () => getLayoutUi(taskId), () => getLayoutUi(taskId)); }
export function resetLayoutUi(): void { state.clear(); for (const l of listeners) l(); }

/** The rows read again from the same marks: what the operator presses after an update, or when the lines look stale. */
export function rereadRows(taskId: string): void { patch(taskId, { error: null, show: true }); rereadFieldRows(taskId); }

export function startMarking(taskId: string): void { patch(taskId, { clicking: true, clicks: [], show: true, error: null, picked: null }); }

export function pickPosition(taskId: string, p: PickedPosition | null): void { patch(taskId, { picked: p }); }

/**
 * The operator's word on the picked position: a crop there (true), none (false), or no word (null, the verdict
 * removed). Kept in the layout, read again at once, and saved for the field when one is known.
 */
export async function setVerdict(taskId: string, input: { fieldId: string | null; userId: string | null; crop: boolean | null; save?: typeof saveFieldLayout }): Promise<void> {
  const ui = getLayoutUi(taskId);
  const cur = frameRunLayoutOf(taskId);
  if (!ui.picked || !cur) return;
  const { lat, lng } = ui.picked;
  const near = (v: { lat: number; lng: number }) => Math.hypot((v.lat - lat) * 111_320, (v.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180)) <= 0.6;
  const verdicts = (cur.verdicts ?? []).filter(v => !near(v));
  if (input.crop !== null) verdicts.push({ lat, lng, crop: input.crop, at: new Date().toISOString() });
  const layout: PlantingLayout = { ...cur, verdicts };
  patch(taskId, { picked: null, error: null });
  setFrameRunLayout(taskId, layout);
  if (input.fieldId) {
    const r = await (input.save ?? saveFieldLayout)({ fieldId: input.fieldId, userId: input.userId, layout });
    patch(taskId, { savedTo: r.savedTo, error: r.savedTo === "browser" && input.userId ? `Kept in this browser only: ${r.error ?? "the field's table is not there yet"}` : null });
  }
}
export function cancelMarking(taskId: string): void { patch(taskId, { clicking: false, clicks: [] }); }
export function setShowRows(taskId: string, show: boolean): void { patch(taskId, { show }); }

/** A plant clicked while marking; the third adds the planting to the layout in use (not saved yet). */
export function addClick(taskId: string, p: LatLng2): void {
  const ui = getLayoutUi(taskId);
  if (!ui.clicking) return;
  const clicks = [...ui.clicks, p];
  if (clicks.length < 3) { patch(taskId, { clicks }); return; }
  const cur = frameRunLayoutOf(taskId);
  const layout: PlantingLayout = { version: 1, blocks: [...(cur?.blocks ?? []), { points: [clicks[0], clicks[1], clicks[2]] }], confirmedAt: null };
  patch(taskId, { clicking: false, clicks: [], unsaved: true, show: true });
  setFrameRunLayout(taskId, layout);
}

/** The rows the reader found, taken as the planting (the operator said they look right). */
export function acceptReaderRows(taskId: string): boolean {
  const rows = frameRunFieldRows(taskId);
  const block = rows ? proposeFromRows(rows) : null;
  if (!block) { patch(taskId, { error: "These rows cannot be turned into a planting; mark three trees instead." }); return false; }
  patch(taskId, { unsaved: true, show: true, error: null });
  setFrameRunLayout(taskId, { version: 1, blocks: [block], confirmedAt: null });
  return true;
}

/** Remove the last planting marked (or all of them), back to what is left. */
export function undoLastPlanting(taskId: string): void {
  const cur = frameRunLayoutOf(taskId);
  if (!cur) return;
  const blocks = cur.blocks.slice(0, -1);
  patch(taskId, { unsaved: true });
  setFrameRunLayout(taskId, blocks.length ? { ...cur, blocks } : null);
}

/** The layout in use, as last refined, kept for the field. */
export async function saveLayout(taskId: string, input: { fieldId: string; userId: string | null; save?: typeof saveFieldLayout }): Promise<void> {
  const blocks = refinedLayoutBlocks(taskId) ?? frameRunLayoutOf(taskId)?.blocks;
  if (!blocks?.length || getFrameRun(taskId).fieldRowsSource !== "layout") { patch(taskId, { error: "Nothing to save: no rows were found from the marked trees." }); return; }
  patch(taskId, { saving: true, error: null });
  const layout: PlantingLayout = { version: 1, blocks, confirmedAt: new Date().toISOString(), verdicts: frameRunLayoutOf(taskId)?.verdicts ?? [] };
  const r = await (input.save ?? saveFieldLayout)({ fieldId: input.fieldId, userId: input.userId, layout });
  patch(taskId, { saving: false, unsaved: false, savedTo: r.savedTo, error: r.savedTo === "browser" && input.userId ? `Kept in this browser only: ${r.error ?? "the field's table is not there yet"}` : null });
  setFrameRunLayout(taskId, layout);
}

/** Forget the field's layout: the rows are read automatically again. */
export async function clearLayout(taskId: string, fieldId: string | null): Promise<void> {
  if (fieldId) await deleteFieldLayout(fieldId);
  patch(taskId, { unsaved: false, savedTo: null, clicks: [], clicking: false });
  setFrameRunLayout(taskId, null);
}
