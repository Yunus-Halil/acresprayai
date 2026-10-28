// The twin build off the main thread: a Web Worker that takes the photographs (Files) and the options, runs the
// pipeline over browserPhotos, calls the local weed model through the dev proxy when asked, and posts progress,
// log lines and the result (twin.json and the atlases as Blobs). One worker per build; the page terminates it to stop.
import { type DetectOptions, detectWeeds } from "../../weedVision/client";
import { browserCodec, browserPhoto } from "./browserPhotos";
import { type BuildReport, buildFieldTwin } from "./pipeline";
import { BuildCancelled, type BuildProgress } from "./types";

export type BuildWorkerRequest = { type: "build"; files: File[]; name: string; id?: string; withWeeds: boolean; detect?: DetectOptions } | { type: "cancel" };
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

self.onmessage = async (e: MessageEvent<BuildWorkerRequest>) => {
  const m = e.data;
  if (!m) return;
  if (m.type === "cancel") { abort.abort(); return; }
  if (m.type !== "build") return;
  try {
    const photos = m.files.map(f => browserPhoto(f, f.name));
    const detect = m.detect ?? { algorithm: "rfdetr_seg_large", scale: 1, tile: 1024, overlap: 256, threshold: 0.5, includeCrop: true, geometry: "full" };
    const detector = m.withWeeds
      ? async (p: { name: string; bytes: () => Promise<Blob | Uint8Array> }, signal?: AbortSignal) => {
        const bytes = await p.bytes();
        const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
        const r = await detectWeeds(blob, `${p.name}.JPG`, detect, { signal });
        if (!r.ok) throw new Error(r.error);
        return r.value;
      }
      : null;
    const out = await buildFieldTwin(photos, { name: m.name, id: m.id, detector, atlases: "later" }, browserCodec, {
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
  }
};
