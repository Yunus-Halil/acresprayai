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

// One palette for the whole twin: charcoal ground, sage for the crop and the boundaries, amber for weeds, a
// restrained orange for the findings that matter most. No glow, no gradients.
export const TWIN_COLOURS = {
  outside: "#191d1a",
  hatch: "#20251f",
  imagery: "#222822",
  imageryEdge: "#879d85",
  soil: "#292f27",
  blockEdge: "#b9b3a4",
  /** Rows: quiet sage. */
  row: "#8aa08c",
  rowDropped: "#5a615b",
  /** Crop: muted green. */
  tree: "#78977c",
  treeFill: "rgba(120, 151, 124, 0.10)",
  vegetation: "#84a888",
  vegetationFill: "rgba(132, 168, 136, 0.09)",
  /** Weeds: controlled amber. */
  weed: "#c58a44",
  weedOnRow: "#c9783d",
  weedSingle: "#a9955f",
  weedOnTree: "#767e86",
  /** The pressure wash, one hue; alpha carries the amount. */
  pressureWash: "#c58a44",
  /** Scouting zones by priority: 1 the finding that matters most, 2 amber, 3 a pale amber. */
  zoneFill: ["", "#d77645", "#c58a44", "#a9955f"],
  zoneEdge: ["", "#d77645", "#c58a44", "#a9955f"],
  uncertain: "rgba(140, 148, 160, 0.12)",
  footprint: "#6c7a6c",
  fieldHalo: "#879d85",
  labelBg: "rgba(25, 29, 26, 0.9)",
  labelText: "#e4e1d8",
  labelOnField: "#191d1a",
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
