import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";
import { buildTreatmentGrid, gridDefinitionFor } from "@/lib/treatmentGrid";
import {
  type RasterSource, MIN_PIXELS_PER_CELL, extractCellFeatures, featureNames,
  samplingVerdict,
} from "@/lib/cellFeatures";
import { fitShrunkenCentroid, rankedFeatures, scoreRow, standardiser } from "@/lib/shrunkenCentroid";
import {
  MATCH_MODEL_VERSION, MIN_MARKS_PER_CLASS,
  applyMatch, clearMarks, emptySession, explainCell, markCell, markCounts,
  previewMatch, readiness, undo,
} from "@/lib/matchCells";

const LAT = 7, LNG = 38;
const SWATH = 6;

function rect(widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(LAT);
  return [
    { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG },
  ];
}

const FIELD = rect(120, 90);
const GRID = buildTreatmentGrid([FIELD], gridDefinitionFor([FIELD], SWATH));

/**
 * White-noise hash. An earlier version of this fixture used `(x*a + y*b) % 17`,
 * which is NOT noise — it produces a strictly alternating pattern across
 * adjacent cells. A test that then labelled cells 1,0,1,0,... was handing the
 * classifier a real periodic signal and asking it to find nothing. It found the
 * signal, correctly, and the test was wrong. Mix properly instead.
 */
function noise(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;   // -1..1
}

/**
 * Synthetic ortho in three bands west to east: bare ground, a gradient, then
 * canopy. The gradient matters — it is what lets us check that scores land
 * between the extremes instead of saturating.
 */
function syntheticRaster(pxPerMetre = 4): RasterSource {
  const width = Math.round(120 * pxPerMetre), height = Math.round(90 * pxPerMetre);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const BARE = [165, 135, 95], CANOPY = [60, 120, 55];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const third = width / 3;
      const t = x < third ? 0 : x < 2 * third ? (x - third) / third : 1;
      const j = noise(x, y) * 8;
      for (let c = 0; c < 3; c++) rgba[o + c] = BARE[c] + (CANOPY[c] - BARE[c]) * t + j;
      rgba[o + 3] = 255;
    }
  }
  const bb = FIELD.reduce((a, p) => ({
    north: Math.max(a.north, p.lat), south: Math.min(a.south, p.lat),
    east: Math.max(a.east, p.lng), west: Math.min(a.west, p.lng),
  }), { north: -90, south: 90, east: -180, west: 180 });
  return { width, height, bounds: bb, rgba };
}

const RASTER = syntheticRaster();
const SAMPLING = extractCellFeatures(GRID.cells, RASTER, null);

const WEST = Math.min(...FIELD.map(p => p.lng));
const EAST = Math.max(...FIELD.map(p => p.lng));
const band = (c: { centroid: LatLng2 }) => (c.centroid.lng - WEST) / (EAST - WEST);

const bareCells = GRID.cells.filter(c => band(c) < 0.3);
const canopyCells = GRID.cells.filter(c => band(c) > 0.7);
/** The gradient in the middle — neither class, and that is the point. */
const transitionCells = GRID.cells.filter(c => band(c) >= 0.42 && band(c) <= 0.58);

describe("feature extraction", () => {
  it("keeps the feature list visible and fixed for RGB-only scans", () => {
    expect(SAMPLING.hasIndex).toBe(false);
    expect(SAMPLING.names).toHaveLength(12);
    expect(SAMPLING.names).toEqual(featureNames(false));
  });

  it("adds index features only when a real index raster is supplied", () => {
    expect(featureNames(true)).toHaveLength(16);
    // No silent backfill: the RGB list is a strict prefix, so the operator can
    // see exactly which extra measurements a multispectral scan contributed.
    expect(featureNames(true).slice(0, 12)).toEqual(featureNames(false));
  });

  it("samples every cell with enough pixels to mean something", () => {
    expect(SAMPLING.underSampled).toBe(0);
    expect(SAMPLING.medianPixels).toBeGreaterThanOrEqual(MIN_PIXELS_PER_CELL);
    for (const s of SAMPLING.samples) expect(s.features).toHaveLength(12);
  });

  it("separates bare from canopy on the greenness feature", () => {
    const idx = SAMPLING.names.indexOf("greenness (ExG)");
    const byId = new Map(SAMPLING.samples.map(s => [s.cellId, s.features]));
    const bare = bareCells.map(c => byId.get(c.id)![idx]);
    const canopy = canopyCells.map(c => byId.get(c.id)![idx]);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(canopy)).toBeGreaterThan(avg(bare));
  });

  it("excludes off-field pixels using the nodata alpha mask", () => {
    const masked: RasterSource = {
      ...RASTER,
      rgba: RASTER.rgba.map((v, i) => (i % 4 === 3 ? 0 : v)) as Uint8ClampedArray,
    };
    const result = extractCellFeatures(GRID.cells, masked, null);
    // Every pixel is masked off, so nothing is characterisable.
    expect(result.underSampled).toBe(result.samples.length);
  });

  it("refuses coarse imagery instead of scoring noise", () => {
    // ~0.4 px per metre: a 6 m cell holds about 6 pixels.
    const coarse = extractCellFeatures(GRID.cells, syntheticRaster(0.4), null);
    const verdict = samplingVerdict(coarse);
    expect(coarse.underSampled).toBeGreaterThan(0);
    if (!verdict.ok) expect(verdict.message).toMatch(/too coarse/);
    else expect(verdict.message).toMatch(/too few pixels/);
  });
});

describe("classifier does not manufacture confidence", () => {
  const usable = SAMPLING.samples.filter(s => s.usable);
  const std = standardiser(usable.map(s => s.features));
  const byId = new Map(usable.map(s => [s.cellId, std.apply(s.features)]));

  it("separates a genuine difference and says so", () => {
    const X = [...bareCells.slice(0, 4), ...canopyCells.slice(0, 4)].map(c => byId.get(c.id)!);
    const y = [1, 1, 1, 1, 0, 0, 0, 0] as (0 | 1)[];
    const clf = fitShrunkenCentroid(X, y, SAMPLING.names);
    expect(clf.separability.verdict).toBe("clear");
    expect(clf.separability.looAccuracy).toBeGreaterThan(0.9);
    expect(clf.separability.featuresUsed).toBeGreaterThan(0);
  });

  it("reports indistinguishable when both sets are drawn from the same ground", () => {
    // All eight cells come from the uniform canopy band, so there is genuinely
    // nothing to separate. The honest answer is to say so rather than paint a
    // confident map — this is the failure mode the diagnostic exists for.
    const pool = canopyCells.slice(0, 8).map(c => byId.get(c.id)!);
    const y = [1, 1, 1, 1, 0, 0, 0, 0] as (0 | 1)[];
    const clf = fitShrunkenCentroid(pool, y, SAMPLING.names);
    expect(clf.separability.verdict).not.toBe("clear");
    expect(clf.separability.message).toMatch(/look alike|cannot tell|only partly/i);
  });

  it("gives ground between the two classes a middling score, not a saturated one", () => {
    // The real signature of the logistic-regression failure is that everything
    // reads 0.000 or 1.000. Ground that genuinely sits between the marked
    // classes is the sharpest test of that: it must score in between.
    const X = [...bareCells.slice(0, 4), ...canopyCells.slice(0, 4)].map(c => byId.get(c.id)!);
    const y = [1, 1, 1, 1, 0, 0, 0, 0] as (0 | 1)[];
    const clf = fitShrunkenCentroid(X, y, SAMPLING.names);

    const scoreOf = (id: string) => scoreRow(clf, byId.get(id)!);
    const mid = transitionCells.map(c => scoreOf(c.id));
    expect(mid.length).toBeGreaterThan(0);
    const avgMid = mid.reduce((a, b) => a + b, 0) / mid.length;
    expect(avgMid).toBeGreaterThan(0.15);
    expect(avgMid).toBeLessThan(0.85);

    // And no cell anywhere is pinned to an exact extreme.
    for (const c of GRID.cells) {
      const s2 = scoreOf(c.id);
      expect(s2).toBeGreaterThan(0);
      expect(s2).toBeLessThan(1);
    }
  });

  it("drops uninformative measurements rather than diluting the signal", () => {
    // Tested directly rather than through the raster: the synthetic bands are
    // unrealistically uniform, so within-class variance is near zero and every
    // feature looks discriminative. Real imagery is noisier. Build a matrix
    // where three columns carry the signal and five are pure noise, and check
    // the noise columns are shrunk away.
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967295 - 0.5;
    };
    const names = ["sig1", "sig2", "sig3", "noise1", "noise2", "noise3", "noise4", "noise5"];
    const row = (cls: 0 | 1) => [
      cls * 3 + rnd(), cls * 3 + rnd(), cls * 3 + rnd(),
      rnd(), rnd(), rnd(), rnd(), rnd(),
    ];
    const X = [row(1), row(1), row(1), row(1), row(0), row(0), row(0), row(0)];
    const y = [1, 1, 1, 1, 0, 0, 0, 0] as (0 | 1)[];

    const clf = fitShrunkenCentroid(X, y, names);
    const ranked = rankedFeatures(clf);

    // Shrinkage is graded, not binary. At four marks per class a noise feature
    // occasionally clears the threshold by luck, so the guarantee that matters
    // is RELATIVE weight: the signal must dominate, not merely be present.
    expect(ranked.slice(0, 3).map(f => f.name).sort()).toEqual(["sig1", "sig2", "sig3"]);

    const weightOf = (n: string) => clf.weights[names.indexOf(n)];
    const signal = ["sig1", "sig2", "sig3"].reduce((a, n) => a + weightOf(n), 0);
    const noise = ["noise1", "noise2", "noise3", "noise4", "noise5"]
      .reduce((a, n) => a + weightOf(n), 0);
    expect(noise / (signal + noise)).toBeLessThan(0.02);

    expect(clf.separability.verdict).toBe("clear");
  });

  it("refuses to fit on a single class", () => {
    const X = bareCells.slice(0, 4).map(c => byId.get(c.id)!);
    expect(() => fitShrunkenCentroid(X, [1, 1, 1, 1], SAMPLING.names))
      .toThrow(/at least one wanted and one unwanted/);
  });
});

describe("marking session", () => {
  const wanted = bareCells.slice(0, 3).map(c => c.id);
  const unwanted = canopyCells.slice(0, 3).map(c => c.id);
  const marked = () => {
    let s = emptySession();
    for (const id of wanted) s = markCell(s, id, "wanted");
    for (const id of unwanted) s = markCell(s, id, "unwanted");
    return s;
  };

  it("will not run on too few examples", () => {
    let s = emptySession();
    expect(readiness(s).ready).toBe(false);
    s = markCell(s, wanted[0], "wanted");
    s = markCell(s, unwanted[0], "unwanted");
    expect(readiness(s).ready).toBe(false);
    expect(readiness(s).message).toMatch(/Mark \d+ more/);
    expect(previewMatch(s, SAMPLING)).toBeNull();
  });

  it("becomes ready at the minimum per class", () => {
    const s = marked();
    expect(markCounts(s)).toEqual({ wanted: 3, unwanted: 3 });
    expect(MIN_MARKS_PER_CLASS).toBe(3);
    expect(readiness(s).ready).toBe(true);
  });

  it("toggles a mark off when clicked with the same label", () => {
    let s = markCell(emptySession(), wanted[0], "wanted");
    expect(s.marks[wanted[0]]).toBe("wanted");
    s = markCell(s, wanted[0], "wanted");
    expect(s.marks[wanted[0]]).toBeUndefined();
  });

  it("switches a mark to the other class without needing to clear it", () => {
    let s = markCell(emptySession(), wanted[0], "wanted");
    s = markCell(s, wanted[0], "unwanted");
    expect(s.marks[wanted[0]]).toBe("unwanted");
  });

  it("undoes all the way back to zero marks", () => {
    let s = marked();
    for (let i = 0; i < 6; i++) s = undo(s);
    expect(Object.keys(s.marks)).toHaveLength(0);
    // Undoing past the start is a no-op, not an error.
    expect(Object.keys(undo(s).marks)).toHaveLength(0);
  });

  it("clears without leaving the mode, and the clear itself is undoable", () => {
    const s = marked();
    const cleared = clearMarks(s);
    expect(Object.keys(cleared.marks)).toHaveLength(0);
    expect(Object.keys(undo(cleared).marks)).toHaveLength(6);
  });

  it("previews live, with no separate calculate step", () => {
    const preview = previewMatch(marked(), SAMPLING)!;
    expect(preview).not.toBeNull();
    expect(preview.scores.size).toBe(GRID.cells.length);
    expect(preview.classifier.separability.verdict).toBe("clear");
  });

  it("scores bare cells above canopy cells", () => {
    const preview = previewMatch(marked(), SAMPLING)!;
    const avg = (ids: string[]) =>
      ids.reduce((a, id) => a + preview.scores.get(id)!, 0) / ids.length;
    expect(avg(bareCells.map(c => c.id))).toBeGreaterThan(avg(canopyCells.map(c => c.id)));
  });
});

describe("applying a match", () => {
  const wanted = bareCells.slice(0, 3).map(c => c.id);
  const unwanted = canopyCells.slice(0, 3).map(c => c.id);
  let session = emptySession();
  for (const id of wanted) session = markCell(session, id, "wanted");
  for (const id of unwanted) session = markCell(session, id, "unwanted");
  const preview = previewMatch(session, SAMPLING)!;
  const applied = applyMatch(GRID, preview, "2026-08-19T10:00:00Z");

  it("writes into the existing detection field, tagged with the method", () => {
    for (const cell of applied.cells) {
      expect(cell.detection).not.toBeNull();
      expect(cell.detection!.modelVersion).toBe(MATCH_MODEL_VERSION);
      expect(cell.detection!.scoredAt).toBe("2026-08-19T10:00:00Z");
      expect(cell.detection!.score).toBeGreaterThanOrEqual(0);
      expect(cell.detection!.score).toBeLessThanOrEqual(1);
    }
  });

  it("assigns no rates — thresholding stays a separate, reversible step", () => {
    for (const cell of applied.cells) {
      expect(cell.rate).toEqual({ state: "untreated", source: "default" });
    }
  });

  it("never overwrites an operator's hand-set rate", () => {
    const withOverride = {
      ...GRID,
      cells: GRID.cells.map((c, i) =>
        i === 0 ? { ...c, rate: { state: "treated" as const, rateLha: 42, source: "operator" as const } } : c),
    };
    const after = applyMatch(withOverride, preview, "2026-08-19T10:00:00Z");
    expect(after.cells[0].rate).toEqual({ state: "treated", rateLha: 42, source: "operator" });
    expect(after.cells[0].detection!.score).toBeGreaterThanOrEqual(0);
  });

  it("re-running with different marks replaces scores but not rates", () => {
    let s2 = emptySession();
    for (const id of canopyCells.slice(0, 3).map(c => c.id)) s2 = markCell(s2, id, "wanted");
    for (const id of bareCells.slice(0, 3).map(c => c.id)) s2 = markCell(s2, id, "unwanted");
    const flipped = applyMatch(applied, previewMatch(s2, SAMPLING)!, "2026-08-19T11:00:00Z");
    const before = applied.cells[0].detection!.score;
    const after = flipped.cells[0].detection!.score;
    // Inverting the marks should invert the score.
    expect(after).toBeCloseTo(1 - before, 6);
    expect(flipped.cells[0].rate).toEqual({ state: "untreated", source: "default" });
  });

  it("can explain why a cell scored as it did", () => {
    const explained = explainCell(preview, SAMPLING, bareCells[0].id);
    expect(explained).not.toBeNull();
    expect(explained!.drivers.length).toBeGreaterThan(0);
    for (const d of explained!.drivers) expect(SAMPLING.names).toContain(d.name);
  });
});
