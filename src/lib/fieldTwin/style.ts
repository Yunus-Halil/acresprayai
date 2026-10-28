// Field Twin colours and the layer set, shared by the renderer, the controls and the inspector.
//
// One palette on a dark ground: charcoal outside, a green-grey observed ground, a warmer block, sage crop
// structure, the pressure heatmap on fixed bands (green, amber, orange-red: heatmap.ts), amber for weed
// candidates, orange-red for the regions that matter. Flat colour, no glow, no gradients beyond the heatmap.
import type { HeatScaleMode } from "./heatmap";
import type { TwinWeed } from "./types";

export type TwinLayers = {
  /** Crop structure: the rows (and, with `crowns`, the trees). */
  structure: boolean;
  /** Tree crowns and tree points. Off, the crowns still come in at the plant level, where they are the measurement. */
  crowns: boolean;
  inferred: boolean;
  droppedRows: boolean;
  /** Weed candidates: measured outlines at the plant level (and, with `clusters`, soft discs at the row level). */
  weeds: boolean;
  clusters: boolean;
  /**
   * Which findings get a marker on the map: only the emphasised ones; those plus count badges where the findings
   * are not drawn as themselves ("summary"); or every qualifying finding, badges everywhere ("all"). The results
   * panel lists every qualifying finding whatever this says.
   */
  markers: TwinMarkers;
  singleView: boolean;
  /** Model detections that sit on tree crowns (diagnostics). */
  onTree: boolean;
  vegetation: boolean;
  /** The weed pressure heatmap (field level, fading as the detail comes in). */
  pressure: boolean;
  /** The pressure wash beyond the cultivated block too (observations there are kept either way). */
  beyondBoundary: boolean;
  /** The cultivated block's boundary, drawn by what each edge stands on. */
  boundary: boolean;
  /** The boundary evidence: what the photographs showed at each half metre (soil, canopy, cover, road, foreign). */
  evidence: boolean;
  /** Its colour scale: the bands raised to this field's own distribution of cover, or the fixed bands. */
  heatScale: HeatScaleMode;
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

export type TwinMarkers = "emphasised" | "summary" | "all";

/** The detail dial: three stops, or "custom" once a layer has been toggled by hand. */
export type TwinDetail = "simple" | "standard" | "full" | "custom";
export type TwinDetailStop = Exclude<TwinDetail, "custom">;

const DIAGNOSTICS = { inferred: true, droppedRows: false, singleView: false, onTree: false, uncertainty: false, footprints: false, evidence: false };
const GROUND = { pressure: true, beyondBoundary: false, boundary: true, heatScale: "field" as HeatScaleMode, zones: true, coverage: true, ground: true, surroundings: true };

/**
 * What each stop of the dial draws. Simple answers "where are the problems": the heatmap, the rows as orientation,
 * the emphasised findings, and the measured outlines once the plant level is reached. Standard adds the crop
 * structure and the row-level weed discs. Full is everything, with a marker for every qualifying finding.
 */
export const DETAIL_PRESETS: Record<TwinDetailStop, TwinLayers> = {
  simple: { ...GROUND, ...DIAGNOSTICS, structure: true, crowns: false, weeds: true, clusters: false, vegetation: false, markers: "emphasised" },
  standard: { ...GROUND, ...DIAGNOSTICS, structure: true, crowns: true, weeds: true, clusters: true, vegetation: true, markers: "summary" },
  full: { ...GROUND, ...DIAGNOSTICS, structure: true, crowns: true, weeds: true, clusters: true, vegetation: true, markers: "all" },
};

export const DEFAULT_LAYERS: TwinLayers = DETAIL_PRESETS.simple;
export const DETAIL_STOPS: TwinDetailStop[] = ["simple", "standard", "full"];
export const DETAIL_LABEL: Record<TwinDetail, string> = { simple: "Simple", standard: "Standard", full: "Full", custom: "Custom" };

/** The stop whose preset the layers match exactly, else "custom". */
export function detailOf(layers: TwinLayers): TwinDetail {
  for (const stop of DETAIL_STOPS) {
    const p = DETAIL_PRESETS[stop];
    if ((Object.keys(p) as (keyof TwinLayers)[]).every(k => p[k] === layers[k])) return stop;
  }
  return "custom";
}

/**
 * The one rule behind the count badges: a badge summarises findings only where they are not drawn as themselves.
 * With "all" markers a badge is always allowed (the full picture); with "emphasised" never (only the emphasised
 * findings are marked, each on itself). In between, weeds are "drawn as themselves" once the row-level discs or
 * the plant-level outlines are on screen, and patches once their boundaries are.
 */
export function badgesAllowed(markers: TwinMarkers, drawnAsThemselves: boolean): boolean {
  if (markers === "all") return true;
  if (markers === "emphasised") return false;
  return !drawnAsThemselves;
}

export const TWIN_COLOURS = {
  outside: "#171a18",
  hatch: "#2a2f29",
  /** Observed ground inside the imagery hull. */
  imagery: "#212823",
  imageryEdge: "#8fb08f",
  /** The orchard block: warmer and a step lighter, so the rows read as inside it. */
  soil: "#2f3429",
  blockEdge: "#d9d3c0",
  /** The boundary by what it stands on: an edge in the photographs, bridged between found pieces, a cap, the
   * end of the photographs, the planting's default margin; and the operator's accepted or corrected boundary. */
  boundaryPhotographs: "#d9d3c0",
  boundaryBridged: "#b9d9b0",
  boundaryCap: "#f0a63a",
  boundaryCoverage: "#7fb0ff",
  boundaryDefault: "#9a9f98",
  boundaryOperational: "#ffffff",
  boundaryHandle: "#ffffff",
  /** Boundary evidence classes (soil, canopy, cover, road, foreign), translucent over the ground. */
  evidence: { soil: "rgba(150,110,80,0.45)", canopy: "rgba(70,150,80,0.5)", cover: "rgba(190,200,70,0.55)", road: "rgba(210,210,210,0.55)", foreign: "rgba(170,90,200,0.55)" },
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
