// Classifying a treatment zone from the Field View popup.
//
// The whole point of these tests is that there is no second record. Everything
// below writes through `classifyGridZone` — the function the popup calls — and
// then asserts against the CELLS and against a fresh projection, because if a
// per-zone store ever crept in, the cells and the projection are exactly what
// would stop agreeing with each other.
import { describe, it, expect, beforeEach } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";
import {
  type CellRate, type TreatmentGrid, MAX_NOTE_CHARS,
  buildTreatmentGrid, gridDefinitionFor, gridTotals,
} from "@/lib/treatmentGrid";
import { parseCellId } from "@/lib/gridMigrate";
import { gridZonesFor } from "@/lib/gridZones";
import { classifyGridZone, loadGridZones } from "@/lib/gridAnomalies";
import { MemoryTreatmentGridRepository } from "@/lib/treatmentGridRepo";
import { applyStored, packGrid } from "@/lib/treatmentGridStore";
import { buildMission } from "@/lib/mission";

const LAT = 41, LNG = -89;
const FIELD_ID = "field-1";

function rect(widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(LAT);
  return [
    { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG },
  ];
}

const BOUNDARY = [rect(120, 90)];
const GRID = buildTreatmentGrid(BOUNDARY, gridDefinitionFor(BOUNDARY, 6));

const anchor = (() => {
  const parsed = GRID.cells.map(c => parseCellId(c.id)!);
  return {
    col: Math.min(...parsed.map(p => p.col)) + 2,
    row: Math.min(...parsed.map(p => p.row)) + 2,
  };
})();

const block = (c0: number, r0: number, w: number, h: number) =>
  Array.from({ length: w * h }, (_, i) => ({ col: c0 + (i % w), row: r0 + Math.floor(i / w) }));

/** A grid with the given lattice cells treated, optionally pre-described. */
function withTreated(
  picks: { col: number; row: number; rateLha?: number; issue?: string; note?: string }[],
): TreatmentGrid {
  const want = new Map(picks.map(p => [`${p.col},${p.row}`, p]));
  return {
    ...GRID,
    cells: GRID.cells.map(c => {
      const p = parseCellId(c.id)!;
      const pick = want.get(`${p.col},${p.row}`);
      return pick === undefined ? c : {
        ...c,
        rate: {
          state: "treated", rateLha: pick.rateLha ?? 20, source: "operator",
          ...(pick.issue ? { issue: pick.issue } : {}),
          ...(pick.note ? { note: pick.note } : {}),
        } as CellRate,
      };
    }),
  };
}

let repo: MemoryTreatmentGridRepository;

/** Store a grid the way the Treatment Grid tab does, and return its one zone. */
async function seed(grid: TreatmentGrid) {
  repo = new MemoryTreatmentGridRepository();
  await repo.save(FIELD_ID, packGrid(grid));
  return gridZonesFor(grid);
}

/** Re-read from storage exactly as the Field View does on mount. */
async function reload() {
  const load = await loadGridZones(FIELD_ID, BOUNDARY, repo);
  return load!.zones;
}

/** The stored cells themselves — what the Treatment Grid tab renders. */
async function reloadCells() {
  return applyStored(GRID, await repo.load(FIELD_ID)).cells;
}

beforeEach(() => { repo = new MemoryTreatmentGridRepository(); });

describe("classifying from the popup", () => {
  it("writes the issue onto every cell the zone is drawn from", async () => {
    const [zone] = await seed(withTreated(block(anchor.col, anchor.row, 3, 3)));
    expect(zone.issue).toBeUndefined();

    const res = await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: "Pest damage" }, repo);
    expect(res?.cells).toBe(9);

    const cells = (await reloadCells()).filter(c => zone.cellIds.includes(c.id));
    expect(cells).toHaveLength(9);
    for (const c of cells) {
      expect(c.rate.state === "treated" && c.rate.issue).toBe("Pest damage");
    }
  });

  it("survives a reload, because the cells are what was written", async () => {
    const [zone] = await seed(withTreated(block(anchor.col, anchor.row, 2, 2)));
    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: "Waterlogging" }, repo);

    const [after] = await reload();
    expect(after.issue).toBe("Waterlogging");
    expect(after.cellCount).toBe(4);
  });

  it("keeps a note, and keeps it attached to the same ground", async () => {
    const [zone] = await seed(withTreated(block(anchor.col, anchor.row, 2, 2)));
    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { note: "  third year running  " }, repo);

    const [after] = await reload();
    expect(after.note).toBe("third year running");
    for (const c of await reloadCells()) {
      if (!zone.cellIds.includes(c.id)) continue;
      expect(c.rate.state === "treated" && c.rate.note).toBe("third year running");
    }
  });

  it("caps a runaway note rather than storing an essay per cell", async () => {
    const [zone] = await seed(withTreated(block(anchor.col, anchor.row, 2, 2)));
    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { note: "x".repeat(5000) }, repo);
    const [after] = await reload();
    expect(after.note).toHaveLength(MAX_NOTE_CHARS);
  });

  it("clears back to unclassified rather than being one-way", async () => {
    const [zone] = await seed(withTreated(
      block(anchor.col, anchor.row, 2, 2).map(p => ({ ...p, issue: "Bare soil", note: "old" })),
    ));
    expect(zone.issue).toBe("Bare soil");

    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: null, note: null }, repo);
    const [after] = await reload();
    expect(after.issue).toBeUndefined();
    expect(after.note).toBeUndefined();
  });

  it("leaves the field it was not given alone", async () => {
    const [zone] = await seed(withTreated(
      block(anchor.col, anchor.row, 2, 2).map(p => ({ ...p, note: "keep me" })),
    ));
    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: "Weed pressure" }, repo);
    const [after] = await reload();
    expect(after.issue).toBe("Weed pressure");
    expect(after.note).toBe("keep me");
  });

  it("touches only the zone that was clicked", async () => {
    const zones = await seed(withTreated([
      ...block(anchor.col, anchor.row, 2, 2),
      ...block(anchor.col + 5, anchor.row, 2, 2),
    ]));
    expect(zones).toHaveLength(2);
    await classifyGridZone(FIELD_ID, BOUNDARY, zones[0].id, { issue: "Pest damage" }, repo);

    const after = await reload();
    const tagged = after.filter(z => z.issue === "Pest damage");
    expect(tagged).toHaveLength(1);
    expect(tagged[0].cellCount).toBe(4);
    expect(after.filter(z => z.issue === undefined)).toHaveLength(1);
  });

  it("refuses to write against a boundary the grid was not built for", async () => {
    const [zone] = await seed(withTreated(block(anchor.col, anchor.row, 2, 2)));
    const moved = [rect(130, 95)];
    expect(await classifyGridZone(FIELD_ID, moved, zone.id, { issue: "Bare soil" }, repo)).toBeNull();
    const [after] = await reload();
    expect(after.issue).toBeUndefined();
  });

  it("reports nothing to write for a zone that has since gone", async () => {
    await seed(withTreated(block(anchor.col, anchor.row, 2, 2)));
    const res = await classifyGridZone(FIELD_ID, BOUNDARY, "grid:nope:0:0", { issue: "Bare soil" }, repo);
    expect(res).toBeNull();
  });

  it("does not lose a write when two land back to back", async () => {
    // The popup does exactly this: pick a category, then type a note. Both are
    // read-modify-write of one blob, so an unserialised second write would
    // revert the first.
    const [zone] = await seed(withTreated(block(anchor.col, anchor.row, 2, 2)));
    await Promise.all([
      classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: "Pest damage" }, repo),
      classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { note: "north corner" }, repo),
    ]);
    const [after] = await reload();
    expect(after.issue).toBe("Pest damage");
    expect(after.note).toBe("north corner");
  });
});

describe("one direction of truth", () => {
  it("shows a tag set on the cells, without being told", async () => {
    // The Treatment Grid tab's direction: paint cells with a tag, and the Field
    // View zone reports it. No sync step, because there is nothing to sync.
    await seed(withTreated(
      block(anchor.col, anchor.row, 2, 2).map(p => ({ ...p, issue: "Bare soil", note: "from the grid tab" })),
    ));
    const [zone] = await reload();
    expect(zone.issue).toBe("Bare soil");
    expect(zone.note).toBe("from the grid tab");
  });

  it("splits a zone whose cells describe different problems", async () => {
    // A zone carries one classification. If two halves disagree they are two
    // zones, which is the structural reason a popup can never show a tag the
    // cells beneath it do not all share.
    await seed(withTreated([
      ...block(anchor.col, anchor.row, 2, 2).map(p => ({ ...p, issue: "Bare soil" })),
      ...block(anchor.col + 2, anchor.row, 2, 2).map(p => ({ ...p, issue: "Weed pressure" })),
    ]));
    const zones = await reload();
    expect(zones.map(z => z.issue).sort()).toEqual(["Bare soil", "Weed pressure"]);
  });
});

describe("classification is metadata, never treatment", () => {
  it("leaves rate, treated state and source exactly as they were", async () => {
    const before = withTreated(block(anchor.col, anchor.row, 3, 3).map(p => ({ ...p, rateLha: 35 })));
    const [zone] = await seed(before);
    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: "Pest damage", note: "hot spot" }, repo);

    const after = await reloadCells();
    const byId = new Map(after.map(c => [c.id, c]));
    for (const c of before.cells) {
      const now = byId.get(c.id)!;
      expect(now.rate.state).toBe(c.rate.state);
      expect(now.rate.source).toBe(c.rate.source);
      if (c.rate.state === "treated" && now.rate.state === "treated") {
        expect(now.rate.rateLha).toBe(c.rate.rateLha);
      }
    }
  });

  it("changes neither the chemical volume nor the route flown", async () => {
    const before = withTreated(block(anchor.col, anchor.row, 4, 3));
    const [zone] = await seed(before);
    const params = {
      home: { lat: LAT + 0.0001, lng: LNG + 0.0001 },
      transitAltM: 30, sprayAltM: 3, transitSpeed: 10, spraySpeed: 3,
      spacingM: 6, repeats: 1,
    };
    const routeBefore = buildMission(BOUNDARY, [{ id: zone.id, ring: zone.ring }], params);
    const volumeBefore = gridTotals(before, 30).totalVolumeL;

    await classifyGridZone(FIELD_ID, BOUNDARY, zone.id, { issue: "Weed pressure", note: "spot spray" }, repo);

    const [after] = await reload();
    const grid = applyStored(GRID, await repo.load(FIELD_ID));
    const routeAfter = buildMission(BOUNDARY, [{ id: after.id, ring: after.ring }], params);

    expect(gridTotals(grid, 30).totalVolumeL).toBeCloseTo(volumeBefore, 9);
    expect(after.areaM2).toBeCloseTo(zone.areaM2, 9);
    expect(after.rateLha).toBe(zone.rateLha);
    expect(routeAfter.sprayDistM).toBeCloseTo(routeBefore.sprayDistM, 6);
    expect(routeAfter.waypoints).toHaveLength(routeBefore.waypoints.length);
  });
});
