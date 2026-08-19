// What to draw of a treatment grid, and where — the part of rendering that has
// no Leaflet in it.
//
// WHY THIS IS SEPARATE. A 1000 ha field at 6 m cells is ~28,000 cells and the
// ceiling is 20,000, so "give every cell its own map layer" is not an option
// that merely runs slowly — it is one that stalls the browser on a pan. What
// keeps it cheap is culling and level-of-detail, and both are arithmetic. Kept
// here they can be tested against numbers rather than against a map somebody
// has to look at.
//
// TreatmentGridLayer.tsx owns the canvas and the Leaflet plumbing; it asks this
// module what to paint.
import { type LatLng2, pointInRing } from "./geo";
import type { TreatmentCell, TreatmentGrid } from "./treatmentGrid";

/** Geographic extent of what the operator can currently see. */
export type Viewport = { north: number; south: number; east: number; west: number };

/**
 * Per-cell bounding boxes, packed flat: [minLat, maxLat, minLng, maxLng] × n.
 *
 * Culling touches every cell on every pan, so it must not walk cell rings. A
 * flat Float64Array is four sequential reads per cell with no pointer chasing,
 * and it is computed once per grid rather than once per frame.
 */
export type CellBounds = Float64Array;

export function cellBoundsOf(cells: TreatmentCell[]): CellBounds {
  const out = new Float64Array(cells.length * 4);
  for (let i = 0; i < cells.length; i++) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of cells[i].ring) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    out[i * 4] = minLat; out[i * 4 + 1] = maxLat;
    out[i * 4 + 2] = minLng; out[i * 4 + 3] = maxLng;
  }
  return out;
}

/**
 * Indices of cells overlapping the viewport.
 *
 * `padDeg` keeps a margin of off-screen cells so a small pan does not expose an
 * unpainted edge before the next redraw lands.
 */
export function visibleCells(bounds: CellBounds, view: Viewport, padDeg = 0): number[] {
  const n = bounds.length / 4;
  const south = view.south - padDeg, north = view.north + padDeg;
  const west = view.west - padDeg, east = view.east + padDeg;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    if (bounds[b + 1] < south || bounds[b] > north) continue;
    if (bounds[b + 3] < west || bounds[b + 2] > east) continue;
    out.push(i);
  }
  return out;
}

/** Ground metres per screen pixel in Web Mercator. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * How much of each cell is worth drawing.
 *
 *   sparse  — cells are a few pixels or less. Individual outlines are sub-pixel
 *             noise, so only cells carrying a DECISION are drawn: the operator
 *             still sees where treatment is, and the undecided majority costs
 *             nothing to paint.
 *   fill    — cells read as shapes but their outlines do not. A 1 px stroke
 *             around an 8 px square is mostly border, and a field of them reads
 *             as a smear rather than a grid.
 *   outline — cells are large enough that the grid structure is information.
 */
export type DetailLevel = "sparse" | "fill" | "outline";

/** Below this many pixels across, a cell is not a shape on screen. */
export const SPARSE_BELOW_PX = 3;
/** Below this, a cell is a shape but its outline is not. */
export const OUTLINE_ABOVE_PX = 10;
/**
 * Stroking is per-cell path work, and past a few thousand cells it is what
 * turns a pan into a stutter. Above this count the grid drops to fills even
 * when zoomed in far enough to justify outlines — the operator loses cell
 * borders, not cell state.
 */
export const MAX_STROKED_CELLS = 4_000;

export function detailFor(cellPx: number, visibleCount: number): DetailLevel {
  if (cellPx < SPARSE_BELOW_PX) return "sparse";
  if (cellPx < OUTLINE_ABOVE_PX) return "fill";
  return visibleCount > MAX_STROKED_CELLS ? "fill" : "outline";
}

/** A cell nobody has decided anything about — the pre-analysis majority. */
export const isUndecided = (c: TreatmentCell): boolean =>
  c.rate.state === "untreated" && c.rate.source === "default";

/**
 * Which of the visible cells to actually paint.
 *
 * At `sparse` the undecided majority is dropped, which is the entire reason
 * that level exists — so it is applied here rather than left to each caller to
 * remember.
 */
export function paintList(
  cells: TreatmentCell[], visible: number[], level: DetailLevel,
): number[] {
  if (level !== "sparse") return visible;
  return visible.filter(i => !isUndecided(cells[i]));
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Rate range across the grid, used to scale the fill ramp.
 *
 * Scaled to the grid's OWN range rather than a fixed 0..100 L/ha: a field
 * sprayed between 18 and 22 L/ha would otherwise render as one flat colour and
 * hide the variation that is the whole point of a prescription.
 */
export function rateRange(grid: TreatmentGrid): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (const c of grid.cells) {
    if (c.rate.state !== "treated") continue;
    if (c.rate.rateLha < min) min = c.rate.rateLha;
    if (c.rate.rateLha > max) max = c.rate.rateLha;
  }
  return isFinite(min) ? { min, max } : null;
}

export type CellPaint = { fill: string; stroke: string };

const UNDECIDED: CellPaint = { fill: "rgba(148,163,184,0.10)", stroke: "rgba(148,163,184,0.35)" };
// Deliberately-not-sprayed is a decision, and must not look like the absence of
// one, so it gets its own colour rather than a fainter grey.
const SKIPPED: CellPaint = { fill: "rgba(56,189,248,0.16)", stroke: "rgba(56,189,248,0.65)" };

/**
 * Fill and stroke for one cell.
 *
 * Treated cells ramp yellow→red with rate. Green is avoided deliberately: on an
 * orthomosaic of a green field it is the one hue that cannot be read. Hand-set
 * cells stroke brighter than computed ones, because an operator override is
 * exactly what a later threshold re-run must not silently wipe — so which cells
 * those are should be visible without clicking them.
 */
export function cellPaint(
  cell: TreatmentCell, range: { min: number; max: number } | null,
): CellPaint {
  if (cell.rate.state === "untreated") {
    return cell.rate.source === "default" ? UNDECIDED : SKIPPED;
  }
  const span = range && range.max > range.min ? range.max - range.min : 0;
  const t = span > 0 ? (cell.rate.rateLha - range!.min) / span : 1;
  const r = 250;
  const g = Math.round(204 - 150 * t);
  const b = Math.round(61 - 40 * t);
  return {
    fill: `rgba(${r},${g},${b},${(0.30 + 0.35 * t).toFixed(3)})`,
    stroke: cell.rate.source === "operator"
      ? `rgba(${r},${g},${b},0.95)`
      : `rgba(${r},${g},${b},0.55)`,
  };
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * The cell under a point, or null.
 *
 * Searched over the already-culled list, so a click costs the viewport rather
 * than the field. The bbox test rejects almost everything before the ring test
 * runs.
 */
export function cellAt(
  cells: TreatmentCell[], bounds: CellBounds, candidates: number[], pt: LatLng2,
): number | null {
  for (const i of candidates) {
    const b = i * 4;
    if (pt.lat < bounds[b] || pt.lat > bounds[b + 1]) continue;
    if (pt.lng < bounds[b + 2] || pt.lng > bounds[b + 3]) continue;
    if (pointInRing(pt, cells[i].ring)) return i;
  }
  return null;
}

/**
 * Cells whose CENTROID falls within `radiusM` of a point — the paint brush.
 *
 * Centroid rather than ring overlap: a brush that catches every cell it grazes
 * makes one drag along a boundary paint a ragged extra row the operator never
 * aimed at. Centroids give the predictable "what is under the cursor" result.
 */
export function cellsNear(
  cells: TreatmentCell[], candidates: number[], pt: LatLng2, radiusM: number,
): number[] {
  const perDegLat = 111_320;
  const perDegLng = perDegLat * Math.cos((pt.lat * Math.PI) / 180);
  const out: number[] = [];
  const r2 = radiusM * radiusM;
  for (const i of candidates) {
    const c = cells[i].centroid;
    const dy = (c.lat - pt.lat) * perDegLat;
    const dx = (c.lng - pt.lng) * perDegLng;
    if (dx * dx + dy * dy <= r2) out.push(i);
  }
  return out;
}
