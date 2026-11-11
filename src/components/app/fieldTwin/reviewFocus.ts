// From a review to the finding it is about, in the saved twin: what the founder's viewer selects when it is opened
// from a review on the pilot desk.
//
// A review names its finding by kind and id (twin_reviews.finding_kind, finding_id). For the objects a saved twin
// holds itself (weeds, trees, green growth, and a corn twin's rows, weed observations and gaps) that id is the
// object's own, fixed when the twin was built, and a saved twin is never rewritten: the same id is the same object.
// Patches, pressure regions and scouting zones are different. They are worked out in the viewer, numbered within one
// search, and move with the boundary in use, so their number is not an identity. Those are never selected from a
// review: opening the wrong one would be worse than opening none.
//
// Whatever is found is checked the other way before it is returned: the selection must review as the very kind and
// id asked for, by the same function the reviewer's own bar uses (reviewTargetOf). Anything else is "not found".
import type { TwinBundle } from "@/lib/fieldTwin/types";
import type { FindingKind } from "@/lib/fieldTwin/reviews";
import { reviewTargetOf } from "./ReviewBar";
import type { TwinPick } from "./TwinCanvasLayer";

export type ReviewFocus = { kind: FindingKind; id: string };

/** The kinds whose id is the saved object's own. */
export const LOCATABLE: readonly FindingKind[] = ["weed", "tree", "vegetation", "corn_row", "corn_weed", "corn_gap"];
export const isLocatable = (kind: string): boolean => (LOCATABLE as readonly string[]).includes(kind);

export type Located = {
  pick: Exclude<TwinPick, null>;
  lat: number; lng: number;
  /** Ground to show around it, metres across. */
  metresAcross: number;
  /** What the twin calls it now (the review stored what it was called then). */
  status: string;
};

/** `?finding=corn_weed:12` read strictly: a locatable kind and a whole number, or nothing. */
export function parseFocus(value: string | null | undefined): ReviewFocus | null {
  const m = /^([a-z_]{1,20}):(\d{1,9})$/.exec(value ?? "");
  return m && isLocatable(m[1]) ? { kind: m[1] as FindingKind, id: String(Number(m[2])) } : null;
}
export const focusParam = (kind: string, id: string): string | null => (parseFocus(`${kind}:${id}`) ? `${kind}:${id}` : null);

export function locateReviewed(focus: ReviewFocus, twin: TwinBundle): Located | null {
  if (!isLocatable(focus.kind) || !/^\d{1,9}$/.test(focus.id)) return null;
  const id = Number(focus.id);
  let at: Omit<Located, "status"> | null = null;
  switch (focus.kind) {
    case "weed": { const w = twin.weeds.find(x => x.id === id); if (w) at = { pick: { kind: "weed", id }, lat: w.lat, lng: w.lng, metresAcross: Math.max(2, w.diameterM * 8) }; break; }
    case "tree": { const t = twin.trees.find(x => x.id === id); if (t) at = { pick: { kind: "tree", id }, lat: t.lat, lng: t.lng, metresAcross: Math.max(4, t.crownRadiusM * 6) }; break; }
    case "vegetation": { const v = twin.vegetation.find(x => x.id === id); if (v) at = { pick: { kind: "vegetation", id }, lat: v.lat, lng: v.lng, metresAcross: Math.max(3, Math.sqrt(v.areaM2) * 4) }; break; }
    case "corn_row": {
      const r = twin.corn?.rows.find(x => x.id === id);
      const a = r?.line[0], b = r?.line[r.line.length - 1];
      if (r && a && b) at = { pick: { kind: "cornRow", id }, lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2, metresAcross: Math.max(6, r.lengthM * 1.1) };
      break;
    }
    case "corn_weed": { const w = twin.corn?.weeds.find(x => x.id === id); if (w) at = { pick: { kind: "cornWeed", id }, lat: w.lat, lng: w.lng, metresAcross: Math.max(3, Math.sqrt(w.areaM2) * 10) }; break; }
    case "corn_gap": { const g = twin.corn?.gaps.find(x => x.id === id); if (g) at = { pick: { kind: "cornGap", id }, lat: (g.a[0] + g.b[0]) / 2, lng: (g.a[1] + g.b[1]) / 2, metresAcross: Math.max(4, g.lengthM * 3) }; break; }
    default: return null;
  }
  if (!at || ![at.lat, at.lng, at.metresAcross].every(Number.isFinite)) return null;
  // The other way round: what was found must be reviewed as exactly this kind and id.
  const target = reviewTargetOf(at.pick, twin, null);
  if (!target || target.kind !== focus.kind || target.id !== focus.id) return null;
  return { ...at, status: target.status };
}
