// Which zones share a treatment decision.
//
// The planner routes over hand-drawn annotations (including Weed Scout spots
// the operator applied) and Treatment Grid zones. A treatment is chosen per
// GROUP, not per zone: every zone the operator identified as the same weed is
// one decision, the unidentified weed spots are one decision the operator
// makes knowingly, hand-drawn non-weed zones are another, and grid zones
// another. A suggestion the operator never confirmed does not create a weed
// group; the spot sits under "unidentified" until they identify it.
import type { TreatmentGroup } from "./quantities";

export type GroupableZone = {
  /** Planner zone id: `user:<annotation id>` or a grid zone id. */
  id: string;
  source: "user" | "grid";
  areaM2: number;
};

export type GroupablePoly = {
  id: string;
  name: string;
  issue_type: string;
  weed_label?: string | null;
  weed_catalog_id?: string | null;
};

export type TreatmentGroupKey = string;

export const UNIDENTIFIED_GROUP = "unidentified";
export const HAND_DRAWN_GROUP = "handdrawn";
export const GRID_GROUP = "grid";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The group a hand-drawn or applied polygon belongs to, and its label. */
export function groupFor(p: GroupablePoly): { key: TreatmentGroupKey; label: string } {
  if (p.weed_catalog_id && p.weed_label) return { key: `catalog:${p.weed_catalog_id}`, label: p.weed_label };
  if (p.weed_label) return { key: `label:${norm(p.weed_label)}`, label: p.weed_label };
  if (p.name.startsWith("Weed Scout:") || p.issue_type === "Weed pressure") return { key: UNIDENTIFIED_GROUP, label: "Unidentified weed spots" };
  return { key: HAND_DRAWN_GROUP, label: "Hand-drawn zones (not weeds)" };
}

export function groupZonesForTreatment(zones: readonly GroupableZone[], polys: readonly GroupablePoly[]): Omit<TreatmentGroup, "choice">[] {
  const byId = new Map(polys.map(p => [p.id, p]));
  const groups = new Map<string, Omit<TreatmentGroup, "choice">>();
  const add = (key: string, label: string, areaM2: number) => {
    const g = groups.get(key) ?? { key, label, areaM2: 0, zoneCount: 0 };
    g.areaM2 += Math.max(0, areaM2);
    g.zoneCount += 1;
    groups.set(key, g);
  };
  for (const z of zones) {
    if (z.source === "grid") { add(GRID_GROUP, "Treatment Grid zones", z.areaM2); continue; }
    const p = byId.get(z.id.replace(/^user:/, ""));
    if (!p) { add(HAND_DRAWN_GROUP, "Hand-drawn zones (not weeds)", z.areaM2); continue; }
    const g = groupFor(p);
    add(g.key, g.label, z.areaM2);
  }
  // Identified weeds first, then unidentified, then the rest, by label.
  const order = (k: string) => (k.startsWith("catalog:") || k.startsWith("label:") ? 0 : k === UNIDENTIFIED_GROUP ? 1 : k === HAND_DRAWN_GROUP ? 2 : 3);
  return [...groups.values()].sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));
}
