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
import type { GroundPlant } from "../frames";
import { isMapRunKey } from "../mapRun";
import { type RunStage1Input, getTwoStage, runStage1, twoStagePlants } from "../twoStage/twoStageStore";
import { type CropGroup, type PressureGrade, cropGroupOf, gradePressure } from "./grade";

export type PressureSession = {
  grade: PressureGrade | null;
  state: "idle" | "reading" | "done" | "none";
  error: string | null;
  show: boolean;
  selectedCell: string | null;
  /** The plants the grade was made from, for the panel's "from the map" or "from the photographs" line. */
  source: "map" | "photos" | "windows" | null;
};
const EMPTY: PressureSession = { grade: null, state: "idle", error: null, show: true, selectedCell: null, source: null };
const sessions = new Map<string, PressureSession>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getPressure = (taskId: string): PressureSession => sessions.get(taskId) ?? EMPTY;
export function patchPressure(taskId: string, p: Partial<PressureSession>): void { sessions.set(taskId, { ...getPressure(taskId), ...p }); for (const l of listeners) l(); }
export function usePressure(taskId: string): PressureSession { return useSyncExternalStore(subscribe, () => getPressure(taskId), () => getPressure(taskId)); }
export function resetPressureStore(): void { sessions.clear(); for (const l of listeners) l(); }

/** The plants to grade and where they came from: the frame run first, the two-stage windows when only those ran. */
export function pressurePlants(taskId: string): { plants: GroundPlant[]; source: PressureSession["source"]; photoBased: boolean } {
  const run = getFrameRun(taskId);
  if (run.plants.length) {
    const map = !!run.paramsKey && isMapRunKey(run.paramsKey);
    return { plants: run.plants, source: map ? "map" : "photos", photoBased: !map };
  }
  const ts = getTwoStage(taskId);
  const plants = twoStagePlants(ts);
  return { plants, source: plants.length ? "windows" : null, photoBased: false };
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
export async function gradeField(taskId: string, input: { crop: string | null; group?: CropGroup; stage1: RunStage1Input }): Promise<void> {
  const cur = getPressure(taskId);
  if (cur.state === "reading") return;
  patchPressure(taskId, { state: "reading", error: null });
  try {
    let ts = getTwoStage(taskId);
    if (!ts.stage1) {
      await runStage1(taskId, input.stage1);
      ts = getTwoStage(taskId);
    }
    if (!ts.stage1) { patchPressure(taskId, { state: "none", error: ts.error ?? "The field could not be read into cells." }); return; }
    const { plants, source, photoBased } = pressurePlants(taskId);
    const rows = frameRunFieldRows(taskId);
    const grade = gradePressure({ plants, grid: ts.stage1.grid, cells: ts.stage1.cells, rows, crop: input.crop, group: input.group ?? cropGroupOf(input.crop, rows?.source === "layout"), canopyClosed: canopyClosedOf(ts.stage1.cells), photoBased });
    patchPressure(taskId, { grade, state: "done", source, error: plants.length ? null : "No weeds have been found on this scan yet: run Find weeds first. The grid is graded as empty." });
  } catch (e) {
    patchPressure(taskId, { state: "none", error: (e as Error)?.message ?? String(e) });
  }
}

export function selectPressureCell(taskId: string, key: string | null): void { patchPressure(taskId, { selectedCell: key }); }
export function showPressure(taskId: string, show: boolean): void { patchPressure(taskId, { show }); }
