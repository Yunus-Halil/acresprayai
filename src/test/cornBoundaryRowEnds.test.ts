// A corn field's automatic boundary (2026-11-23, his rule): where every single row ends, and the two outer rows' sides.
import { describe, expect, it } from "vitest";
import { localFrame, orchardBlock, pointInRing } from "@/lib/fieldTwin/intelligence";
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinRow } from "@/lib/fieldTwin/types";

const LAT = 31.58, LNG = -83.586, S = 0.9;
/** Rows running east, S apart; each from `ends[i][0]` to `ends[i][1]` metres east, the second in two pieces. */
function twin(ends: [number, number][], plantsFirst: boolean): TwinBundle {
  const t = { origin: { lat: LAT, lng: LNG }, field: { rowDirectionDeg: 0, rowSpacingM: S, plantSpacingM: 0 } } as TwinBundle, f = localFrame(t);
  const rows: TwinRow[] = [];
  const piece = (row: number, e0: number, e1: number) => rows.push({ id: rows.length + 1, kept: true, reason: null, line: [f.toLatLng(e0, row * S), f.toLatLng(e1, row * S)], trees: 0, inferred: 0, photos: 0, lengthM: e1 - e0, straightnessSdM: 0 });
  ends.forEach(([e0, e1], i) => { if (i === 1) { piece(i, e0, (e0 + e1) / 2 - 1); piece(i, (e0 + e1) / 2 + 1, e1); } else piece(i, e0, e1); });
  return {
    ...t, format: FIELD_TWIN_FORMAT, id: "ends", name: "Ends", builtAt: "test",
    source: { photographs: 1, camera: "test", capturedAt: null, groundPixelCm: 0.6, method: "test", weedModel: "none", treeModel: "none" },
    bounds: [f.toLatLng(-5, -5), f.toLatLng(60, 10)], footprints: [], rows, trees: [], inferredTrees: [], weeds: [], vegetation: [], atlases: [], stats: {},
    // Five plants a metre: half a plant spacing is 10 cm.
    ...(plantsFirst ? { corn: { fieldRows: ends.map((_, i) => ({ id: i + 1, plants: 250, certain: 200, perM: 5, kind: "certain" as const })) } as TwinBundle["corn"] } : {}),
  };
}
// Six rows: the third starts 0.6 m late, the fourth runs 0.5 m long, the last stops 15 m short.
const ENDS: [number, number][] = [[0, 50], [0, 50], [0.6, 50], [0, 50.5], [0, 50], [0, 35]];

describe("a corn field's boundary from its rows", () => {
  const t = twin(ENDS, true), ring = orchardBlock(t)!, inside = (e: number, n: number) => pointInRing(e, n, ring);
  it("holds every row's first and last plant, and stops half a plant spacing past them", () => {
    ENDS.forEach(([e0, e1], i) => {
      expect(inside(e0 + 0.01, i * S)).toBe(true); expect(inside(e1 - 0.01, i * S)).toBe(true);
      expect(inside(e0 - 0.09, i * S)).toBe(true); expect(inside(e1 + 0.09, i * S)).toBe(true);
      expect(inside(e0 - 0.12, i * S)).toBe(false); expect(inside(e1 + 0.12, i * S)).toBe(false);
    });
  });
  it("steps with a row that starts late, runs long or stops short: none of it smoothed away", () => {
    // Before the third row's first plant, on its own line: outside, though its neighbours' rows run there.
    expect(inside(0.3, 2 * S)).toBe(false); expect(inside(0.3, 1 * S)).toBe(true); expect(inside(0.3, 3 * S)).toBe(true);
    // Past the others' ends, on the long row's line: inside.
    expect(inside(50.4, 3 * S)).toBe(true); expect(inside(50.4, 4 * S)).toBe(false);
    // Past the short last row's end: outside, all the way.
    expect(inside(40, 5 * S)).toBe(false); expect(inside(40, 4 * S)).toBe(true);
  });
  it("runs half a row spacing beyond the two outer rows, and no further", () => {
    expect(inside(25, -0.4 * S)).toBe(true); expect(inside(25, -0.6 * S)).toBe(false);
    expect(inside(25, 5.4 * S)).toBe(true); expect(inside(25, 5.6 * S)).toBe(false);
  });
  it("crosses a row's pieces as one row (the ground between two pieces is the field's)", () => {
    expect(inside(25, 1 * S)).toBe(true);
  });
  it("keeps a corner only where the outline turns", () => {
    // Rows 1 and 2 end alike at both ends: their shared corners say nothing and are gone.
    expect(ring.length).toBeLessThan(4 * ENDS.length);
    expect(ring.length).toBeGreaterThanOrEqual(12);
  });
  it("leaves a twin whose rows were not read from its plants as it was (pieces' ragged ends smoothed)", () => {
    const old = orchardBlock(twin(ENDS, false))!;
    // Steps under a row spacing are smoothed there: fewer corners, and no margin past a row's end (no plant spacing known).
    expect(old.length).toBeLessThan(ring.length);
    expect(pointInRing(-0.05, 0, old)).toBe(false);
  });
});
