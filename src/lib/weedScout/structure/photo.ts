// The structure of one photo: the pass's blobs and fragments as items in
// the photo's own metres (x right, y down, from the top-left corner), grouped,
// and carried to the ground through a projection the caller supplies.
import type { PhotoPattern } from "../../photoScout/pattern";
import { type GroupInput, groupVegetation } from "./group";
import type { Structure, StructureParams, VegItem } from "./types";

/** The pass's blobs and fragment cells as items. Crop on the pattern, off-pattern off it, unplaced where no rows were trusted. */
export function itemsFromPhoto(pattern: PhotoPattern): VegItem[] {
  const g = pattern.gsdM;
  const out: VegItem[] = [];
  for (const b of pattern.blobs) {
    const cls: VegItem["cls"] = b.cls === "on pattern" || b.cls === "double" ? "crop" : b.cls === "unplaced" ? "unplaced" : "off-pattern";
    out.push({ id: `b${b.id}`, x: b.x * g, y: b.y * g, areaM2: b.areaM2, equivDiameterM: b.equivDiameterM, cls, kind: b.cls === "off-row" ? "off-row" : b.cls === "between plants" ? "between plants" : null, touchesBorder: b.touchesBorder });
  }
  const fr = pattern.fragments;
  if (fr) {
    const cellPx = fr.cellM / g;
    for (const [col, row, count, areaPx] of fr.cells) {
      const areaM2 = areaPx * g * g;
      out.push({ id: `f${col}:${row}`, x: (col + 0.5) * cellPx * g, y: (row + 0.5) * cellPx * g, areaM2, equivDiameterM: 2 * Math.sqrt(areaM2 / Math.max(1, count) / Math.PI), cls: "fragment", count });
    }
  }
  return out;
}

export function structureOfPhoto(pattern: PhotoPattern, params?: Partial<StructureParams>): Structure {
  const g = pattern.gsdM;
  const s = groupVegetation({
    items: itemsFromPhoto(pattern), gsdM: g, params,
    bounds: { x0: 0, y0: 0, x1: pattern.width * g, y1: pattern.height * g },
    rowsKnown: pattern.summary.usableWindows > 0 && !pattern.canopyClosed,
  } satisfies GroupInput);
  if (!pattern.fragments) s.notes.push("This photo's read predates fragment counting; its zones hold only objects under the measurable size.");
  return s;
}
