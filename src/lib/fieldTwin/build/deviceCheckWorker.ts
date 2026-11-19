// The device check's worker (deviceCheck.ts): canvas sizes, and one photograph read exactly as a build reads it
// (browserPhoto: the camera's preview, then the full-size decode on one canvas).
import { browserPhoto } from "./browserPhotos";
import { type PhotoProbe, type WorkerAnswer, type WorkerAsk, probeCanvas } from "../deviceCheck";

const post = (m: WorkerAnswer) => (self as unknown as { postMessage: (m: WorkerAnswer) => void }).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerAsk>) => {
  const ask = e.data;
  try {
    if (ask.kind === "canvas") { post({ kind: "canvas", probes: ask.sizes.map(([w, h]) => probeCanvas(w, h)) }); return; }
    const src = browserPhoto(ask.file, ask.file.name);
    const probe: PhotoProbe = { name: ask.file.name, bytes: ask.file.size, preview: { ok: false, ms: 0 }, full: { ok: false, ms: 0 } };
    let t = performance.now();
    try { const p = await src.preview(); probe.preview = p ? { ok: true, w: p.width, h: p.height, ms: Math.round(performance.now() - t) } : { ok: false, ms: Math.round(performance.now() - t), why: "no camera preview in this file" }; }
    catch (err) { probe.preview = { ok: false, ms: Math.round(performance.now() - t), why: (err as Error)?.message ?? String(err) }; }
    t = performance.now();
    try {
      const px = await src.decode(1);
      // A canvas the browser refused to draw reads back as zeros: the mean green of a sample says whether it drew.
      let sum = 0, n = 0;
      for (let i = 1; i < px.rgba.length; i += 4 * 997) { sum += px.rgba[i]; n++; }
      const meanGreen = n ? Math.round(sum / n) : 0;
      probe.full = { ok: meanGreen > 0, w: px.width, h: px.height, ms: Math.round(performance.now() - t), meanGreen, ...(meanGreen > 0 ? {} : { why: "the decode read back empty (the canvas was refused)" }) };
    } catch (err) { probe.full = { ok: false, ms: Math.round(performance.now() - t), why: (err as Error)?.message ?? String(err) }; }
    post({ kind: "photo", probe });
  } catch (err) { post({ kind: "error", message: (err as Error)?.message ?? String(err) }); }
};
