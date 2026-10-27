// Field Twin colours and the layer set, shared by the renderer, the controls and the inspector.
//
// A restrained palette on a dark ground: soil and olive for the field, lavender for the planting, green for the
// crop, amber for weeds (the one thing meant to stand out), grey for what is uncertain or diagnostic.
import type { TwinWeed } from "./types";

export type TwinLayers = {
  /** Crop structure: rows, trees, the orchard block. */
  structure: boolean;
  inferred: boolean;
  droppedRows: boolean;
  /** Weed candidates: clusters at the row level, measured outlines at the plant level. */
  weeds: boolean;
  singleView: boolean;
  /** Model detections that sit on tree crowns (diagnostics). */
  onTree: boolean;
  vegetation: boolean;
  /** Weed pressure cells (field level). */
  pressure: boolean;
  zones: boolean;
  /** Ground only one photograph saw. */
  uncertainty: boolean;
  /** Imagery coverage: the hull and the hatch beyond it. */
  coverage: boolean;
  /** Every photograph's footprint (diagnostics). */
  footprints: boolean;
  /** The ground fill itself; off when reference imagery is shown underneath. */
  ground: boolean;
  /** The field's surroundings: a muted basemap of OpenStreetMap data, seen when zoomed out. */
  surroundings: boolean;
};

export const DEFAULT_LAYERS: TwinLayers = {
  structure: true, inferred: true, droppedRows: false, weeds: true, singleView: false, onTree: false, vegetation: true,
  pressure: true, zones: true, uncertainty: false, coverage: true, footprints: false, ground: true, surroundings: true,
};

export const TWIN_COLOURS = {
  outside: "#1a1c1a",
  hatch: "#262927",
  imagery: "#23271f",
  imageryEdge: "#5a6058",
  soil: "#3a3028",
  blockEdge: "#d2c9b8",
  row: "#a394e0",
  rowDropped: "#6b7280",
  tree: "#5fbf7a",
  treeFill: "rgba(95, 191, 122, 0.14)",
  vegetation: "#8fd3a5",
  vegetationFill: "rgba(143, 211, 165, 0.12)",
  weed: "#f2c230",
  weedOnRow: "#f49a3e",
  weedSingle: "#d9c37a",
  weedOnTree: "#8a949e",
  clusterFill: "rgba(242, 194, 48, 0.26)",
  clusterSingleFill: "rgba(217, 195, 122, 0.12)",
  /** Indexed by pressure class: none, trace, low, moderate, high. */
  pressure: ["", "#4a4430", "#6e5b2a", "#9a7a22", "#cf9a1c"],
  zone: "#f2c230",
  uncertain: "rgba(130, 140, 160, 0.16)",
  footprint: "#7d8a7a",
  labelBg: "rgba(20, 22, 20, 0.78)",
  labelOnField: "#1a1c1a",
  hover: "rgba(255, 255, 255, 0.55)",
  selection: "#ffffff",
};

export const WEED_COLOUR = { betweenRows: TWIN_COLOURS.weed, onRow: TWIN_COLOURS.weedOnRow, single: TWIN_COLOURS.weedSingle, onTree: TWIN_COLOURS.weedOnTree };
export const TREE_COLOUR = TWIN_COLOURS.tree;
export const ROW_COLOUR = TWIN_COLOURS.row;

/** Amber between the rows (the candidates that matter), orange on a row, pale for one sighting, grey on a tree. */
export function weedColour(w: Pick<TwinWeed, "status" | "rowStatus">): string {
  if (w.status === "on a tree") return WEED_COLOUR.onTree;
  if (w.status === "single view") return WEED_COLOUR.single;
  return w.rowStatus === "on a row" ? WEED_COLOUR.onRow : WEED_COLOUR.betweenRows;
}
