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
  outside: "#1f221f",
  hatch: "#2a2e2a",
  imagery: "#262a22",
  imageryEdge: "#5f665c",
  soil: "#3b3129",
  blockEdge: "#c9c0ae",
  /** Rows: quiet, a warm grey-violet. */
  row: "#8f88a8",
  rowDropped: "#5e6470",
  /** Crop: muted green. */
  tree: "#6aa884",
  treeFill: "rgba(106, 168, 132, 0.12)",
  vegetation: "#7fb393",
  vegetationFill: "rgba(127, 179, 147, 0.10)",
  /** Weeds: controlled amber. */
  weed: "#d9a93a",
  weedOnRow: "#d98b45",
  weedSingle: "#bfa86a",
  weedOnTree: "#7f8891",
  /** The pressure wash, one hue; alpha carries the amount. */
  pressureWash: "#b8862a",
  /** Scouting zones by priority: 1 red-orange, 2 orange, 3 amber. */
  zoneFill: ["", "#d2602c", "#d48a33", "#c9a53a"],
  zoneEdge: ["", "#e8805a", "#e0a55a", "#d8bb66"],
  uncertain: "rgba(140, 148, 160, 0.14)",
  footprint: "#7d8a7a",
  fieldHalo: "#e6c76a",
  labelBg: "rgba(24, 26, 24, 0.86)",
  labelText: "#eae6dc",
  labelOnField: "#1f221f",
  hover: "rgba(255, 255, 255, 0.5)",
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
