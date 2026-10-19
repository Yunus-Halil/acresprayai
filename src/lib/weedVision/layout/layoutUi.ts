// The operator's side of the planting layout: marking three plants on the map,
// accepting a proposal, saving the result for the field. Kept per scan outside
// the tab like the run stores.
import { useSyncExternalStore } from "react";
import type { LatLng2 } from "../../geo";
import { frameRunFieldRows, frameRunLayoutOf, getFrameRun, refinedLayoutBlocks, setFrameRunLayout } from "../frameRunStore";
import { deleteFieldLayout, saveFieldLayout } from "./fieldLayoutStore";
import { type PlantingLayout, proposeFromRows } from "./readLayout";

export type LayoutUi = {
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
const EMPTY: LayoutUi = { clicking: false, clicks: [], show: false, unsaved: false, saving: false, savedTo: null, error: null };
const state = new Map<string, LayoutUi>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getLayoutUi = (taskId: string): LayoutUi => state.get(taskId) ?? EMPTY;
function patch(taskId: string, p: Partial<LayoutUi>): void { state.set(taskId, { ...getLayoutUi(taskId), ...p }); for (const l of listeners) l(); }
export function useLayoutUi(taskId: string): LayoutUi { return useSyncExternalStore(subscribe, () => getLayoutUi(taskId), () => getLayoutUi(taskId)); }
export function resetLayoutUi(): void { state.clear(); for (const l of listeners) l(); }

export function startMarking(taskId: string): void { patch(taskId, { clicking: true, clicks: [], show: true, error: null }); }
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
  const layout: PlantingLayout = { version: 1, blocks, confirmedAt: new Date().toISOString() };
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
