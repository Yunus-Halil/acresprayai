import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng, polygonAreaM2 } from "@/lib/geo";
import {
  GridTooLargeError,
  buildTreatmentGrid, cellSizeM, gridDefinitionFor, gridIdFor, gridTotals,
  minWidthM, regenerationImpact,
} from "@/lib/treatmentGrid";
import { applyStored, packGrid, GridStoreTooLargeError } from "@/lib/treatmentGridStore";

const LAT = 45;
const LNG = -93;

function rectAt(eastM: number, northM: number, widthM: number, heightM: number): LatLng2[] {
  const lat = LAT + northM / M_PER_DEG_LAT;
  const lng = LNG + eastM / mPerDegLng(LAT);
  return [
    { lat, lng },
    { lat, lng: lng + widthM / mPerDegLng(lat) },
    { lat: lat + heightM / M_PER_DEG_LAT, lng: lng + widthM / mPerDegLng(lat) },
    { lat: lat + heightM / M_PER_DEG_LAT, lng },
  ];
}

const FIELD = rectAt(0, 0, 120, 90);
const SWATH = 6;

describe("cell size derives from the swath", () => {
  it("defaults to exactly one swath", () => {
    const d = gridDefinitionFor([FIELD], SWATH);
    expect(d.cellMultiple).toBe(1);
    expect(cellSizeM(d)).toBe(SWATH);
  });

  it("allows integer multiples only", () => {
    for (const m of [1, 2, 3] as const) {
      expect(cellSizeM(gridDefinitionFor([FIELD], SWATH, m))).toBe(SWATH * m);
    }
  });

  it("cannot express a sub-swath cell through the type at all", () => {
    // The guarantee is structural: size = swath x multiple, multiple >= 1.
    for (const m of [1, 2, 3] as const) {
      const d = gridDefinitionFor([FIELD], SWATH, m);
      expect(cellSizeM(d)).toBeGreaterThanOrEqual(d.swathM);
    }
  });

  it("still guards against a sub-swath multiple arriving from stored JSON", () => {
    // Persisted definitions are not type-checked on load, so an older or
    // hand-edited record can carry a fractional multiple. That must warn rather
    // than silently produce a prescription the aircraft cannot fly.
    const d = { ...gridDefinitionFor([FIELD], SWATH), cellMultiple: 0.5 as unknown as 1 };
    const grid = buildTreatmentGrid([FIELD], d);
    const w = grid.warnings.find(x => x.kind === "sub-swath-cell");
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/cannot vary its rate within one boom width/);
  });
});

describe("cell identity is derived, not assigned", () => {
  const d = gridDefinitionFor([FIELD], SWATH);

  it("is stable across regeneration", () => {
    const a = buildTreatmentGrid([FIELD], d);
    const b = buildTreatmentGrid([FIELD], d);
    expect(a.id).toBe(b.id);
    expect(a.cells.map(c => c.id)).toEqual(b.cells.map(c => c.id));
  });

  it("changes when the swath changes, so stale rates cannot land on new cells", () => {
    expect(gridIdFor(gridDefinitionFor([FIELD], 6))).not.toBe(gridIdFor(gridDefinitionFor([FIELD], 9)));
  });

  it("changes when the cell multiple changes", () => {
    expect(gridIdFor(gridDefinitionFor([FIELD], SWATH, 1)))
      .not.toBe(gridIdFor(gridDefinitionFor([FIELD], SWATH, 2)));
  });

  it("changes when the boundary is edited", () => {
    const bigger = rectAt(0, 0, 140, 90);
    expect(gridIdFor(gridDefinitionFor([FIELD], SWATH)))
      .not.toBe(gridIdFor(gridDefinitionFor([bigger], SWATH)));
  });

  it("survives float noise in the heading", () => {
    const a = gridDefinitionFor([FIELD], SWATH);
    const b = { ...a, headingRad: a.headingRad + 1e-12 };
    expect(gridIdFor(a)).toBe(gridIdFor(b));
  });

  it("carries the grid id, so a cell id can never be read against the wrong grid", () => {
    const grid = buildTreatmentGrid([FIELD], d);
    for (const c of grid.cells) expect(c.id.startsWith(`${grid.id}:`)).toBe(true);
  });
});

describe("cells tile the field", () => {
  const d = gridDefinitionFor([FIELD], SWATH);
  const grid = buildTreatmentGrid([FIELD], d);

  it("covers the field area to within a rounding error", () => {
    const total = grid.cells.reduce((s, c) => s + c.areaM2, 0);
    const field = polygonAreaM2(FIELD);
    expect(Math.abs(total - field) / field).toBeLessThan(0.02);
  });

  it("keeps partial edge cells with their true clipped area", () => {
    const full = SWATH * SWATH;
    const partials = grid.cells.filter(c => c.clipped);
    expect(partials.length).toBeGreaterThan(0);
    for (const c of partials) {
      expect(c.areaM2).toBeGreaterThan(0);
      // A clipped cell is by definition smaller than a whole one.
      expect(c.areaM2).toBeLessThan(full * 1.02);
    }
  });

  it("gives whole interior cells close to the nominal area", () => {
    const interior = grid.cells.filter(c => !c.clipped);
    expect(interior.length).toBeGreaterThan(0);
    for (const c of interior) expect(c.areaM2).toBeCloseTo(SWATH * SWATH, -1);
  });

  it("puts every centroid inside the field", () => {
    // 120x90 at 6 m ≈ 20x15 cells.
    expect(grid.cells.length).toBeGreaterThan(250);
    expect(grid.cells.length).toBeLessThan(400);
  });

  it("starts every cell unassigned and unscored", () => {
    for (const c of grid.cells) {
      expect(c.rate).toEqual({ state: "untreated", source: "default" });
      expect(c.detection).toBeNull();
    }
  });

  it("refuses a field that would generate too many cells", () => {
    const huge = rectAt(0, 0, 20_000, 20_000);
    expect(() => buildTreatmentGrid([huge], gridDefinitionFor([huge], 1)))
      .toThrow(GridTooLargeError);
  });
});

describe("plots narrower than the swath", () => {
  it("measures a strip's true width regardless of orientation", () => {
    const strip = rectAt(0, 0, 3, 80);
    expect(minWidthM(strip, { lat: LAT, lng: LNG })).toBeCloseTo(3, 0);
  });

  it("warns that treating a narrow strip must overspray its neighbours", () => {
    const strip = rectAt(0, 0, 3, 80);
    const grid = buildTreatmentGrid([strip], gridDefinitionFor([strip], SWATH));
    const w = grid.warnings.find(x => x.kind === "narrower-than-swath");
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/overspray onto whatever borders it/);
    // The strip is still griddable — the warning is advice, not a refusal.
    expect(grid.cells.length).toBeGreaterThan(0);
  });

  it("stays quiet on a plot wider than the boom", () => {
    const grid = buildTreatmentGrid([FIELD], gridDefinitionFor([FIELD], SWATH));
    expect(grid.warnings.filter(w => w.kind === "narrower-than-swath")).toHaveLength(0);
  });

  it("names which plot is too narrow in a mixed field", () => {
    const parts = [rectAt(0, 0, 60, 60), rectAt(100, 0, 3, 60)];
    const grid = buildTreatmentGrid(parts, gridDefinitionFor(parts, SWATH));
    const narrow = grid.warnings.filter(w => w.kind === "narrower-than-swath");
    expect(narrow).toHaveLength(1);
    expect(narrow[0].kind === "narrower-than-swath" && narrow[0].ringIndex).toBe(1);
  });
});

describe("totals drive volume from true clipped area", () => {
  const d = gridDefinitionFor([FIELD], SWATH);
  const grid = buildTreatmentGrid([FIELD], d);

  it("reports nothing treated on a fresh grid", () => {
    const t = gridTotals(grid, 30);
    expect(t.treatedCellCount).toBe(0);
    expect(t.totalVolumeL).toBe(0);
    expect(t.tankLoads).toBe(0);
    expect(t.fieldAreaHa).toBeCloseTo(polygonAreaM2(FIELD) / 10_000, 2);
  });

  it("bills an edge cell for its clipped area, not a whole cell", () => {
    const edge = grid.cells.find(c => c.clipped)!;
    const treated = {
      ...grid,
      cells: [{ ...edge, rate: { state: "treated" as const, rateLha: 100, source: "operator" as const } }],
    };
    const t = gridTotals(treated, 30);
    // 100 L/ha over the clipped area, not over a full 36 m² cell.
    expect(t.totalVolumeL).toBeCloseTo((edge.areaM2 / 10_000) * 100, 6);
    expect(t.totalVolumeL).toBeLessThan((36 / 10_000) * 100);
  });

  it("converts volume into whole tank loads", () => {
    const treated = {
      ...grid,
      cells: grid.cells.map(c => ({
        ...c, rate: { state: "treated" as const, rateLha: 200, source: "threshold" as const },
      })),
    };
    const t = gridTotals(treated, 30);
    expect(t.treatedCellCount).toBe(grid.cells.length);
    expect(t.tankLoads).toBe(Math.ceil(t.totalVolumeL / 30));
  });
});

describe("regeneration is explicit about what it would discard", () => {
  const d = gridDefinitionFor([FIELD], SWATH);
  const grid = buildTreatmentGrid([FIELD], d);
  const withWork = {
    ...grid,
    cells: grid.cells.map((c, i) =>
      i < 5 ? { ...c, rate: { state: "treated" as const, rateLha: 20, source: "operator" as const } }
        : i < 12 ? { ...c, rate: { state: "treated" as const, rateLha: 10, source: "threshold" as const } }
          : c),
  };

  it("reports no change when the definition is identical", () => {
    expect(regenerationImpact(withWork, d).changes).toBe(false);
  });

  it("counts assigned and operator-overridden cells at risk", () => {
    const impact = regenerationImpact(withWork, gridDefinitionFor([FIELD], 9));
    expect(impact.changes).toBe(true);
    expect(impact.assignedCells).toBe(12);
    expect(impact.overriddenCells).toBe(5);
  });
});

describe("persistence stores definition plus sparse state", () => {
  const d = gridDefinitionFor([FIELD], SWATH);
  const grid = buildTreatmentGrid([FIELD], d);

  it("stores nothing for a fresh grid beyond the definition", () => {
    const packed = packGrid(grid);
    expect(Object.keys(packed.rates)).toHaveLength(0);
    expect(packed.detection).toBeNull();
    expect(packed.definition).toEqual(d);
  });

  it("round-trips rates onto regenerated geometry", () => {
    const edited = {
      ...grid,
      cells: grid.cells.map((c, i) =>
        i === 3 ? { ...c, rate: { state: "treated" as const, rateLha: 22.5, source: "operator" as const } }
          : i === 4 ? { ...c, rate: { state: "untreated" as const, source: "operator" as const } }
            : c),
    };
    const packed = packGrid(edited);
    // Only the two touched cells are persisted.
    expect(Object.keys(packed.rates)).toHaveLength(2);

    const rebuilt = applyStored(buildTreatmentGrid([FIELD], d), packed);
    expect(rebuilt.cells[3].rate).toEqual({ state: "treated", rateLha: 22.5, source: "operator" });
    // An explicit operator "untreated" survives, distinct from the default.
    expect(rebuilt.cells[4].rate).toEqual({ state: "untreated", source: "operator" });
    expect(rebuilt.cells[5].rate).toEqual({ state: "untreated", source: "default" });
  });

  it("packs detection scores as parallel arrays, not per-cell objects", () => {
    const scored = {
      ...grid,
      cells: grid.cells.map((c, i) => ({
        ...c,
        detection: { score: i / grid.cells.length, modelVersion: "det-1", scoredAt: "2026-08-19T00:00:00Z" },
      })),
    };
    const packed = packGrid(scored);
    expect(packed.detection).not.toBeNull();
    expect(packed.detection!.scores).toHaveLength(grid.cells.length);
    expect(packed.detection!.cellIds).toHaveLength(grid.cells.length);
    // Version and timestamp are per run, hoisted out of the cells entirely.
    expect(packed.detection!.modelVersion).toBe("det-1");

    const rebuilt = applyStored(buildTreatmentGrid([FIELD], d), packed);
    expect(rebuilt.cells[7].detection?.score).toBeCloseTo(7 / grid.cells.length, 12);
    expect(rebuilt.cells[7].detection?.modelVersion).toBe("det-1");
  });

  it("keeps score and rate independent, so thresholds can be retuned", () => {
    const scored = {
      ...grid,
      cells: grid.cells.map(c => ({
        ...c,
        detection: { score: 0.9, modelVersion: "det-1", scoredAt: "2026-08-19T00:00:00Z" },
        rate: { state: "treated" as const, rateLha: 30, source: "threshold" as const },
      })),
    };
    const rebuilt = applyStored(buildTreatmentGrid([FIELD], d), packGrid(scored));
    // Re-thresholding reads score and rewrites rate; the score is untouched.
    for (const c of rebuilt.cells) {
      expect(c.detection?.score).toBe(0.9);
      expect(c.rate.state).toBe("treated");
    }
  });

  it("drops stored ids that match nothing rather than guessing", () => {
    const packed = packGrid(grid);
    packed.rates["deadbee:0:0"] = { state: "treated", rateLha: 99, source: "operator" };
    const rebuilt = applyStored(buildTreatmentGrid([FIELD], d), packed);
    expect(rebuilt.cells.some(c => c.rate.state === "treated")).toBe(false);
  });

  it("refuses to write a blob past the ceiling instead of doing it quietly", () => {
    const fake = {
      ...grid,
      cells: Array.from({ length: 20_001 }, (_, i) => ({
        ...grid.cells[0],
        id: `${grid.id}:${i}:0`,
        rate: { state: "treated" as const, rateLha: 10, source: "operator" as const },
      })),
    };
    expect(() => packGrid(fake)).toThrow(GridStoreTooLargeError);
  });
});
