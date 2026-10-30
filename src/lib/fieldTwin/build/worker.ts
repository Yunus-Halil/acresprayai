// The twin build off the main thread: a Web Worker that takes the photographs (Files) and the options, runs the
// pipeline over browserPhotos, calls the local weed model through the dev proxy when asked, and posts progress,
// log lines and the result (twin.json and the atlases as Blobs). One worker per build; the page terminates it to stop.
import { type DetectOptions, detectWeeds } from "../../weedVision/client";
import { browserCodec, groupPhotoFiles } from "./browserPhotos";
import { detectionKey, indexedDbStore, sha256Hex } from "./detectionCache";
import { workerPool } from "./pool";
import { type BuildReport, buildFieldTwin } from "./pipeline";
import { BuildCancelled, type BuildProgress } from "./types";

export type BuildWorkerRequest = { type: "build"; files: File[]; name: string; id?: string; /** The weed pass: the model through the local service, the colour rules, or none. */ weeds: "model" | "colour" | "none"; /** Model tier: nearest views per ground cell to run (0, the default: every tile; measured on the apricot flight, 1024 px tiles prune only 8 %). */ views?: number; /** Helper workers (default: cores - 1, at most 6; 1 = none). */ helpers?: number; detect?: DetectOptions } | { type: "cancel" };
export type BuildWorkerMessage =
  | { type: "progress"; progress: BuildProgress }
  | { type: "log"; line: string }
  | { type: "result"; twinJson: string; files: [string, Blob][]; report: BuildReport }
  /** An atlas cut after the result: the page opens the twin while these arrive. */
  | { type: "atlas"; file: string; blob: Blob; index: number; total: number }
  | { type: "atlases-done" }
  | { type: "cancelled" }
  | { type: "error"; message: string };

const post = (m: BuildWorkerMessage) => (self as unknown as { postMessage: (m: BuildWorkerMessage) => void }).postMessage(m);
const abort = new AbortController();
let pool: ReturnType<typeof workerPool> | null = null;

self.onmessage = async (e: MessageEvent<BuildWorkerRequest>) => {
  const m = e.data;
  if (!m) return;
  if (m.type === "cancel") { abort.abort(); return; }
  if (m.type !== "build") return;
  try {
    const photos = groupPhotoFiles(m.files);
    // "lite" geometry and the service's own 128 px overlap: the twin reads only the outline and the span (taken
    // from the outline), and 24 tiles instead of 35 cover the photograph (step C0 of the speed plan).
    const detect = m.detect ?? { algorithm: "rfdetr_seg_large", scale: 1, tile: 1024, overlap: 128, threshold: 0.5, includeCrop: true, geometry: "lite" };
    const store = indexedDbStore();
    const detector = m.weeds === "model"
      ? async (p: { name: string; bytes: () => Promise<Blob | Uint8Array> }, signal?: AbortSignal, tiles?: number[]) => {
        const bytes = await p.bytes();
        const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
        const opts = tiles ? { ...detect, tiles } : detect;
        const key = store ? detectionKey(await sha256Hex(new Uint8Array(await blob.arrayBuffer())), opts as unknown as Record<string, unknown>) : null;
        if (store && key) { const hit = await store.get(key); if (hit) { post({ type: "log", line: `${p.name}: the model's answer from the cache` }); return hit; } }
        const r = await detectWeeds(blob, `${p.name}.JPG`, opts, { signal });
        if (!r.ok) throw new Error(r.error);
        if (store && key) await store.put(key, r.value);
        return r.value;
      }
      : null;
    // Helper workers for the ties, the colour pass and the crops: one fewer than the cores, at most six.
    const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
    const helpers = m.helpers ?? Math.max(1, Math.min(6, cores - 1));
    pool = helpers > 1 ? workerPool(helpers, () => new Worker(new URL("./helper.ts", import.meta.url), { type: "module" })) : null;
    if (pool) post({ type: "log", line: `${helpers} helper workers (${cores} cores)` });
    const out = await buildFieldTwin(photos, { name: m.name, id: m.id, detector, weedTier: m.weeds, weedViews: m.views ?? 0, detectPlan: { tile: detect.tile ?? 1024, overlap: detect.overlap ?? 128, scale: detect.scale }, atlases: "later", pool: pool ?? undefined }, browserCodec, {
      signal: abort.signal,
      onProgress: progress => post({ type: "progress", progress }),
      log: line => post({ type: "log", line }),
    });
    const files: [string, Blob][] = [];
    for (const [k, v] of out.files) files.push([k, v instanceof Blob ? v : new Blob([v])]);
    post({ type: "result", twinJson: JSON.stringify(out.twin), files, report: out.report });
    if (out.cutAtlases) for await (const a of out.cutAtlases()) post({ type: "atlas", file: a.file, blob: a.bytes instanceof Blob ? a.bytes : new Blob([a.bytes]), index: a.index, total: a.total });
    post({ type: "atlases-done" });
  } catch (err) {
    if (err instanceof BuildCancelled || abort.signal.aborted) post({ type: "cancelled" });
    else post({ type: "error", message: (err as Error)?.message ?? String(err) });
  } finally { pool?.close(); pool = null; }
};
