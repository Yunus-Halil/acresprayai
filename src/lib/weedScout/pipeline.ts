// The pipeline, end to end, in the order the operator described it:
//
//   1. the mosaic and the boundary become tiles              (tiles.ts)
//   2. every tile is measured against the field's densest
//      half AND against its own neighbourhood                (baseline.ts)
//   3. the not-average tiles are marked, and touching ones
//      are grown into regions with an area                   (baseline.ts)
//      where rows can be fitted, off-row vegetation; and
//      plants unlike the field's plants                      (rows.ts, blobs.ts)
//   4. the whole interior is swept at full depth, window by
//      window, so the small things are seen                  (sweep.ts)
//   5. candidates are ranked, compared with the archive, and
//      described in-house                                    (candidates.ts,
//                                                             feedback.ts, describe.ts)
//   6. every shape is matched to the original photos that
//      hold it, from the camera positions                    (sourceFrames/spot.ts)
//
// ANY CROP, ANY FIELD. Nothing here assumes corn, rows, or a size. The tile
// edge is picked from the field's area unless the operator pins it. Rows are
// looked for and used only when found (or when the operator says there are
// rows); on a field without them the regions and the plant population carry
// the run and the result says so. A closed canopy (pasture, a mature crop, a
// cover crop) turns plant-level detection off rather than into a crash, and
// the regions still work on it.
//
// Browser-side. Yields to the event loop between windows so the map stays
// responsive during a run, and reports every stage so the UI can say what is
// happening rather than spinning. Nothing here calls anything outside the
// tile server and the operator's own archive.
import { pointInAnyRing } from "../geo";
import { stitchTiles } from "../orthoRaster";
import {
  MIN_BASELINE_TILES, canopyClosed, fieldBaseline, flagTiles, growRegions, sampleTiles, scoreTiles,
} from "./baseline";
import { TooManyBlobsError, extractBlobs } from "./blobs";
import { chipSpanM, rankCandidates } from "./candidates";
import type { EventContext } from "./context";
import { describe } from "./describe";
import { applyFeedback } from "./feedback";
import { type FieldPattern, patternDistance, patternRowModel, planPatternWindows, readFieldPattern } from "./fieldPattern";
import { distanceToRowM, fitRowModel } from "./rows";
import { planSweep, sweepWindow } from "./sweep";
import { autoTileM, rasterGsdM, tessellate, tileIdAt, tileLattice, tileWindow } from "./tiles";
import {
  F, type AnalysisTile, type Blob, type Candidate, type Region, type RowModel, type ScoutInputs, type ScoutProgress,
  type ScoutResult, type SweepStats, type TileFlag, type TileScore,
} from "./types";
import { type UnitSystem, fmtLengthCm } from "../units";
import { globalThreshold, indexRaster, maskWindow } from "./vegetation";
import { boundsAround, fetchRaster, renderChip } from "./zoom";
import { classifyCandidates } from "./classify";
import type { ScanSources } from "../sourceFrames/scan";
import { sourceImagesNote, sourceImagesOf, spotSources } from "../sourceFrames/spot";

const yieldToUi = () => new Promise<void>(r => setTimeout(r, 0));

export type RunOptions = {
  onProgress?: (p: ScoutProgress) => void;
  signal?: AbortSignal;
  /** For the describer. Optional; the estimate says when it is missing. */
  context?: EventContext | null;
  crop?: string;
  growthStage?: string | null;
  fieldId?: string | null;
  /** Follows the operator's display setting; defaults to metric for callers (tests) that omit it. */
  unitSystem?: UnitSystem;
  /** Score chipped plant candidates with the shipped classifier. Default: only in a browser. */
  classify?: boolean;
  /** The scan's camera positions and kept originals, for matching shapes to photos. */
  sources?: ScanSources | null;
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
  const sys: UnitSystem = opts.unitSystem ?? "metric";
  const startedAt = new Date().toISOString();
  const template = (z: number, x: number, y: number) =>
    tileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const insideField = (p: { lat: number; lng: number }) => pointInAnyRing(p, boundary);

  // 1. Imagery, then tiles. ---------------------------------------------------
  report("stitching");
  const tileM = params.autoTile ? autoTileM(boundary, params.tileM) : params.tileM;
  if (params.autoTile && tileM !== params.tileM) notes.push(`Tile size set to ${tileM} m from the field's area.`);
  const lattice = tileLattice(boundary, tileM);
  const bbox = {
    north: lattice.minLat + lattice.rows * lattice.dLat, south: lattice.minLat,
    east: lattice.minLng + lattice.cols * lattice.dLng, west: lattice.minLng,
  };
  const { raster, missingTiles } = await stitchTiles(template, bbox, tileM, Math.min(20, maxNative));
  check();
  const gsdM = rasterGsdM(raster);
  if (missingTiles) notes.push(`${missingTiles} imagery tile(s) failed to load in the base pass; ground under them is unmeasured.`);

  report("tiling");
  const tiles = tessellate(boundary, tileM, params.headlandM);
  const tileById = new Map(tiles.map(t => [t.id, t]));
  const headland = new Set(tiles.filter(t => t.headland).map(t => t.id));
  if (tiles.length && headland.size === tiles.length) {
    notes.push(`The ${params.headlandM} m headland covers the whole field; nothing can be scored. Lower the headland for a field this size.`);
  }
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

  // 3. Baseline at two scales, flags, regions. --------------------------------
  report("baseline");
  const samples = sampleTiles(tiles, raster, mask);
  const baseline = fieldBaseline(samples);
  const canopy = canopyClosed(samples);
  let scores: TileScore[] = [];
  let flags: TileFlag[] = [];
  let regions: Region[] = [];
  if (!baseline) {
    notes.push(`Only ${samples.filter(s => s.usable).length} tiles held enough pixels to measure; a baseline needs ${MIN_BASELINE_TILES}. Nothing was flagged as not-average.`);
  } else {
    scores = scoreTiles(samples, baseline, tiles, params.anomalyZ);
    flags = flagTiles(scores, params.anomalyZ, headland);
    report("regions");
    regions = growRegions(tiles, scores, flags, lattice, { ...params, tileM }, headland);
    const flagged = new Set(flags.map(f => f.tileId));
    const unsupported = scores.filter(s => !s.supported && s.leader >= params.anomalyZ).length;
    if (unsupported) notes.push(`${unsupported} tile(s) deviated on one feature alone and were not flagged without a second feature agreeing.`);
    const brightOnly = scores.filter(s => !flagged.has(s.tileId) && (Math.abs(s.fieldZ[F.brightness]) >= params.anomalyZ || Math.abs(s.localZ[F.brightness]) >= params.anomalyZ)).length;
    if (brightOnly) notes.push(`${brightOnly} tile(s) differed from the field only in brightness (a seam, a shadow or exposure) and were not flagged; brightness describes a region, it never triggers one.`);
    const covered = regions.reduce((s, r) => s + r.tileCount, 0);
    if (regions.length) notes.push(`${regions.length} region(s) cover ${covered} tiles (${((covered / tiles.length) * 100).toFixed(0)}% of the field).`);
  }
  if (canopy.closed) {
    notes.push(
      `The canopy is closed (typical tile is ${(canopy.medianVegetation * 100).toFixed(0)}% vegetation), so plants cannot be separated ` +
      `from one another. Plant-level detection and the row fit are off for this run; regions still apply.`,
    );
  }
  await yieldToUi();
  check();

  // The planting pattern, from the field map at about 5 cm per pixel. -------
  // Every row block, its settled lines and its plants, on the ground; it
  // stands for the row model below and the sweep measures its distances
  // against the settled lines. Where it finds no rows the older fit still
  // runs, so a field it cannot read is no worse off than before.
  let pattern: FieldPattern | null = null;
  if (params.pattern && params.rowMode !== "none" && !canopy.closed) {
    report("pattern", 0);
    try {
      const plan = planPatternWindows(bbox, boundary, maxNative);
      const fp = await readFieldPattern(template, plan, { lat: bbox.north, lng: bbox.west }, {
        rowSpacingM: params.rowSpacingAuto ? "auto" : params.rowSpacingM,
        rowAngleDeg: params.rowAngleDeg,
        signal: opts.signal,
        onProgress: (i, n, note) => report("pattern", n ? i / n : null, note),
      });
      if (fp.summary.blocks > 0) {
        pattern = fp;
        const s = fp.summary;
        notes.push(
          `Planting pattern: rows ${s.rowSpacingM == null ? "" : fmtLengthCm(s.rowSpacingM * 100, sys).text + " apart"}` +
          `${s.plantSpacingM == null ? "" : ", plants " + fmtLengthCm(s.plantSpacingM * 100, sys).text + " apart along the row"}` +
          `, ${s.plantCount.toLocaleString()} crop plant(s) placed in ${s.blocks} block(s) over ${s.windowsWithRows} of ${s.windows} windows at ${fmtLengthCm(fp.gsdM * 100, sys).text} per pixel.`,
        );
        if (s.squareGrid) notes.push("The plants sit on a square grid, so rows fit both ways; the lines follow the brighter direction. If they run the wrong way, set the row direction.");
        if (plan.grown) notes.push(`Pattern windows were widened to ${plan.windowM} m to read this field in ${plan.windows.length} windows.`);
        if (s.missingTiles) notes.push(`${s.missingTiles} imagery tile(s) failed to load in the pattern pass; rows under them were not read.`);
      } else {
        notes.push("No planting pattern was read from the field map; the row fit below stands on its own.");
      }
    } catch (e) {
      if ((e as Error)?.name === "Aborted") throw e;
      notes.push(`The planting pattern pass failed: ${(e as Error).message}`);
    }
    check();
  }

  // Where the pattern placed the crop, a region of vegetation unlike the
  // field average is the crop: trees on bare ground read as "dense
  // vegetation" against a field that is mostly soil. Only ground classes
  // (bare, dark or wet, thin stand) remain findings there; off the pattern,
  // every class still counts.
  if (pattern) {
    const onPattern = patternDistance(pattern);
    const vegetationClass = new Set<Region["klass"]>(["dense vegetation", "pale vegetation", "greener than the field", "different from the field"]);
    const before = regions.length;
    regions = regions.filter(r => !(vegetationClass.has(r.klass) && onPattern(r.centroid) != null));
    const dropped = before - regions.length;
    if (dropped) notes.push(`${dropped} region(s) of vegetation unlike the field average sat on the planting pattern, where the crop itself is what stands out from the ground, and were not counted as findings.`);
  }

  // Rows, where they can be found and where they are wanted. ------------------
  report("rows");
  let rows: RowModel | null = pattern ? patternRowModel(pattern) : null;
  let rowsUsed: ScoutResult["rowsUsed"] = rows ? "fitted" : "not a row crop";
  if (!rows && params.rowMode !== "none" && !canopy.closed) {
    try {
      rows = fitRowModel(mask, raster, params.rowSpacingM, { insideField });
      if (rows.usable) {
        rowsUsed = "fitted";
        if (rows.tiles.some(t => t.pitchFromGrower && t.confidence > 0)) {
          notes.push("Some windows recovered a row spacing more than 10% from the stated spacing (a harmonic); the stated spacing was kept there.");
        }
      } else {
        rowsUsed = "not found";
        notes.push(params.rowMode === "rows"
          ? "You said this is a row crop, but no window of the base pass showed a row pattern the fit would trust. The sweep will still try per window; check the row spacing, and whether soil is visible between rows."
          : "No row pattern was found in the base pass, so this run treats the field as not a row crop: regions and plant outliers carry it, and nothing is scored as off-row.");
      }
    } catch (e) {
      rows = null;
      rowsUsed = "not found";
      notes.push(`Row fit failed: ${(e as Error).message}`);
    }
  }
  await yieldToUi();
  check();

  // 4. Plants: the full-depth sweep, or the base pass when it is off. --------
  let blobs: Blob[] = [];
  const sweep: SweepStats = { ran: false, windows: 0, gsdM: null, backedOff: 0, failed: 0, rowWindows: 0 };
  // With a pattern the sweep measures against its settled lines and does not refit rows per window.
  const fitRowsInSweep = !pattern && (params.rowMode === "rows" || (params.rowMode === "auto" && !!rows?.usable));
  const plan = params.sweep && !canopy.closed ? planSweep(bbox, tiles, maxNative, params.maxSweepWindows) : null;
  if (canopy.closed) {
    // Nothing to separate. Regions are the whole answer here.
  } else if (plan && plan.windows.length && plan.gsdM < gsdM * 0.95) {
    sweep.ran = true;
    sweep.gsdM = plan.gsdM;
    sweep.backedOff = plan.backedOff;
    const angleHint = rows?.usable ? rows.medianAngleDeg : null;
    const patternDist = pattern ? patternDistance(pattern) : null;
    const coarseDistance = (p: { lat: number; lng: number }) => (patternDist ? patternDist(p) : rows ? distanceToRowM(rows, p) : null);
    let canopyWindows = 0;
    for (let i = 0; i < plan.windows.length; i++) {
      report("sweeping", i / plan.windows.length, `window ${i + 1} of ${plan.windows.length}`);
      const res = await sweepWindow(template, plan.windows[i], plan.z, {
        fieldThreshold, growerSpacingM: params.rowSpacingM, angleHintDeg: angleHint,
        minAreaCm2: params.minBlobCm2, tileOf, coarseDistance, fitRows: fitRowsInSweep,
      });
      if (res.failed) sweep.failed++;
      if (res.canopy) canopyWindows++;
      if (res.fit) sweep.rowWindows++;
      blobs.push(...res.blobs);
      sweep.windows++;
      check();
      await yieldToUi();
    }
    if (sweep.backedOff) notes.push(`The sweep read at ${fmtLengthCm(plan.gsdM * 100, sys).text}/px, ${sweep.backedOff} zoom level(s) above the deepest bake, to stay under ${params.maxSweepWindows} windows. Raise the window limit for the full depth.`);
    if (sweep.failed) notes.push(`${sweep.failed} sweep window(s) failed to load; plants there were not measured.`);
    if (canopyWindows) notes.push(`${canopyWindows} sweep window(s) were one sheet of vegetation and yielded no separate plants.`);
    if (fitRowsInSweep && rows && !rows.usable && sweep.rowWindows) {
      rowsUsed = "fitted";
      notes.push(`${sweep.rowWindows} of ${sweep.windows} sweep windows found rows on their own at full depth.`);
    }
  } else {
    report("blobs");
    try {
      blobs = extractBlobs(mask, raster, { minAreaCm2: params.minBlobCm2, tileOf, idPrefix: "b" });
    } catch (e) {
      if (!(e instanceof TooManyBlobsError)) throw e;
      blobs = [];
      notes.push("The vegetation mask split into too many pieces to be plants; plant-level detection is off for this run.");
    }
    if (params.sweep && plan) notes.push("The base pass already read the imagery at its deepest zoom, so no separate sweep was needed.");
  }
  await yieldToUi();
  check();

  // 5. Rank, learn from the archive, describe. --------------------------------
  report("ranking");
  const ranked = rankCandidates({ blobs, tiles, flags, regions, rows, params, pattern });
  let candidates: Candidate[] = applyFeedback(ranked.candidates, inputs.feedback ?? [], params.rowSpacingM, opts.fieldId ?? null);
  const measuredGsd = sweep.gsdM ?? gsdM;
  candidates = candidates.map(c => ({
    ...c,
    estimate: describe(c, opts.context ?? null, opts.crop ?? "", opts.growthStage ?? null, ranked.plants, params.rowSpacingM, measuredGsd, sys),
  }));
  if (ranked.overflow) notes.push(`${ranked.overflow} further candidate(s) were cut from the queue; raise the thresholds or shrink the field.`);
  if (ranked.headlandExcluded) notes.push(`${ranked.headlandExcluded} plant(s) inside the ${params.headlandM} m headland were not scored.`);
  if (!canopy.closed) {
    if (!ranked.plants && blobs.length) notes.push(`Only ${blobs.length} plants were measurable, too few for a plant population baseline; nothing is scored as a plant outlier.`);
    else if (ranked.plants) notes.push(`Typical plant in this field: ${fmtLengthCm(ranked.plants.typicalDiameterM * 100, sys).text} across, over ${ranked.plants.population.toLocaleString()} plants.`);
  }
  const adjusted = candidates.filter(c => c.feedback && c.feedback.factor !== 1).length;
  if (adjusted) notes.push(`${adjusted} candidate(s) were re-ranked from your past verdicts.`);

  // Chips for the top of the queue, read at the sweep depth. -----------------
  const chipZ = Math.min(plan?.z ?? 20, 21, maxNative);
  const chipCount = Math.min(params.maxChips, candidates.length);
  for (let i = 0; i < chipCount; i++) {
    report("chips", i / chipCount);
    const c = candidates[i];
    try {
      const span = chipSpanM(c, tileM / 2);
      const z = c.region ? Math.max(14, chipZ - Math.round(Math.log2(Math.max(1, span / 6)))) : chipZ;
      const { raster: r } = await fetchRaster(template, boundsAround(c.centroid, span), z, 9);
      const chip = renderChip(r, c.centroid, span);
      if (chip) candidates[i] = { ...c, chip: chip.dataUrl, chipSpanM: chip.spanM, chipGsdM: chip.gsdM };
    } catch {
      // A missing chip is a missing picture, not a missing candidate.
    }
    check();
    if (i % 4 === 3) await yieldToUi();
  }

  // The classifier, on the chips just rendered. Plant spots only: a region is
  // ground and the model was never shown ground. No model means no change.
  const classify = opts.classify ?? (typeof document !== "undefined");
  if (classify && chipCount > 0) {
    report("classifying");
    try {
      const outcome = await classifyCandidates(candidates);
      candidates = outcome.candidates;
      notes.push(outcome.note);
    } catch (e) {
      notes.push(`Classifier skipped: ${(e as Error).message}`);
    }
    check();
  }

  // 6. The source images: which original photos hold each shape. -------------
  // Pure geometry from the camera positions ODM recovered; no pixels are read.
  report("sourcing");
  if (opts.sources !== undefined) {
    const sources = opts.sources;
    candidates = candidates.map((c, i) => {
      if (i % 20 === 19) report("sourcing", i / candidates.length);
      return { ...c, sourceImages: sources?.set ? sourceImagesOf(spotSources(sources, c)) : null };
    });
    notes.push(sourceImagesNote(candidates, sources));
    check();
  }

  report("done");
  return {
    tileM, rowsUsed, canopyClosed: canopy.closed,
    tiles, samples, scores, flags, regions, rows, pattern, candidates,
    gsdM, sweep, missingTiles,
    baselineTiles: baseline?.tiles ?? 0,
    blobCount: blobs.length,
    smallestMeasurableM: 3 * measuredGsd,
    notes,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

export type { AnalysisTile };
