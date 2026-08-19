// Concrete storage for the treatment grid.
//
// treatmentGridStore.ts defines the SHAPE (what is stored, packed how) and the
// `TreatmentGridRepository` interface; this file is the implementation that
// actually talks to the database. The split is the one that module's header
// argues for: the day a 1000 ha field outgrows a JSON column, that is a new
// class here rather than a rewrite of every caller.
//
// WHERE IT LANDS: `fields.settings` JSON, under one key. That column already
// holds FarmerSettings for the same field, which is why the write below is a
// read-merge-write rather than an overwrite — see `save`.
import { supabase } from "@/integrations/supabase/client";
import {
  type PackedDetection, type StoredGrid, type TreatmentGridRepository,
  GridStoreTooLargeError,
} from "./treatmentGridStore";
import { MAX_CELLS } from "./treatmentGrid";

/** The single key inside `fields.settings` that the grid occupies. */
export const GRID_SETTINGS_KEY = "treatment_grid";

/**
 * Validate a blob pulled out of the settings column.
 *
 * Everything in that column is JSON the database never type-checked: rows
 * written by an older build, rows hand-edited during support, rows half-written
 * by a client that lost its connection. A malformed grid must come back as "no
 * grid" and let the operator regenerate, because the alternative is a map that
 * throws while rendering and takes the whole tab with it.
 */
export function parseStoredGrid(raw: unknown): StoredGrid | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<StoredGrid>;

  const d = g.definition;
  if (!d || typeof d !== "object") return null;
  if (typeof d.swathM !== "number" || !isFinite(d.swathM) || d.swathM <= 0) return null;
  if (typeof d.cellMultiple !== "number" || !isFinite(d.cellMultiple)) return null;
  if (typeof d.headingRad !== "number" || !isFinite(d.headingRad)) return null;
  if (typeof d.boundaryHash !== "string") return null;
  const o = d.origin;
  if (!o || typeof o.lat !== "number" || typeof o.lng !== "number") return null;
  if (!isFinite(o.lat) || !isFinite(o.lng)) return null;

  // Rates: drop individual malformed entries rather than the whole grid. One
  // corrupt cell should not cost the operator every other decision they made.
  const rates: StoredGrid["rates"] = {};
  if (g.rates && typeof g.rates === "object") {
    for (const [id, r] of Object.entries(g.rates)) {
      if (!r || typeof r !== "object") continue;
      const rate = r as { state?: unknown; rateLha?: unknown; source?: unknown };
      if (rate.source !== "default" && rate.source !== "threshold" && rate.source !== "operator") continue;
      if (rate.state === "untreated") {
        rates[id] = { state: "untreated", source: rate.source };
      } else if (rate.state === "treated" && typeof rate.rateLha === "number"
                 && isFinite(rate.rateLha) && rate.rateLha > 0) {
        rates[id] = { state: "treated", rateLha: rate.rateLha, source: rate.source };
      }
    }
  }

  // Detection is all-or-nothing: the two arrays are index-aligned, so a length
  // mismatch means we cannot tell which score belongs to which cell. Guessing
  // would put a score on the wrong ground, which is the failure this whole
  // subsystem is built to make impossible.
  let detection: PackedDetection | null = null;
  const raw2 = g.detection;
  if (raw2 && typeof raw2 === "object") {
    const p = raw2 as Partial<PackedDetection>;
    if (Array.isArray(p.cellIds) && Array.isArray(p.scores)
        && p.cellIds.length === p.scores.length
        && typeof p.modelVersion === "string" && typeof p.scoredAt === "string"
        && p.cellIds.every(id => typeof id === "string")
        && p.scores.every(s => typeof s === "number" && isFinite(s))) {
      detection = {
        modelVersion: p.modelVersion, scoredAt: p.scoredAt,
        cellIds: p.cellIds, scores: p.scores,
      };
    }
  }

  return { definition: d as StoredGrid["definition"], rates, detection };
}

/** Records a StoredGrid would occupy — the number the ceiling applies to. */
export const recordCount = (grid: StoredGrid): number =>
  Object.keys(grid.rates).length + (grid.detection?.cellIds.length ?? 0);

export class SupabaseTreatmentGridRepository implements TreatmentGridRepository {
  async load(fieldId: string): Promise<StoredGrid | null> {
    const { data, error } = await supabase
      .from("fields").select("settings").eq("id", fieldId).maybeSingle();
    if (error) throw error;
    const settings = (data as { settings?: unknown } | null)?.settings;
    if (!settings || typeof settings !== "object") return null;
    return parseStoredGrid((settings as Record<string, unknown>)[GRID_SETTINGS_KEY]);
  }

  async save(fieldId: string, grid: StoredGrid): Promise<void> {
    // The ceiling is enforced again here, not only in packGrid. packGrid is
    // where a live grid is reduced, but this is the WRITE, and the guarantee
    // that matters is "no huge blob reaches the column" — which has to hold for
    // a StoredGrid that arrived by any other route too.
    const records = recordCount(grid);
    if (records > MAX_CELLS) throw new GridStoreTooLargeError(records);
    await this.#patchSettings(fieldId, grid);
  }

  async clear(fieldId: string): Promise<void> {
    await this.#patchSettings(fieldId, null);
  }

  /**
   * Read-merge-write of the one key.
   *
   * `fields.settings` is shared with FarmerSettings, so writing the column
   * wholesale from a grid save would delete the operator's crop, costs and
   * flight plan. Reading first and replacing a single key keeps the blast
   * radius to the grid.
   *
   * This is still last-write-wins against a settings save landing in the same
   * moment — one of the two edits loses. Acceptable at this size: both writers
   * are the same operator in one browser tab, seconds apart at worst. It is
   * also the specific thing that a move to a `treatment_cells` table would fix,
   * so it is written down here rather than discovered later.
   */
  async #patchSettings(fieldId: string, value: StoredGrid | null): Promise<void> {
    const { data, error } = await supabase
      .from("fields").select("settings").eq("id", fieldId).maybeSingle();
    if (error) throw error;

    const current = (data as { settings?: unknown } | null)?.settings;
    const next: Record<string, unknown> =
      current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
    if (value === null) delete next[GRID_SETTINGS_KEY];
    else next[GRID_SETTINGS_KEY] = value;

    const { error: writeErr } = await supabase
      .from("fields").update({ settings: next as never }).eq("id", fieldId);
    if (writeErr) throw writeErr;
  }
}

/**
 * In-memory repository.
 *
 * Exists for tests and for the offline case the product is aimed at — a field
 * edge with no signal is the normal working condition, not the exception, so a
 * grid that can only exist when the database answers is a grid that does not
 * work where it is used.
 */
export class MemoryTreatmentGridRepository implements TreatmentGridRepository {
  #byField = new Map<string, StoredGrid>();

  async load(fieldId: string): Promise<StoredGrid | null> {
    return this.#byField.get(fieldId) ?? null;
  }

  async save(fieldId: string, grid: StoredGrid): Promise<void> {
    const records = recordCount(grid);
    if (records > MAX_CELLS) throw new GridStoreTooLargeError(records);
    this.#byField.set(fieldId, grid);
  }

  async clear(fieldId: string): Promise<void> {
    this.#byField.delete(fieldId);
  }
}
