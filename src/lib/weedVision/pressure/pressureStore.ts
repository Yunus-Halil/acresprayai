// The weed-pressure grade per scan, kept outside the tab like the model run: Stage 1's cell grid over the field
// (seconds, from the map) plus the plants "Find weeds" put between the rows, graded by pressure/grade.ts.
//
// The plants come from the scan's frame run (the map run where the map is sharp enough, else the photographs),
// and from the two-stage windows when those are what ran. The crop group comes from the field's crop, or from the
// planting layout when the crop is not on file. Whether the canopy is closed is read off Stage 1 (the mean green
// share of the assessed cells against the pattern pass's CANOPY_CLOSED).
import { useSyncExternalStore } from "react";
import { CANOPY_CLOSED } from "../../photoScout/pattern";
import { frameRunFieldRows, getFrameRun } from "../frameRunStore";
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

/**
 * Grade the field: Stage 1 read if it has not been, then the plants between the rows graded on its grid.
 * `crop` is the field's crop on file (null when none); `group` overrides the crop group when the operator says so.
 */
export async function gradeField(taskId: string, input: { crop: string | null; group?: CropGroup; stage1: RunStage1Input; /** The scan's spots kept as weeds, with the operator's verdicts applied. */ scanWeeds?: WeedObject[] }): Promise<void> {
  const cur = getPressure(taskId);
  if (cur.state === "reading") return;
  patchPressure(taskId, { state: "reading", error: null });
  try {
    let ts = getTwoStage(taskId);
    const cellOf = (g: { cellPx: number; mpp: number }) => g.cellPx * g.mpp;
    if (!ts.stage1 || Math.abs(cellOf(ts.stage1.grid) - PRESSURE_CELL_M) > 0.25 * PRESSURE_CELL_M) {
      await runStage1(taskId, { ...input.stage1, stage1Params: { ...(input.stage1.stage1Params ?? {}), cellM: PRESSURE_CELL_M } });
      ts = getTwoStage(taskId);
      // Stage 1 was read for the grade, not for the prototype: its own layers (cells, candidates, windows) stay off the map.
      if (ts.stage1) patchTwoStage(taskId, { layers: { pressure: false, candidates: false, windows: false, weeds: false } });
    }
    if (!ts.stage1) { patchPressure(taskId, { state: "none", error: ts.error ?? "The field could not be read into cells." }); return; }
    const { objects, source, photoBased } = pressureObjects(taskId, input.scanWeeds ?? []);
    const rows = frameRunFieldRows(taskId);
    const grade = gradePressure({ objects, grid: ts.stage1.grid, cells: ts.stage1.cells, rows, crop: input.crop, group: input.group ?? cropGroupOf(input.crop, rows?.source === "layout"), canopyClosed: canopyClosedOf(ts.stage1.cells), photoBased });
    patchPressure(taskId, { grade, state: "done", source, error: objects.length ? null : "Nothing to grade yet: this scan has no weeds on it. Scan the field, or run Find weeds, and grade again." });
  } catch (e) {
    patchPressure(taskId, { state: "none", error: (e as Error)?.message ?? String(e) });
  }
}

export function selectPressureCell(taskId: string, key: string | null): void { patchPressure(taskId, { selectedCell: key }); }
export function showPressure(taskId: string, show: boolean): void { patchPressure(taskId, { show }); }
