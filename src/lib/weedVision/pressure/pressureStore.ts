// The weed-pressure grade per scan, kept outside the tab like the model run: Stage 1's cell grid over the field
// (seconds, from the map) plus the plants "Find weeds" put between the rows, graded by pressure/grade.ts.
//
// The plants come from the scan's frame run (the map run where the map is sharp enough, else the photographs),
// and from the two-stage windows when those are what ran. The crop group comes from the field's crop, or from the
// planting layout when the crop is not on file. Whether the canopy is closed is read off Stage 1 (the mean green
// share of the assessed cells against the pattern pass's CANOPY_CLOSED). A row crop on file (wide-row or cereal)
// without a fitted planting layout is not graded at all: the row reader cannot read its rows (fieldRows.ts,
// ROW_CROP_GRADING_UNSUPPORTED). Nor is a field with no crop on file and no layout: the group is never guessed.
import { useSyncExternalStore } from "react";
import { CANOPY_CLOSED } from "../../photoScout/pattern";
import { estimateStage, stageOutside } from "../../cropProfiles/checks";
import { cropProfileFor } from "../../cropProfiles/registry";
import { ROW_CROP_GRADING_UNSUPPORTED, rowCropGradingBlocked } from "../fieldRows";
import { ensureFieldRows, frameRunBoundaryOf, frameRunFieldRows, frameRunMapOf, getFrameRun } from "../frameRunStore";
import { fieldReadPlan } from "../fieldRows";
import { isMapRunKey } from "../mapRun";
import { type RunStage1Input, getTwoStage, patchTwoStage, runStage1, twoStagePlants } from "../twoStage/twoStageStore";
import { type CropGroup, type PressureGrade, type WeedObject, cropGroupOf, gradePressure, weedObjectsOf } from "./grade";

/**
 * The grade's cell, metres: the finest grid of the UAV weed-map studies (0.5 m; Peña 2013, Lopez-Granados 2016),
 * half the 1 x 1 m spot-spray box (Allmendinger 2024) and a quarter of the 2 m boom-section cell the two-stage
 * prototype reads at. The operator: "the tiles are way too broad" (2026-10-21), then "make the tiles smaller for
 * more accuracy, it's already very fast". At the map's 4 to 6 cm read a cell is about 100 pixels, so cover is read
 * to the percent and the patches follow their own edges, not the grid's.
 */
export const PRESSURE_CELL_M = 0.5;

export type PressureSession = {
  grade: PressureGrade | null;
  state: "idle" | "reading" | "done" | "none";
  error: string | null;
  show: boolean;
  selectedCell: string | null;
  /** What the grade was made from, for the panel's line: the model on the map or the photographs, the scan's kept spots, or the two-stage windows. */
  source: "map" | "photos" | "scan" | "windows" | null;
};
const EMPTY: PressureSession = { grade: null, state: "idle", error: null, show: true, selectedCell: null, source: null };
const sessions = new Map<string, PressureSession>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getPressure = (taskId: string): PressureSession => sessions.get(taskId) ?? EMPTY;
export function patchPressure(taskId: string, p: Partial<PressureSession>): void { sessions.set(taskId, { ...getPressure(taskId), ...p }); for (const l of listeners) l(); }
export function usePressure(taskId: string): PressureSession { return useSyncExternalStore(subscribe, () => getPressure(taskId), () => getPressure(taskId)); }
export function resetPressureStore(): void { sessions.clear(); for (const l of listeners) l(); }

/**
 * The weeds to grade and where they came from: the model's plants from Find weeds when it ran; else the scan's spots
 * kept as weeds (Scan this field, with the operator's verdicts applied by the caller); else the two-stage windows.
 */
export function pressureObjects(taskId: string, scanWeeds: WeedObject[] = []): { objects: WeedObject[]; source: PressureSession["source"]; photoBased: boolean } {
  const run = getFrameRun(taskId);
  if (run.plants.length) {
    const map = !!run.paramsKey && isMapRunKey(run.paramsKey);
    return { objects: weedObjectsOf(run.plants), source: map ? "map" : "photos", photoBased: !map };
  }
  if (scanWeeds.length) return { objects: scanWeeds, source: "scan", photoBased: false };
  const ts = getTwoStage(taskId);
  const plants = twoStagePlants(ts);
  return { objects: weedObjectsOf(plants), source: plants.length ? "windows" : null, photoBased: false };
}

/** Whether the canopy reads as closed on the field: the mean green share of Stage 1's assessed cells. Null without cells. */
export function canopyClosedOf(cells: { greenShare: number; uncertain: unknown[] }[]): boolean | null {
  const ok = cells.filter(c => !c.uncertain.length);
  if (!ok.length) return null;
  return ok.reduce((a, c) => a + c.greenShare, 0) / ok.length >= CANOPY_CLOSED;
}

/** No crop on file and no planting layout: the grade does not guess the crop group (it used to fall back to wide-row). */
export const NO_CROP_ON_FILE = "Set the field's crop before grading: the thresholds and the row reader depend on it.";

/**
 * The grade refused before it starts, or null: no crop on file without a fitted planting layout (a layout is the
 * operator's own word that this is a planting of trees or vines, so it grades as an orchard), or a row crop on file
 * whose rows are not a fitted planting layout.
 */
export function pressureRefusal(crop: string | null, rows: Parameters<typeof rowCropGradingBlocked>[1], ctx: { plantingDate?: string | null; on?: Date; rowsConfirmed?: boolean } = {}): string | null {
  if (!crop?.trim()) return rows?.source === "layout" ? null : NO_CROP_ON_FILE;
  // A crop with a profile: the profile says whether the grade applies at this stage and on rows read automatically.
  const profile = cropProfileFor(crop);
  if (profile) {
    const cap = profile.capabilities["weed-pressure-grade"];
    if (ctx.plantingDate && cap?.stages) {
      const est = estimateStage(profile, ctx.plantingDate, ctx.on ?? new Date());
      if (est.status === "estimated" && stageOutside(profile, est, cap.stages) === "after") {
        return `${profile.policies.UNSUPPORTED_STAGE?.message ?? "Past the stage this grade applies to."} ${est.note}`;
      }
    }
    const Name = `${profile.name[0].toUpperCase()}${profile.name.slice(1)}`;
    if (rows?.source === "layout") return null;
    if (cap?.status === "unsupported") return `${Name} is not graded on rows read automatically yet: ${cap.reason}`;
    if (profile.rowReader.strategy === "continuous-row") {
      if (rows?.source !== "pattern") return `${Name} rows have not been read from the map yet. Open Crop rows and read them, check them on the map, and grade again.`;
      if (!ctx.rowsConfirmed) return `Confirm the ${profile.name} rows first: open Crop rows, turn on "show on map", and say whether the lines sit on the ${profile.name}. A wrong row spacing makes a wrong grade.`;
    }
    return null;
  }
  return rowCropGradingBlocked(cropGroupOf(crop, false), rows) ? ROW_CROP_GRADING_UNSUPPORTED : null;
}

/**
 * Grade the field: Stage 1 read if it has not been, then the plants between the rows graded on its grid.
 * `crop` is the field's crop on file (null when none); `group` overrides the crop group when the operator says so,
 * but never the row-crop guard, which goes by the crop on file.
 */
export async function gradeField(taskId: string, input: { crop: string | null; group?: CropGroup; stage1: RunStage1Input; /** The scan's spots kept as weeds, with the operator's verdicts applied. */ scanWeeds?: WeedObject[]; /** The field's planting date (YYYY-MM-DD), for the crop profile's stage window. */ plantingDate?: string | null }): Promise<void> {
  const cur = getPressure(taskId);
  if (cur.state === "reading") return;
  patchPressure(taskId, { state: "reading", error: null });
  try {
    // The rows first (the saved layout may still be loading): a row crop on reader rows is refused before anything is read.
    await (input.stage1.deps?.ensureRows ?? ensureFieldRows)(taskId);
    const refusal = pressureRefusal(input.crop, (input.stage1.deps?.rowsOf ?? frameRunFieldRows)(taskId), { plantingDate: input.plantingDate, rowsConfirmed: getFrameRun(taskId).fieldRowsConfirmed });
    if (refusal) { patchPressure(taskId, { grade: null, state: "none", source: null, error: refusal }); return; }
    // A crop profile reads the map at its own pixel (corn: 3 cm, what cover between 76 cm rows needs), and refuses a map
    // coarser than that rather than grade it.
    const profile = cropProfileFor(input.crop);
    const maxGsdCm = profile?.capabilities["weed-pressure-grade"]?.maxGsdCm;
    const map = frameRunMapOf(taskId);
    if (profile && maxGsdCm && map) {
      const plan = fieldReadPlan(frameRunBoundaryOf(taskId) ?? [], map.maxNative, map.lat, maxGsdCm / 100);
      if (plan && plan.mpp * 100 > maxGsdCm * 1.25) {
        patchPressure(taskId, { grade: null, state: "none", source: null, error: `${profile.policies.INSUFFICIENT_RESOLUTION?.message ?? "The map is too coarse."} This map is about ${(plan.mpp * 100).toFixed(1)} cm a pixel; ${profile.name} needs ${maxGsdCm} cm or finer for cover between the rows.` });
        return;
      }
    }
    // Stage 1 is read fresh for every grade: it takes seconds, and a kept read can carry rows the field no longer
    // has (the first grade of 2026-10-22 ran on the automatic rows while the saved layout was still loading, and
    // "Grade again" kept that read).
    await runStage1(taskId, { ...input.stage1, stage1Params: { ...(input.stage1.stage1Params ?? {}), cellM: PRESSURE_CELL_M, ...(maxGsdCm ? { readMpp: maxGsdCm / 100 } : {}) } });
    const ts = getTwoStage(taskId);
    // Stage 1 was read for the grade, not for the prototype: its own layers (cells, candidates, windows) stay off the map.
    if (ts.stage1) patchTwoStage(taskId, { layers: { pressure: false, candidates: false, windows: false, weeds: false } });
    if (!ts.stage1) { patchPressure(taskId, { state: "none", error: ts.error ?? "The field could not be read into cells." }); return; }
    const { objects, source, photoBased } = pressureObjects(taskId, input.scanWeeds ?? []);
    const rows = frameRunFieldRows(taskId);
    const grade = gradePressure({ objects, grid: ts.stage1.grid, cells: ts.stage1.cells, rows, crop: input.crop, group: input.group ?? cropGroupOf(input.crop, rows?.source === "layout"), canopyClosed: canopyClosedOf(ts.stage1.cells), photoBased });
    const noRows = grade.summary.assessed === 0 && grade.summary.cells > 0 && (grade.summary.whyNot["no rows"] ?? 0) >= 0.9 * grade.summary.cells;
    const error = noRows
      ? (rows?.source === "layout"
        ? "The planting's rows reach none of the cells. Open Crop rows, read the rows again, and grade again."
        : "The rows read automatically reach none of the cells (the read found no rows, or rows in one block only). Mark the planting under Crop rows and grade again.")
      : null;
    patchPressure(taskId, { grade, state: "done", source, error });
  } catch (e) {
    patchPressure(taskId, { state: "none", error: (e as Error)?.message ?? String(e) });
  }
}

export function selectPressureCell(taskId: string, key: string | null): void { patchPressure(taskId, { selectedCell: key }); }
export function showPressure(taskId: string, show: boolean): void { patchPressure(taskId, { show }); }
