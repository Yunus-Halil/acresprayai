// The pipeline, end to end, in the order the operator described it:
//
//   1. the mosaic and the boundary become tiles          (tiles.ts)
//   2. every tile is measured against the field average   (baseline.ts)
//   3. the not-average tiles are marked                   (baseline.ts)
//      and, where rows can be fitted, off-row vegetation  (rows.ts, blobs.ts)
//   4. the marked ground is re-read at full depth         (zoom.ts)
//   5. candidates are ranked for the brain and the human  (candidates.ts)
//
// Browser-side. Yields to the event loop between tiles so the map stays
// responsive during a run, and reports every stage so the UI can say what is
// happening rather than spinning.
import { pointInAnyRing } from "../geo";
import { stitchTiles } from "../orthoRaster";
import { MIN_BASELINE_TILES, fieldBaseline, flagOutliers, sampleTiles } from "./baseline";
import { extractBlobs } from "./blobs";
import { chipSpanM, rankCandidates } from "./candidates";
import { fitRowModel } from "./rows";
import { rasterGsdM, tessellate, tileIdAt, tileLattice, tileWindow } from "./tiles";
import type { AnalysisTile, Candidate, RowModel, ScoutInputs, ScoutProgress, ScoutResult, TileFlag } from "./types";
import { globalThreshold, indexRaster, maskWindow } from "./vegetation";
import { boundsOfRing, fetchRaster, padBounds, renderChip } from "./zoom";

const yieldToUi = () => new Promise<void>(r => setTimeout(r, 0));

export type RunOptions = {
  onProgress?: (p: ScoutProgress) => void;
  signal?: AbortSignal;
};

class Aborted extends Error {
  constructor() { super("Weed Scout run cancelled."); this.name = "Aborted"; }
}

export async function runWeedScout(inputs: ScoutInputs, opts: RunOptions = {}): Promise<ScoutResult> {
  const { boundary, tileUrl, maxNative, params } = inputs;
  const report = (stage: ScoutProgress["stage"], fraction: number | null = null, note?: string) =>
    opts.onProgress?.({ stage, fraction, note });
  const check = () => { if (opts.signal?.aborted) throw new Aborted(); };
  const notes: string[] = [];
  const startedAt = new Date().toISOString();
  const template = (z: number, x: number, y: number) =>
    tileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

  // 1. Imagery, then tiles. ---------------------------------------------------
  report("stitching");
  const lattice = tileLattice(boundary, params.tileM);
  const bbox = {
    north: lattice.minLat + lattice.rows * lattice.dLat, south: lattice.minLat,
    east: lattice.minLng + lattice.cols * lattice.dLng, west: lattice.minLng,
  };
  const { raster, missingTiles } = await stitchTiles(template, bbox, params.tileM, Math.min(20, maxNative));
  check();
  const gsdM = rasterGsdM(raster);
  if (missingTiles) notes.push(`${missingTiles} imagery tile(s) failed to load; ground under them is unmeasured.`);

  report("tiling");
  const tiles = tessellate(boundary, params.tileM, params.headlandM);
  const tileById = new Map(tiles.map(t => [t.id, t]));
  const tileOf = (p: { lat: number; lng: number }) => {
    const id = tileIdAt(lattice, p);
    return id && tileById.has(id) ? id : null;
  };
  await yieldToUi();

  // 2. Vegetation mask, tile by tile with a field-wide fallback. -------------
  report("masking", 0);
  const index = indexRaster(raster);
  const fieldThreshold = globalThreshold(index, raster.width);
  const mask = new Uint8Array(raster.width * raster.height);
  let fallbacks = 0;
  for (let i = 0; i < tiles.length; i++) {
    const w = tileWindow(tiles[i], raster);
    if (w) {
      const stats = maskWindow(index, raster.width, w, mask, fieldThreshold);
      if (stats.usedFallback) fallbacks++;
    }
    if (i % 200 === 0) { check(); report("masking", i / tiles.length); await yieldToUi(); }
  }
  if (tiles.length && fallbacks / tiles.length > 0.5) {
    notes.push(`${fallbacks} of ${tiles.length} tiles had no soil-to-plant contrast of their own and used the field-wide threshold.`);
  }

  // 3. Baseline and flags. ----------------------------------------------------
  report("baseline");
  const samples = sampleTiles(tiles, raster, mask);
  const baseline = fieldBaseline(samples);
  let flags: TileFlag[] = [];
  if (!baseline) {
    notes.push(`Only ${samples.filter(s => s.usable).length} tiles held enough pixels to measure; a baseline needs ${MIN_BASELINE_TILES}. Nothing was flagged as not-average.`);
  } else {
    const headland = new Set(tiles.filter(t => t.headland).map(t => t.id));
    flags = flagOutliers(samples, baseline, params.anomalyZ, headland);
  }
  await yieldToUi();
  check();

  // Rows, where they can be found. --------------------------------------------
  report("rows");
  let rows: RowModel | null = null;
  try {
    rows = fitRowModel(mask, raster, params.rowSpacingM, {
      insideField: p => pointInAnyRing(p, boundary),
    });
    if (!rows.usable) {
      notes.push(
        "No window of this imagery showed a row pattern the fit would trust, so nothing is scored as off-row. " +
        "Off-row detection needs early-season row crop with soil visible between rows.",
      );
    } else {
      const weak = rows.tiles.filter(t => t.confidence > 0 && t.confidence < 0.35).length;
      if (weak) notes.push(`${weak} row-fit window(s) were below the confidence floor and are not consulted.`);
      if (rows.tiles.some(t => t.pitchFromGrower && t.confidence > 0)) {
        notes.push("Some windows recovered a row spacing more than 10% from the stated spacing (a harmonic); the stated spacing was kept there.");
      }
    }
  } catch (e) {
    rows = null;
    notes.push(`Row fit failed: ${(e as Error).message}`);
  }
  await yieldToUi();
  check();

  // Blobs over the whole field mask. -----------------------------------------
  report("blobs");
  let blobs = extractBlobs(mask, raster, { minAreaCm2: params.minBlobCm2, tileOf, idPrefix: "b" });
  await yieldToUi();
  check();

  // Preliminary ranking decides which ground is worth zooming into. ---------
  const ranked = rankCandidates({ blobs, tiles, flags, rows, params });

  // 4. Zoom in on the not-average things. -------------------------------------
  const zoomTiles = new Set<string>();
  for (const f of flags) { if (zoomTiles.size >= params.maxZoomTiles) break; if (!tileById.get(f.tileId)?.headland) zoomTiles.add(f.tileId); }
  for (const c of ranked.candidates) { if (zoomTiles.size >= params.maxZoomTiles) break; zoomTiles.add(c.tileId); }
  let zoomGsdM: number | null = null;
  const refined = new Map<string, Candidate>();
  let zi = 0;
  for (const tileId of zoomTiles) {
    const tile = tileById.get(tileId)!;
    report("zooming", zi / zoomTiles.size, `tile ${tileId}`);
    zi++;
    try {
      const { raster: deep } = await fetchRaster(template, padBounds(boundsOfRing(tile.ring), 0.75), Math.min(20, maxNative));
      check();
      const deepGsd = rasterGsdM(deep);
      zoomGsdM = deepGsd;
      const deepIndex = indexRaster(deep);
      const deepMask = new Uint8Array(deep.width * deep.height);
      maskWindow(deepIndex, deep.width, { x0: 0, y0: 0, x1: deep.width - 1, y1: deep.height - 1 }, deepMask, fieldThreshold);
      const deepBlobs = extractBlobs(deepMask, deep, {
        minAreaCm2: params.minBlobCm2,
        tileOf: p => (pointInAnyRing(p, [tile.ring]) ? tile.id : null),
        idPrefix: `z${tileId}-`,
      });
      for (const c of ranked.candidates) {
        if (c.tileId !== tileId) continue;
        let next: Candidate = { ...c };
        if (c.blob) {
          // The same plant, re-measured on the deep pixels: nearest deep blob
          // within half a metre of the coarse centroid.
          let best = null as (typeof deepBlobs)[number] | null, bestD = 0.5;
          for (const b of deepBlobs) {
            const d = distanceM(b.centroid, c.centroid);
            if (d < bestD) { bestD = d; best = b; }
          }
          if (best) next = { ...next, blob: { ...best, id: c.blob.id, tileId }, centroid: best.centroid };
        }
        const chip = renderChip(deep, next.centroid, chipSpanM(next, params.tileM / 2));
        if (chip) next = { ...next, chip: chip.dataUrl, chipSpanM: chip.spanM, chipGsdM: chip.gsdM };
        refined.set(c.id, next);
      }
    } catch (e) {
      notes.push(`Zoom into tile ${tileId} failed: ${(e as Error).message}`);
    }
    await yieldToUi();
  }
  if (zoomTiles.size && zoomGsdM !== null && zoomGsdM < gsdM * 0.9) {
    notes.push(`Flagged ground was re-read at ${(zoomGsdM * 100).toFixed(1)} cm/px (base pass ${(gsdM * 100).toFixed(1)} cm/px).`);
  }

  // 5. Final queue. -----------------------------------------------------------
  report("ranking");
  const candidates = ranked.candidates.map(c => refined.get(c.id) ?? c);
  if (ranked.overflow) notes.push(`${ranked.overflow} further candidate(s) were cut from the queue; raise the thresholds or shrink the field.`);
  if (ranked.headlandExcluded) notes.push(`${ranked.headlandExcluded} blob(s) inside the ${params.headlandM} m headland were not scored.`);
  blobs = [];
  report("done");
  return {
    tiles, samples, flags, rows, candidates,
    gsdM, zoomGsdM, missingTiles,
    baselineTiles: baseline?.tiles ?? 0,
    notes,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export type { AnalysisTile };
