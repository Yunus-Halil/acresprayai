// Swath-aligned treatment grid — the unit in which rates are assigned.
//
// WHY THIS EXISTS. The prescription raster used to be a free-form surface at
// ~1 m resolution. On a real field that produced 5 treated pixels out of 2232:
// about 5 m² of treatment across roughly 1000 m². But a spray swath is metres
// wide, so the aircraft cannot execute treatment at that granularity — it will
// either ignore it or overspray it. A 1 m raster claims precision the hardware
// does not have, no matter how many pixels carry a rate.
//
// So the unit of rate assignment becomes a cell whose size derives from the
// swath width. Every cell then corresponds to something the drone can actually
// do, and sub-swath detail is refused at the model level rather than silently
// smeared at export time.
//
// STAGE 1 of three. This module owns geometry and identity only. Rate
// assignment (stage 2) and detection scoring (stage 3) have their fields
// reserved here because identity and state representation are the expensive
// things to retrofit, but nothing computes them yet.
import {
  type LatLng2, M_PER_DEG_LAT, M2_PER_HECTARE,
  bboxOfRings, centroidOfRings, mPerDegLng, pointInAnyRing,
  polygonAreaM2, principalAxisAngle, rotateLL,
} from "./geo";

// ---------------------------------------------------------------------------
// Definition — small, persisted, and fully determines every cell
// ---------------------------------------------------------------------------

export type GridDefinition = {
  /** Effective spray swath in metres, from the active drone's spec. */
  swathM: number;
  /**
   * Cell size as an INTEGER multiple of the swath. Sub-swath cells are refused
   * rather than offered: the aircraft cannot execute a cell narrower than its
   * own boom, so allowing 0.5x would let an operator draw a prescription that
   * physically cannot be flown.
   */
  cellMultiple: 1 | 2 | 3;
  /** Radians. The planner's own field heading, so cells line up with passes. */
  headingRad: number;
  /** Rotation anchor and grid origin. */
  origin: LatLng2;
  /** Boundary fingerprint, so editing the field also invalidates the grid. */
  boundaryHash: string;
};

export const cellSizeM = (d: GridDefinition): number => d.swathM * d.cellMultiple;

/**
 * Hard ceiling on cell count.
 *
 * Sparse persistence holds only while cells are untouched — the first detection
 * run writes a score to EVERY cell, so a field that generates 200k cells would
 * quietly try to persist 200k records. Failing loudly at generation time means
 * we find out at the boundary rather than when a customer's field times out.
 */
export const MAX_CELLS = 20_000;

export class GridTooLargeError extends Error {
  constructor(readonly cells: number, readonly limit = MAX_CELLS) {
    super(
      `This field needs ${cells.toLocaleString()} treatment cells, over the ${limit.toLocaleString()} limit. ` +
      `Increase the cell size multiple, or split the field.`,
    );
    this.name = "GridTooLargeError";
  }
}

// ---------------------------------------------------------------------------
// Identity — derived, never assigned
// ---------------------------------------------------------------------------

export type GridId = string;
export type CellId = string;

/**
 * Stable id for a grid definition.
 *
 * Derived rather than random, and rounded before hashing so float noise in the
 * heading or origin does not mint a new grid on every recompute. Two
 * consequences that matter:
 *
 *   - The same definition always yields the same cell ids, so a sparse map of
 *     rates reattaches correctly across reload, recompute and DB round trip.
 *   - Changing swath, multiple, heading or boundary yields a DIFFERENT gridId,
 *     so stale rates cannot silently land on cells they were not assigned to.
 *     Regeneration mismatch becomes structurally impossible instead of
 *     something a caller has to remember to check.
 */
export function gridIdFor(d: GridDefinition): GridId {
  const canonical = [
    d.swathM.toFixed(2),
    d.cellMultiple,
    d.headingRad.toFixed(6),
    d.origin.lat.toFixed(7),
    d.origin.lng.toFixed(7),
    d.boundaryHash,
  ].join("|");
  // FNV-1a. Not cryptographic — this only needs to be stable and well spread.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

export const cellIdFor = (gridId: GridId, col: number, row: number): CellId =>
  `${gridId}:${col}:${row}`;

/** Fingerprint of the field outline, at ~1 cm resolution. */
export function boundaryHashOf(boundary: LatLng2[][]): string {
  let h = 0x811c9dc5;
  for (const ring of boundary) {
    for (const p of ring) {
      const s = `${p.lat.toFixed(7)},${p.lng.toFixed(7)};`;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
    h ^= 0x5f; h = Math.imul(h, 0x01000193) >>> 0;   // ring separator
  }
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// Cell state — rate (stage 2) and detection (stage 3)
// ---------------------------------------------------------------------------

/**
 * Who decided this cell's rate.
 *
 * `operator` is the override marker: a threshold re-run must skip these, so a
 * later tuning pass cannot silently wipe a hand correction.
 */
export type RateSource = "default" | "threshold" | "operator";

/**
 * Untreated is a STATE, not a rate of zero.
 *
 * Modelled as a discriminated union rather than a nullable number so that
 * "deliberately not sprayed" and "no decision yet" cannot collapse into the
 * same value — and so an operator can explicitly override a cell TO untreated,
 * which a nullable rate would make indistinguishable from clearing it.
 */
export type CellRate =
  | { state: "untreated"; source: RateSource }
  | {
      state: "treated"; rateLha: number; source: RateSource;
      /**
       * What kind of problem this ground has, if the operator said. Optional
       * and honest: a painted cell with no issue set is UNCLASSIFIED, never
       * guessed. Uses the same vocabulary as hand-drawn anomaly polygons
       * (USER_POLY_ISSUES) so the two flag the same kinds of things.
       *
       * METADATA ONLY. Neither this nor `note` may influence what is treated
       * or at what rate — classifying ground describes it, it does not spray
       * it. Every writer of these two fields must leave `state`, `rateLha` and
       * `source` exactly as they found them.
       */
      issue?: string;
      /**
       * The operator's own words about this ground: "third year running",
       * "check drainage". Free text, short, and never parsed — it exists so a
       * triage decision made in the field survives the walk back to the truck.
       */
      note?: string;
    };

export const UNASSIGNED: CellRate = { state: "untreated", source: "default" };

/**
 * Ceiling on a cell note, in characters.
 *
 * The whole grid lives in one JSON column and a note is stored per cell, so a
 * zone of 200 cells carrying an essay each is how that column stops loading.
 * Short by design: this is a margin annotation, not a report.
 */
export const MAX_NOTE_CHARS = 200;

/** A note as it may be stored: trimmed, capped, or absent entirely. */
export function normalizeNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTE_CHARS) : undefined;
}

/** Raw detection output, kept separate from the rate it may imply. */
export type CellDetection = {
  /** 0..1, straight from the model. Never thresholded in place. */
  score: number;
  modelVersion: string;
  scoredAt: string;
} | null;

export type TreatmentCell = {
  id: CellId;
  col: number;
  row: number;
  /** Clipped to the field boundary, WGS84. */
  ring: LatLng2[];
  /** TRUE clipped area — this is what drives the volume calculation. */
  areaM2: number;
  centroid: LatLng2;
  /** A partial edge cell, kept rather than dropped. */
  clipped: boolean;
  rate: CellRate;
  detection: CellDetection;
};

export type GridWarning =
  | {
      kind: "narrower-than-swath";
      /** Which boundary ring is too narrow. */
      ringIndex: number;
      widthM: number;
      swathM: number;
      message: string;
    }
  | {
      kind: "sub-swath-cell";
      cellSizeM: number;
      swathM: number;
      message: string;
    };

export type TreatmentGrid = {
  id: GridId;
  definition: GridDefinition;
  cells: TreatmentCell[];
  warnings: GridWarning[];
  cellSizeM: number;
  /**
   * Which scan's imagery the current reference points were confirmed against
   * (see treatmentGridStore.GridAssessedAgainst). Null/absent = unknown
   * provenance: opened on any scan, this grid is carried over until confirmed.
   */
  assessed?: import("./treatmentGridStore").GridAssessedAgainst | null;
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Local metric frame about `origin`: metres east/north. */
function toLocal(p: LatLng2, origin: LatLng2): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * mPerDegLng(origin.lat),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

/** Andrew's monotone chain. */
function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (p.length < 3) return p;
  const cross = (o: typeof p[0], a: typeof p[0], b: typeof p[0]) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (src: typeof p) => {
    const out: typeof p = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...build(p), ...build(p.slice().reverse())];
}

/**
 * Narrowest width of a ring, in metres — the smallest distance between two
 * parallel lines enclosing it (rotating calipers over the convex hull).
 *
 * Exact for convex shapes, which is what field strips are. For a concave ring
 * this measures the hull, so it OVERSTATES the width and can only miss a
 * warning, never invent one.
 */
export function minWidthM(ring: LatLng2[], origin: LatLng2): number {
  const hull = convexHull(ring.map(p => toLocal(p, origin)));
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    let far = 0;
    for (const q of hull) {
      // Perpendicular distance from the edge line.
      far = Math.max(far, Math.abs((q.x - a.x) * ey - (q.y - a.y) * ex) / len);
    }
    best = Math.min(best, far);
  }
  return isFinite(best) ? best : 0;
}

/**
 * Sutherland–Hodgman: clip `subject` against a CONVEX clipper.
 *
 * The cell rectangle is the clipper, so convexity holds by construction. A
 * concave boundary that enters a cell twice comes back joined by a zero-width
 * connector; that contributes no area, so `areaM2` stays correct even where the
 * outline is cosmetically imperfect.
 */
function clipToConvex(subject: LatLng2[], clipper: LatLng2[]): LatLng2[] {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length];
    // Positive = left of edge a→b. Clipper is wound counter-clockwise.
    const side = (p: LatLng2) => (b.lng - a.lng) * (p.lat - a.lat) - (b.lat - a.lat) * (p.lng - a.lng);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      const dCur = side(cur), dPrev = side(prev);
      if (dCur >= 0) {
        if (dPrev < 0) out.push(intersect(prev, cur, dPrev, dCur));
        out.push(cur);
      } else if (dPrev >= 0) {
        out.push(intersect(prev, cur, dPrev, dCur));
      }
    }
  }
  return out;
}

function intersect(p: LatLng2, q: LatLng2, dp: number, dq: number): LatLng2 {
  const t = dp / (dp - dq);
  return { lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t };
}

/**
 * Build the definition from what the planner already knows.
 *
 * Heading comes from `principalAxisAngle`, the SAME function `buildFieldSweep`
 * uses to orient its passes. If the two ever diverge, cells stop lining up with
 * the rows they are supposed to describe, so they must share one source.
 */
export function gridDefinitionFor(
  boundary: LatLng2[][],
  swathM: number,
  cellMultiple: 1 | 2 | 3 = 1,
): GridDefinition {
  return {
    swathM,
    cellMultiple,
    headingRad: principalAxisAngle(boundary),
    origin: centroidOfRings(boundary),
    boundaryHash: boundaryHashOf(boundary),
  };
}

/**
 * Generate the grid. Geometry only — every cell comes back unassigned and
 * unscored; stages 2 and 3 populate `rate` and `detection`.
 */
export function buildTreatmentGrid(
  boundary: LatLng2[][],
  definition: GridDefinition,
): TreatmentGrid {
  if (!boundary?.length) throw new Error("treatment grid: no field boundary");
  const size = cellSizeM(definition);
  if (!(size > 0)) throw new Error("treatment grid: cell size must be positive");

  const id = gridIdFor(definition);
  const warnings: GridWarning[] = [];

  // Unreachable through `GridDefinition` — `cellMultiple` is 1|2|3, so size is
  // always at least one swath. It is still a real guard, because a definition
  // loaded from persisted JSON has not been type-checked: an older or
  // hand-edited record can carry a fractional multiple and would otherwise
  // generate a prescription that cannot be flown.
  if (size < definition.swathM) {
    warnings.push({
      kind: "sub-swath-cell",
      cellSizeM: size,
      swathM: definition.swathM,
      message:
        `Cells are ${size.toFixed(1)} m across but the swath is ${definition.swathM.toFixed(1)} m. ` +
        `The aircraft cannot vary its rate within one boom width, so this prescription cannot be flown as drawn.`,
    });
  }

  // A plot narrower than the boom cannot be treated without hitting its
  // neighbours. That is a fact about the aircraft, not a bug in the grid — but
  // the software should say so rather than quietly averaging across plots.
  boundary.forEach((ring, ringIndex) => {
    const w = minWidthM(ring, definition.origin);
    if (w > 0 && w < definition.swathM) {
      warnings.push({
        kind: "narrower-than-swath",
        ringIndex,
        widthM: w,
        swathM: definition.swathM,
        message:
          `This plot is about ${w.toFixed(1)} m wide, narrower than the ${definition.swathM.toFixed(1)} m swath. ` +
          `Treating it will overspray onto whatever borders it, no cell can fit inside it alone.`,
      });
    }
  });

  const { origin, headingRad } = definition;
  const cF = Math.cos(-headingRad), sF = Math.sin(-headingRad);
  const cI = Math.cos(headingRad), sI = Math.sin(headingRad);
  const rot = (p: LatLng2) => rotateLL(p, origin, cF, sF);
  const unrot = (p: LatLng2) => rotateLL(p, origin, cI, sI);

  const rotBoundary = boundary.map(r => r.map(rot));
  const bb = bboxOfRings(rotBoundary);

  // Cell size in degrees within the rotated frame.
  const dLat = size / M_PER_DEG_LAT;
  const dLng = size / mPerDegLng(origin.lat);

  // Index cells from the ORIGIN outward rather than from the bbox corner, so a
  // boundary edit that extends the field northwards does not renumber every
  // existing cell. Column/row indices are therefore signed.
  const col0 = Math.floor((bb.minLng - origin.lng) / dLng);
  const col1 = Math.ceil((bb.maxLng - origin.lng) / dLng);
  const row0 = Math.floor((bb.minLat - origin.lat) / dLat);
  const row1 = Math.ceil((bb.maxLat - origin.lat) / dLat);

  const candidates = (col1 - col0 + 1) * (row1 - row0 + 1);
  if (candidates > MAX_CELLS * 4) throw new GridTooLargeError(candidates);

  const cells: TreatmentCell[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const south = origin.lat + row * dLat;
      const west = origin.lng + col * dLng;
      // Counter-clockwise, as clipToConvex expects.
      const rect: LatLng2[] = [
        { lat: south, lng: west },
        { lat: south, lng: west + dLng },
        { lat: south + dLat, lng: west + dLng },
        { lat: south + dLat, lng: west },
      ];

      let ringRot: LatLng2[] | null = null;
      let clipped = false;
      // Whole-cell fast path: all four corners inside means no clipping needed.
      const cornersIn = rect.every(p => pointInAnyRing(p, rotBoundary));
      if (cornersIn) {
        ringRot = rect;
      } else {
        for (const rb of rotBoundary) {
          const piece = clipToConvex(rb, rect);
          if (piece.length >= 3) { ringRot = piece; clipped = true; break; }
        }
      }
      if (!ringRot || ringRot.length < 3) continue;

      const ring = ringRot.map(unrot);
      const areaM2 = polygonAreaM2(ring);
      // Slivers below 1% of a cell are rounding artefacts at the boundary, not
      // ground anyone can treat.
      if (areaM2 < size * size * 0.01) continue;

      cells.push({
        id: cellIdFor(id, col, row),
        col, row, ring, areaM2, clipped,
        centroid: {
          lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length,
          lng: ring.reduce((a, p) => a + p.lng, 0) / ring.length,
        },
        rate: UNASSIGNED,
        detection: null,
      });

      if (cells.length > MAX_CELLS) throw new GridTooLargeError(cells.length);
    }
  }

  return { id, definition, cells, warnings, cellSizeM: size };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type GridTotals = {
  cellCount: number;
  treatedCellCount: number;
  fieldAreaHa: number;
  treatedAreaHa: number;
  /** Litres required across the whole mission. */
  totalVolumeL: number;
  /** Usable tank litres per load, at the configured fill. */
  tankL: number;
  /** Loads needed — 0 when nothing is treated. */
  tankLoads: number;
};

export function gridTotals(grid: TreatmentGrid, tankL: number): GridTotals {
  let fieldAreaM2 = 0, treatedAreaM2 = 0, volumeL = 0, treatedCells = 0;
  for (const c of grid.cells) {
    fieldAreaM2 += c.areaM2;
    if (c.rate.state !== "treated") continue;
    treatedCells++;
    treatedAreaM2 += c.areaM2;
    // True clipped area is why an edge cell does not bill a full cell's volume.
    volumeL += (c.areaM2 / M2_PER_HECTARE) * c.rate.rateLha;
  }
  return {
    cellCount: grid.cells.length,
    treatedCellCount: treatedCells,
    fieldAreaHa: fieldAreaM2 / M2_PER_HECTARE,
    treatedAreaHa: treatedAreaM2 / M2_PER_HECTARE,
    totalVolumeL: volumeL,
    tankL,
    tankLoads: tankL > 0 && volumeL > 0 ? Math.ceil(volumeL / tankL) : 0,
  };
}

/**
 * Whether regenerating would discard operator work.
 *
 * Cell ids do not survive a change of swath, multiple, heading or boundary, so
 * the caller must confirm before rebuilding rather than find out afterwards.
 */
export function regenerationImpact(
  current: TreatmentGrid | null,
  next: GridDefinition,
): { changes: boolean; assignedCells: number; overriddenCells: number } {
  if (!current) return { changes: false, assignedCells: 0, overriddenCells: 0 };
  const changes = gridIdFor(next) !== current.id;
  let assigned = 0, overridden = 0;
  for (const c of current.cells) {
    if (c.rate.state === "treated" || c.rate.source !== "default") assigned++;
    if (c.rate.source === "operator") overridden++;
  }
  return { changes, assignedCells: assigned, overriddenCells: overridden };
}
