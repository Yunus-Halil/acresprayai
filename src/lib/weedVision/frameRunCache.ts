// A photograph scored once by a model is scored: the model's instances for
// that photo, on the ground, kept per scan (migration 20261015120000, table
// `scan_frame_detections`), one row per (scan, photo, run key). The next run
// with the same settings and the same checkpoint takes the rows instead of
// the photos, and a reload of the page shows the last run again. Fails soft
// like the photo-read cache: a row that cannot be saved is still a result,
// and a cache that cannot be loaded is an empty cache.
import { supabase } from "@/integrations/supabase/client";
import type { FrameDetection, FrameRunParams } from "./frames";

export type SavedFrameRun = {
  filename: string;
  algorithm: string;
  modelSha256: string | null;
  nativeWidth: number;
  nativeHeight: number;
  timingsMs: Record<string, number>;
  detections: FrameDetection[];
  createdAt: string | null;
};

export type FrameRunRow = {
  filename: string; algorithm: string; model_sha256: string | null; native_width: number; native_height: number;
  timings_ms: Record<string, number> | null; detections: FrameDetection[]; created_at?: string | null;
};

export function runFromRow(r: FrameRunRow): SavedFrameRun {
  return { filename: r.filename, algorithm: r.algorithm, modelSha256: r.model_sha256, nativeWidth: r.native_width, nativeHeight: r.native_height, timingsMs: r.timings_ms ?? {}, detections: Array.isArray(r.detections) ? r.detections : [], createdAt: r.created_at ?? null };
}

const COLUMNS = "filename, algorithm, model_sha256, native_width, native_height, timings_ms, detections, created_at";

/** Every saved photo of a scan under one run key, by filename. Empty, never an error, when nothing loads. */
export async function loadFrameRuns(scanId: string, paramsKey: string): Promise<Map<string, SavedFrameRun>> {
  const out = new Map<string, SavedFrameRun>();
  try {
    const q = await supabase.from("scan_frame_detections").select(COLUMNS).eq("scan_id", scanId).eq("params_key", paramsKey);
    if (q.error || !q.data) return out;
    for (const r of q.data as unknown as FrameRunRow[]) out.set(r.filename, runFromRow(r));
  } catch { /* an empty cache */ }
  return out;
}

/** Save one photo's result, replacing the same photo under the same key. Never throws. */
export async function saveFrameRun(input: { userId: string; scanId: string; paramsKey: string; params: FrameRunParams; run: SavedFrameRun }): Promise<{ ok: boolean; error?: string }> {
  try {
    const row = {
      user_id: input.userId, scan_id: input.scanId, filename: input.run.filename, params_key: input.paramsKey,
      algorithm: input.run.algorithm, model_sha256: input.run.modelSha256, params: input.params,
      native_width: input.run.nativeWidth, native_height: input.run.nativeHeight,
      count_weed: input.run.detections.filter(d => d.klass === "weed").length, count_crop: input.run.detections.filter(d => d.klass === "crop").length,
      timings_ms: input.run.timingsMs, detections: input.run.detections,
    };
    const up = await supabase.from("scan_frame_detections").upsert(row as never, { onConflict: "scan_id,filename,params_key" });
    return up.error ? { ok: false, error: up.error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}

/** Forget a scan's saved results under one key (the operator's "clear"). Never throws. */
export async function deleteFrameRuns(scanId: string, paramsKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const d = await supabase.from("scan_frame_detections").delete().eq("scan_id", scanId).eq("params_key", paramsKey);
    return d.error ? { ok: false, error: d.error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}

/** The run keys a scan has results under, newest first, so a reload can offer the last run without knowing its settings. */
export async function listFrameRunKeys(scanId: string): Promise<Array<{ paramsKey: string; algorithm: string; params: FrameRunParams | null; frames: number; latest: string | null }>> {
  try {
    const q = await supabase.from("scan_frame_detections").select("params_key, algorithm, params, created_at").eq("scan_id", scanId);
    if (q.error || !q.data) return [];
    const by = new Map<string, { paramsKey: string; algorithm: string; params: FrameRunParams | null; frames: number; latest: string | null }>();
    for (const r of q.data as unknown as Array<{ params_key: string; algorithm: string; params: FrameRunParams | null; created_at: string | null }>) {
      const cur = by.get(r.params_key) ?? { paramsKey: r.params_key, algorithm: r.algorithm, params: r.params, frames: 0, latest: null };
      cur.frames += 1;
      if (r.created_at && (!cur.latest || r.created_at > cur.latest)) cur.latest = r.created_at;
      by.set(r.params_key, cur);
    }
    return [...by.values()].sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? ""));
  } catch {
    return [];
  }
}
