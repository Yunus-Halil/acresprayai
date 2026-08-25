// What two flights actually share, and what may honestly be said about it.
//
// Every number the compare UI shows comes through here, on purpose. Two scans
// of one field rarely cover identical ground — different flight lines, wind,
// battery turnarounds — and a "stressed area changed by X%" computed across
// ground only one flight saw is a fabricated number wearing a measured one's
// clothes. So the rule this module enforces: change statistics exist only
// inside the geometric intersection of both footprints, and the intersection
// itself is reported alongside them.
//
// The footprints available to the client are the scans' tilejson bounds —
// axis-aligned WGS84 rectangles. That makes the intersection a rectangle too,
// which overstates shared coverage when a flight was flown diagonally. It is
// still the honest upper bound the data supports; refining it needs the
// raster's own alpha, which lives server-side.
import { area as turfArea } from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import type { ScanBounds } from "@/lib/scanLayers";

/**
 * Provenance marker on everything the treatment grid writes to a scan row —
 * results AND failures. Declared here, in the pure module, so the decoder can
 * check it without pulling the database client into its import graph;
 * lib/scanAssessment.ts (the writer) imports it from here.
 */
export const GRID_SOURCE = "treatment-grid" as const;

export type GroundPoint = { lat: number; lng: number };

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/** Acres of one polygon ring. Moved from HistoryTab, same turf math. */
export function polyAcres(ring: GroundPoint[] | undefined | null): number {
  if (!ring || ring.length < 3) return 0;
  try {
    const coords = ring.map(p => [p.lng, p.lat]) as [number, number][];
    if (
      coords[0][0] !== coords[coords.length - 1][0] ||
      coords[0][1] !== coords[coords.length - 1][1]
    ) coords.push(coords[0]);
    const m2 = turfArea(turfPolygon([coords]) as never);
    return m2 / 4046.8564224;
  } catch {
    return 0;
  }
}

export function rectAcres(r: ScanBounds): number {
  const midLat = (r.north + r.south) / 2;
  const w = Math.max(0, r.east - r.west) * mPerDegLng(midLat);
  const h = Math.max(0, r.north - r.south) * M_PER_DEG_LAT;
  return (w * h) / 4046.8564224;
}

// ---------------------------------------------------------------------------
// Footprint geometry
// ---------------------------------------------------------------------------

export function rectIntersection(a: ScanBounds, b: ScanBounds): ScanBounds | null {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (west >= east || south >= north) return null;
  return { west, east, south, north };
}

/**
 * How far apart the two footprints' centres sit, in metres on the ground.
 * Positive east = B's centre is east of A's; positive north = north of A's.
 */
export function centerOffsetM(a: ScanBounds, b: ScanBounds): { eastM: number; northM: number } {
  const aC = { lat: (a.north + a.south) / 2, lng: (a.east + a.west) / 2 };
  const bC = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
  const midLat = (aC.lat + bC.lat) / 2;
  return {
    eastM: (bC.lng - aC.lng) * mPerDegLng(midLat),
    northM: (bC.lat - aC.lat) * M_PER_DEG_LAT,
  };
}

/**
 * Says what the offset is and where it lives — in the scans, not the viewer.
 *
 * The viewer places every tile purely from the raster's own georeference (the
 * slippy-map grid is deterministic), so when two footprints of "the same
 * field" sit apart, the difference is in the data: GPS drift between flights,
 * or genuinely different coverage. Reporting it beats nudging one scan under
 * the other, which would misplace every measurement made on it.
 *
 * Null when the centres agree to within ~2 m — normal coverage variation, not
 * worth an alarm.
 */
export function offsetDescription(a: ScanBounds, b: ScanBounds): string | null {
  const { eastM, northM } = centerOffsetM(a, b);
  if (Math.abs(eastM) < 2 && Math.abs(northM) < 2) return null;
  const ew = `${Math.abs(eastM).toFixed(0)} m ${eastM >= 0 ? "east" : "west"}`;
  const ns = `${Math.abs(northM).toFixed(0)} m ${northM >= 0 ? "north" : "south"}`;
  return `The newer flight's footprint sits ${ew} and ${ns} of the older one's. ` +
    `That offset is in the scans' own georeferencing, not this viewer.`;
}

/**
 * Sutherland–Hodgman clip of one ring against an axis-aligned rectangle.
 * The rectangle is convex, so four half-plane passes are exact.
 */
export function clipRingToRect(ring: GroundPoint[], rect: ScanBounds): GroundPoint[] {
  type Edge = { inside: (p: GroundPoint) => boolean; cross: (a: GroundPoint, b: GroundPoint) => GroundPoint };
  const lerpAt = (a: GroundPoint, b: GroundPoint, t: number): GroundPoint => ({
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  });
  const edges: Edge[] = [
    { inside: p => p.lng >= rect.west, cross: (a, b) => lerpAt(a, b, (rect.west - a.lng) / (b.lng - a.lng)) },
    { inside: p => p.lng <= rect.east, cross: (a, b) => lerpAt(a, b, (rect.east - a.lng) / (b.lng - a.lng)) },
    { inside: p => p.lat >= rect.south, cross: (a, b) => lerpAt(a, b, (rect.south - a.lat) / (b.lat - a.lat)) },
    { inside: p => p.lat <= rect.north, cross: (a, b) => lerpAt(a, b, (rect.north - a.lat) / (b.lat - a.lat)) },
  ];
  let out = ring.slice();
  for (const e of edges) {
    if (out.length === 0) return [];
    const next: GroundPoint[] = [];
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      const prev = out[(i + out.length - 1) % out.length];
      const curIn = e.inside(cur);
      const prevIn = e.inside(prev);
      if (curIn) {
        if (!prevIn) next.push(e.cross(prev, cur));
        next.push(cur);
      } else if (prevIn) {
        next.push(e.cross(prev, cur));
      }
    }
    out = next;
  }
  return out.length >= 3 ? out : [];
}

// ---------------------------------------------------------------------------
// Change statistics — overlap only
// ---------------------------------------------------------------------------

type ZoneLike = { ring?: GroundPoint[]; areaM2?: number };

/**
 * One zone's acres. Treatment-grid snapshots carry `areaM2` — the sum of the
 * member cells' TRUE clipped areas, the number prescriptions are priced on —
 * so it wins over re-deriving from the traced ring, which pokes past the field
 * edge. Ring area is the fallback for legacy zones that carry nothing better.
 */
export function zoneAcres(z: ZoneLike): number {
  if (typeof z.areaM2 === "number" && isFinite(z.areaM2) && z.areaM2 >= 0) {
    return z.areaM2 / 4046.8564224;
  }
  return polyAcres(z.ring);
}

/** Marked/stressed acres of a whole scan, no clipping. For single-scan cards. */
export function stressedAcres(zones: ZoneLike[]): number {
  return zones.reduce((sum, z) => sum + zoneAcres(z), 0);
}

/**
 * Marked acres inside the shared footprint only. A zone partly outside is
 * counted by its true area scaled by the clipped fraction of its ring —
 * geometry decides the fraction, the grid's own arithmetic decides the total.
 */
export function stressedAcresWithin(zones: ZoneLike[], rect: ScanBounds): number {
  return zones.reduce((sum, z) => {
    if (!z.ring || z.ring.length < 3) return sum;
    const ringAc = polyAcres(z.ring);
    if (ringAc <= 0) return sum;
    const clippedAc = polyAcres(clipRingToRect(z.ring, rect));
    return sum + zoneAcres(z) * (clippedAc / ringAc);
  }, 0);
}

export type CompareStats = {
  overlap: ScanBounds | null;
  overlapAcres: number;
  /** Null until that scan has a completed analysis — never a fabricated zero. */
  aStressedAc: number | null;
  bStressedAc: number | null;
  /** Percent change A→B within the overlap. Null unless both are analyzed and A > 0. */
  deltaPct: number | null;
};

export function compareStats(input: {
  aBounds: ScanBounds | null;
  bBounds: ScanBounds | null;
  /** Null = that scan has no completed analysis. Empty array = analyzed, clean. */
  aZones: ZoneLike[] | null;
  bZones: ZoneLike[] | null;
}): CompareStats {
  const overlap = input.aBounds && input.bBounds
    ? rectIntersection(input.aBounds, input.bBounds)
    : null;
  if (!overlap) {
    return { overlap: null, overlapAcres: 0, aStressedAc: null, bStressedAc: null, deltaPct: null };
  }
  const aStressedAc = input.aZones ? stressedAcresWithin(input.aZones, overlap) : null;
  const bStressedAc = input.bZones ? stressedAcresWithin(input.bZones, overlap) : null;
  const deltaPct = aStressedAc !== null && bStressedAc !== null && aStressedAc > 0
    ? ((bStressedAc - aStressedAc) / aStressedAc) * 100
    : null;
  return { overlap, overlapAcres: rectAcres(overlap), aStressedAc, bStressedAc, deltaPct };
}

// ---------------------------------------------------------------------------
// What a scan's analysis may claim
// ---------------------------------------------------------------------------

/**
 * A failed run recorded by the REMOVED vision path, found on a scan row.
 *
 * These exist because that path stamped its failures onto `ai_analysis`
 * before it was deleted — most of them "AI is not configured (missing
 * AI_API_KEY)", from an auto-run against a key that was never set. They are
 * disclosed, never attributed to the treatment grid, and never silently
 * dropped: the grid has no AI configuration and cannot produce such a failure.
 */
export type LegacyFailure = { error: string; at: string | null };

export type AnalysisState =
  | { kind: "none"; legacyFailure?: LegacyFailure }
  /** A TREATMENT GRID run failed. Never a legacy artifact — see LegacyFailure. */
  | { kind: "failed"; error: string; at: string | null }
  | {
      kind: "done";
      /**
       * "grid": snapshotted from the treatment grid — the product's one
       * analysis system. "legacy": written by the removed analyze-ortho vision
       * path; kept, never blended, and every reader labels it as legacy so no
       * number is ambiguous about which system produced it.
       */
      source: "grid" | "legacy";
      zones: { id?: string; ring?: GroundPoint[]; severity?: string }[];
      at: string | null;
      /** A later GRID run failed; the zones shown are from the last good state. */
      rerunFailed: { error: string; at: string | null } | null;
      /** A failure left by the removed vision path, disclosed as such. */
      legacyFailure?: LegacyFailure;
    };

/**
 * The one place that decides whether a scan is "no reference points yet",
 * "assessed" or "run failed" — so the three can never blur into one rendering.
 *
 * FAILURES CARRY PROVENANCE, exactly like results. A `last_run` failure is a
 * grid failure only when it is stamped `source: "treatment-grid"`. Anything
 * else was written by the removed vision path, and attributing it to the grid
 * is how a scan came to read "Grid run failed · AI is not configured (missing
 * AI_API_KEY)" — a message the grid cannot produce, since it computes over
 * pixels and calls no service. Those are reported as legacy artifacts.
 *
 * The states live in odm_tasks.ai_analysis without a schema change (shape in
 * lib/scanAssessment.ts):
 *   null / empty grid snapshot with no reference points  → none
 *   grid-stamped last_run failure, nothing assessed      → failed, reason kept
 *   unstamped last_run failure                           → none + legacyFailure
 *   zones array (possibly empty)                         → done — an empty
 *     result from placed reference points is a RESULT, not an absence
 *   source != "treatment-grid" but zones present         → done, legacy-marked
 */
export function analysisStateOf(task: {
  ai_analysis: unknown;
  ai_analysis_at: string | null;
}): AnalysisState {
  const a = task.ai_analysis as {
    source?: string;
    zones?: unknown;
    reference?: { treated?: number; skipped?: number };
    detection?: unknown;
    last_run?: { status?: string; at?: string; error?: string; source?: string };
  } | null;
  const lastRun = a && typeof a === "object" ? a.last_run : undefined;
  const anyFailure = lastRun?.status === "failed"
    ? { error: lastRun.error ?? "Unknown error", at: lastRun.at ?? null }
    : null;
  // Only a failure the grid itself stamped may be reported as a grid failure.
  const fromGrid = lastRun?.source === GRID_SOURCE;
  const failedRun = anyFailure && fromGrid ? anyFailure : null;
  const legacyFailure = anyFailure && !fromGrid ? anyFailure : undefined;

  if (a && Array.isArray(a.zones)) {
    const isGrid = a.source === GRID_SOURCE;
    // A grid snapshot with zero zones AND zero reference points AND no
    // detection is a grid nobody has worked yet — "none", not "assessed clean".
    if (
      isGrid && a.zones.length === 0 && !a.detection &&
      (a.reference?.treated ?? 0) === 0 && (a.reference?.skipped ?? 0) === 0
    ) {
      return failedRun ? { kind: "failed", ...failedRun } : { kind: "none", legacyFailure };
    }
    return {
      kind: "done",
      source: isGrid ? "grid" : "legacy",
      zones: a.zones as { id?: string; ring?: GroundPoint[]; severity?: string }[],
      at: task.ai_analysis_at,
      rerunFailed: failedRun,
      legacyFailure,
    };
  }
  if (failedRun) return { kind: "failed", ...failedRun };
  return { kind: "none", legacyFailure };
}

// ---------------------------------------------------------------------------
// Picking the two scans
// ---------------------------------------------------------------------------

/**
 * Toggle a scan in the pick list. At most two picks; picking a third replaces
 * the pick made first, so a wrong choice is one click to fix.
 */
export function togglePick(picked: string[], id: string): string[] {
  if (picked.includes(id)) return picked.filter(x => x !== id);
  const next = [...picked, id];
  return next.length > 2 ? next.slice(-2) : next;
}

/**
 * Assign the picked scans to the two sides: A (base) is always the older
 * flight, B (compare) the newer, whatever order they were clicked in.
 */
export function abOf(
  picked: string[],
  dateOf: (id: string) => string,
): { a: string | null; b: string | null } {
  if (picked.length === 0) return { a: null, b: null };
  if (picked.length === 1) return { a: picked[0], b: null };
  const sorted = [...picked].sort((x, y) => dateOf(x).localeCompare(dateOf(y)));
  return { a: sorted[0], b: sorted[1] };
}
