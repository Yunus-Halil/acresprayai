// Carry treatment-grid decisions across a boundary edit.
//
// THE MECHANISM THIS EXISTS TO FIX. Cell identity is derived:
// gridId = hash(swath, multiple, heading, origin, boundaryHash), and a cell is
// `gridId:col:row`. That derivation is what makes stale state structurally
// unable to land on the wrong ground — but a boundary edit changes not just
// the hash: the origin is the boundary's CENTROID and the heading its
// PRINCIPAL AXIS, so even nudging one vertex mints a new gridId and shifts the
// whole lattice. Stored state then fails the id guard on load, nothing
// reattaches, and the first paint on the fresh grid overwrites the stored blob.
// The operator's work does not die loudly; it is orphaned silently and then
// buried.
//
// WHY REMAP GEOMETRICALLY. Matching by id can never work across a boundary
// edit — the ids differ by construction. But the stored blob carries enough to
// recover the GROUND each decision was made about: col/row are embedded in
// every stored cell id, and the old definition (origin, heading, cell size) is
// stored beside them, so each old cell's centre is reconstructible without the
// old boundary. A decision then moves to whichever new cell contains that
// centre. Decisions whose ground is outside the new boundary are genuinely
// gone — the ground itself left the field — and are counted, not hidden.
//
// The id-guard in the loader stays exactly as it is. This module does not
// weaken the identity model; it adds the explicit, counted path across it.
import {
  type LatLng2, M_PER_DEG_LAT, mPerDegLng, rotateLL,
} from "./geo";
import type { PackedDetection, StoredGrid } from "./treatmentGridStore";
import {
  type CellId, type CellRate, type GridDefinition, type TreatmentGrid,
  cellIdFor, cellSizeM, gridIdFor,
} from "./treatmentGrid";

/**
 * Above this fraction of decided cells lost, the migration stops being a
 * remap and starts being a deletion — so it asks instead of acting. 0.3 is a
 * judgment call, not a measurement: losing a third of someone's decisions is
 * the point where "the boundary moved a little" stops being a credible story.
 */
export const MAJOR_LOSS_FRACTION = 0.3;

/** col/row back out of a stored cell id. GridIds are base36 — no colons. */
export function parseCellId(id: CellId): { gridId: string; col: number; row: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3) return null;
  const col = Number(parts[1]), row = Number(parts[2]);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  return { gridId: parts[0], col, row };
}

/**
 * World-coordinate centre of a cell that may no longer exist.
 *
 * Replays buildTreatmentGrid's lattice: cells are laid out on a grid of
 * `size`-metre squares in a frame rotated by `headingRad` about `origin`,
 * indexed from the origin outward. The centre is lattice position (col+½,
 * row+½), unrotated back to WGS84 — the same `unrot` the builder applies to
 * every ring vertex.
 */
export function cellCentreOf(def: GridDefinition, col: number, row: number): LatLng2 {
  const size = cellSizeM(def);
  const dLat = size / M_PER_DEG_LAT;
  const dLng = size / mPerDegLng(def.origin.lat);
  const rotated = {
    lat: def.origin.lat + (row + 0.5) * dLat,
    lng: def.origin.lng + (col + 0.5) * dLng,
  };
  return rotateLL(rotated, def.origin, Math.cos(def.headingRad), Math.sin(def.headingRad));
}

/** Lattice indices of the cell containing a world point, under a definition. */
export function cellIndexAt(def: GridDefinition, p: LatLng2): { col: number; row: number } {
  const size = cellSizeM(def);
  const dLat = size / M_PER_DEG_LAT;
  const dLng = size / mPerDegLng(def.origin.lat);
  const r = rotateLL(p, def.origin, Math.cos(-def.headingRad), Math.sin(-def.headingRad));
  return {
    col: Math.floor((r.lng - def.origin.lng) / dLng),
    row: Math.floor((r.lat - def.origin.lat) / dLat),
  };
}

export type MigrationPlan = {
  /** Remapped rates, keyed by NEW cell id. */
  rates: Record<CellId, CellRate>;
  /** Remapped detection, keyed by NEW cell id. Null when none survived. */
  detection: PackedDetection | null;
  /** Decisions in the stored grid — the denominator for loss. */
  decided: number;
  /** Decisions that found a home in the new grid. */
  moved: number;
  /** Decisions whose ground is no longer inside the boundary. */
  lost: number;
  lossFraction: number;
  /** True when the loss is large enough that a human should confirm. */
  needsConfirmation: boolean;
};

const sourceRank = (r: CellRate): number => (r.source === "operator" ? 2 : r.source === "threshold" ? 1 : 0);

/**
 * Work out where every stored decision lands on a rebuilt grid.
 *
 * Pure and side-effect free: nothing is written, so the caller can show the
 * counts before anything is destroyed — which is the entire point.
 *
 * When two old cells land in one new cell (the lattice rotated or shifted),
 * the operator's own decision outranks a computed one, and ties go to the old
 * cell whose centre sits closest to the new cell's centre — the decision most
 * "about" that ground.
 */
export function planMigration(stored: StoredGrid, next: TreatmentGrid): MigrationPlan {
  const nextIds = new Set(next.cells.map(c => c.id));
  const nextDef = next.definition;
  const nextGridId = gridIdFor(nextDef);

  type Claim = { rate: CellRate; rank: number; dist2: number };
  const claims = new Map<CellId, Claim>();

  const landing = (oldId: CellId): { id: CellId; dist2: number } | null => {
    const parsed = parseCellId(oldId);
    if (!parsed) return null;
    const centre = cellCentreOf(stored.definition, parsed.col, parsed.row);
    const idx = cellIndexAt(nextDef, centre);
    const id = cellIdFor(nextGridId, idx.col, idx.row);
    if (!nextIds.has(id)) return null;    // ground now outside the boundary
    const newCentre = cellCentreOf(nextDef, idx.col, idx.row);
    const dLat = (centre.lat - newCentre.lat) * M_PER_DEG_LAT;
    const dLng = (centre.lng - newCentre.lng) * mPerDegLng(centre.lat);
    return { id, dist2: dLat * dLat + dLng * dLng };
  };

  let decided = 0, moved = 0;
  for (const [oldId, rate] of Object.entries(stored.rates)) {
    decided++;
    const land = landing(oldId);
    if (!land) continue;
    moved++;
    const rank = sourceRank(rate);
    const prev = claims.get(land.id);
    if (!prev || rank > prev.rank || (rank === prev.rank && land.dist2 < prev.dist2)) {
      claims.set(land.id, { rate, rank, dist2: land.dist2 });
    }
  }

  // Detection rides along on the same containment — scores are provenance and
  // keeping them costs nothing, but they never count toward the loss numbers:
  // the confirmation is about decisions, and a score is not a decision.
  let detection: PackedDetection | null = null;
  if (stored.detection) {
    const best = new Map<CellId, { score: number; dist2: number }>();
    for (let i = 0; i < stored.detection.cellIds.length; i++) {
      const land = landing(stored.detection.cellIds[i]);
      if (!land) continue;
      const prev = best.get(land.id);
      if (!prev || land.dist2 < prev.dist2) {
        best.set(land.id, { score: stored.detection.scores[i], dist2: land.dist2 });
      }
    }
    if (best.size) {
      detection = {
        modelVersion: stored.detection.modelVersion,
        scoredAt: stored.detection.scoredAt,
        cellIds: [...best.keys()],
        scores: [...best.values()].map(b => b.score),
      };
    }
  }

  const lost = decided - moved;
  const lossFraction = decided > 0 ? lost / decided : 0;
  return {
    rates: Object.fromEntries([...claims.entries()].map(([id, c]) => [id, c.rate])),
    detection,
    decided, moved, lost, lossFraction,
    needsConfirmation: decided > 0 && lossFraction > MAJOR_LOSS_FRACTION,
  };
}

/** The plan, applied — a new grid carrying the migrated state. */
export function applyMigration(next: TreatmentGrid, plan: MigrationPlan): TreatmentGrid {
  const scoreById = new Map<CellId, { score: number }>();
  const d = plan.detection;
  if (d) for (let i = 0; i < d.cellIds.length; i++) scoreById.set(d.cellIds[i], { score: d.scores[i] });

  return {
    ...next,
    cells: next.cells.map(c => {
      const rate = plan.rates[c.id];
      const det = scoreById.get(c.id);
      if (!rate && !det) return c;
      return {
        ...c,
        rate: rate ?? c.rate,
        detection: det && d
          ? { score: det.score, modelVersion: d.modelVersion, scoredAt: d.scoredAt }
          : c.detection,
      };
    }),
  };
}
