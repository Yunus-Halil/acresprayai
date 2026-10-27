// What the inspector says about a selected object, in the account's units, and a few view helpers.
//
// Every line here is a measurement the bundle holds or a count of its observations; nothing is estimated for display.
import { fmtAreaCm2, fmtDistance, fmtLengthCm, type Measure } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import { localFrame } from "./intelligence";
import type { TwinBundle, TwinTree, TwinWeed } from "./types";

export type InspectLine = { label: string; value: string };

const cm = (m: number, u: UnitSystem): Measure => fmtLengthCm(m * 100, u);

/** Distance from a point to the nearest kept row line, metres, or null without rows. */
export function distanceToRowM(twin: TwinBundle, lat: number, lng: number): { rowId: number; distanceM: number } | null {
  const f = localFrame(twin);
  const [px, py] = f.toLocal(lat, lng);
  let best: { rowId: number; distanceM: number } | null = null;
  for (const r of twin.rows) {
    if (!r.kept || r.line.length < 2) continue;
    const a = f.toLocal(...r.line[0]), b = f.toLocal(...r.line[r.line.length - 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
    const d = Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
    if (!best || d < best.distanceM) best = { rowId: r.id, distanceM: d };
  }
  return best;
}

/** The inspector's lines for a weed. */
export function weedLines(w: TwinWeed, u: UnitSystem, twin?: TwinBundle): InspectLine[] {
  const lines: InspectLine[] = [
    { label: "Status", value: w.status === "verified" ? `Seen in ${w.seenBy} of ${w.coveredBy} photographs that covered it` : w.status === "single view" ? `Seen in 1 of ${w.coveredBy} photograph${w.coveredBy === 1 ? "" : "s"}: unverified` : "On a tree crown: likely part of the tree, not a weed" },
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
  if (twin) { const d = distanceToRowM(twin, w.lat, w.lng); if (d) lines.push({ label: "Nearest crop row", value: `Row ${d.rowId}, ${fmtDistance(d.distanceM, u).text} away` }); }
  if (w.treeId != null) lines.push({ label: "Tree", value: `Tree ${w.treeId}` });
  lines.push({ label: "Position", value: `${w.lat.toFixed(7)}, ${w.lng.toFixed(7)}` });
  return lines;
}

/** The inspector's lines for a tree. */
export function treeLines(t: TwinTree, u: UnitSystem): InspectLine[] {
  const lines: InspectLine[] = [
    { label: "Seen in", value: `${t.seenBy} of ${t.coveredBy} photographs that covered it` },
    { label: "Crown across", value: fmtDistance(2 * t.crownRadiusM, u).text },
  ];
  if (t.heightM != null) lines.push({ label: "Crown centre above soil", value: fmtDistance(Math.max(0, t.heightM), u).text });
  lines.push({ label: "Row", value: t.rowId != null ? `Row ${t.rowId}` : "Not on a kept row" });
  if (t.seenBy >= 2) lines.push({ label: "Views agree on position", value: `within ${cm(t.viewSpreadM, u).text}` });
  lines.push({ label: "Position", value: `${t.lat.toFixed(7)}, ${t.lng.toFixed(7)}` });
  return lines;
}

export type DensityCell = { south: number; west: number; north: number; east: number; count: number; areaM2: number };

/** Weeds per compass-aligned square, kept for callers that want a plain grid; the map uses the row-aligned pressure cells. */
export function weedDensity(twin: TwinBundle, cellM: number, keep: (w: TwinWeed) => boolean): DensityCell[] {
  const lat0 = twin.origin.lat, lng0 = twin.origin.lng;
  const mLat = 111_320, mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const cells = new Map<string, DensityCell>();
  for (const w of twin.weeds) {
    if (!keep(w)) continue;
    const i = Math.floor(((w.lng - lng0) * mLng) / cellM), j = Math.floor(((w.lat - lat0) * mLat) / cellM);
    const k = `${i},${j}`;
    let c = cells.get(k);
    if (!c) { c = { west: lng0 + (i * cellM) / mLng, east: lng0 + ((i + 1) * cellM) / mLng, south: lat0 + (j * cellM) / mLat, north: lat0 + ((j + 1) * cellM) / mLat, count: 0, areaM2: 0 }; cells.set(k, c); }
    c.count++; c.areaM2 += w.areaM2;
  }
  return [...cells.values()];
}
