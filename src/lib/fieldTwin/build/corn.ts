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
import { FIELD, FIELD_V2, compactCornRead, cornField, type CornFieldResult, type CornPhotoRead } from "../cornField";
import type { Pool } from "./pool";
import { type BuildHooks, type CornVariant, type PhotoSource, checkCancelled } from "./types";

export const CORN_STAGE = {
  /** Photographs read at once with helper workers (each holds a full-size photograph). */
  maxParallel: 3,
};

/** Corn V1 on one photograph, compacted for the field (also the pool task's body). */
export function cornPhotoRead(name: string, px: PhotoPixels, gsdM: number | null, baselineSeedlings = false): CornPhotoRead {
  const v = readCornV1(px, rowCropParamsFor(cropProfileFor("corn")!, gsdM), { enteredCrop: "corn", baselineSeedlings });
  return compactCornRead(name, v, 1);
}

export type CornStageResult = {
  /** The comparison variant the stage ran as (undefined: the present reader and field rules). */
  variant?: CornVariant;
  field: CornFieldResult;
  reads: CornPhotoRead[];
  failed: { name: string; reason: string }[];
  /** Photographs whose read holds any row. */
  withRows: number;
  msPerPhoto: number;
  ms: number;
};

/** Read every photograph with a camera, then combine them over the field. */
export async function cornStage(photos: PhotoSource[], frames: Map<string, GeorefFrame>, hooks: BuildHooks = {}, pool: Pool | null = null, files?: Map<string, Blob>, variant?: CornVariant): Promise<CornStageResult> {
  const t0 = Date.now(), baseline = variant === "corn-v1.0";
  const list = photos.filter(p => frames.has(p.name));
  const reads: CornPhotoRead[] = [], failed: { name: string; reason: string }[] = [];
  let done = 0, readMs = 0;
  const gsdOf = (name: string) => { const f = frames.get(name)!; return groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy); };
  const report = (name: string) => hooks.onProgress?.({ stage: "corn", done, total: list.length, message: `${name}: read by Corn V1`, elapsedMs: Date.now() - t0 });
  const one = async (p: PhotoSource): Promise<void> => {
    checkCancelled(hooks.signal);
    try {
      const file = files?.get(p.name);
      if (pool && pool.size > 1 && file) {
        const r = await pool.run({ kind: "corn", name: p.name, file, gsdM: gsdOf(p.name), baseline });
        if (r.kind !== "corn") throw new Error("the helper answered another task");
        reads.push(r.read); readMs += r.ms;
      } else {
        const t = Date.now();
        const px = await p.decode(1);
        reads.push(cornPhotoRead(p.name, px, gsdOf(p.name), baseline)); readMs += Date.now() - t;
      }
      const last = reads[reads.length - 1];
      hooks.log?.(`${p.name}: ${last.rows.filter(r => r.identity === "corn").length} corn rows, ${last.rows.length} rows, ${last.patches.filter(q => q.verdict === "weed candidate").length} weed candidates, ${last.gaps.filter(g => g.verdict === "stand gap").length} gaps`);
    } catch (e) {
      if ((e as Error)?.name === "BuildCancelled" || hooks.signal?.aborted) throw e;
      failed.push({ name: p.name, reason: (e as Error)?.message ?? String(e) });
    }
    done++; report(p.name);
  };
  report("starting");
  const parallel = pool && pool.size > 1 && files ? Math.max(1, Math.min(CORN_STAGE.maxParallel, pool.size)) : 1;
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => { while (next < list.length) { const p = list[next++]; await one(p); } }));
  checkCancelled(hooks.signal);
  hooks.onProgress?.({ stage: "corn", done: list.length, total: list.length, message: "combining the photographs over the field", elapsedMs: Date.now() - t0 });
  // Reads arrive in completion order; the field does not depend on it, the report and the twin should not either.
  reads.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const field = cornField(reads, frames, variant ? FIELD_V2 : FIELD);
  hooks.log?.(`corn over the field: ${field.summary.cornRows} corn rows, ${field.summary.probableRows} unconfirmed, ${field.summary.weeds} confirmed weed candidates, ${field.summary.gaps} stand gaps; rows agree within ${field.rowAgreementM != null ? (field.rowAgreementM * 100).toFixed(1) : "?"} cm`);
  for (const n of field.notes.slice(0, -1)) hooks.log?.(`  ${n}`);
  return { variant, field, reads, failed, withRows: reads.filter(r => r.rows.length).length, msPerPhoto: reads.length ? Math.round(readMs / reads.length) : 0, ms: Date.now() - t0 };
}
