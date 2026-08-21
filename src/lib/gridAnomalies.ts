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
import {
  type CellRate, boundaryHashOf, buildTreatmentGrid, normalizeNote,
} from "./treatmentGrid";
import type { TreatmentGridRepository } from "./treatmentGridStore";
import { applyStored, packGrid } from "./treatmentGridStore";
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
  repository: TreatmentGridRepository = repo,
): Promise<GridZonesLoad | null> {
  if (!fieldId || !boundary || boundary.length === 0) return null;
  const stored = await repository.load(fieldId);
  if (!stored) return null;
  if (stored.definition.boundaryHash !== boundaryHashOf(boundary)) {
    return { zones: [], stale: true };
  }
  const grid = applyStored(buildTreatmentGrid(boundary, stored.definition), stored);
  return { zones: gridZonesFor(grid), stale: false };
}

/**
 * An edit to a zone's description. Both fields are optional and tri-state:
 * absent leaves the current value alone, null clears it, a string sets it.
 */
export type ZoneClassification = {
  /** From USER_POLY_ISSUES, or null for Unclassified. */
  issue?: string | null;
  note?: string | null;
};

export type ClassifyResult = {
  /** Freshly derived zones, so a caller can redraw without a second read. */
  zones: GridZone[];
  /** Cells actually written. Zero means the zone had already left the grid. */
  cells: number;
};

/**
 * Writes are serialised.
 *
 * Every write here is a read-modify-write of one JSON column, so two of them
 * in flight at once means the second one's read predates the first one's write
 * and silently reverts it. An operator classifying a zone and typing a note in
 * the same breath is exactly that race, so the queue is not theoretical.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  // Keep the chain alive after a rejection: one failed write must not wedge
  // every later one.
  writeQueue = next.catch(() => undefined);
  return next;
}

/**
 * Set the issue and/or note on a zone, by writing them to the cells it is a
 * projection of.
 *
 * WHY THE CELLS AND NOT THE ZONE. A zone is derived on read from contiguous
 * same-rate cells (see gridZones.ts); it has no record of its own to store
 * anything in. Writing a per-zone classification somewhere else would create a
 * second copy that drifts the moment a cell is repainted, and there would be no
 * principled answer to which one is true. So the shape is edited exactly where
 * the Treatment Grid tab edits it: on the cells. That is also what makes the
 * round trip work in both directions for free.
 *
 * METADATA ONLY. `state`, `rateLha` and `source` are copied through untouched.
 * Classifying ground says what is wrong with it, never what to spray on it.
 *
 * Returns null when there is no grid to write to, or when the stored grid was
 * built for a different boundary — the caller must not silently create one.
 */
export async function classifyGridZone(
  fieldId: string,
  boundary: LatLng2[][],
  zoneId: string,
  patch: ZoneClassification,
  repository: TreatmentGridRepository = repo,
): Promise<ClassifyResult | null> {
  return serialise(async () => {
    const stored = await repository.load(fieldId);
    if (!stored) return null;
    if (stored.definition.boundaryHash !== boundaryHashOf(boundary)) return null;

    const grid = applyStored(buildTreatmentGrid(boundary, stored.definition), stored);
    const zone = gridZonesFor(grid).find(z => z.id === zoneId);
    if (!zone) return null;

    const members = new Set(zone.cellIds);
    const issue = patch.issue === undefined
      ? undefined
      : (patch.issue?.trim() ? patch.issue.trim() : null);
    const note = patch.note === undefined
      ? undefined
      : (normalizeNote(patch.note) ?? null);

    let written = 0;
    const next = {
      ...grid,
      cells: grid.cells.map(c => {
        if (!members.has(c.id) || c.rate.state !== "treated") return c;
        written++;
        const nextIssue = issue === undefined ? c.rate.issue : (issue ?? undefined);
        const nextNote = note === undefined ? c.rate.note : (note ?? undefined);
        // Rebuilt field by field rather than spread, so that the three
        // treatment-bearing fields are visibly copied through unchanged.
        const rate: CellRate = {
          state: "treated",
          rateLha: c.rate.rateLha,
          source: c.rate.source,
          ...(nextIssue ? { issue: nextIssue } : {}),
          ...(nextNote ? { note: nextNote } : {}),
        };
        return { ...c, rate };
      }),
    };

    await repository.save(fieldId, packGrid(next));
    return { zones: gridZonesFor(next), cells: written };
  });
}

export type ClearZonesSummary = {
  zones: number;
  cells: number;
  areaM2: number;
  /** Deliberate skips, which clearing zones does NOT touch. */
  skipsKept: number;
};

/**
 * What clearing the zones would cost, without clearing anything.
 *
 * Separate from the clear itself so the confirmation can state real numbers.
 * "Are you sure?" over an unknown quantity of somebody's afternoon is not a
 * confirmation, it is a coin toss.
 */
export function summariseZones(zones: GridZone[], skipsKept: number): ClearZonesSummary {
  return {
    zones: zones.length,
    cells: zones.reduce((s, z) => s + z.cellCount, 0),
    areaM2: zones.reduce((s, z) => s + z.areaM2, 0),
    skipsKept,
  };
}

/**
 * Return every TREATED cell to its default state, leaving everything else.
 *
 * Scoped to treated cells on purpose. A "zone" is treated ground, so clearing
 * the zones means clearing those; deliberate skips are not zones, and they are
 * the negative examples Find Similar learns from — wiping them as collateral
 * would quietly cost the operator their training set along with their paint.
 * Detection scores also survive: they are provenance about the imagery, not
 * decisions about it.
 */
export async function clearGridZones(
  fieldId: string,
  boundary: LatLng2[][],
): Promise<ClearZonesSummary | null> {
  const stored = await repo.load(fieldId);
  if (!stored) return null;
  if (stored.definition.boundaryHash !== boundaryHashOf(boundary)) return null;

  const grid = applyStored(buildTreatmentGrid(boundary, stored.definition), stored);
  const summary = summariseZones(
    gridZonesFor(grid),
    grid.cells.filter(c => c.rate.state === "untreated" && c.rate.source === "operator").length,
  );

  const cleared = {
    ...grid,
    cells: grid.cells.map(c => (c.rate.state === "treated"
      ? { ...c, rate: { state: "untreated", source: "default" } as CellRate }
      : c)),
  };
  await repo.save(fieldId, packGrid(cleared));
  return summary;
}
