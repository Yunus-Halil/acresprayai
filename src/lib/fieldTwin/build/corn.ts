// The corn stage of a Field Twin build: Corn V1 (src/lib/rowCrop/cornV1.ts) on every placed photograph at its full
// size, then the field combination (src/lib/fieldTwin/cornField.ts) through the cameras the build has just aligned.
// Each photograph is read exactly as Photo Scout reads it, with the pixel size the aligned camera gives instead of an
// assumed one. A build can be asked for the shipped corn-v1.0 result instead (BuildOptions.cornVariant), to compare.
//
// Cost: a full-size decode and 3-7 s of reading per 20 MP photograph. With helper workers the photographs are read
// in parallel, at most CORN_STAGE.maxParallel at once: each read holds the photograph (84 MB) and its masks, so the
// cap bounds the build's memory, not the cores.
import { readCornV1 } from "../../rowCrop/cornV1";
import { rowCropParamsFor } from "../../rowCrop/params";
import { cropProfileFor } from "../../cropProfiles/registry";
import { groundSampleAt, type GeorefFrame } from "../../directGeoref/projection";
import type { PhotoPixels } from "../../photoScout/pattern";
import { FIELD, FIELD_V2, compactCornRead, cornFieldAndGround, cornFlightGuard, type CornFieldResult, type CornPhotoRead } from "../cornField";
import { type CornPlants, cornPlantsOf, placeDots, plantSightings, readRows } from "../cornPlants";
import type { CornPlantsOptions, PlacedDots } from "../layers/l3Place";
import type { Reconstruction } from "../plantsFirst";
import { type CornPreset, cornPresetSettings } from "../cornPreset";
import { type PhotoColours, samplePhotoColours } from "../cornColours";
import { type PackedLooks, type PhotoLooks, measureMarkLooks, packLooks, plantLooks } from "../cornPlantLook";
import type { Pool } from "./pool";
import { type BuildHooks, type CornVariant, type PhotoSource, checkCancelled } from "./types";

export const CORN_STAGE = {
  /** Photographs read at once with helper workers (each holds a full-size photograph), unless the build is given its
   * own number (concurrency.ts: fewer on a tablet or a device with little memory). */
  maxParallel: 3,
};

/**
 * Corn V1 on one photograph, compacted for the field (also the pool task's body). `preset` (cornPreset.ts): the app
 * always names one ("today" unless the founder's flag is on); null, the scripts' way, reads with the code's defaults
 * and the module-wide switches (CORN_CORES, CORN_COUNT_GUARD) as a process has set them.
 */
export function cornPhotoRead(name: string, px: PhotoPixels, gsdM: number | null, baselineSeedlings = false, coresSizePx: number | "self" | null = null, preset: CornPreset | null = null): CornPhotoRead {
  const params = rowCropParamsFor(cropProfileFor("corn")!, gsdM);
  // The comparison read (corn-v1.0's mask) is the same under every preset.
  if (baselineSeedlings) return compactCornRead(name, readCornV1(px, params, { enteredCrop: "corn", baselineSeedlings }), 1);
  if (preset) { const S = cornPresetSettings(preset); return compactCornRead(name, readCornV1(px, params, { enteredCrop: "corn", ...S.read }), 1, S.keepLook); }
  // rowSpans: a candidate for the rows carries its extent along them, and the field splits the long ones at the plant
  // spacing it measured (cornPlants.ts candidatePoints) instead of the one a single photograph assumes.
  const v = readCornV1(px, params, { enteredCrop: "corn", baselineSeedlings, rowSpans: !baselineSeedlings, ...(coresSizePx != null ? { coresSizePx } : {}) });
  return compactCornRead(name, v, 1);
}

export type CornStageResult = {
  /** The comparison variant the stage ran as (undefined: the present reader and field rules). */
  variant?: CornVariant;
  field: CornFieldResult;
  /** The plants first, and the rows through them (cornPlants.ts): the twin's rows when present; null when the plants
   * made no certain row (the twin keeps the field's rows) or on a comparison build. */
  plants?: CornPlants | null;
  reads: CornPhotoRead[];
  /** Each read photograph's soil and corn colours, by name (cornColours.ts): for the twin's Realistic view, read after
   * the corn read from the same decoded pixels. `colourMs`: what sampling them cost over the whole flight. */
  colours: { name: string; colours: PhotoColours }[]; colourMs: number;
  /** Each plant's own look, in the plants' order (cornPlantLook.ts): which way its leaves lie, its length, its green,
   * from the photographs that marked it; null with no plants. And what measuring it cost over the flight. */
  plantLook: PackedLooks | null; lookMs: number;
  /** Read only: for each plant, in the plants' order, the marks it was made from (cornPlants.ts plantSightings); null with no plants. */
  plantMarks: { photo: string; u: number; v: number; k: number }[][] | null;
  failed: { name: string; reason: string }[];
  /** Photographs whose read holds any row. */
  withRows: number;
  msPerPhoto: number;
  ms: number;
};

/** Read every photograph with a camera, then combine them over the field. */
export async function cornStage(photos: PhotoSource[], frames: Map<string, GeorefFrame>, hooks: BuildHooks = {}, pool: Pool | null = null, files?: Map<string, Blob>, variant?: CornVariant, maxParallel: number = CORN_STAGE.maxParallel, preset: CornPreset | null = null): Promise<CornStageResult> {
  const t0 = Date.now(), baseline = variant === "corn-v1.0";
  const list = photos.filter(p => frames.has(p.name));
  const reads: CornPhotoRead[] = [], failed: { name: string; reason: string }[] = [], colours: { name: string; colours: PhotoColours }[] = [];
  let done = 0, readMs = 0, colourMs = 0, lookMs = 0;
  const looks = new Map<string, PhotoLooks>(), NO_LOW = new Uint8Array(0);
  const gsdOf = (name: string) => { const f = frames.get(name)!; return groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy); };
  const report = (name: string) => hooks.onProgress?.({ stage: "corn", done, total: list.length, message: `${name}: read by Corn V1`, elapsedMs: Date.now() - t0 });
  const one = async (p: PhotoSource): Promise<void> => {
    checkCancelled(hooks.signal);
    try {
      const file = files?.get(p.name);
      if (pool && pool.size > 1 && file) {
        const r = await pool.run({ kind: "corn", name: p.name, file, gsdM: gsdOf(p.name), baseline, preset });
        if (r.kind !== "corn") throw new Error("the helper answered another task");
        reads.push(r.read); readMs += r.ms;
        colours.push({ name: p.name, colours: r.colours }); colourMs += r.colourMs;
        if (r.looks) looks.set(p.name, { plants: r.looks, low: NO_LOW }); lookMs += r.lookMs;
      } else {
        const t = Date.now();
        const px = await p.decode(1);
        const read = cornPhotoRead(p.name, px, gsdOf(p.name), baseline, null, preset);
        reads.push(read); readMs += Date.now() - t;
        const tc = performance.now(); colours.push({ name: p.name, colours: samplePhotoColours(px, read.plants) }); colourMs += performance.now() - tc;
        const g = gsdOf(p.name), tl = performance.now(); if (g) looks.set(p.name, { plants: measureMarkLooks(px, read.plants, g * read.scale), low: NO_LOW }); lookMs += performance.now() - tl;
      }
      const last = reads[reads.length - 1];
      hooks.log?.(`${p.name}: ${last.rows.filter(r => r.identity === "corn").length} corn rows, ${last.rows.length} rows, ${last.patches.filter(q => q.verdict === "weed candidate").length} weed candidates, ${last.gaps.filter(g => g.verdict === "stand gap").length} gaps${last.countWithheld ? "; plant count withheld (too late for a per-plant count)" : ""}`);
    } catch (e) {
      if ((e as Error)?.name === "BuildCancelled" || hooks.signal?.aborted) throw e;
      failed.push({ name: p.name, reason: (e as Error)?.message ?? String(e) });
    }
    done++; report(p.name);
  };
  report("starting");
  const parallel = pool && pool.size > 1 && files ? Math.max(1, Math.min(maxParallel, pool.size)) : 1;
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => { while (next < list.length) { const p = list[next++]; await one(p); } }));
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "corn", done: list.length, total: list.length, message: "combining the photographs over the field", elapsedMs: Date.now() - t0 });
  // Reads arrive in completion order; the field does not depend on it, the report and the twin should not either.
  reads.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  failed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  colours.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  hooks.log?.(`soil and corn colours: ${colours.filter(c => c.colours.soil).length} photographs with a soil colour, ${colours.filter(c => c.colours.corn).length} with a corn colour, ${colourMs.toFixed(0)} ms in all`);
  const C = cornCombine(reads, frames, preset, variant, hooks.log, () => hooks.onProgress?.({ stage: "corn", done: list.length, total: list.length, message: "placing the plants, then the rows through them", elapsedMs: Date.now() - t0 }));
  if (C.reads !== reads) { reads.length = 0; reads.push(...C.reads); }
  // Each plant's own look, from the marks it was made of. Nothing above reads it; a failure leaves the plants as they are.
  let plantLook: PackedLooks | null = null, plantMarks: CornStageResult["plantMarks"] = null;
  if (C.plants && C.placed && C.rows) {
    try {
      const tl = performance.now();
      plantMarks = plantSightings(C.placed, C.rows);
      if (plantMarks.length !== C.plants.points.length) throw new Error("the plants and their marks differ in number");
      const L = plantLooks(plantMarks, looks, new Map(reads.map(r => [r.name, r])), frames, C.field.origin);
      plantLook = packLooks(L); lookMs += performance.now() - tl;
      hooks.log?.(`each plant's own look: ${L.filter(p => p.dirDeg != null).length} of ${L.length} plants with a leaf direction, ${L.filter(p => p.sizeM != null).length} with a size and a colour, ${lookMs.toFixed(0)} ms in all`);
    } catch (e) { plantLook = null; plantMarks = null; hooks.log?.(`each plant's own look: not made (${(e as Error)?.message ?? e})`); }
  }
  return { variant, field: C.field, plants: C.plants, plantLook, plantMarks, lookMs: Math.round(lookMs), reads, colours, colourMs: Math.round(colourMs), failed, withRows: reads.filter(r => r.rows.length).length, msPerPhoto: reads.length ? Math.round(readMs / reads.length) : 0, ms: Date.now() - t0 };
}

/**
 * The photographs' reads combined over the field, as the corn stage combines them (also for the scripts, which must
 * run exactly what a build runs): the guard over the flight (when the preset asks for it, or with no preset), the field
 * and its ground, then the plants first with the preset's rules. `placed` and `rows` are the plants' dots and their
 * reading (null where no dot was made, or on a comparison variant).
 */
export function cornCombine(readsIn: CornPhotoRead[], frames: Map<string, GeorefFrame>, preset: CornPreset | null, variant?: CornVariant, log?: (line: string) => void, beforePlants?: () => void) {
  // The emergence guard over the flight (cornField.ts cornFlightGuard): a photograph that misread its row spacing gives no plants.
  // A named preset says whether it runs ("today": no; reads without the guard pass it unchanged anyway).
  const S = preset ? cornPresetSettings(preset) : null;
  let reads = readsIn;
  if (!S || S.flightGuard) {
    const guarded = cornFlightGuard(reads);
    for (const w of guarded.withheld) log?.(`${w.name}: plant count withheld (${w.reason})`);
    reads = guarded.reads;
  }
  const { field, ground } = cornFieldAndGround(reads, frames, variant ? FIELD_V2 : FIELD);
  log?.(`corn over the field: ${field.summary.cornRows} corn rows, ${field.summary.probableRows} unconfirmed, ${field.summary.weeds} confirmed weed candidates, ${field.summary.gaps} stand gaps; rows agree within ${field.rowAgreementM != null ? (field.rowAgreementM * 100).toFixed(1) : "?"} cm`);
  for (const n of field.notes.slice(0, -1)) log?.(`  ${n}`);
  let plants: CornPlants | null = null, placed: PlacedDots | null = null, rows: Reconstruction | null = null;
  if (!variant) {
    beforePlants?.();
    const tp = Date.now(), opts: CornPlantsOptions = S ? { ...S.plants, ground: S.ground ? ground : null } : { ground };
    // cornPlantsFirst's three steps, kept apart so a script can measure the dots (cornPlants.ts cornPlantsFirst).
    try { placed = placeDots(reads, frames, field, opts); rows = placed ? readRows(placed, field, opts) : null; plants = placed && rows ? cornPlantsOf(placed, rows, field, opts) : null; }
    catch (e) { log?.(`plants first failed (${(e as Error)?.message ?? e}): the field's rows are kept`); plants = null; }
    const T = placed?.together;
    if (T) log?.(`photographs aligned together by their plants: ${T.applied ? "kept" : `not kept (${T.why})`}; marks another photograph agrees with within 2 cm ${T.matched[0]} to ${T.matched[1]} of ${T.marks}; squares of ground over the merge gate ${T.overGate[0]} of ${T.squares[0]} to ${T.overGate[1]} of ${T.squares[1]}; pairs of photographs with their plants on each other ${T.pairsOn} of ${T.pairs}; a mark moved a median ${(T.movedMedianM * 100).toFixed(1)} cm, ${(T.movedMostM * 100).toFixed(1)} cm at most (${(T.ms / 1000).toFixed(1)} s)`);
    if (plants) log?.(`plants first: ${plants.summary.plants} plants (${plants.summary.certain} certain, ${plants.summary.probable} probable on a row), ${plants.summary.rows} rows, ${Math.round(plants.summary.confirmedM)} m with plants seen, ${Math.round(plants.summary.notConfirmedM)} m not confirmed (${((Date.now() - tp) / 1000).toFixed(1)} s)`);
    else log?.("plants first: no certain row from the plants, the field's rows are kept");
  }
  return { reads, field, ground, plants, placed, rows };
}
