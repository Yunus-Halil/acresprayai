// What the Field Twin map shows at each zoom, and what the inspector says about a selected object.
//
// Progressive detail: zoomed out, the field reads as rows and a weed density grid (a few hundred squares instead of
// thousands of outlines); closer, trees and weeds become points; closest, every crown and weed is its measured
// outline. The inspector's lines follow the account's unit system (units apply everywhere).
import { fmtAreaCm2, fmtDistance, fmtLengthCm, type Measure } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import type { TwinBundle, TwinTree, TwinWeed } from "./types";

export type DetailLevel = "overview" | "points" | "outlines";

/** Zoom thresholds (Web Mercator zoom). At 20 a 2 m crown is about 13 screen pixels at this latitude. */
export const POINTS_FROM_ZOOM = 19;
export const OUTLINES_FROM_ZOOM = 21;

export function detailAt(zoom: number): DetailLevel {
  if (zoom >= OUTLINES_FROM_ZOOM) return "outlines";
  if (zoom >= POINTS_FROM_ZOOM) return "points";
  return "overview";
}

export type DensityCell = { south: number; west: number; north: number; east: number; count: number; areaM2: number };

/**
 * Weeds per square of `cellM` metres, for the overview: count and summed area, cells with none left out. The grid is
 * aligned to the bundle's origin so it does not shift as the view moves.
 */
export function weedDensity(twin: TwinBundle, cellM: number, keep: (w: TwinWeed) => boolean): DensityCell[] {
  const lat0 = twin.origin.lat, lng0 = twin.origin.lng;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const cells = new Map<string, DensityCell>();
  for (const w of twin.weeds) {
    if (!keep(w)) continue;
    const i = Math.floor(((w.lng - lng0) * mLng) / cellM), j = Math.floor(((w.lat - lat0) * mLat) / cellM);
    const k = `${i},${j}`;
    let c = cells.get(k);
    if (!c) {
      c = { west: lng0 + (i * cellM) / mLng, east: lng0 + ((i + 1) * cellM) / mLng, south: lat0 + (j * cellM) / mLat, north: lat0 + ((j + 1) * cellM) / mLat, count: 0, areaM2: 0 };
      cells.set(k, c);
    }
    c.count++;
    c.areaM2 += w.areaM2;
  }
  return [...cells.values()];
}

export type InspectLine = { label: string; value: string };

const cm = (m: number, u: UnitSystem): Measure => fmtLengthCm(m * 100, u);

/** The inspector's lines for a weed. */
export function weedLines(w: TwinWeed, u: UnitSystem): InspectLine[] {
  const lines: InspectLine[] = [
    { label: "Status", value: w.status === "verified" ? `Verified: seen in ${w.seenBy} of ${w.coveredBy} photographs` : w.status === "single view" ? `Unverified: seen in 1 of ${w.coveredBy} photograph${w.coveredBy === 1 ? "" : "s"}` : "On a tree crown: likely part of the tree, not a weed" },
    { label: "Where", value: w.rowStatus === "between rows" ? "Between the rows" : w.rowStatus === "on a row" ? "On a crop row" : "No rows read here" },
    { label: "Size across", value: cm(w.diameterM, u).text },
    { label: "Ground cover", value: fmtAreaCm2(w.areaM2 * 10_000, u).text },
  ];
  if (w.spanM != null) lines.push({ label: "Longest span", value: cm(w.spanM, u).text });
  if (w.heightM != null) lines.push({ label: "Height above soil", value: cm(Math.max(0, w.heightM), u).text });
  if (w.seenBy >= 2) {
    lines.push({ label: "Views agree on position", value: `within ${cm(w.viewSpreadM, u).text}` });
    lines.push({ label: "Views agree on size", value: `within ${Math.round(w.sizeCv * 100)} %` });
  }
  if (w.score != null) lines.push({ label: "Model confidence", value: `${Math.round(w.score * 100)} %` });
  lines.push({ label: "Position", value: `${w.lat.toFixed(7)}, ${w.lng.toFixed(7)}` });
  return lines;
}

/** The inspector's lines for a tree. */
export function treeLines(t: TwinTree, u: UnitSystem): InspectLine[] {
  const lines: InspectLine[] = [
    { label: "Seen in", value: `${t.seenBy} of ${t.coveredBy} photographs` },
    { label: "Crown across", value: fmtDistance(2 * t.crownRadiusM, u).text },
  ];
  if (t.heightM != null) lines.push({ label: "Crown centre above soil", value: fmtDistance(Math.max(0, t.heightM), u).text });
  lines.push({ label: "Row", value: t.rowId != null ? `Row ${t.rowId}` : "Not on a kept row" });
  if (t.seenBy >= 2) lines.push({ label: "Views agree on position", value: `within ${cm(t.viewSpreadM, u).text}` });
  lines.push({ label: "Position", value: `${t.lat.toFixed(7)}, ${t.lng.toFixed(7)}` });
  return lines;
}
