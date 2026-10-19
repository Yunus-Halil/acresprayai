// Client for the local research inference service. Never throws: every call
// returns {ok: true, ...} or {ok: false, error}. Types mirror the service's
// result schema (research/weed-vision-lab/docs/research-preview.md).
import { WEED_VISION_API_BASE } from "./flag";

export type WeedInstance = {
  id: number;
  centroid_px: [number, number];
  bbox_px: [number, number, number, number];
  area_px: number;
  /** The hull-based measures are null when the run asked for "lite" geometry (the map runs, which never read them). */
  max_span_px: number | null;
  span_endpoints_px: [[number, number], [number, number]] | null;
  perpendicular_span_px: number | null;
  obb: { length_px: number; width_px: number; angle_deg: number } | null;
  equivalent_diameter_px: number;
  solidity: number | null;
  pieces: number;
  touches_border: boolean;
  tiny: boolean;
  score: number | null;
  score_kind: string;
  polygons_px: [number, number][][];
  flags: string[];
  /** Instance-segmentation algorithms (RF-DETR) say what the plant is; the ERFNet and colour algorithms list weeds only. */
  class?: InstanceClass;
  /** How many tiles' predictions were fused into this instance (RF-DETR). */
  fused_from_tiles?: number;
};

export type InstanceClass = "crop" | "weed";

export type ModelStatus = {
  loaded: boolean; checkpoint_path: string; checkpoint_sha256: string | null; load_ms: number | null; error: string | null; licence_note: string;
  threads?: number;
  /** RF-DETR holder fields. */
  device?: string | null; resolution?: number | null; architecture?: string; classes?: string[]; warmup_ms?: number | null;
};

export type WeedVisionResult = {
  schema_version: string;
  run_id: string;
  research_only: boolean;
  image: { filename: string; format: string | null; bytes: number; width: number; height: number; exif: Record<string, unknown>; coordinate_system: string };
  processing: { scale: number; width: number; height: number; tiles: number | null; tile_px: number | null; overlap_px: number | null; threshold?: number | null; model_resolution?: number | null; device?: string | null };
  algorithm: { name: string; label: string; family: string; benchmark: string; description: string; requested: string; separation?: Record<string, number> | null; model?: ModelKey | null; default_threshold?: number };
  model: ModelStatus | null;
  versions: { service: string; lab: string };
  /** What the instances can be: ["crop", "weed"] for RF-DETR, ["weed"] for ERFNet, ["vegetation"] for the colour rules. */
  classes?: string[];
  count: number;
  instances: WeedInstance[];
  /** RF-DETR only: the crop plants as instances with the same geometry as the weeds. */
  crop_instances?: WeedInstance[] | null;
  crop_regions_px: [number, number][][] | null;
  pixel_fractions: { weed: number | null; crop: number | null };
  timings_ms: Record<string, number>;
  memory: { peak_working_set_mb: number | null; peak_gpu_mb?: number | null };
  warnings: string[];
  measurement_note: string;
  evaluation?: WeedVisionEvaluation;
};

export type WeedVisionEvaluation = {
  reference_instances: number;
  predicted_instances: number;
  detection: { "iou_0.5": { tp: number; fp: number; fn: number; precision: number; recall: number }; "iou_0.3": { recall: number } };
  count_error: number;
  mask_iou: number;
  pixel_precision: number;
  pixel_recall: number;
  instance_iou_median: number | null;
  per_reference: Array<Record<string, unknown>>;
  per_detection: Array<Record<string, unknown>>;
  regions_px: { false_positive: [number, number][][]; missed: [number, number][][]; true_positive: [number, number][][] };
  note: string;
};

export type ModelKey = "erfnet" | "rfdetr";
export type AlgorithmFamily = "colour" | "erfnet" | "rfdetr";
export type AlgorithmInfo = { label: string; family: AlgorithmFamily; needs_model: boolean; model?: ModelKey | null; benchmark: string; description: string; alias_of?: string; default_threshold?: number };

export type Health = {
  ok: boolean; service: string; lab: string; research_only: boolean;
  /** The ERFNet holder, kept for older callers; `models` has every holder. */
  model: ModelStatus;
  models?: Partial<Record<ModelKey, ModelStatus>>;
  limits: { max_megapixels: number; max_mb: number; min_side_px: number };
  defaults: { algorithm: string; selected: string; scale: number; tile: number; overlap: number; threshold?: number };
};

/** Whether the model an algorithm needs is loaded, by the service's own word. */
export function algorithmReady(info: AlgorithmInfo | undefined, health: Health | null): boolean {
  if (!info) return false;
  if (!info.needs_model) return !!health?.ok;
  const key = info.model ?? (info.family === "rfdetr" ? "rfdetr" : "erfnet");
  const st = health?.models?.[key] ?? (key === "erfnet" ? health?.model : undefined);
  return !!st?.loaded;
}

export type DetectOptions = { algorithm: string; scale: number; tile?: number; overlap?: number; includeCrop?: boolean; /** RF-DETR confidence cut, 0.05 to 0.95. */ threshold?: number; /** "lite" skips the hull-based shape measures the map never reads. */ geometry?: "full" | "lite" };
export type Progress = { phase: "uploading" | "queued" | "running" | "done"; tilesDone: number; tilesTotal: number | null; elapsedMs: number };

// Both arms carry both keys (one undefined) so the union narrows even without strictNullChecks.
type Ok<T> = { ok: true; value: T; error?: undefined; status?: undefined };
type Err = { ok: false; error: string; status?: number; value?: undefined };
export type Outcome<T> = Ok<T> | Err;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 300) || `HTTP ${res.status}` }; }
}

export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<Outcome<Health>> {
  try {
    const res = await fetchImpl(`${WEED_VISION_API_BASE}/health`);
    const j = (await readJson(res)) as Health & { error?: string };
    if (!res.ok || !j.ok) return { ok: false, error: j.error ?? `service answered ${res.status}`, status: res.status };
    return { ok: true, value: j };
  } catch (e) {
    return { ok: false, error: `the research service is not reachable (${(e as Error).message}); start it with scripts/serve_research_api.py` };
  }
}

export async function fetchAlgorithms(fetchImpl: typeof fetch = fetch): Promise<Outcome<{ selected: string; algorithms: Record<string, AlgorithmInfo> }>> {
  try {
    const res = await fetchImpl(`${WEED_VISION_API_BASE}/algorithms`);
    const j = (await readJson(res)) as { selected: string; algorithms: Record<string, AlgorithmInfo>; error?: string };
    if (!res.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}`, status: res.status };
    return { ok: true, value: j };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function form(file: Blob, filename: string, opts: DetectOptions, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append("image", file, filename);
  fd.append("algorithm", opts.algorithm);
  fd.append("scale", String(opts.scale));
  if (opts.tile) fd.append("tile", String(opts.tile));
  if (opts.overlap !== undefined) fd.append("overlap", String(opts.overlap));
  if (opts.threshold !== undefined) fd.append("threshold", String(opts.threshold));
  fd.append("include_crop", opts.includeCrop === false ? "0" : "1");
  if (opts.geometry) fd.append("geometry", opts.geometry);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Detect with the asynchronous job endpoint so progress can be shown; falls back to the synchronous answer if the service returns one. */
export async function detectWeeds(file: Blob, filename: string, opts: DetectOptions, hooks: { onProgress?: (p: Progress) => void; signal?: AbortSignal; fetchImpl?: typeof fetch; pollMs?: number } = {}): Promise<Outcome<WeedVisionResult>> {
  const fetchImpl = hooks.fetchImpl ?? fetch;
  const t0 = Date.now();
  const report = (phase: Progress["phase"], tilesDone = 0, tilesTotal: number | null = null) => hooks.onProgress?.({ phase, tilesDone, tilesTotal, elapsedMs: Date.now() - t0 });
  try {
    report("uploading");
    const res = await fetchImpl(`${WEED_VISION_API_BASE}/detect`, { method: "POST", body: form(file, filename, opts, { async: "1" }), signal: hooks.signal });
    const j = (await readJson(res)) as { job_id?: string; error?: string } & Partial<WeedVisionResult>;
    if (!res.ok && res.status !== 202) return { ok: false, error: j.error ?? `HTTP ${res.status}`, status: res.status };
    if (!j.job_id) {
      if (j.schema_version) { report("done"); return { ok: true, value: j as WeedVisionResult }; }
      return { ok: false, error: j.error ?? "unexpected answer from the service" };
    }
    report("queued");
    for (;;) {
      if (hooks.signal?.aborted) return { ok: false, error: "cancelled" };
      await sleep(hooks.pollMs ?? 400);
      const s = await fetchImpl(`${WEED_VISION_API_BASE}/jobs/${j.job_id}`, { signal: hooks.signal });
      const sj = (await readJson(s)) as { state: string; progress?: { tiles_done: number; tiles_total: number | null }; result?: WeedVisionResult; error?: string };
      if (sj.state === "done" && sj.result) { report("done", sj.progress?.tiles_done ?? 0, sj.progress?.tiles_total ?? null); return { ok: true, value: sj.result }; }
      if (sj.state === "error" || !s.ok) return { ok: false, error: sj.error ?? `HTTP ${s.status}`, status: s.status };
      report(sj.state === "running" ? "running" : "queued", sj.progress?.tiles_done ?? 0, sj.progress?.tiles_total ?? null);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, error: "cancelled" };
    return { ok: false, error: `the research service is not reachable (${(e as Error).message})` };
  }
}

/** Evaluation mode: the reference mask is sent for scoring only; the service runs inference first, then compares. */
export async function evaluateWithReference(file: Blob, filename: string, reference: Blob, refName: string, opts: DetectOptions, fetchImpl: typeof fetch = fetch): Promise<Outcome<WeedVisionResult>> {
  try {
    const fd = form(file, filename, opts);
    fd.append("reference", reference, refName);
    const res = await fetchImpl(`${WEED_VISION_API_BASE}/evaluate`, { method: "POST", body: fd });
    const j = (await readJson(res)) as WeedVisionResult & { error?: string };
    if (!res.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}`, status: res.status };
    return { ok: true, value: j };
  } catch (e) {
    return { ok: false, error: `the research service is not reachable (${(e as Error).message})` };
  }
}

/** Point-in-polygon (ray casting) on the instance's largest polygon; falls back to a 20 px centroid radius. */
export function instanceAt(instances: WeedInstance[], x: number, y: number): WeedInstance | null {
  const inside = (poly: [number, number][]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) hit = !hit;
    }
    return hit;
  };
  let best: WeedInstance | null = null;
  for (const inst of instances) {
    const [x0, y0, x1, y1] = inst.bbox_px;
    if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) continue;
    if (inst.polygons_px.some(inside)) { if (!best || inst.area_px < best.area_px) best = inst; }
  }
  if (best) return best;
  let near: WeedInstance | null = null; let d2 = 20 * 20;
  for (const inst of instances) {
    const dd = (inst.centroid_px[0] - x) ** 2 + (inst.centroid_px[1] - y) ** 2;
    if (dd < d2) { d2 = dd; near = inst; }
  }
  return near;
}
