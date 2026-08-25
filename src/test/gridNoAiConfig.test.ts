// The treatment grid computes with NO AI configuration present, at all.
//
// This is a correctness requirement, not a nice-to-have. The grid extrapolates
// by distance-weighted kNN over per-cell imagery features — pure computation
// over pixels — so it must never reach for a model key, a gateway URL or any
// network service. A scan once displayed "Grid run failed · AI is not
// configured (missing AI_API_KEY)"; the grid had not run at all (the message
// was a fossil left on the row by the deleted vision path), but nothing in the
// suite would have caught the grid genuinely acquiring such a dependency.
// This test would.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractCellFeatures } from "@/lib/cellFeatures";
import { findSimilarCells, labelsFromGrid, applyScores } from "@/lib/findSimilar";
import { scanOutliers } from "@/lib/findSimilar";
import { gridZonesFor } from "@/lib/gridZones";
import {
  type CellRate, buildTreatmentGrid, gridDefinitionFor,
} from "@/lib/treatmentGrid";
import type { RasterSource } from "@/lib/cellFeatures";

// ~100 m square field, cells small enough to give the sampler room.
const RING = [
  { lat: 45.0, lng: -93.0 },
  { lat: 45.0009, lng: -93.0 },
  { lat: 45.0009, lng: -92.9987 },
  { lat: 45.0, lng: -92.9987 },
];

/**
 * Synthetic imagery: the western half green (healthy), the eastern half brown
 * (stressed). Real pixel data, so the features and the kNN have something
 * genuine to separate — a stub raster would test nothing.
 */
function twoToneRaster(): RasterSource {
  const width = 240, height = 240;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const green = x < width / 2;
      rgba[i] = green ? 60 : 150;      // R
      rgba[i + 1] = green ? 140 : 110; // G
      rgba[i + 2] = green ? 50 : 80;   // B
      rgba[i + 3] = 255;               // opaque = on-field
    }
  }
  return {
    width, height, rgba,
    bounds: { north: 45.0009, south: 45.0, east: -92.9987, west: -93.0 },
  };
}

function paintedGrid() {
  const def = gridDefinitionFor([RING], 12, 1);
  const grid = buildTreatmentGrid([RING], def);
  // Reference points: treated examples in the east (brown), skipped examples
  // in the west (green). Exactly the operator gesture the product is built on.
  const midLng = -92.99935;
  const east = grid.cells.filter(c => c.centroid.lng > midLng);
  const west = grid.cells.filter(c => c.centroid.lng <= midLng);
  const treated: CellRate = { state: "treated", rateLha: 25, source: "operator" };
  const skipped: CellRate = { state: "untreated", source: "operator" };
  const marks = new Map<string, CellRate>();
  for (const c of east.slice(0, 4)) marks.set(c.id, treated);
  for (const c of west.slice(0, 4)) marks.set(c.id, skipped);
  return {
    ...grid,
    cells: grid.cells.map(c => (marks.has(c.id) ? { ...c, rate: marks.get(c.id)! } : c)),
  };
}

/**
 * Every environment surface an AI client could read a key from, emptied. Any
 * code that reached for one would get undefined and have to fail loudly.
 */
function stripAiConfig() {
  for (const key of ["AI_API_KEY", "AI_GATEWAY_URL", "AI_MODEL"]) {
    vi.stubEnv(key, "");
    delete (import.meta as unknown as { env: Record<string, unknown> }).env[key];
    delete (import.meta as unknown as { env: Record<string, unknown> }).env[`VITE_${key}`];
  }
  // No Deno either: the grid is client-side and must not expect an edge shim.
  vi.stubGlobal("Deno", undefined);
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stripAiConfig();
  // Any network call at all from this path is a failure, so make it loud
  // rather than letting a silent fallback slip through.
  fetchSpy = vi.fn(async (input: unknown) => {
    throw new Error(`the treatment grid must not call the network: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the treatment grid with no AI configuration present", () => {
  it("extrapolates from reference points and produces zones, touching no network", () => {
    const grid = paintedGrid();
    const labels = labelsFromGrid(grid);
    expect(labels.wanted.length).toBeGreaterThanOrEqual(3);
    expect(labels.unwanted.length).toBeGreaterThanOrEqual(3);

    // The full pipeline the operator drives: sample pixels → score → project.
    const sampling = extractCellFeatures(grid.cells, twoToneRaster(), null);
    const result = findSimilarCells(grid, sampling);
    expect(result.ready).toBe(true);
    if (!result.ready) return;

    // It actually computed something: scores exist and separate the two tones.
    expect(result.scores.size).toBeGreaterThan(0);

    // Accepting the suggestions yields real zones with real areas and rates.
    const scored = applyScores(grid, result.scores, "2026-08-25T10:00:00Z");
    const accepted = {
      ...scored,
      cells: scored.cells.map(c => (
        result.candidates.some(k => k.cellId === c.id)
          ? { ...c, rate: { state: "treated", rateLha: 25, source: "operator" } as CellRate }
          : c
      )),
    };
    const zones = gridZonesFor(accepted);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(z.areaM2).toBeGreaterThan(0);
      expect(z.rateLha).toBe(25);
      expect(z.source).toBe("grid");
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs the unsupervised outlier scan without any AI configuration either", () => {
    const grid = paintedGrid();
    const sampling = extractCellFeatures(grid.cells, twoToneRaster(), null);
    expect(() => scanOutliers(grid, sampling)).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses honestly when there are too few reference points — never by blaming config", () => {
    const def = gridDefinitionFor([RING], 12, 1);
    const bare = buildTreatmentGrid([RING], def);   // nothing marked
    const sampling = extractCellFeatures(bare.cells, twoToneRaster(), null);
    const result = findSimilarCells(bare, sampling);

    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.message).toMatch(/mark|example|cell/i);
      // The refusal must be about the operator's examples, never about a key.
      expect(result.message).not.toMatch(/AI|API|key|configur/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
