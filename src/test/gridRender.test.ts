// Culling, level-of-detail and hit testing — the arithmetic that keeps a
// 20,000-cell grid drawable. Tested against numbers rather than a map, which is
// the reason it lives outside the Leaflet layer in the first place.
import { describe, it, expect } from "vitest";
import {
  MAX_STROKED_CELLS, OUTLINE_ABOVE_PX, SPARSE_BELOW_PX,
  cellAt, cellBoundsOf, cellPaint, cellsNear, detailFor, isUndecided,
  metresPerPixel, paintList, rateRange, visibleCells,
} from "@/lib/gridRender";
import {
  type CellRate, type TreatmentCell, type TreatmentGrid,
  buildTreatmentGrid, gridDefinitionFor,
} from "@/lib/treatmentGrid";

// A square field, roughly 300 m on a side, at a latitude where the numbers stay
// readable.
const SQUARE = [[
  { lat: 40.0000, lng: -100.0000 },
  { lat: 40.0000, lng: -99.99648 },
  { lat: 40.00270, lng: -99.99648 },
  { lat: 40.00270, lng: -100.0000 },
]];

const gridOf = (swathM = 30, mult: 1 | 2 | 3 = 1): TreatmentGrid =>
  buildTreatmentGrid(SQUARE, gridDefinitionFor(SQUARE, swathM, mult));

const withRate = (c: TreatmentCell, rate: CellRate): TreatmentCell => ({ ...c, rate });

describe("cell bounds", () => {
  it("packs one bbox per cell, flat, in [minLat,maxLat,minLng,maxLng] order", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    expect(b.length).toBe(g.cells.length * 4);
    for (let i = 0; i < g.cells.length; i++) {
      const ring = g.cells[i].ring;
      expect(b[i * 4]).toBeCloseTo(Math.min(...ring.map(p => p.lat)), 12);
      expect(b[i * 4 + 1]).toBeCloseTo(Math.max(...ring.map(p => p.lat)), 12);
      expect(b[i * 4 + 2]).toBeCloseTo(Math.min(...ring.map(p => p.lng)), 12);
      expect(b[i * 4 + 3]).toBeCloseTo(Math.max(...ring.map(p => p.lng)), 12);
    }
  });
});

describe("viewport culling", () => {
  it("returns everything when the viewport covers the field", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    const all = visibleCells(b, { north: 41, south: 39, east: -99, west: -101 });
    expect(all.length).toBe(g.cells.length);
  });

  it("returns nothing when the viewport is elsewhere", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    expect(visibleCells(b, { north: 10, south: 9, east: 10, west: 9 })).toEqual([]);
  });

  it("keeps a cell that merely overlaps the edge, not only ones contained", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    // A viewport whose south edge cuts THROUGH a row of cells rather than
    // along the seam between two — the seam is the one cut that legitimately
    // straddles nothing, so landing on it would test nothing.
    const view = { north: 41, south: 40.00095, east: -99, west: -101 };
    const vis = visibleCells(b, view);
    const straddles = vis.some(i => b[i * 4] < view.south && b[i * 4 + 1] > view.south);
    expect(straddles).toBe(true);
    // And nothing entirely below the cut survives.
    expect(vis.every(i => b[i * 4 + 1] >= view.south)).toBe(true);
  });

  it("padding admits cells outside the viewport, so a small pan finds them drawn", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    const view = { north: 40.00135, south: 40.0013, east: -99.998, west: -99.9981 };
    const tight = visibleCells(b, view, 0);
    const padded = visibleCells(b, view, 0.0005);
    expect(padded.length).toBeGreaterThan(tight.length);
    // Padding widens the set, it never drops a cell that was already in it.
    expect(tight.every(i => padded.includes(i))).toBe(true);
  });
});

describe("level of detail", () => {
  it("drops to sparse only when a cell is smaller than a few pixels", () => {
    expect(detailFor(SPARSE_BELOW_PX - 0.1, 10)).toBe("sparse");
    expect(detailFor(SPARSE_BELOW_PX + 0.1, 10)).toBe("fill");
  });

  it("withholds outlines until a cell is big enough for one to mean something", () => {
    expect(detailFor(OUTLINE_ABOVE_PX - 0.1, 10)).toBe("fill");
    expect(detailFor(OUTLINE_ABOVE_PX + 0.1, 10)).toBe("outline");
  });

  it("drops outlines on a large field however far you zoom in", () => {
    // The zoom says outline; the cell count overrules it. Stroking is the
    // per-cell work that turns a pan into a stutter.
    expect(detailFor(40, MAX_STROKED_CELLS + 1)).toBe("fill");
    expect(detailFor(40, MAX_STROKED_CELLS)).toBe("outline");
  });

  it("metresPerPixel shrinks with zoom and with distance from the equator", () => {
    expect(metresPerPixel(0, 18)).toBeGreaterThan(metresPerPixel(0, 19));
    expect(metresPerPixel(0, 18)).toBeGreaterThan(metresPerPixel(60, 18));
    // Sanity: the familiar ~0.6 m/px at z18 on the equator.
    expect(metresPerPixel(0, 18)).toBeCloseTo(0.597, 2);
  });
});

describe("paint list", () => {
  it("paints everything visible at fill and outline detail", () => {
    const g = gridOf();
    const vis = [0, 1, 2];
    expect(paintList(g.cells, vis, "fill")).toEqual(vis);
    expect(paintList(g.cells, vis, "outline")).toEqual(vis);
  });

  it("paints only decided cells at sparse detail", () => {
    // This is the whole reason the level exists: at three pixels a cell nobody
    // has touched is a grey speck that costs a draw call and says nothing.
    const g = gridOf();
    const cells = g.cells.map((c, i) =>
      i === 1 ? withRate(c, { state: "treated", rateLha: 20, source: "operator" })
      : i === 2 ? withRate(c, { state: "untreated", source: "operator" })
      : c);
    expect(paintList(cells, [0, 1, 2, 3], "sparse")).toEqual([1, 2]);
  });

  it("counts a hand-set skip as a decision, not as undecided", () => {
    const g = gridOf();
    const skipped = withRate(g.cells[0], { state: "untreated", source: "operator" });
    // Same state as the default, different source — and the difference is the
    // point: "I looked and chose not to spray" is not "nobody has looked".
    expect(isUndecided(g.cells[0])).toBe(true);
    expect(isUndecided(skipped)).toBe(false);
  });
});

describe("colour", () => {
  it("scales the ramp to the grid's own rate range, not a fixed axis", () => {
    const g = gridOf();
    const cells = g.cells.map((c, i) =>
      i < 2 ? withRate(c, { state: "treated", rateLha: i === 0 ? 18 : 22, source: "operator" }) : c);
    expect(rateRange({ ...g, cells })).toEqual({ min: 18, max: 22 });
  });

  it("has no range when nothing is treated", () => {
    expect(rateRange(gridOf())).toBeNull();
  });

  it("gives a deliberate skip a different colour from no-decision-yet", () => {
    const g = gridOf();
    const undecided = cellPaint(g.cells[0], null);
    const skipped = cellPaint(withRate(g.cells[0], { state: "untreated", source: "operator" }), null);
    expect(skipped.fill).not.toBe(undecided.fill);
  });

  it("strokes a hand-set cell more strongly than a computed one", () => {
    const g = gridOf();
    const range = { min: 10, max: 30 };
    const hand = cellPaint(withRate(g.cells[0], { state: "treated", rateLha: 20, source: "operator" }), range);
    const auto = cellPaint(withRate(g.cells[0], { state: "treated", rateLha: 20, source: "threshold" }), range);
    expect(hand.fill).toBe(auto.fill);          // same rate, same fill
    expect(hand.stroke).not.toBe(auto.stroke);  // different provenance, visible
  });

  it("does not divide by zero when every treated cell shares one rate", () => {
    const g = gridOf();
    const paint = cellPaint(
      withRate(g.cells[0], { state: "treated", rateLha: 20, source: "operator" }),
      { min: 20, max: 20 },
    );
    expect(paint.fill).toMatch(/^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
  });
});

describe("hit testing", () => {
  it("finds the cell containing a point", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    const all = g.cells.map((_, i) => i);
    const target = g.cells[Math.floor(g.cells.length / 2)];
    expect(cellAt(g.cells, b, all, target.centroid)).toBe(g.cells.indexOf(target));
  });

  it("returns null off the field", () => {
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    const all = g.cells.map((_, i) => i);
    expect(cellAt(g.cells, b, all, { lat: 39.9, lng: -100.1 })).toBeNull();
  });

  it("only searches the candidates it is given", () => {
    // The cull is what bounds a click to the viewport, so a hit outside the
    // candidate list must not be found — otherwise the cull is decorative.
    const g = gridOf();
    const b = cellBoundsOf(g.cells);
    const target = 5;
    const others = g.cells.map((_, i) => i).filter(i => i !== target);
    expect(cellAt(g.cells, b, others, g.cells[target].centroid)).not.toBe(target);
    expect(cellAt(g.cells, b, [target], g.cells[target].centroid)).toBe(target);
  });
});

describe("brush", () => {
  it("catches cells by centroid distance, not by grazing them", () => {
    const g = gridOf();
    const all = g.cells.map((_, i) => i);
    const centre = g.cells[Math.floor(g.cells.length / 2)];
    // A radius under half a cell can only ever catch the cell it is inside.
    const tight = cellsNear(g.cells, all, centre.centroid, g.cellSizeM * 0.4);
    expect(tight).toEqual([g.cells.indexOf(centre)]);
  });

  it("grows with the radius", () => {
    const g = gridOf();
    const all = g.cells.map((_, i) => i);
    const centre = g.cells[Math.floor(g.cells.length / 2)].centroid;
    const small = cellsNear(g.cells, all, centre, g.cellSizeM * 0.6);
    const big = cellsNear(g.cells, all, centre, g.cellSizeM * 1.6);
    expect(big.length).toBeGreaterThan(small.length);
    expect(small.every(i => big.includes(i))).toBe(true);
  });
});
