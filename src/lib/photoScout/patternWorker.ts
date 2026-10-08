// The planting-pattern pass, off the main thread.
//
// A Web Worker that takes one raster and the parameters, runs analysePhoto
// and posts the pattern back. pattern.ts is pure, so nothing here touches
// the DOM; the raster's pixel buffer is transferred in, never copied. One
// worker per run: the caller terminates it to stop.
import { analysePhoto, type PhotoParams, type PhotoPixels } from "./pattern";

export type PatternWorkerRequest = { type: "run"; px: PhotoPixels; params: PhotoParams };
export type PatternWorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; pattern: Awaited<ReturnType<typeof analysePhoto>> }
  | { type: "error"; message: string };

const post = (m: PatternWorkerMessage) => (self as unknown as { postMessage: (m: PatternWorkerMessage) => void }).postMessage(m);

self.onmessage = async (e: MessageEvent<PatternWorkerRequest>) => {
  const m = e.data;
  if (!m || m.type !== "run") return;
  try {
    const pattern = await analysePhoto(m.px, m.params, {
      yieldBetweenWindows: false,
      onProgress: (done, total) => { post({ type: "progress", done, total }); },
    });
    post({ type: "result", pattern });
  } catch (err) {
    post({ type: "error", message: (err as Error)?.message ?? String(err) });
  }
};
