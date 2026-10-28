// The whole build, photographs in, twin out: the stages in order with their timings, a progress line for the
// operator, and the report the page shows. Runs wherever the two abstractions (PhotoSource, Codec) are provided:
// a browser worker (worker.ts) or Node (scripts/directGeoref/buildTwinApp.ts).
import { parseTwin, type TwinBundle } from "../types";
import { type AtlasFile, assembleBundle, evidenceAndBoundary } from "./bundle";
import { alignCameras } from "./cameras";
import { readPhotographs } from "./photos";
import { rowsAndTrees } from "./rows";
import { type BuildHooks, type BuildOptions, type BuildStage, type Codec, type PhotoSource, type StageTimings, checkCancelled } from "./types";
import { findWeeds } from "./weeds";

export type BuildReport = {
  photographs: { given: number; read: number; refused: { name: string; reason: string }[]; previews: number };
  cameras: Record<string, unknown>;
  rows: Record<string, unknown> | null;
  weeds: { detections: number; photographsRun: number; failed: { name: string; reason: string }[]; stats: Record<string, unknown> };
  boundary: { areaM2: number; uncertaintyM2: number; supportPhotographs: number; failures: string[] } | null;
  crops: number;
  timings: StageTimings;
  totalMs: number;
  notes: string[];
};

export type BuildOutput = {
  twin: TwinBundle;
  /** twin.json (bytes) and, with `atlases: "now"`, every atlas; with "later" the atlases arrive from `cutAtlases`. */
  files: Map<string, Blob | Uint8Array>;
  report: BuildReport;
  /** With `atlases: "later"`: cuts the atlases after the twin has opened, one file at a time. */
  cutAtlases: (() => AsyncGenerator<AtlasFile>) | null;
};

/** Build a Field Twin from photographs. Throws BuildCancelled on cancel, an Error with the reason when nothing can be built. */
export async function buildFieldTwin(photos: PhotoSource[], options: BuildOptions, codec: Codec, hooks: BuildHooks = {}): Promise<BuildOutput> {
  const T0 = Date.now();
  const down = options.down ?? 4;
  const timings: StageTimings = {};
  const notes: string[] = [];
  const timed = async <T>(stage: BuildStage, fn: () => Promise<T>): Promise<T> => { const t = Date.now(); const v = await fn(); timings[stage] = Date.now() - t; return v; };
  if (!photos.length) throw new Error("no photographs");

  const usePreview = options.usePreview ?? true;
  const { reads, refused } = await timed("photographs", () => readPhotographs(photos, down, hooks, usePreview));
  for (const r of refused) notes.push(`${r.name} left out: ${r.reason}`);
  if (reads.length < 2) throw new Error(reads.length ? "only one photograph holds a camera: a twin needs overlapping photographs" : `no photograph holds a camera (${refused[0]?.reason ?? "unknown"})`);
  checkCancelled(hooks.signal);

  const cams = await timed("cameras", () => alignCameras(reads, hooks, 40, options.holdOutShare ?? 0));
  if (cams.report.note) notes.push(cams.report.note);
  const previews = reads.filter(r => r.source === "preview").length;
  if (usePreview && previews) notes.push(`${previews} of ${reads.length} photographs read from the camera's own ${reads.find(r => r.source === "preview")!.viewW} x ${reads.find(r => r.source === "preview")!.viewH} preview`);
  const sources = new Map(photos.map(p => [p.name, p]));
  const readBy = new Map(reads.map(r => [r.name, r]));
  const pixels = async (name: string) => { const src = sources.get(name)!; if (readBy.get(name)?.source === "preview") { const p = await src.preview(); if (p) return p; } return src.decode(down); };
  const rows = await timed("rows", () => rowsAndTrees(cams.frames, cams.model, pixels, hooks, options.rowRasterCellM ?? 0.08));
  if (!rows) notes.push("no rows were read in any photograph: the twin has no crop rows, no trees and no cultivated block");
  checkCancelled(hooks.signal);

  const kept = photos.filter(p => cams.frames.has(p.name));
  const tier = options.weedTier ?? (options.detector ? "model" : "none");
  const colourPixels = options.colourPixels === "preview" ? pixels : (name: string) => sources.get(name)!.decode(down);
  const weeds = await timed("weeds", () => findWeeds(kept, cams.frames, cams.model, rows, options.detector, hooks, { tier, colourPixels, views: options.weedViews ?? 0, plan: options.detectPlan }));
  if (weeds.tier === "none") notes.push("built without a weed pass: no weed candidates");
  else if (weeds.tier === "colour") notes.push("weeds by the colour rules, not the model: green patches over bare soil; the small, the dark and the yellowing are missed");
  for (const f of weeds.photographsFailed) notes.push(`${f.name}: the weed model gave no answer (${f.reason})`);

  const later = options.atlases === "later";
  const built = await timed("bundle", () => assembleBundle({ id: options.id, name: options.name, photos: kept, reads, frames: cams.frames, model: cams.model, rows, weeds, detector: options.detector, cameraReport: cams.report as unknown as Record<string, unknown>, codec, down }, hooks, !later));
  const ev = await timed("evidence", () => evidenceAndBoundary(built.twin, kept, cams.frames, cams.model, pixels, options.evidenceCellM ?? 0.25, hooks));
  if (ev.note) notes.push(ev.note);
  timings.boundary = ev.classifyMs; timings.evidence = ev.sampledMs;

  const parsed = parseTwin(JSON.parse(JSON.stringify(built.twin)));
  if ("reason" in parsed) throw new Error(`the built twin is malformed: ${parsed.reason}`);
  const files = new Map<string, Blob | Uint8Array>(built.atlases);
  const json = JSON.stringify(built.twin);
  // Bytes, never a Blob: Node has Blob too, and the scripts write files. The worker wraps the bytes for the page.
  files.set("twin.json", new TextEncoder().encode(json));
  const report: BuildReport = {
    photographs: { given: photos.length, read: reads.length, refused, previews },
    cameras: cams.report as unknown as Record<string, unknown>,
    rows: rows?.report ?? null,
    weeds: { detections: weeds.detections, photographsRun: weeds.photographsRun, failed: weeds.photographsFailed, stats: weeds.stats },
    boundary: ev.boundary ? { areaM2: ev.boundary.areaM2, uncertaintyM2: ev.boundary.uncertaintyM2, supportPhotographs: ev.boundary.stats.support.photographs, failures: ev.boundary.failures } : null,
    crops: built.crops, timings, totalMs: Date.now() - T0, notes,
  };
  return { twin: built.twin, files, report, cutAtlases: later ? built.cutAtlases : null };
}
