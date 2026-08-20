// Treated cells → planner zones. Contiguity, exact volumes, and the hole case.
import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng, polygonAreaM2 } from "@/lib/geo";
import {
  type CellRate, type TreatmentGrid, buildTreatmentGrid, gridDefinitionFor, gridTotals,
} from "@/lib/treatmentGrid";
import { parseCellId } from "@/lib/gridMigrate";
import { gridZonesFor, traceOutline } from "@/lib/gridZones";
import { buildMission } from "@/lib/mission";
import { MemoryTreatmentGridRepository } from "@/lib/treatmentGridRepo";
import { applyStored, packGrid } from "@/lib/treatmentGridStore";

const LAT = 41, LNG = -89;

function rect(widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(LAT);
  return [
    { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG },
  ];
}

const GRID = buildTreatmentGrid([rect(120, 90)], gridDefinitionFor([rect(120, 90)], 6));

/** Grid with the given lattice cells treated. */
function withTreated(picks: { col: number; row: number; rateLha?: number }[]): TreatmentGrid {
  const want = new Map(picks.map(p => [`${p.col},${p.row}`, p.rateLha ?? 20]));
  return {
    ...GRID,
    cells: GRID.cells.map(c => {
      const parsed = parseCellId(c.id)!;
      const rate = want.get(`${parsed.col},${parsed.row}`);
      return rate === undefined ? c : {
        ...c, rate: { state: "treated", rateLha: rate, source: "operator" } as CellRate,
      };
    }),
  };
}

/** A block of lattice picks. */
const block = (c0: number, r0: number, w: number, h: number, rateLha = 20) =>
  Array.from({ length: w * h }, (_, i) => ({
    col: c0 + (i % w), row: r0 + Math.floor(i / w), rateLha,
  }));

// The grid's lattice indices are origin-centred and signed; find a corner cell
// to anchor picks somewhere guaranteed to exist.
const anchor = (() => {
  const parsed = GRID.cells.map(c => parseCellId(c.id)!);
  return {
    col: Math.min(...parsed.map(p => p.col)) + 2,
    row: Math.min(...parsed.map(p => p.row)) + 2,
  };
})();

describe("merging", () => {
  it("turns a 3×3 block into one zone, not nine", () => {
    const g = withTreated(block(anchor.col, anchor.row, 3, 3));
    const zones = gridZonesFor(g);
    expect(zones).toHaveLength(1);
    expect(zones[0].cellCount).toBe(9);
    expect(zones[0].source).toBe("grid");
  });

  it("keeps disjoint groups as separate zones", () => {
    const g = withTreated([
      ...block(anchor.col, anchor.row, 2, 2),
      ...block(anchor.col + 5, anchor.row, 2, 2),
    ]);
    const zones = gridZonesFor(g);
    expect(zones).toHaveLength(2);
    expect(zones.map(z => z.cellCount)).toEqual([4, 4]);
  });

  it("does not treat diagonal contact as contiguity", () => {
    // A sprayer cannot treat two corner-touching cells as one area.
    const g = withTreated([
      { col: anchor.col, row: anchor.row },
      { col: anchor.col + 1, row: anchor.row + 1 },
    ]);
    expect(gridZonesFor(g)).toHaveLength(2);
  });

  it("splits adjacent cells with different rates into different zones", () => {
    // One zone has one rate. Merging 15 L/ha ground into a 40 L/ha zone would
    // either overdose the first or underdose the second.
    const g = withTreated([
      ...block(anchor.col, anchor.row, 2, 2, 15),
      ...block(anchor.col + 2, anchor.row, 2, 2, 40),
    ]);
    const zones = gridZonesFor(g);
    expect(zones).toHaveLength(2);
    expect(zones.map(z => z.rateLha).sort((a, b) => a - b)).toEqual([15, 40]);
  });

  it("yields the same zones in the same order every time", () => {
    const g = withTreated(block(anchor.col, anchor.row, 3, 2));
    const a = gridZonesFor(g), b = gridZonesFor(g);
    expect(a.map(z => z.id)).toEqual(b.map(z => z.id));
  });
});

describe("geometry", () => {
  it("draws a ring that encloses the member cells' centroids", () => {
    const g = withTreated(block(anchor.col, anchor.row, 3, 3));
    const [zone] = gridZonesFor(g);
    // The ring's WGS84 area should be close to 9 unclipped cells (interior
    // block, no boundary clipping): 9 × 36 m².
    expect(polygonAreaM2(zone.ring)).toBeCloseTo(9 * 36, -1);
  });

  it("carries the summed clipped cell area, not the ring's own area", () => {
    // Paint every cell: edge cells are clipped by the boundary, so Σ areaM2 is
    // the true treated ground while the traced ring pokes past the edge.
    const all = GRID.cells.map(c => parseCellId(c.id)!);
    const g = withTreated(all.map(p => ({ ...p, rateLha: 20 })));
    const zones = gridZonesFor(g);
    const zoneArea = zones.reduce((s, z) => s + z.areaM2, 0);
    const cellArea = GRID.cells.reduce((s, c) => s + c.areaM2, 0);
    expect(zoneArea).toBeCloseTo(cellArea, 6);
  });
});

describe("the hole case", () => {
  it("never covers deliberately untreated ground inside a treated ring", () => {
    // A 3×3 ring with an untreated centre. One merged polygon would spray the
    // centre cell; the fallback decomposes instead.
    const ring = block(anchor.col, anchor.row, 3, 3)
      .filter(p => !(p.col === anchor.col + 1 && p.row === anchor.row + 1));
    const g = withTreated(ring);
    const zones = gridZonesFor(g);
    expect(zones.length).toBeGreaterThan(1);
    expect(zones.reduce((s, z) => s + z.cellCount, 0)).toBe(8);
    // No zone's ring may contain the hole's centre.
    const hole = GRID.cells.find(c => {
      const p = parseCellId(c.id)!;
      return p.col === anchor.col + 1 && p.row === anchor.row + 1;
    })!;
    for (const z of zones) {
      const lats = z.ring.map(v => v.lat), lngs = z.ring.map(v => v.lng);
      const inside =
        hole.centroid.lat > Math.min(...lats) && hole.centroid.lat < Math.max(...lats) &&
        hole.centroid.lng > Math.min(...lngs) && hole.centroid.lng < Math.max(...lngs);
      expect(inside).toBe(false);
    }
  });

  it("traceOutline reports one loop for a solid block and two for a ring", () => {
    const solid = block(0, 0, 3, 3).map(p => ({ ...p, areaM2: 36 }));
    expect(traceOutline(solid)).toHaveLength(1);
    const holed = solid.filter(p => !(p.col === 1 && p.row === 1));
    expect(traceOutline(holed).length).toBeGreaterThan(1);
  });
});

describe("one calculation path for chemical volume", () => {
  it("matches the Prescription panel's own number exactly", () => {
    const g = withTreated([
      ...block(anchor.col, anchor.row, 3, 2, 15),
      ...block(anchor.col + 6, anchor.row + 3, 2, 2, 40),
    ]);
    const zones = gridZonesFor(g);
    const zoneVolume = zones.reduce((s, z) => s + (z.areaM2 / 10_000) * z.rateLha, 0);
    // gridTotals is what the Prescription panel shows. The planner pricing the
    // same cells through zones must land on the same litres — not a recomputed
    // approximation from ring geometry.
    expect(zoneVolume).toBeCloseTo(gridTotals(g, 30).totalVolumeL, 9);
  });
});

describe("through the planner pipeline", () => {
  it("a mission built over grid zones actually sprays them", () => {
    // The end of the gap this closes: painted cells producing zero spray legs
    // was the entire complaint. Route the real mission builder over a
    // grid-derived zone and demand spray distance.
    const g = withTreated(block(anchor.col, anchor.row, 4, 3));
    const [zone] = gridZonesFor(g);
    const boundary = [rect(120, 90)];
    const mission = buildMission(
      boundary,
      [{ id: zone.id, ring: zone.ring }],
      {
        home: { lat: LAT + 0.0001, lng: LNG + 0.0001 },
        transitAltM: 30, sprayAltM: 3, transitSpeed: 10, spraySpeed: 3,
        spacingM: 6, repeats: 1,
      },
    );
    expect(mission.sprayDistM).toBeGreaterThan(0);
    expect(mission.sprayOnCount).toBeGreaterThanOrEqual(1);
  });

  it("painting more cells and re-reading the store yields the new zones", async () => {
    // "Live, not a snapshot": the planner re-reads the stored grid on mount.
    // Simulate the loop — paint, save, reload, rebuild, re-derive.
    const repo = new MemoryTreatmentGridRepository();
    const first = withTreated(block(anchor.col, anchor.row, 2, 2));
    await repo.save("f", packGrid(first));

    let reloaded = applyStored(GRID, await repo.load("f"));
    expect(gridZonesFor(reloaded).reduce((s, z) => s + z.cellCount, 0)).toBe(4);

    const more = withTreated([
      ...block(anchor.col, anchor.row, 2, 2),
      ...block(anchor.col + 6, anchor.row + 4, 3, 3),
    ]);
    await repo.save("f", packGrid(more));

    reloaded = applyStored(GRID, await repo.load("f"));
    const zones = gridZonesFor(reloaded);
    expect(zones.reduce((s, z) => s + z.cellCount, 0)).toBe(13);
    expect(zones.length).toBe(2);
  });
});
