// Field Twin colours and the default layer set, shared by the map and the page.
import type { TwinWeed } from "./types";

export type TwinLayers = {
  rows: boolean;
  droppedRows: boolean;
  trees: boolean;
  inferred: boolean;
  verified: boolean;
  singleView: boolean;
  onTree: boolean;
  vegetation: boolean;
  coverage: boolean;
};

export const DEFAULT_LAYERS: TwinLayers = { rows: true, droppedRows: false, trees: true, inferred: true, verified: true, singleView: false, onTree: false, vegetation: false, coverage: true };

export const WEED_COLOUR = { betweenRows: "#facc15", onRow: "#fb923c", single: "#fde68a", onTree: "#94a3b8" };
export const TREE_COLOUR = "#4ade80";
export const ROW_COLOUR = "#a78bfa";

/** Yellow between the rows (the candidates that matter), orange on a row, pale for one sighting, grey on a tree. */
export function weedColour(w: Pick<TwinWeed, "status" | "rowStatus">): string {
  if (w.status === "on a tree") return WEED_COLOUR.onTree;
  if (w.status === "single view") return WEED_COLOUR.single;
  return w.rowStatus === "on a row" ? WEED_COLOUR.onRow : WEED_COLOUR.betweenRows;
}
