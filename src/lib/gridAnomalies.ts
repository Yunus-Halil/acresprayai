// Treatment-grid zones, loaded for display surfaces.
//
// WHAT AN "ANOMALY" ACTUALLY IS IN THIS APP, for anyone arriving from the
// brief that assumed a dedicated anomaly-record layer: there isn't one. The
// `anomalies` DB table is dormant dead schema (see data-model.md). The two
// live shapes are AiZone (JSON inside odm_tasks.ai_analysis) and UserPoly
// (user_annotations rows), and neither goes through a "promotion" flow — the
// planner reads both directly. Grid zones follow the same pattern: they are
// PROJECTIONS of the grid's cell state, derived on read, never stored as
// separate records.
//
// ONE DIRECTION OF TRUTH, on purpose. The grid cell is the authoritative
// record; a zone shown on the Field View or routed by the planner is a view of
// it. There is no anomaly record to edit, so there is nothing to drift: change
// the category or the rate by editing the cells in the Treatment Grid tab, and
// every surface that shows the zone follows. Sync in "both directions" is
// therefore structural — paint, accept, reject, clear and boundary migration
// all mutate the cells, and the projections cannot disagree with them.
import type { LatLng2 } from "./geo";
import { type GridZone, gridZonesFor } from "./gridZones";
import { boundaryHashOf, buildTreatmentGrid } from "./treatmentGrid";
import { applyStored } from "./treatmentGridStore";
import { SupabaseTreatmentGridRepository } from "./treatmentGridRepo";

const repo = new SupabaseTreatmentGridRepository();

/** What a treated zone with no operator classification is called on screen. */
export const UNCLASSIFIED_LABEL = "Unclassified";

export type GridZonesLoad = {
  zones: GridZone[];
  /**
   * True when the stored grid was built for an older boundary. Its lattice
   * derives from that boundary, so projecting it onto the new one would put
   * zones on the wrong ground — the caller shows a pointer to the Treatment
   * Grid tab (which owns migration) instead of stale shapes.
   */
  stale: boolean;
};

/**
 * The current grid's zones, straight from storage.
 *
 * Load-on-mount IS live here: every consumer of this remounts when its tab is
 * switched to, so repainting cells and coming back re-derives the zones. No
 * snapshot, nothing to go stale between visits.
 */
export async function loadGridZones(
  fieldId: string | null,
  boundary: LatLng2[][] | null,
): Promise<GridZonesLoad | null> {
  if (!fieldId || !boundary || boundary.length === 0) return null;
  const stored = await repo.load(fieldId);
  if (!stored) return null;
  if (stored.definition.boundaryHash !== boundaryHashOf(boundary)) {
    return { zones: [], stale: true };
  }
  const grid = applyStored(buildTreatmentGrid(boundary, stored.definition), stored);
  return { zones: gridZonesFor(grid), stale: false };
}
