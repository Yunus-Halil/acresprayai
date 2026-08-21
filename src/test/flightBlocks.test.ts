// Jagged cell selections → flight-ready blocks.
//
// This is the one step in the pipeline that changes WHAT gets sprayed, so these
// tests are mostly guardrails: never drop a marked cell, never fill an explicit
// skip, never add area without reporting it, and give back the exact selection
// when the dial is at zero.
import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";
import {
  type CellRate, type TreatmentGrid, buildTreatmentGrid, gridDefinitionFor, gridTotals,
} from "@/lib/treatmentGrid";
import { parseCellId } from "@/lib/gridMigrate";
import {
  DEFAULT_OVERSPRAY_TOLERANCE, kernelRadiusFor, rectangles, regularizeGrid,
} from "@/lib/flightBlocks";
import { buildMission } from "@/lib/mission";
import { computeMissionStats, pesticideLitres } from "@/lib/missionStats";
import { DRONE_SPECS } from "@/lib/droneSpecs";

const LAT = 41, LNG = -89;

function rect(widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(LAT);
  return [
    { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG },
  ];
}

const BOUNDARY = [rect(240, 180)];
const GRID = buildTreatmentGrid(BOUNDARY, gridDefinitionFor(BOUNDARY, 6));
const T40 = DRONE_SPECS["DJI Agras T40"];

type Pick =
  | { col: number; row: number; kind: "treat"; rateLha?: number }
  | { col: number; row: number; kind: "skip" };

/** Grid with the given lattice cells painted. Everything else stays default. */
function painted(picks: Pick[]): TreatmentGrid {
  const want = new Map(picks.map(p => [`${p.col},${p.row}`, p]));
  return {
    ...GRID,
    cells: GRID.cells.map(c => {
      const parsed = parseCellId(c.id)!;
      const pick = want.get(`${parsed.col},${parsed.row}`);
      if (!pick) return c;
      return {
        ...c,
        rate: (pick.kind === "treat"
          ? { state: "treated", rateLha: pick.rateLha ?? 20, source: "operator" }
          : { state: "untreated", source: "operator" }) as CellRate,
      };
    }),
  };
}

const treat = (col: number, row: number, rateLha = 20): Pick =>
  ({ col, row, kind: "treat", rateLha });
const skip = (col: number, row: number): Pick => ({ col, row, kind: "skip" });

/** A solid w×h block of treat picks. */
const solid = (c0: number, r0: number, w: number, h: number, rateLha = 20): Pick[] =>
  Array.from({ length: w * h }, (_, i) =>
    treat(c0 + (i % w), r0 + Math.floor(i / w), rateLha));

// The lattice is origin-centred and signed; anchor picks somewhere that exists.
const A = (() => {
  const parsed = GRID.cells.map(c => parseCellId(c.id)!);
  return {
    col: Math.min(...parsed.map(p => p.col)) + 3,
    row: Math.min(...parsed.map(p => p.row)) + 3,
  };
})();

/** Every treated cell id in a grid. */
const treatedIds = (g: TreatmentGrid) =>
  new Set(g.cells.filter(c => c.rate.state === "treated").map(c => c.id));

/** Every cell id covered by a plan's blocks. */
const coveredIds = (plan: ReturnType<typeof regularizeGrid>) =>
  new Set(plan.blocks.flatMap(b => b.cellIds));

describe("the dial", () => {
  it("reproduces the exact cell selection at zero tolerance", () => {
    const g = painted([
      ...solid(A.col, A.row, 5, 5),
      treat(A.col + 5, A.row + 2),                       // a spur
    ].filter(p => !(p.col === A.col + 2 && p.row === A.row + 2)));  // a notch

    const plan = regularizeGrid(g, { tolerance: 0 });
    expect(plan.enabled).toBe(false);
    expect(plan.addedAreaM2).toBe(0);
    expect(plan.addedLitres).toBe(0);
    expect(plan.addedCellIds).toEqual([]);
    expect(coveredIds(plan)).toEqual(treatedIds(g));
    expect(plan.sprayedAreaM2).toBeCloseTo(plan.markedAreaM2, 9);
  });

  it("adds more area as the tolerance rises, and says how much", () => {
    // A 7×7 block with a scatter of one-cell dents.
    const dents = new Set(["2,2", "4,1", "1,5", "5,5", "3,4"]);
    const g = painted(solid(A.col, A.row, 7, 7)
      .filter(p => !dents.has(`${p.col - A.col},${p.row - A.row}`)));

    const off = regularizeGrid(g, { tolerance: 0 });
    const mid = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });

    expect(mid.addedAreaM2).toBeGreaterThan(0);
    expect(mid.blocks.length).toBeLessThan(off.blocks.length);
    expect(mid.sprayedAreaM2).toBeCloseTo(mid.markedAreaM2 + mid.addedAreaM2, 6);
  });

  it("picks a bigger kernel only at high tolerance", () => {
    expect(kernelRadiusFor(0)).toBe(0);
    expect(kernelRadiusFor(DEFAULT_OVERSPRAY_TOLERANCE)).toBe(1);
    expect(kernelRadiusFor(0.2)).toBe(2);
  });

  it("clamps a tolerance past the ceiling rather than obeying it", () => {
    const g = painted(solid(A.col, A.row, 4, 4));
    expect(regularizeGrid(g, { tolerance: 5 }).toleranceUsed).toBeLessThanOrEqual(0.25);
  });
});

describe("morphological cleanup", () => {
  it("fills a one-cell notch and comes back as one clean block", () => {
    const g = painted(solid(A.col, A.row, 5, 5)
      .filter(p => !(p.col === A.col + 2 && p.row === A.row + 2)));

    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].cols).toBe(5);
    expect(plan.blocks[0].rows).toBe(5);
    expect(plan.addedCellIds).toHaveLength(1);
  });

  it("prices the filled notch at exactly the notch's own area and rate", () => {
    const g = painted(solid(A.col, A.row, 5, 5, 30)
      .filter(p => !(p.col === A.col + 2 && p.row === A.row + 2)));
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });

    const notch = g.cells.find(c => {
      const p = parseCellId(c.id)!;
      return p.col === A.col + 2 && p.row === A.row + 2;
    })!;
    expect(plan.addedAreaM2).toBeCloseTo(notch.areaM2, 6);
    expect(plan.addedLitres).toBeCloseTo(pesticideLitres([{ areaM2: notch.areaM2, rateLha: 30 }]), 9);
  });

  it("keeps a single-cell spur as its own block rather than a ragged spike", () => {
    const g = painted([...solid(A.col, A.row, 5, 5), treat(A.col + 5, A.row + 2)]);
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });

    // The big block is clean — a 5×5 rectangle with no bite out of it and no
    // spike on it — and the spur is a block of its own.
    const big = plan.blocks.find(b => b.cellCount > 1)!;
    expect(big.cols).toBe(5);
    expect(big.rows).toBe(5);
    const spur = plan.blocks.find(b => b.cellCount === 1);
    expect(spur).toBeDefined();
    expect(coveredIds(plan)).toEqual(treatedIds(g));
  });

  it("never drops a marked cell, whatever the tolerance", () => {
    const g = painted([
      ...solid(A.col, A.row, 6, 4),
      treat(A.col + 6, A.row + 1), treat(A.col - 1, A.row + 2),
      treat(A.col + 2, A.row + 5), treat(A.col + 8, A.row + 8),
    ]);
    for (const tolerance of [0, 0.02, 0.08, 0.15, 0.25]) {
      const plan = regularizeGrid(g, { tolerance });
      const covered = coveredIds(plan);
      for (const id of treatedIds(g)) expect(covered.has(id)).toBe(true);
      expect(plan.sprayedAreaM2).toBeGreaterThanOrEqual(plan.markedAreaM2 - 1e-9);
    }
  });

  it("never merges cells of different rates into one block", () => {
    const g = painted([
      ...solid(A.col, A.row, 4, 4, 20),
      ...solid(A.col + 4, A.row, 4, 4, 40),
    ]);
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    for (const b of plan.blocks) {
      const rates = new Set(b.cellIds.map(id =>
        (g.cells.find(c => c.id === id)!.rate as { rateLha: number }).rateLha));
      expect(rates.size).toBe(1);
    }
  });
});

describe("the explicit-skip guardrail", () => {
  it("leaves an explicit skip inside a block as a boom-off hole", () => {
    const g = painted([
      ...solid(A.col, A.row, 5, 5).filter(p => !(p.col === A.col + 2 && p.row === A.row + 2)),
      skip(A.col + 2, A.row + 2),
    ]);
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });

    const skipId = g.cells.find(c => {
      const p = parseCellId(c.id)!;
      return p.col === A.col + 2 && p.row === A.row + 2;
    })!.id;
    expect(coveredIds(plan).has(skipId)).toBe(false);
    expect(plan.addedCellIds).not.toContain(skipId);
    expect(plan.addedAreaM2).toBe(0);
    // And the guardrail says out loud that it stopped a fill.
    expect(plan.sparedSkips).toBeGreaterThan(0);

    // No block's rectangle spans it either — a hole, not a covered cell.
    const [c, r] = [A.col + 2, A.row + 2];
    for (const b of plan.blocks) {
      const inside = c >= b.col0 && c < b.col0 + b.cols && r >= b.row0 && r < b.row0 + b.rows;
      expect(inside).toBe(false);
    }
  });

  it("fills the default notch beside a skip without touching the skip", () => {
    const g = painted([
      ...solid(A.col, A.row, 6, 5)
        .filter(p => !(p.row === A.row + 2 && (p.col === A.col + 2 || p.col === A.col + 3))),
      skip(A.col + 3, A.row + 2),
    ]);
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    expect(plan.addedCellIds).toHaveLength(1);       // the default one, not the skip
    expect(plan.sparedSkips).toBe(1);
  });

  it("never sprays a skip however high the tolerance goes", () => {
    const g = painted([
      ...solid(A.col, A.row, 7, 7).filter(p =>
        !(p.col >= A.col + 3 && p.col <= A.col + 4 && p.row >= A.row + 3 && p.row <= A.row + 4)),
      skip(A.col + 3, A.row + 3), skip(A.col + 4, A.row + 3),
      skip(A.col + 3, A.row + 4), skip(A.col + 4, A.row + 4),
    ]);
    const skipIds = new Set(g.cells
      .filter(c => c.rate.state === "untreated" && c.rate.source === "operator")
      .map(c => c.id));
    for (const tolerance of [0.05, 0.15, 0.25]) {
      const plan = regularizeGrid(g, { tolerance });
      for (const id of skipIds) {
        expect(coveredIds(plan).has(id)).toBe(false);
        expect(plan.addedCellIds).not.toContain(id);
      }
    }
  });
});

describe("decomposition", () => {
  it("returns a solid block as one rectangle, not a bounding box of runs", () => {
    const set = new Set<string>();
    for (let c = 0; c < 6; c++) for (let r = 0; r < 4; r++) set.add(`${c},${r}`);
    expect(rectangles(set)).toEqual([{ col0: 0, row0: 0, cols: 6, rows: 4 }]);
  });

  it("splits an L into two rectangles rather than over-spraying the notch", () => {
    // ####
    // ####
    // ##
    // ##
    const set = new Set<string>();
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) set.add(`${c},${r}`);
    for (let r = 2; r < 4; r++) for (let c = 0; c < 4; c++) set.add(`${c},${r}`);
    const rects = rectangles(set);
    expect(rects).toHaveLength(2);
    expect(rects.reduce((s, x) => s + x.cols * x.rows, 0)).toBe(set.size);
  });

  it("never covers a cell that is not in the set", () => {
    const set = new Set(["0,0", "1,0", "3,0", "0,1", "1,1", "3,1"]);
    for (const r of rectangles(set)) {
      for (let dc = 0; dc < r.cols; dc++) for (let dr = 0; dr < r.rows; dr++) {
        expect(set.has(`${r.col0 + dc},${r.row0 + dr}`)).toBe(true);
      }
    }
  });

  it("aligns every block edge to a whole cell — a lane boundary, never mid-boom", () => {
    const g = painted(solid(A.col, A.row, 5, 3));
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    for (const b of plan.blocks) {
      expect(Number.isInteger(b.col0)).toBe(true);
      expect(Number.isInteger(b.row0)).toBe(true);
      expect(b.cols).toBeGreaterThanOrEqual(1);
      expect(b.rows).toBeGreaterThanOrEqual(1);
      expect(b.ring).toHaveLength(4);
    }
  });
});

describe("composition with grouping and the swath", () => {
  const HOME: LatLng2 = { lat: LAT, lng: LNG };
  const PARAMS = {
    home: HOME, transitAltM: 30, sprayAltM: 3,
    transitSpeed: 10, spraySpeed: 3, spacingM: 6,
  };

  it("produces a flyable route through the grouped serpentine planner", () => {
    const g = painted([
      ...solid(A.col, A.row, 6, 4).filter(p => !(p.col === A.col + 3 && p.row === A.row + 1)),
      ...solid(A.col, A.row + 6, 6, 3),
      treat(A.col + 7, A.row + 2),
    ]);
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    const mission = buildMission(
      BOUNDARY, plan.blocks.map(b => ({ id: b.id, ring: b.ring, rateLha: b.rateLha })), PARAMS,
    );
    expect(mission.spraySegments.length).toBeGreaterThan(0);
    expect(mission.sprayDistM).toBeGreaterThan(0);
    expect(mission.waypoints[0].action).toBe("TAKEOFF");
    expect(mission.waypoints[mission.waypoints.length - 1].action).toBe("LAND");
  });

  it("prices the regularized plan with the Prescription panel's own arithmetic", () => {
    const g = painted(solid(A.col, A.row, 5, 5, 25)
      .filter(p => !(p.col === A.col + 2 && p.row === A.row + 2)));
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });

    // Raw, the plan's marked total must equal the panel's treated total.
    const totals = gridTotals(g, 0);
    expect(plan.markedAreaM2 / 10_000).toBeCloseTo(totals.treatedAreaHa, 9);
    expect(plan.markedLitres).toBeCloseTo(totals.totalVolumeL, 6);

    // Regularized, it must equal the same arithmetic over the blocks.
    expect(plan.sprayedLitres).toBeCloseTo(
      pesticideLitres(plan.blocks.map(b => ({ areaM2: b.areaM2, rateLha: b.rateLha }))), 6,
    );
    expect(plan.sprayedLitres - plan.markedLitres).toBeCloseTo(plan.addedLitres, 6);
  });

  it("keeps the mission stats consistent with the regularized volume", () => {
    const g = painted(solid(A.col, A.row, 6, 6, 25)
      .filter(p => !(p.col === A.col + 3 && p.row === A.row + 3)));
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    const zones = plan.blocks.map(b => ({ areaM2: b.areaM2, rateLha: b.rateLha }));
    const stats = computeMissionStats({
      mission: buildMission(
        BOUNDARY, plan.blocks.map(b => ({ id: b.id, ring: b.ring, rateLha: b.rateLha })), PARAMS,
      ),
      spec: T40, sprayAltM: 3, transitAltM: 30, tankLoadPct: 100, zones, wx: null,
    });
    expect(stats.pesticideAmountLiters).toBeCloseTo(plan.sprayedLitres, 6);
    expect(stats.treatedAreaHa).toBeCloseTo(plan.sprayedAreaM2 / 10_000, 9);
  });

  it("covers every originally-marked cell's centre once the route is flown", () => {
    const g = painted(solid(A.col, A.row, 5, 4)
      .filter(p => !(p.col === A.col + 1 && p.row === A.row + 2)));
    const plan = regularizeGrid(g, { tolerance: DEFAULT_OVERSPRAY_TOLERANCE });
    const mission = buildMission(
      BOUNDARY, plan.blocks.map(b => ({ id: b.id, ring: b.ring, rateLha: b.rateLha })), PARAMS,
    );
    const half = 6 / 2 + 0.5;
    for (const cell of g.cells) {
      if (cell.rate.state !== "treated") continue;
      let best = Infinity;
      for (const seg of mission.spraySegments) {
        best = Math.min(best, distToSegM(cell.centroid, seg[0], seg[seg.length - 1]));
      }
      expect(best).toBeLessThanOrEqual(half);
    }
  });
});

/** Perpendicular distance from a point to a segment, in metres. */
function distToSegM(p: LatLng2, a: LatLng2, b: LatLng2): number {
  const mLng = mPerDegLng(p.lat);
  const px = (p.lng - a.lng) * mLng, py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - a.lng) * mLng, by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}
