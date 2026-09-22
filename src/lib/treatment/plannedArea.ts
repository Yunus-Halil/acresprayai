// The one place a marked shape becomes a planned shape, and an area.
//
// WHY THIS IS A MODULE AND NOT A BLOCK IN THE PLANNER. Two screens now need to
// answer "how much ground is this?" about the same zones: the Flight Planner,
// which prices the chemical and flies the route, and the Weed Scout results
// screen, which tells the operator what the scan found before they hand it
// over. Those two answers must be the same number, and until this existed they
// could not be: the planner ignores the `area_hectares` stored on a
// `user_annotations` row and recomputes from the ring after insetting it, so a
// scout-side sum of stored areas disagreed with the planner by the whole
// headland bite on every zone wide enough to take one.
//
// The transformation, unchanged from where it used to live inline in
// PlannerTab:
//
//   1. A zone whose ring CENTROID falls outside the field boundary is dropped.
//      Not clipped: dropped. That is the planner's long-standing rule and it is
//      preserved here rather than improved, because changing it would change
//      what gets sprayed.
//   2. The remaining rings are held back from their own edge by the headland
//      (`applyHeadland`), which refuses rather than collapsing a zone too narrow
//      to take one.
//   3. The area is the zone's OWN measured area scaled by the headland's
//      proportional bite when it has one (a grid zone knows its true clipped
//      cell area, which ring geometry cannot reproduce), or the geodesic area
//      of the inset ring when it does not (every hand-drawn polygon and every
//      applied Weed Scout spot).
//
// Nothing here decides what to spray or how much of it. It answers "which
// shapes, and how big", and the callers do the rest.
import { type LatLng2, pointInAnyRing, polygonAreaM2 } from "../geo";
import {
  DEFAULT_HEADLAND_M, type HeadlandOutcome, MAX_HEADLAND_M, applyHeadland, headlandAreaScale,
} from "../headland";

/** The least a zone must carry to be planned. Callers may carry more; it is passed through. */
export type PlannableZone = {
  id: string;
  ring: LatLng2[];
  /**
   * An area the caller already measured and trusts, square metres. Grid zones
   * have one (summed clipped cells); hand-drawn polygons and Weed Scout spots
   * do not, and are measured from their ring.
   */
  areaM2?: number;
  /** Only used to word the headland's refusal note. */
  source?: "user" | "grid";
};

export type PlannedZone<Z extends PlannableZone> = Z & {
  /** The ring the passes are planned inside. Inset, unless the headland was waived. */
  ring: LatLng2[];
  /** Square metres of ground this zone contributes to the plan. Always a number. */
  areaM2: number;
  headland: HeadlandOutcome;
};

/** The headland actually used, clamped to what the planner allows. */
export const clampHeadlandM = (v: number | null | undefined): number =>
  Math.max(0, Math.min(MAX_HEADLAND_M, v ?? DEFAULT_HEADLAND_M));

/**
 * Zones whose centroid lies inside the boundary. A zone with no usable ring, or
 * no boundary to test against, is not plannable.
 */
export function zonesInsideBoundary<Z extends PlannableZone>(
  zones: readonly Z[],
  boundary: LatLng2[][] | null,
): Z[] {
  if (!boundary || boundary.length === 0) return [];
  return zones.filter(z => {
    if (!z.ring || z.ring.length < 3) return false;
    const cx = z.ring.reduce((a, p) => a + p.lng, 0) / z.ring.length;
    const cy = z.ring.reduce((a, p) => a + p.lat, 0) / z.ring.length;
    return pointInAnyRing({ lat: cy, lng: cx }, boundary);
  });
}

/**
 * The plannable zones, with the headland applied and a real area on each.
 *
 * `bufferM` is clamped here so no caller can plan against a headland the
 * planner would not use.
 */
export function plannedZones<Z extends PlannableZone>(
  zones: readonly Z[],
  boundary: LatLng2[][] | null,
  bufferM: number,
): PlannedZone<Z>[] {
  const inset = clampHeadlandM(bufferM);
  return zonesInsideBoundary(zones, boundary).map(z => {
    const outcome = applyHeadland(z.ring, inset, {
      label: z.source === "grid" ? "A treatment-grid zone" : "A zone",
    });
    return {
      ...z,
      ring: outcome.ring,
      areaM2: z.areaM2 != null
        ? z.areaM2 * headlandAreaScale(outcome)
        : Math.abs(polygonAreaM2(outcome.ring)),
      headland: outcome,
    };
  });
}

/** Square metres of ground a set of planned zones covers. */
export const plannedAreaM2 = (zones: readonly { areaM2: number }[]): number =>
  zones.reduce((a, z) => a + Math.max(0, z.areaM2), 0);
