import { describe, expect, it } from "vitest";
import { detectorLedRows, hybridRows, rowsFromPoints, type PlantPoint } from "@/lib/rowCrop/plantRows";

// A seeded random so the layouts are the same every run.
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/** Plants along rows at angle `deg` (row direction), rows `pitch` apart, plants `step` apart, with jitter. */
function field(opts: { rows: number[]; pitch: number; step: number; length: number; deg?: number; jitter?: number; drop?: number; seed?: number; origin?: [number, number] }): PlantPoint[] {
  const r = rng(opts.seed ?? 1), t = ((opts.deg ?? 90) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), [ox, oy] = opts.origin ?? [1000, 1000], out: PlantPoint[] = [];
  for (const k of opts.rows) for (let u = 0; u <= opts.length; u += opts.step) {
    if (r() < (opts.drop ?? 0)) continue;
    const uu = u + (r() - 0.5) * 2 * (opts.jitter ?? 3), vv = k * opts.pitch + (r() - 0.5) * 2 * (opts.jitter ?? 3);
    out.push({ x: ox + uu * c - vv * s, y: oy + uu * s + vv * c });
  }
  return out;
}

describe("rows from plant positions", () => {
  it("finds every row of a planted field, its direction and spacing", () => {
    const pts = field({ rows: [0, 1, 2, 3, 4, 5], pitch: 190, step: 40, length: 2000, deg: 80 });
    const r = rowsFromPoints(pts);
    expect(r.rows.length).toBe(6);
    expect(Math.abs(r.directionDeg! - 80)).toBeLessThan(1.5);
    expect(Math.abs(r.pitchPx! - 190)).toBeLessThan(10);
    for (const row of r.rows) expect(row.members.length).toBeGreaterThan(40);
  });

  it("makes no rows from scattered plants", () => {
    const r0 = rng(7), pts: PlantPoint[] = Array.from({ length: 200 }, () => ({ x: r0() * 3000, y: r0() * 3000 }));
    expect(rowsFromPoints(pts).rows.length).toBe(0);
  });

  it("does not make a row of one line of plants with no neighbour", () => {
    const pts = field({ rows: [0], pitch: 190, step: 40, length: 2000 });
    expect(rowsFromPoints(pts).rows.length).toBe(0);
  });

  it("cuts a row where its plants stop (a road across the field)", () => {
    const a = field({ rows: [0, 1, 2], pitch: 190, step: 40, length: 1000 });
    const b = field({ rows: [0, 1, 2], pitch: 190, step: 40, length: 1000, origin: [1000, 2600], seed: 3 });
    const r = rowsFromPoints([...a, ...b]);
    expect(r.rows.length).toBe(6);
    for (const row of r.rows) expect(row.spanPx).toBeLessThan(1100);
  });

  it("keeps two plantings with their own spacings", () => {
    const a = field({ rows: [0, 1, 2, 3], pitch: 190, step: 40, length: 1500 });
    const b = field({ rows: [0, 1, 2, 3], pitch: 95, step: 25, length: 1500, origin: [2200, 1000], seed: 5 });
    const r = rowsFromPoints([...a, ...b]);
    expect(r.rows.length).toBe(8);
  });
});

describe("hybrid rows beside a reader", () => {
  const readerRows = (ks: number[], pitch = 190, length = 2000) => ks.map(k => ({ points: [[1000 - k * pitch, 1000], [1000 - k * pitch, 1000 + length]] as [number, number][] }));
  // Direction 90 deg: along = y, across = -x, so row k sits at x = 1000 - k * pitch.

  it("recovers rows the reader missed next to its rows, on its spacing", () => {
    const det = field({ rows: [0, 1, 2, 3, 4, 5], pitch: 190, step: 40, length: 2000 });
    const h = hybridRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, det, []);
    expect(h.rows.filter(r => r.status === "confirms a reader row").length).toBe(3);
    expect(h.rows.filter(r => r.status === "recovered corn row").length).toBe(3);
  });

  it("calls a separate planting a planted row with the crop unconfirmed", () => {
    const det = field({ rows: [0, 1, 2, 3], pitch: 140, step: 30, length: 2000, origin: [-1500, 1000], seed: 9 });
    const h = hybridRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, det, []);
    expect(h.rows.filter(r => r.status === "recovered corn row").length).toBe(0);
    expect(h.rows.filter(r => r.status === "planted row, crop unconfirmed").length).toBe(4);
  });

  it("rejects a plant line between reader rows that hold plants, and its weeds stay weeds", () => {
    const det = [...field({ rows: [0, 1, 2], pitch: 190, step: 40, length: 2000 }), ...field({ rows: [0.5], pitch: 190, step: 60, length: 2000, seed: 4 })];
    const weeds: [number, number][] = [[1000 - 95, 1500]];
    const h = hybridRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, det, [], weeds);
    expect(h.rows.filter(r => r.status === "recovered corn row" || r.status === "planted row, crop unconfirmed").length).toBe(0);
    expect(h.onRecoveredRows).toEqual([]);
  });

  it("moves weed candidates on a recovered row off the weed list", () => {
    const det = field({ rows: [0, 1, 2, 3, 4], pitch: 190, step: 40, length: 2000 });
    const weeds: [number, number][] = [[1000 - 4 * 190 + 5, 1600], [1000 - 2.5 * 190, 1600]];
    const h = hybridRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, det, [], weeds);
    expect(h.onRecoveredRows).toEqual([0]);
  });

  it("moves reader rows drawn between the plant rows onto the plants, and keeps reader rows that hold plants", () => {
    // The reader's rows sit half a spacing off the plants (on the soil between them) for rows 0-2; row 3 holds plants.
    const det = field({ rows: [0, 1, 2, 3], pitch: 190, step: 40, length: 2000 });
    const reader = [...readerRows([0.5, 1.5, 2.5]), ...readerRows([3])];
    const h = hybridRows({ rows: reader, directionDeg: 90, pitchPx: 190 }, det, []);
    expect(h.droppedReaderRows).toEqual([0, 1, 2]);
    expect(h.rows.filter(r => r.status === "corrected corn row").length).toBe(3);
    expect(h.rows.filter(r => r.status === "confirms a reader row").length).toBe(1);
  });

  it("never drops a reader row where the detector sees no plants (past V10)", () => {
    const h = hybridRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, [], []);
    expect(h.droppedReaderRows).toEqual([]);
  });

  it("with no reader rows, builds the detector's rows but never confirms the crop", () => {
    const det = field({ rows: [0, 1, 2, 3], pitch: 190, step: 40, length: 2000 });
    const h = hybridRows({ rows: [], directionDeg: null, pitchPx: null }, det, []);
    expect(h.rows.length).toBe(4);
    expect(h.rows.every(r => r.status === "planted row, crop unconfirmed")).toBe(true);
  });
});

describe("detector-led rows (variant D)", () => {
  const readerRows = (ks: number[], pitch = 190, length = 2000, y0 = 1000) => ks.map(k => ({ points: [[1000 - k * pitch, y0], [1000 - k * pitch, y0 + length]] as [number, number][] }));

  it("takes the detector's rows where they stand, as corn rows inside the reader's ground", () => {
    const det = field({ rows: [0, 1, 2, 3], pitch: 190, step: 40, length: 2000 });
    const d = detectorLedRows({ rows: readerRows([0.5, 1.5, 2.5]), directionDeg: 90, pitchPx: 190 }, det);
    expect(d.rows.length).toBe(4);
    expect(d.rows.every(r => r.status === "corn row")).toBe(true);
    expect(d.replacedReaderRows).toEqual([0, 1, 2]);
    expect(d.readerPieces.length).toBe(0);
  });

  it("keeps the reader's rows where the detector sees nothing", () => {
    const d = detectorLedRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, []);
    expect(d.readerPieces.length).toBe(3);
    expect(d.rows.length).toBe(0);
  });

  it("calls a detector planting away from the reader's rows crop unconfirmed and leaves the reader's rows alone", () => {
    const det = field({ rows: [0, 1, 2, 3], pitch: 140, step: 30, length: 2000, origin: [-1500, 1000], seed: 9 });
    const d = detectorLedRows({ rows: readerRows([0, 1, 2]), directionDeg: 90, pitchPx: 190 }, det);
    expect(d.rows.length).toBe(4);
    expect(d.rows.every(r => r.status === "planted row, crop unconfirmed")).toBe(true);
    expect(d.readerPieces.length).toBe(3);
  });

  it("keeps the part of a reader row the detector cannot see", () => {
    // Detector rows cover the first 1000 px of the rows; the reader's rows run 3000 px.
    const det = field({ rows: [0, 1, 2], pitch: 190, step: 40, length: 1000 });
    const d = detectorLedRows({ rows: readerRows([0, 1, 2], 190, 3000), directionDeg: 90, pitchPx: 190 }, det);
    expect(d.rows.length).toBe(3);
    expect(d.readerPieces.length).toBe(3);
    for (const piece of d.readerPieces) expect(Math.min(...piece.map(q => q[1]))).toBeGreaterThan(1900);
  });
});
