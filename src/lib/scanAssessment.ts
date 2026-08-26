// The per-scan record of what the TREATMENT GRID found — the product's one
// analysis system.
//
// THE MODEL. The grid itself is per-field and mutable: one lattice of cells in
// fields.settings, edited live as the operator paints reference points and
// runs Find Similar over a scan's imagery. Scan cards, the compare view's
// change statistics and the spray report all need "what the assessment was ON
// THIS SCAN" — so every successful grid write snapshots a slim projection of
// the zones onto the scan row (odm_tasks.ai_analysis, the column the deleted
// legacy path used to own), and every failed grid run records its reason
// there. History lives on the scans; the live grid stays the single editable
// truth.
//
// THREE STATES, DECIDED HERE AND NOWHERE ELSE:
//   none    — no reference points placed and no detection run for this scan
//   done    — the grid was worked against this scan; zones may legitimately be
//             empty, and an empty result is a RESULT, never rendered like
//             absence
//   failed  — a grid run (tile stitch, sampling, save) failed; the reason is
//             stored, never a silent null
//
// LEGACY DATA. Rows written by the removed analyze-ortho vision path lack
// `source: "treatment-grid"`. They are never deleted, never blended with grid
// output, and every reader labels them as legacy — two analysis systems on
// one surface would make it ambiguous which one produced any given number.
import { supabase } from "@/integrations/supabase/client";
import type { LatLng2 } from "./geo";
import { type GridZone, gridZonesFor } from "./gridZones";
import type { TreatmentGrid } from "./treatmentGrid";
import { labelsFromGrid } from "./findSimilar";
import { loadGridZones } from "./gridAnomalies";
import { GRID_SOURCE } from "./compareGround";

export { GRID_SOURCE };

/**
 * Fired after any successful grid write (paint save, Find Similar scores,
 * clear, confirm). Field View is PERMANENTLY MOUNTED — only hidden on tab
 * switch, to keep its Leaflet state — so its load-on-mount of grid zones
 * never re-ran when the operator edited the grid in another tab and came
 * back: they saw the old grid drawn over the new state. Anything holding
 * long-lived grid-derived state listens for this and reloads.
 */
export const GRID_CHANGED_EVENT = "swathwise:grid-changed";

/**
 * Callers announce AFTER a successful grid write — deliberately not baked
 * into the snapshot writer, because the zone-classify popup writes through
 * the same path while the operator is mid-edit, and a reload there would
 * yank the popup out from under them (GridAnomaliesLayer's drafts note).
 */
export const announceGridChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GRID_CHANGED_EVENT));
  }
};

/** A zone as frozen onto a scan: everything display needs, nothing else. */
export type SnapshotZone = {
  id: string;
  ring: LatLng2[];
  /** Σ member cells' clipped areas — the priced number, carried not re-derived. */
  areaM2: number;
  rateLha: number;
  cellCount: number;
  issue?: string;
  matchScore?: number | null;
};

export type ScanAssessment = {
  source: typeof GRID_SOURCE;
  zones: SnapshotZone[];
  /** Operator reference points at snapshot time — what "none" is decided from. */
  reference: { treated: number; skipped: number };
  /** Present when a Find Similar detection has scored this grid. */
  detection: { scoredAt: string; modelVersion: string } | null;
  computed_at: string;
  /** `source` marks the run as the grid's, so failures stay attributable. */
  last_run: {
    status: "completed" | "failed";
    at: string;
    error?: string;
    source: typeof GRID_SOURCE;
  };
};

const slim = (z: GridZone): SnapshotZone => ({
  id: z.id,
  ring: z.ring,
  areaM2: z.areaM2,
  rateLha: z.rateLha,
  cellCount: z.cellCount,
  ...(z.issue ? { issue: z.issue } : {}),
  matchScore: z.matchScore,
});

function assessmentFromGrid(grid: TreatmentGrid): ScanAssessment {
  const labels = labelsFromGrid(grid);
  const scored = grid.cells.find(c => c.detection);
  const now = new Date().toISOString();
  return {
    source: GRID_SOURCE,
    zones: gridZonesFor(grid).map(slim),
    reference: { treated: labels.wanted.length, skipped: labels.unwanted.length },
    detection: scored?.detection
      ? { scoredAt: scored.detection.scoredAt, modelVersion: scored.detection.modelVersion }
      : null,
    computed_at: now,
    last_run: { status: "completed", at: now, source: GRID_SOURCE },
  };
}

/**
 * Freeze the grid's current zones onto a scan row.
 *
 * Called after every successful grid write made while this scan is open — the
 * imagery on screen is the imagery the decisions were made against. Failure to
 * snapshot is reported to the caller (the grid save itself already succeeded,
 * so this must not be silently conflated with it).
 */
export async function snapshotGridAssessment(
  taskId: string,
  grid: TreatmentGrid,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  // THE INHERITANCE GATE. The grid is field-keyed and carries forward to
  // every new scan, but its reference points were judged against ONE scan's
  // imagery. Until the operator confirms (or adjusts) them on this scan, the
  // carried-over grid is a starting point — writing it onto this scan's row
  // would present an inherited grid as an assessment of imagery nobody
  // assessed. Skipped, not failed: the grid save itself succeeded.
  if (grid.assessed?.scanId !== taskId) {
    return { ok: true, skipped: true };
  }
  const assessment = assessmentFromGrid(grid);
  const { error } = await supabase.from("odm_tasks")
    .update({
      ai_analysis: assessment as never,
      ai_analysis_at: assessment.computed_at,
    } as never)
    .eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Same freeze, from storage — for write paths that do not hold the live grid
 * (zone classification popup, clear-zones). Loads the stored grid, projects,
 * snapshots. No-op when there is no current grid for the boundary.
 */
export async function snapshotGridAssessmentFromStore(
  taskId: string,
  fieldId: string,
  boundary: LatLng2[][] | null,
): Promise<{ ok: boolean; error?: string }> {
  const load = await loadGridZones(fieldId, boundary);
  if (!load || !load.grid) return { ok: false, error: "No current grid for this boundary" };
  return snapshotGridAssessment(taskId, load.grid);
}

/**
 * Record a FAILED grid run on the scan, preserving whatever assessment (or
 * legacy result) already sits there. "Failed at 10:12: imagery too coarse" and
 * "never run" must never be the same null — that is the defect the removed
 * legacy path had, reproduced nowhere.
 */
export async function recordGridRunFailure(
  taskId: string,
  reason: string,
): Promise<void> {
  try {
    const { data } = await supabase.from("odm_tasks")
      .select("ai_analysis").eq("id", taskId).maybeSingle();
    const prior = data?.ai_analysis && typeof data.ai_analysis === "object"
      ? data.ai_analysis as Record<string, unknown>
      : {};
    // `prior` is spread through untouched — a failed run must never restamp a
    // legacy result's source or disturb its zones.
    //
    // The failure carries its OWN provenance. Without it, a failure the
    // removed vision path left behind is indistinguishable from a grid
    // failure, and the reader blames the grid for it — which is exactly how a
    // scan came to display "Grid run failed · AI is not configured (missing
    // AI_API_KEY)" for a system that calls no service at all.
    const { error } = await supabase.from("odm_tasks")
      .update({
        ai_analysis: {
          ...prior,
          last_run: {
            status: "failed",
            at: new Date().toISOString(),
            error: reason,
            source: GRID_SOURCE,
          },
        } as never,
      } as never)
      .eq("id", taskId);
    if (error) console.warn("[assessment] could not record failure:", error.message);
  } catch (e) {
    console.warn("[assessment] could not record failure", e);
  }
}
