// Field Twin colours and the layer set, shared by the renderer, the controls and the inspector.
//
// One palette on a dark ground: charcoal outside, a green-grey observed ground, a warmer block, sage crop
// structure, the pressure heatmap on fixed bands (green, amber, orange-red: heatmap.ts), amber for weed
// candidates, orange-red for the regions that matter. Flat colour, no glow, no gradients beyond the heatmap.
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
  /** The weed pressure heatmap (field level, fading as the detail comes in). */
  pressure: boolean;
  /** Boundaries and labels of the findings (regions, patches, weeds) the Explore Findings control selects. */
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
  outside: "#171a18",
  hatch: "#2a2f29",
  /** Observed ground inside the imagery hull. */
  imagery: "#212823",
  imageryEdge: "#8fb08f",
  /** The orchard block: warmer and a step lighter, so the rows read as inside it. */
  soil: "#2f3429",
  blockEdge: "#d9d3c0",
  /** Rows: sage, readable over the heatmap. */
  row: "#a7bfa8",
  rowDropped: "#5f665f",
  /** Crop: a fresh green. */
  tree: "#86c290",
  treeFill: "rgba(134, 194, 144, 0.12)",
  vegetation: "#8fd19a",
  vegetationFill: "rgba(143, 209, 154, 0.10)",
  /** Weeds: amber. */
  weed: "#f0a63a",
  weedOnRow: "#ee7e3a",
  weedSingle: "#b7a062",
  weedOnTree: "#7d868e",
  /** Findings: weeds and patches in amber, regions in orange-red (the heatmap's high end). */
  finding: "#f5b955",
  region: "#ff7a45",
  /** Kept for the inspector's zone header. */
  zoneFill: ["", "#ff7a45", "#f0a63a", "#b7a062"],
  uncertain: "rgba(140, 148, 160, 0.14)",
  footprint: "#6c7a6c",
  fieldHalo: "#8fb08f",
  labelBg: "rgba(20, 23, 20, 0.92)",
  labelText: "#ece8dc",
  labelOnField: "#171a18",
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
