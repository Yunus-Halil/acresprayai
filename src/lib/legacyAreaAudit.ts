// Marks flight logs whose treated acreage predates the ring-area fix.
//
// From 2026-08-20 (grid zones entered the flight-plan pipeline, commit
// 166222b) to 2026-08-26 (fix, commit 309d3e0), the Log Flight zone list
// re-derived grid-zone areas from the traced RING via shoelace instead of
// using the carried clipped areaM2 — so `flight_logs.acres_treated` for
// missions that completed grid zones in that window is OVER-counted, and the
// computed application rate derived from it is correspondingly understated.
// Measured on realistic grids: interior-only zones agree exactly, a
// full-coverage mission over-counts ~10–20% (cell-size dependent), and a
// boundary-hugging zone can over-count up to ~2.5× its true area.
//
// THE STORED FIGURES ARE NOT REWRITTEN. A logged flight is a record of what
// was believed at the time; quietly changing historical figures is its own
// integrity problem. Instead, records from the window are FLAGGED — on the
// Flight Log and on any report regenerated from them — so a reader knows the
// method behind the number.
//
// The window bounds are the COMMIT times (UTC). The true boundaries are the
// frontend deploy times either side of each commit; if a deploy lagged,
// widen the window rather than letting an affected record pass unflagged.

/** Grid zones entered the flight-plan pipeline (commit 166222b). */
export const RING_AREA_BUG_FROM = "2026-08-20T15:32:20Z";
/** The carried-area fix landed (commit 309d3e0). */
export const RING_AREA_FIX_AT = "2026-08-26T18:57:08Z";

/** Zone-id prefixes whose areas the buggy path re-derived from rings.
 *  (AI "ai-*" and user "user:*" zones only ever had rings — not this bug.) */
const GRID_ID_PREFIXES = ["grid:", "block:"];

export type AuditableLog = {
  created_at?: string | null;
  acres_treated?: number | null;
  zones_completed?: string[] | null;
};

/**
 * True when this log's treated acreage came from the pre-fix ring-derived
 * path: logged inside the window, with at least one completed grid zone,
 * and carrying an acreage at all.
 */
export function acreageFromBuggyPath(log: AuditableLog | null | undefined): boolean {
  if (!log?.created_at || log.acres_treated == null) return false;
  if (log.created_at < RING_AREA_BUG_FROM || log.created_at >= RING_AREA_FIX_AT) return false;
  return (log.zones_completed ?? []).some(
    id => GRID_ID_PREFIXES.some(p => typeof id === "string" && id.startsWith(p)),
  );
}

/** The plain-language flag, shared by the Flight Log and the report. */
export const LEGACY_AREA_NOTE =
  "The treated area on this flight was computed by a pre-fix method (before 26 Aug 2026) " +
  "that over-counts zones at the field edge (typically 10 to 20% high for a full mission, " +
  "more for zones hugging the boundary). The figure is kept exactly as recorded; the " +
  "computed application rate derived from it is correspondingly understated.";
