// The structure of the field map: the sweep's blobs (every vegetation
// component at the map's pixel size, inside the boundary) as items in the
// field's local frame, classed by the planting pattern where one was read,
// grouped, and put back in lat/lng. The map's pixel size sets the scale:
// at 4 cm per pixel nothing under 24 cm is measured on its own and the
// small weeds are coverage, which is what a map at that size can honestly
// say; the photos, read at 1 cm, give the individuals.
import type { LatLng2 } from "../../geo";
import { type FieldPattern, nearestPlantFinder } from "../fieldPattern";
import { localFrame } from "../rows";
import type { Blob, RowModel } from "../types";
import { type GroundStructure, groundStructure } from "./ground";
import { groupVegetation } from "./group";
import type { StructureParams, VegItem } from "./types";

export type MapStructureInput = {
  blobs: Blob[];
  pattern: FieldPattern | null;
  rows: RowModel | null;
  boundary: LatLng2[][];
  /** The pixel size the blobs were measured at. */
  gsdM: number;
  /** In-row band, metres: a blob further than this from its row is off the row. */
  bandM: number;
  params?: Partial<StructureParams>;
};

export function structureOfMap(input: MapStructureInput): GroundStructure {
  const { blobs, pattern, rows, boundary, gsdM, bandM } = input;
  const ring = boundary[0] ?? [];
  const origin: LatLng2 = pattern?.origin ?? ring[0] ?? { lat: 0, lng: 0 };
  const frame = localFrame(origin);
  const nearest = pattern ? nearestPlantFinder(pattern) : null;
  const plantR = (pattern?.summary.plantDiameterM ?? 0) / 2;
  const rowsKnown = !!pattern || !!rows?.usable;
  const items: VegItem[] = blobs.map(b => {
    const { x, y } = frame.toXY(b.centroid);
    let cls: VegItem["cls"];
    let kind: VegItem["kind"] = null;
    const d = b.distanceToRowM ?? null;
    if (pattern && nearest) {
      const n = nearest(b.centroid);
      const onCrop = n != null && n <= plantR + b.equivDiameterM / 2;
      cls = onCrop ? "crop" : "off-pattern";
      if (!onCrop) kind = d != null && Math.abs(d) <= bandM ? "between plants" : "off-row";
    } else if (rows?.usable && d != null) {
      cls = Math.abs(d) <= bandM ? "crop" : "off-pattern";
      if (cls === "off-pattern") kind = "off-row";
    } else {
      cls = "unplaced";
    }
    return { id: b.id, x, y, areaM2: b.areaM2, equivDiameterM: b.equivDiameterM, cls, kind, touchesBorder: b.touchesBorder };
  });
  const pts = boundary.flat().map(p => frame.toXY(p));
  const bounds = pts.length
    ? { x0: Math.min(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), x1: Math.max(...pts.map(p => p.x)), y1: Math.max(...pts.map(p => p.y)) }
    : null;
  const s = groupVegetation({ items, gsdM, bounds, params: input.params, rowsKnown });
  return groundStructure(s, "map", (x, y) => frame.toLatLng(x, y));
}
