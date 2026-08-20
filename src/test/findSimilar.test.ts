// Find Similar — the glue between the treatment grid's cell state and the
// interactive classifier, plus the tile arithmetic that feeds it imagery.
import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";
import {
  type CellRate, type TreatmentGrid, buildTreatmentGrid, gridDefinitionFor,
} from "@/lib/treatmentGrid";
import { type RasterSource, extractCellFeatures } from "@/lib/cellFeatures";
import {
  OUTLIER_Z_THRESHOLD, SIMILARITY_THRESHOLD, candidateTotals, findSimilarCells,
  labelsFromGrid, scanOutliers,
} from "@/lib/findSimilar";
import {
  MAX_TILES, resolutionSufficient, tileCorner, tileCount, tileOf, tileRangeFor,
  zoomForSampling,
} from "@/lib/orthoRaster";

// Same synthetic field as matchCells.test.ts: bare ground west, canopy east,
// a gradient between. See that file for why the noise is a real hash.
const LAT = 7, LNG = 38;

function rect(widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(LAT);
  return [
    { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG },
  ];
}

const FIELD = rect(120, 90);
const GRID = buildTreatmentGrid([FIELD], gridDefinitionFor([FIELD], 6));

function noise(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/** Fractional-rect regions painted solid white — bare-soil stand-ins. */
type WhitePatch = { x0: number; x1: number; y0: number; y1: number };

function syntheticRaster(
  opts: { holeBand?: [number, number]; whitePatches?: WhitePatch[] } = {},
): RasterSource {
  const px = 4;
  const width = Math.round(120 * px), height = Math.round(90 * px);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const BARE = [165, 135, 95], CANOPY = [60, 120, 55];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const third = width / 3;
      const t = x < third ? 0 : x < 2 * third ? (x - third) / third : 1;
      const j = noise(x, y) * 8;
      for (let c = 0; c < 3; c++) rgba[o + c] = BARE[c] + (CANOPY[c] - BARE[c]) * t + j;
      const fx = x / width, fy = y / height;
      for (const w of opts.whitePatches ?? []) {
        if (fx >= w.x0 && fx < w.x1 && fy >= w.y0 && fy < w.y1) {
          rgba[o] = 235 + noise(x, y) * 6;
          rgba[o + 1] = 228 + noise(x + 7, y) * 6;
          rgba[o + 2] = 205 + noise(x, y + 7) * 6;
        }
      }
      const inHole = opts.holeBand && fx >= opts.holeBand[0] && fx < opts.holeBand[1];
      rgba[o + 3] = inHole ? 0 : 255;   // alpha 0 = no imagery, like a cloud gap
    }
  }
  const bb = FIELD.reduce((a, p) => ({
    north: Math.max(a.north, p.lat), south: Math.min(a.south, p.lat),
    east: Math.max(a.east, p.lng), west: Math.min(a.west, p.lng),
  }), { north: -90, south: 90, east: -180, west: 180 });
  return { width, height, bounds: bb, rgba };
}

const SAMPLING = extractCellFeatures(GRID.cells, syntheticRaster(), null);

const WEST = Math.min(...FIELD.map(p => p.lng));
const EAST = Math.max(...FIELD.map(p => p.lng));
const band = (c: { centroid: LatLng2 }) => (c.centroid.lng - WEST) / (EAST - WEST);

const bareCells = GRID.cells.filter(c => band(c) < 0.3);
const canopyCells = GRID.cells.filter(c => band(c) > 0.7);

/** The grid with specific cells relabeled — everything else stays default. */
function gridWith(labels: Record<string, CellRate>): TreatmentGrid {
  return {
    ...GRID,
    cells: GRID.cells.map(c => (labels[c.id] ? { ...c, rate: labels[c.id] } : c)),
  };
}

const treated: CellRate = { state: "treated", rateLha: 20, source: "operator" };
const skipped: CellRate = { state: "untreated", source: "operator" };

/** Three bare cells treated, three canopy cells explicitly skipped. */
function labeledGrid(nPos = 3, nNeg = 3): TreatmentGrid {
  const labels: Record<string, CellRate> = {};
  for (const c of bareCells.slice(0, nPos)) labels[c.id] = treated;
  for (const c of canopyCells.slice(0, nNeg)) labels[c.id] = skipped;
  return gridWith(labels);
}

describe("reading labels off the grid", () => {
  it("takes operator decisions and ignores the default majority", () => {
    const g = labeledGrid();
    const { wanted, unwanted } = labelsFromGrid(g);
    expect(wanted).toHaveLength(3);
    expect(unwanted).toHaveLength(3);
  });

  it("does not count threshold-assigned cells as human examples", () => {
    // A later automated pass must not feed its own output back in as labels.
    const g = gridWith({
      [bareCells[0].id]: { state: "treated", rateLha: 20, source: "threshold" },
    });
    expect(labelsFromGrid(g).wanted).toHaveLength(0);
  });
});

describe("readiness", () => {
  it("returns nothing without negative examples, and says what is missing", () => {
    const g = labeledGrid(3, 0);
    const r = findSimilarCells(g, SAMPLING);
    expect(r.ready).toBe(false);
    expect(r.candidates).toHaveLength(0);
    expect(r.message).toMatch(/skip/i);
  });

  it("returns nothing without positive examples either", () => {
    const r = findSimilarCells(labeledGrid(0, 3), SAMPLING);
    expect(r.ready).toBe(false);
    expect(r.message).toMatch(/treated/i);
  });

  it("needs three of each, not one — the classifier's own floor", () => {
    const r = findSimilarCells(labeledGrid(1, 1), SAMPLING);
    expect(r.ready).toBe(false);
  });
});

describe("finding candidates", () => {
  it("separates the field: suggests bare ground, never canopy", () => {
    const g = labeledGrid();
    const r = findSimilarCells(g, SAMPLING);
    expect(r.ready).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);

    const ids = new Set(r.candidates.map(c => c.cellId));
    const canopyHits = canopyCells.filter(c => ids.has(c.id));
    const bareHits = bareCells.filter(c => ids.has(c.id));
    expect(canopyHits).toHaveLength(0);
    // The unlabeled bare cells are exactly what the operator asked for more of.
    expect(bareHits.length).toBeGreaterThan(bareCells.length / 2);
  });

  it("never suggests a cell the operator already decided", () => {
    const g = labeledGrid();
    const labeled = new Set(Object.keys(labelsFromGrid(g)).length ? [
      ...labelsFromGrid(g).wanted, ...labelsFromGrid(g).unwanted,
    ] : []);
    const r = findSimilarCells(g, SAMPLING);
    expect(r.candidates.some(c => labeled.has(c.cellId))).toBe(false);
  });

  it("orders candidates best first and respects the threshold", () => {
    const r = findSimilarCells(labeledGrid(), SAMPLING);
    for (let i = 1; i < r.candidates.length; i++) {
      expect(r.candidates[i].score).toBeLessThanOrEqual(r.candidates[i - 1].score);
    }
    expect(r.candidates.every(c => c.score >= SIMILARITY_THRESHOLD)).toBe(true);
  });

  it("reports zero candidates as a real answer, not a failure", () => {
    // An impossible threshold: still ready, still ran, found nothing — the UI
    // must be able to say "no similar cells" rather than looking broken.
    const r = findSimilarCells(labeledGrid(), SAMPLING, 1.01);
    expect(r.ready).toBe(true);
    expect(r.candidates).toHaveLength(0);
  });
});

describe("cells without usable imagery", () => {
  it("excludes them from scoring entirely rather than calling them dissimilar", () => {
    // A cloud gap over the WEST band — the same band as the positive examples.
    // If holes were scored as dissimilar-by-default they would vanish from the
    // suggestions silently; instead they are named in `unscored`.
    const holed = extractCellFeatures(
      GRID.cells, syntheticRaster({ holeBand: [0.05, 0.2] }), null,
    );
    const r = findSimilarCells(labeledGrid(), holed);
    expect(r.ready).toBe(true);
    expect(r.unscored.length).toBeGreaterThan(0);
    const suggested = new Set(r.candidates.map(c => c.cellId));
    for (const id of r.unscored) expect(suggested.has(id)).toBe(false);
  });
});

describe("running again after review", () => {
  it("uses accepted and rejected cells as new examples and stops re-suggesting them", () => {
    const first = findSimilarCells(labeledGrid(), SAMPLING);
    const accepted = first.candidates[0].cellId;
    const rejected = first.candidates[1].cellId;

    const labels: Record<string, CellRate> = {};
    for (const c of bareCells.slice(0, 3)) labels[c.id] = treated;
    for (const c of canopyCells.slice(0, 3)) labels[c.id] = skipped;
    labels[accepted] = treated;    // accepted → same as a manual click
    labels[rejected] = skipped;    // rejected → explicit negative

    const second = findSimilarCells(gridWith(labels), SAMPLING);
    expect(second.ready).toBe(true);
    expect(second.wantedCount).toBe(4);
    expect(second.unwantedCount).toBe(4);
    const ids = new Set(second.candidates.map(c => c.cellId));
    expect(ids.has(accepted)).toBe(false);
    expect(ids.has(rejected)).toBe(false);
  });
});

describe("candidate totals", () => {
  it("prices the suggestion with the same area-times-rate arithmetic as the grid", () => {
    const r = findSimilarCells(labeledGrid(), SAMPLING);
    const ids = new Set(r.candidates.map(c => c.cellId));
    const t = candidateTotals(GRID, ids, 20);
    expect(t.count).toBe(ids.size);
    const areaM2 = GRID.cells.filter(c => ids.has(c.id)).reduce((a, c) => a + c.areaM2, 0);
    expect(t.areaM2).toBeCloseTo(areaM2, 6);
    expect(t.volumeL).toBeCloseTo((areaM2 / 10_000) * 20, 6);
  });
});

describe("tile arithmetic for the raster", () => {
  const BOUNDS = { north: LAT + 0.001, south: LAT, east: LNG + 0.0015, west: LNG };

  it("round-trips a coordinate through tile and corner", () => {
    const z = 17;
    const t = tileOf(LAT, LNG, z);
    const nw = tileCorner(t.x, t.y, z);
    const se = tileCorner(t.x + 1, t.y + 1, z);
    expect(LAT).toBeLessThanOrEqual(nw.lat);
    expect(LAT).toBeGreaterThanOrEqual(se.lat);
    expect(LNG).toBeGreaterThanOrEqual(nw.lng);
    expect(LNG).toBeLessThanOrEqual(se.lng);
  });

  it("covers the whole bounds with its tile range", () => {
    const r = tileRangeFor(BOUNDS, 17);
    const nw = tileCorner(r.minX, r.minY, 17);
    const se = tileCorner(r.maxX + 1, r.maxY + 1, 17);
    expect(nw.lat).toBeGreaterThanOrEqual(BOUNDS.north);
    expect(se.lat).toBeLessThanOrEqual(BOUNDS.south);
    expect(nw.lng).toBeLessThanOrEqual(BOUNDS.west);
    expect(se.lng).toBeGreaterThanOrEqual(BOUNDS.east);
  });

  it("stays under the tile budget however deep the imagery goes", () => {
    const { range } = zoomForSampling(BOUNDS, 6, 22);
    expect(tileCount(range)).toBeLessThanOrEqual(MAX_TILES);
  });

  it("picks a zoom where a cell is measurable, and says when it cannot", () => {
    const deep = zoomForSampling(BOUNDS, 6, 20);
    expect(resolutionSufficient(deep.cellPx)).toBe(true);
    // Capped at a shallow max zoom, the same field becomes unmeasurable — and
    // the caller can see that from cellPx instead of scoring noise.
    const shallow = zoomForSampling(BOUNDS, 6, 12);
    expect(resolutionSufficient(shallow.cellPx)).toBe(false);
  });

  it("does not fetch deeper than the pixel target needs", () => {
    // Four times the pixels the statistics need is bandwidth, not accuracy.
    const { cellPx } = zoomForSampling(BOUNDS, 6, 22);
    expect(cellPx).toBeLessThan(40);
  });
});

describe("visually distinct anomaly types — the case that forced kNN", () => {
  // White patches sit in the canopy (east) side: nothing like the bare band.
  const PATCHES = [
    { x0: 0.75, x1: 0.85, y0: 0.1, y1: 0.3 },
    { x0: 0.8, x1: 0.9, y0: 0.6, y1: 0.85 },
  ];
  const patchedSampling = extractCellFeatures(
    GRID.cells, syntheticRaster({ whitePatches: PATCHES }), null,
  );
  const inPatch = (c: { centroid: LatLng2 }) => {
    const fx = (c.centroid.lng - WEST) / (EAST - WEST);
    const SOUTH = Math.min(...FIELD.map(p => p.lat));
    const NORTH = Math.max(...FIELD.map(p => p.lat));
    const fy = 1 - (c.centroid.lat - SOUTH) / (NORTH - SOUTH);
    return PATCHES.some(w =>
      fx >= w.x0 + 0.02 && fx < w.x1 - 0.02 && fy >= w.y0 + 0.05 && fy < w.y1 - 0.05);
  };
  const whiteCells = GRID.cells.filter(inPatch);

  it("has enough white cells for the fixture to mean anything", () => {
    expect(whiteCells.length).toBeGreaterThanOrEqual(4);
  });

  it("surfaces BOTH example groups' lookalikes, not an average of them", () => {
    // Positives: two bare-band cells AND one white cell. Under a single
    // averaged centroid these blend into a point resembling neither, and the
    // remaining white cells score ambiguous — the exact miss reported from the
    // field. Per-example kNN must pull in both neighbourhoods.
    const labels: Record<string, CellRate> = {};
    for (const c of bareCells.slice(0, 2)) labels[c.id] = treated;
    labels[whiteCells[0].id] = treated;
    for (const c of canopyCells.filter(c => !inPatch(c)).slice(0, 3)) labels[c.id] = skipped;

    const r = findSimilarCells(gridWith(labels), patchedSampling);
    expect(r.ready).toBe(true);
    const ids = new Set(r.candidates.map(c => c.cellId));
    const whiteHits = whiteCells.filter(c => !labels[c.id] && ids.has(c.id));
    const bareHits = bareCells.filter(c => !labels[c.id] && ids.has(c.id));
    expect(whiteHits.length).toBeGreaterThanOrEqual(2);   // the previously-missed group
    expect(bareHits.length).toBeGreaterThan(bareCells.length / 2);
  });

  it("flags white patches even with only bare examples — the vote is relative", () => {
    // A finding, not the planned assertion: this test originally expected the
    // white patches to be MISSED without a white example, documenting the old
    // centroid limitation. Under kNN they are caught anyway, because the vote
    // asks "nearer the anomaly examples or the healthy negatives?" — and white
    // ground is far from healthy canopy on nearly every feature. That is the
    // outcome the field report wanted. The outlier scan remains the guarantee
    // for the zero-example case; this is the bonus, pinned so a future scoring
    // change that quietly loses it fails a test instead of a farmer.
    const labels: Record<string, CellRate> = {};
    for (const c of bareCells.slice(0, 3)) labels[c.id] = treated;
    for (const c of canopyCells.filter(c => !inPatch(c)).slice(0, 3)) labels[c.id] = skipped;

    const r = findSimilarCells(gridWith(labels), patchedSampling);
    const ids = new Set(r.candidates.map(c => c.cellId));
    const whiteHits = whiteCells.filter(c => ids.has(c.id));
    expect(whiteHits.length).toBeGreaterThanOrEqual(whiteCells.length / 2);
  });
});

describe("the outlier scan", () => {
  it("flags a bright patch on an otherwise uniform field with ZERO examples", () => {
    // A fresh field, nothing painted: the scan must catch what a human sees at
    // a glance — bright bare ground against green canopy.
    const uniform = syntheticRaster({ whitePatches: [{ x0: 0.4, x1: 0.5, y0: 0.4, y1: 0.6 }] });
    // Make the base field uniform canopy by sampling only the east two thirds?
    // Simpler: run on the standard three-band field — the white patch must
    // still be the STRONGEST outlier because nothing else is that bright.
    const sampling = extractCellFeatures(GRID.cells, uniform, null);
    const r = scanOutliers(GRID, sampling);
    expect(r.candidates.length).toBeGreaterThan(0);
    const top = r.candidates[0];
    const cell = GRID.cells.find(c => c.id === top.cellId)!;
    const fx = (cell.centroid.lng - WEST) / (EAST - WEST);
    expect(fx).toBeGreaterThan(0.38);
    expect(fx).toBeLessThan(0.52);
    expect(top.z).toBeGreaterThanOrEqual(OUTLIER_Z_THRESHOLD);
    expect(top.feature.length).toBeGreaterThan(0);         // says WHY, not just that
  });

  it("never flags cells the operator already decided", () => {
    const sampling = extractCellFeatures(
      GRID.cells, syntheticRaster({ whitePatches: [{ x0: 0.4, x1: 0.5, y0: 0.4, y1: 0.6 }] }), null,
    );
    const first = scanOutliers(GRID, sampling);
    expect(first.candidates.length).toBeGreaterThan(0);
    const decided = gridWith(Object.fromEntries(first.candidates.map(c => [c.cellId, treated])));
    const second = scanOutliers(decided, sampling);
    const decidedIds = new Set(first.candidates.map(c => c.cellId));
    expect(second.candidates.some(c => decidedIds.has(c.cellId))).toBe(false);
  });

  it("excludes unusable imagery rather than scoring holes as anomalies", () => {
    const sampling = extractCellFeatures(
      GRID.cells, syntheticRaster({ holeBand: [0.05, 0.2] }), null,
    );
    const r = scanOutliers(GRID, sampling);
    expect(r.unscored.length).toBeGreaterThan(0);
    const flagged = new Set(r.candidates.map(c => c.cellId));
    for (const id of r.unscored) expect(flagged.has(id)).toBe(false);
  });

  it("declines to scan a field too small to have a baseline", () => {
    const few = { ...GRID, cells: GRID.cells.slice(0, 5) };
    const sampling = extractCellFeatures(few.cells, syntheticRaster(), null);
    expect(scanOutliers(few, sampling).candidates).toHaveLength(0);
  });
});
