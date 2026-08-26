// Persistence for the treatment grid.
//
// WHAT IS STORED: the grid DEFINITION plus a sparse map of per-cell state.
// Geometry is never persisted — it is recomputed from the definition on load,
// which is the whole reason cell identity is derived rather than assigned. A
// 1000 ha field at 6 m cells is ~28,000 cells; serialising their outlines would
// be megabytes of JSON to say something four numbers already say.
//
// WHERE IT IS STORED: `fields.settings` JSON today, because real fields here
// are small — the export that motivated this work was 0.105 ha. Building a
// table for the 1000 ha case would be solving a problem we do not have.
//
// WHY THERE IS AN INTERFACE ANYWAY: sparseness is a property of the
// PRE-ANALYSIS state only. Untouched cells store nothing, which holds right up
// until the first detection run writes a score to every cell at once. Detection
// is the feature this is being built toward, so the day the assumption breaks
// is already on the roadmap. `TreatmentGridRepository` exists so that day is a
// new implementation rather than a rewrite of every caller.
import {
  type CellDetection, type CellId, type CellRate, type GridDefinition,
  type TreatmentGrid, MAX_CELLS, cellIdFor,
} from "./treatmentGrid";

/**
 * Detection scores as a packed array rather than per-cell objects.
 *
 * Scores are a dense grid of floats and JSON objects are the worst available
 * container for that: `{"score":0.83,...}` is ~40 bytes to carry 4 bytes of
 * information, repeated per cell. Packing them into one parallel array keyed by
 * a cell-id index costs a lookup and saves an order of magnitude, which is what
 * buys headroom before the storage backend has to change.
 *
 * Model version and timestamp are per-RUN, not per-cell — detection scores a
 * whole grid in one pass — so they are hoisted out of the cells entirely.
 */
export type PackedDetection = {
  modelVersion: string;
  scoredAt: string;
  /** Cell ids, index-aligned with `scores`. */
  cellIds: CellId[];
  /** 0..1 per cell. Parallel to `cellIds`. */
  scores: number[];
};

/**
 * Which scan's imagery the current reference points were confirmed against.
 *
 * The grid is FIELD-keyed and carries forward to every new scan — but its
 * reference cells were judged against one specific orthomosaic's pixels, and
 * a new flight has different growth, lighting and sun angle. So provenance is
 * part of the grid: opened on a different scan, the grid is a CARRIED-OVER
 * starting point, not an assessment, until the operator confirms (or adjusts)
 * the points against the imagery actually on screen. Grids stored before this
 * field existed have unknown provenance and are treated as carried over.
 */
export type GridAssessedAgainst = {
  scanId: string;
  /** ISO date of that scan's capture, for "carried over from 12 May" copy. */
  scanDate: string | null;
  at: string;
};

/** Everything needed to rebuild a grid's state onto freshly computed geometry. */
export type StoredGrid = {
  definition: GridDefinition;
  /**
   * Sparse: only cells whose rate differs from the default. A cell absent here
   * is untreated-by-default, which is the overwhelming majority pre-analysis.
   */
  rates: Record<CellId, CellRate>;
  detection: PackedDetection | null;
  assessed?: GridAssessedAgainst | null;
};

export interface TreatmentGridRepository {
  load(fieldId: string): Promise<StoredGrid | null>;
  save(fieldId: string, grid: StoredGrid): Promise<void>;
  clear(fieldId: string): Promise<void>;
}

export class GridStoreTooLargeError extends Error {
  constructor(readonly records: number, readonly limit = MAX_CELLS) {
    super(
      `Refusing to persist ${records.toLocaleString()} treatment cell records, over the ${limit.toLocaleString()} limit. ` +
      `Increase the cell size multiple, split the field, or move this field to table-backed storage.`,
    );
    this.name = "GridStoreTooLargeError";
  }
}

/**
 * Reduce a live grid to what actually needs persisting.
 *
 * Errors loudly past the ceiling rather than writing a huge blob, so an
 * oversized field is discovered at the boundary instead of when a customer's
 * field times out loading.
 */
export function packGrid(grid: TreatmentGrid): StoredGrid {
  const rates: Record<CellId, CellRate> = {};
  const cellIds: CellId[] = [];
  const scores: number[] = [];
  let modelVersion = "", scoredAt = "";

  for (const c of grid.cells) {
    // Default-untreated is the implied state, so storing it would defeat the
    // sparseness the whole scheme depends on.
    if (c.rate.state === "treated" || c.rate.source !== "default") rates[c.id] = c.rate;
    if (c.detection) {
      cellIds.push(c.id);
      scores.push(c.detection.score);
      modelVersion = c.detection.modelVersion;
      scoredAt = c.detection.scoredAt;
    }
  }

  const records = Object.keys(rates).length + cellIds.length;
  if (records > MAX_CELLS) throw new GridStoreTooLargeError(records);

  return {
    definition: grid.definition,
    rates,
    detection: cellIds.length ? { modelVersion, scoredAt, cellIds, scores } : null,
    assessed: grid.assessed ?? null,
  };
}

/**
 * Reattach stored state onto freshly generated geometry.
 *
 * Cells whose id is absent keep the defaults they were built with. A stored id
 * that matches nothing is dropped silently — which only happens when the
 * definition changed, and in that case the gridId changed too, so the caller
 * was already warned before regenerating.
 */
export function applyStored(grid: TreatmentGrid, stored: StoredGrid | null): TreatmentGrid {
  if (!stored) return grid;

  const scoreById = new Map<CellId, CellDetection>();
  const d = stored.detection;
  if (d) {
    for (let i = 0; i < d.cellIds.length; i++) {
      scoreById.set(d.cellIds[i], {
        score: d.scores[i],
        modelVersion: d.modelVersion,
        scoredAt: d.scoredAt,
      });
    }
  }

  return {
    ...grid,
    assessed: stored.assessed ?? null,
    cells: grid.cells.map(c => ({
      ...c,
      rate: stored.rates[c.id] ?? c.rate,
      detection: scoreById.get(c.id) ?? c.detection,
    })),
  };
}

/** Rebuild a cell id from stored coordinates — used when migrating layouts. */
export const storedCellId = cellIdFor;
