// Persistence: what survives a round trip, what is refused, and what a
// malformed row does.
//
// The parsing tests matter more than they look. `fields.settings` is JSON the
// database never type-checked — older builds, support edits, a client that lost
// its connection mid-write — and the failure mode of trusting it is a map that
// throws while rendering and takes the tab with it.
import { describe, it, expect } from "vitest";
import {
  GRID_SETTINGS_KEY, MemoryTreatmentGridRepository, parseStoredGrid, recordCount,
} from "@/lib/treatmentGridRepo";
import { GridStoreTooLargeError, applyStored, packGrid } from "@/lib/treatmentGridStore";
import type { StoredGrid } from "@/lib/treatmentGridStore";
import {
  MAX_CELLS, buildTreatmentGrid, gridDefinitionFor, gridIdFor,
} from "@/lib/treatmentGrid";

const SQUARE = [[
  { lat: 40.0000, lng: -100.0000 },
  { lat: 40.0000, lng: -99.99648 },
  { lat: 40.00270, lng: -99.99648 },
  { lat: 40.00270, lng: -100.0000 },
]];

const freshGrid = (swathM = 30) =>
  buildTreatmentGrid(SQUARE, gridDefinitionFor(SQUARE, swathM, 1));

const DEF = gridDefinitionFor(SQUARE, 30, 1);

describe("round trip", () => {
  it("reattaches rates onto freshly built geometry", async () => {
    const repo = new MemoryTreatmentGridRepository();
    const grid = freshGrid();
    const target = grid.cells[4].id;
    const edited = {
      ...grid,
      cells: grid.cells.map(c =>
        c.id === target ? { ...c, rate: { state: "treated" as const, rateLha: 22, source: "operator" as const } } : c),
    };

    await repo.save("field-1", packGrid(edited));

    // Geometry is never stored: the reload rebuilds it and reattaches by id.
    // That is the entire justification for deriving cell ids rather than
    // assigning them.
    const rebuilt = applyStored(freshGrid(), await repo.load("field-1"));
    const cell = rebuilt.cells.find(c => c.id === target)!;
    expect(cell.rate).toEqual({ state: "treated", rateLha: 22, source: "operator" });
    expect(rebuilt.cells.filter(c => c.rate.state === "treated")).toHaveLength(1);
  });

  it("stores nothing for the untouched majority", async () => {
    const repo = new MemoryTreatmentGridRepository();
    const grid = freshGrid();
    await repo.save("field-1", packGrid(grid));
    const stored = await repo.load("field-1");
    expect(Object.keys(stored!.rates)).toHaveLength(0);
    expect(stored!.detection).toBeNull();
  });

  it("keeps a hand-set skip, which is a decision and not a default", async () => {
    const repo = new MemoryTreatmentGridRepository();
    const grid = freshGrid();
    const target = grid.cells[2].id;
    const edited = {
      ...grid,
      cells: grid.cells.map(c =>
        c.id === target ? { ...c, rate: { state: "untreated" as const, source: "operator" as const } } : c),
    };
    await repo.save("field-1", packGrid(edited));
    const stored = await repo.load("field-1");
    // Same STATE as the default, so a store that keyed on state alone would
    // drop it and silently turn "I decided not to spray here" back into "nobody
    // has looked at this yet".
    expect(stored!.rates[target]).toEqual({ state: "untreated", source: "operator" });
  });

  it("drops stored state when the definition no longer matches", async () => {
    const repo = new MemoryTreatmentGridRepository();
    const grid = freshGrid(30);
    const edited = {
      ...grid,
      cells: grid.cells.map((c, i) =>
        i === 0 ? { ...c, rate: { state: "treated" as const, rateLha: 30, source: "operator" as const } } : c),
    };
    await repo.save("field-1", packGrid(edited));
    const stored = await repo.load("field-1");

    // A different swath is a different grid id, so nothing reattaches — which
    // is correct. Stale rates landing on cells they were never assigned to is
    // the failure derived ids exist to prevent.
    const other = freshGrid(20);
    expect(gridIdFor(stored!.definition)).not.toBe(other.id);
    const rebuilt = applyStored(other, stored);
    expect(rebuilt.cells.every(c => c.rate.state === "untreated")).toBe(true);
  });

  it("clear removes the grid", async () => {
    const repo = new MemoryTreatmentGridRepository();
    await repo.save("field-1", packGrid(freshGrid()));
    await repo.clear("field-1");
    expect(await repo.load("field-1")).toBeNull();
  });
});

describe("the 20k ceiling", () => {
  const oversized = (records: number): StoredGrid => {
    const rates: StoredGrid["rates"] = {};
    for (let i = 0; i < records; i++) rates[`g:${i}:0`] = { state: "treated", rateLha: 10, source: "operator" };
    return { definition: DEF, rates, detection: null };
  };

  it("refuses to write past the limit rather than storing a huge blob", async () => {
    const repo = new MemoryTreatmentGridRepository();
    await expect(repo.save("f", oversized(MAX_CELLS + 1))).rejects.toThrow(GridStoreTooLargeError);
  });

  it("accepts exactly the limit", async () => {
    const repo = new MemoryTreatmentGridRepository();
    await expect(repo.save("f", oversized(MAX_CELLS))).resolves.toBeUndefined();
  });

  it("counts rates and detection scores together", () => {
    // Sparseness holds only until the first scoring run writes a score to every
    // cell, so the ceiling has to see both halves or it guards nothing.
    const grid: StoredGrid = {
      definition: DEF,
      rates: { "g:0:0": { state: "treated", rateLha: 10, source: "operator" } },
      detection: { modelVersion: "v1", scoredAt: "2026-01-01T00:00:00Z", cellIds: ["g:0:0", "g:1:0"], scores: [0.1, 0.2] },
    };
    expect(recordCount(grid)).toBe(3);
  });
});

describe("parsing what the column actually contains", () => {
  it("reads a well-formed grid", () => {
    const stored = packGrid(freshGrid());
    expect(parseStoredGrid(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("returns null for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "grid", [], {}, { definition: null }]) {
      expect(parseStoredGrid(junk)).toBeNull();
    }
  });

  it("rejects a definition with a non-finite origin", () => {
    expect(parseStoredGrid({
      definition: { ...DEF, origin: { lat: NaN, lng: 0 } }, rates: {}, detection: null,
    })).toBeNull();
  });

  it("drops one malformed rate without losing the others", () => {
    const parsed = parseStoredGrid({
      definition: DEF,
      rates: {
        good: { state: "treated", rateLha: 20, source: "operator" },
        noRate: { state: "treated", source: "operator" },
        badSource: { state: "treated", rateLha: 20, source: "wishful" },
        negative: { state: "treated", rateLha: -5, source: "operator" },
        skip: { state: "untreated", source: "threshold" },
      },
      detection: null,
    });
    // One corrupt cell must not cost the operator every other decision.
    expect(Object.keys(parsed!.rates).sort()).toEqual(["good", "skip"]);
  });

  it("drops detection whole when the two arrays disagree in length", () => {
    // cellIds and scores are index-aligned. A mismatch means we cannot tell
    // which score belongs to which cell, and guessing would put a score on the
    // wrong ground — the exact failure this subsystem is built to prevent.
    const parsed = parseStoredGrid({
      definition: DEF, rates: {},
      detection: { modelVersion: "v1", scoredAt: "t", cellIds: ["a", "b"], scores: [0.5] },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.detection).toBeNull();
  });

  it("keeps detection when it is intact", () => {
    const parsed = parseStoredGrid({
      definition: DEF, rates: {},
      detection: { modelVersion: "interactive-v1", scoredAt: "t", cellIds: ["a", "b"], scores: [0.5, 0.75] },
    });
    expect(parsed!.detection).toEqual({
      modelVersion: "interactive-v1", scoredAt: "t", cellIds: ["a", "b"], scores: [0.5, 0.75],
    });
  });

  it("names the settings key it occupies", () => {
    // The column is shared with FarmerSettings, so the key is part of the
    // contract rather than an implementation detail.
    expect(GRID_SETTINGS_KEY).toBe("treatment_grid");
  });
});
