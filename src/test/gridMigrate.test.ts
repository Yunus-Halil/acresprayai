// Boundary edits versus the treatment grid: decisions must survive the small
// edits and be counted before the large ones destroy anything.
import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";
import {
  type CellRate, type TreatmentGrid, buildTreatmentGrid, gridDefinitionFor,
} from "@/lib/treatmentGrid";
import { packGrid } from "@/lib/treatmentGridStore";
import {
  MAJOR_LOSS_FRACTION, applyMigration, cellCentreOf, cellIndexAt, parseCellId,
  planMigration,
} from "@/lib/gridMigrate";

const LAT = 41, LNG = -89;
const SWATH = 6;

function rect(widthM: number, heightM: number, shift: { eastM?: number; northM?: number } = {}): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(LAT);
  const oLat = LAT + (shift.northM ?? 0) / M_PER_DEG_LAT;
  const oLng = LNG + (shift.eastM ?? 0) / mPerDegLng(LAT);
  return [
    { lat: oLat, lng: oLng }, { lat: oLat, lng: oLng + dLng },
    { lat: oLat + dLat, lng: oLng + dLng }, { lat: oLat + dLat, lng: oLng },
  ];
}

const gridOf = (boundary: LatLng2[]): TreatmentGrid =>
  buildTreatmentGrid([boundary], gridDefinitionFor([boundary], SWATH));

const treated: CellRate = { state: "treated", rateLha: 25, source: "operator" };
const skipped: CellRate = { state: "untreated", source: "operator" };

/** Paint the westmost n cells treated and the eastmost m skipped. */
function paint(grid: TreatmentGrid, nTreated: number, mSkipped: number): TreatmentGrid {
  const byLng = [...grid.cells].sort((a, b) => a.centroid.lng - b.centroid.lng);
  const t = new Set(byLng.slice(0, nTreated).map(c => c.id));
  const s = new Set(byLng.slice(-mSkipped).map(c => c.id));
  return {
    ...grid,
    cells: grid.cells.map(c =>
      t.has(c.id) ? { ...c, rate: treated } : s.has(c.id) ? { ...c, rate: skipped } : c),
  };
}

describe("the lattice arithmetic", () => {
  it("round-trips a cell through centre and back to its own indices", () => {
    const g = gridOf(rect(120, 90));
    for (const c of g.cells.slice(0, 20)) {
      const p = parseCellId(c.id)!;
      const centre = cellCentreOf(g.definition, p.col, p.row);
      expect(cellIndexAt(g.definition, centre)).toEqual({ col: p.col, row: p.row });
    }
  });

  it("puts the reconstructed centre inside the cell's actual ring bbox", () => {
    const g = gridOf(rect(120, 90));
    const c = g.cells.find(x => !x.clipped)!;
    const p = parseCellId(c.id)!;
    const centre = cellCentreOf(g.definition, p.col, p.row);
    const lats = c.ring.map(v => v.lat), lngs = c.ring.map(v => v.lng);
    expect(centre.lat).toBeGreaterThan(Math.min(...lats));
    expect(centre.lat).toBeLessThan(Math.max(...lats));
    expect(centre.lng).toBeGreaterThan(Math.min(...lngs));
    expect(centre.lng).toBeLessThan(Math.max(...lngs));
  });

  it("rejects malformed ids instead of guessing", () => {
    expect(parseCellId("not-a-cell")).toBeNull();
    expect(parseCellId("g:x:y")).toBeNull();
  });
});

describe("a small boundary nudge", () => {
  it("changes the gridId — the premise of the whole problem", () => {
    const a = gridOf(rect(120, 90));
    const b = gridOf(rect(120, 90, { eastM: 2 }));
    expect(a.id).not.toBe(b.id);
  });

  it("carries nearly every decision across, states intact", () => {
    const old = paint(gridOf(rect(120, 90)), 6, 6);
    const stored = packGrid(old);
    const next = gridOf(rect(120, 90, { eastM: 2, northM: 1 }));

    const plan = planMigration(stored, next);
    expect(plan.decided).toBe(12);
    // A 2 m nudge on a 120 m field: at worst the outermost column falls off.
    expect(plan.lossFraction).toBeLessThan(MAJOR_LOSS_FRACTION);
    expect(plan.needsConfirmation).toBe(false);

    const migrated = applyMigration(next, plan);
    const t = migrated.cells.filter(c => c.rate.state === "treated");
    const s = migrated.cells.filter(c => c.rate.state === "untreated" && c.rate.source === "operator");
    expect(t.length).toBeGreaterThanOrEqual(5);
    expect(s.length).toBeGreaterThanOrEqual(5);
    // The rate value and the provenance both survive — "treated by the
    // operator at 25 L/ha" must not degrade to "treated by default".
    for (const c of t) expect(c.rate).toEqual(treated);
  });

  it("keeps treated ground on the treated side of the field", () => {
    const old = paint(gridOf(rect(120, 90)), 6, 0);
    const next = gridOf(rect(120, 90, { eastM: 2 }));
    const migrated = applyMigration(next, planMigration(packGrid(old), next));
    const lngs = migrated.cells.filter(c => c.rate.state === "treated").map(c => c.centroid.lng);
    const mid = (Math.min(...next.cells.map(c => c.centroid.lng)) + Math.max(...next.cells.map(c => c.centroid.lng))) / 2;
    // West cells were painted; after a 2 m nudge they must still be west.
    for (const lng of lngs) expect(lng).toBeLessThan(mid);
  });

  it("carries detection scores along without counting them as decisions", () => {
    const old = paint(gridOf(rect(120, 90)), 4, 4);
    const withScores: TreatmentGrid = {
      ...old,
      cells: old.cells.map((c, i) => ({
        ...c,
        detection: { score: (i % 10) / 10, modelVersion: "interactive-v1", scoredAt: "t" },
      })),
    };
    const stored = packGrid(withScores);
    const next = gridOf(rect(120, 90, { northM: 2 }));
    const plan = planMigration(stored, next);
    expect(plan.decided).toBe(8);                    // scores excluded from the count
    expect(plan.detection).not.toBeNull();
    expect(plan.detection!.modelVersion).toBe("interactive-v1");
    const migrated = applyMigration(next, plan);
    expect(migrated.cells.some(c => c.detection !== null)).toBe(true);
  });
});

describe("a boundary shrink", () => {
  it("drops the decisions whose ground left the field and keeps the rest", () => {
    const old = paint(gridOf(rect(120, 90)), 6, 6);   // treated west, skipped east
    const stored = packGrid(old);
    // Cut the eastern half: the skipped cells' ground is gone.
    const next = gridOf(rect(60, 90));
    const plan = planMigration(stored, next);
    expect(plan.moved).toBeGreaterThanOrEqual(6);
    expect(plan.lost).toBeGreaterThanOrEqual(5);
    const migrated = applyMigration(next, plan);
    expect(migrated.cells.filter(c => c.rate.state === "treated").length).toBeGreaterThanOrEqual(5);
    expect(migrated.cells.filter(c => c.rate.source === "operator" && c.rate.state === "untreated"))
      .toHaveLength(0);
  });
});

describe("a major change", () => {
  it("asks before destroying instead of acting", () => {
    const old = paint(gridOf(rect(120, 90)), 8, 8);
    // The field moves 500 m east — nothing overlaps.
    const next = gridOf(rect(120, 90, { eastM: 500 }));
    const plan = planMigration(packGrid(old), next);
    expect(plan.moved).toBe(0);
    expect(plan.lossFraction).toBe(1);
    expect(plan.needsConfirmation).toBe(true);
  });

  it("does not ask when there was nothing to lose", () => {
    const stored = packGrid(gridOf(rect(120, 90)));   // no decisions at all
    const next = gridOf(rect(120, 90, { eastM: 500 }));
    const plan = planMigration(stored, next);
    expect(plan.decided).toBe(0);
    expect(plan.needsConfirmation).toBe(false);
  });
});

describe("conflicts", () => {
  it("prefers the operator's decision when two old cells land in one new cell", () => {
    // Double the cell size: four old cells land in each new cell. Give one of
    // them an operator rate and another a threshold rate.
    const old = gridOf(rect(120, 90));
    const byLng = [...old.cells].sort((a, b) => a.centroid.lng - b.centroid.lng);
    const opId = byLng[0].id;
    const thId = byLng[1].id;
    const painted: TreatmentGrid = {
      ...old,
      cells: old.cells.map(c =>
        c.id === opId ? { ...c, rate: { state: "treated", rateLha: 30, source: "operator" } as CellRate }
        : c.id === thId ? { ...c, rate: { state: "treated", rateLha: 10, source: "threshold" } as CellRate }
        : c),
    };
    const boundary = rect(120, 90);
    const next = buildTreatmentGrid([boundary], gridDefinitionFor([boundary], SWATH, 2));
    const plan = planMigration(packGrid(painted), next);
    const rates = Object.values(plan.rates);
    expect(rates.length).toBeGreaterThanOrEqual(1);
    // Whichever new cell got both claims must have kept the operator's.
    const winners = rates.filter(r => r.state === "treated");
    expect(winners.some(r => r.source === "operator")).toBe(true);
  });
});
