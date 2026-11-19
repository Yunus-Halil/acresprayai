// What this device's browser can do for a Field Twin build (the founder's device check, /app/device-check): the
// facts it states about itself, the features the build uses, the largest canvas it will draw (a build reads every
// photograph at its full size on one canvas; iPadOS Safari has long refused canvases over 16.7 million pixels), and,
// with one of the flight's photographs, the build's own decode of it. Runs on this device; nothing is sent.
export type CanvasProbe = { w: number; h: number; mp: number; ok: boolean; ms: number; why?: string };

/** Draw at the far corner of a w x h canvas and read it back. False when the browser refuses or reads back nothing. */
export function probeCanvas(w: number, h: number): CanvasProbe {
  const t = performance.now(), mp = +((w * h) / 1e6).toFixed(1);
  try {
    if (typeof OffscreenCanvas === "undefined") return { w, h, mp, ok: false, ms: 0, why: "no OffscreenCanvas" };
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return { w, h, mp, ok: false, ms: performance.now() - t, why: "no 2d context" };
    g.fillStyle = "rgb(60,200,40)"; g.fillRect(w - 2, h - 2, 2, 2);
    const d = g.getImageData(w - 1, h - 1, 1, 1).data;
    c.width = 1; c.height = 1;
    const ok = d[1] > 150 && d[3] === 255;
    return { w, h, mp, ok, ms: Math.round(performance.now() - t), ...(ok ? {} : { why: "what was drawn reads back empty" }) };
  } catch (e) { return { w, h, mp, ok: false, ms: Math.round(performance.now() - t), why: (e as Error)?.message ?? String(e) }; }
}

/** The sizes tried: 16.8 MP (the old iPadOS limit), a 20 MP 4:3 drone photograph, 48 MP, 67 MP. */
export const CANVAS_SIZES: [number, number][] = [[4096, 4096], [5280, 3956], [8064, 6048], [8192, 8192]];

export type PhotoProbe = {
  name: string; bytes: number;
  preview: { ok: boolean; w?: number; h?: number; ms: number; why?: string };
  full: { ok: boolean; w?: number; h?: number; ms: number; why?: string; meanGreen?: number };
};

export type WorkerAsk = { kind: "canvas"; sizes: [number, number][] } | { kind: "photo"; file: File };
export type WorkerAnswer = { kind: "canvas"; probes: CanvasProbe[] } | { kind: "photo"; probe: PhotoProbe } | { kind: "error"; message: string };

/** Ask the check's worker (the build reads photographs in workers, so that is where it matters). */
export function askWorker(ask: WorkerAsk, timeoutMs = 60_000): Promise<WorkerAnswer> {
  return new Promise(resolve => {
    let w: Worker;
    try { w = new Worker(new URL("./build/deviceCheckWorker.ts", import.meta.url), { type: "module" }); }
    catch (e) { resolve({ kind: "error", message: `no module worker (${(e as Error).message})` }); return; }
    const timer = setTimeout(() => { w.terminate(); resolve({ kind: "error", message: "the worker did not answer (it may have been stopped for memory)" }); }, timeoutMs);
    w.onmessage = (e: MessageEvent<WorkerAnswer>) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    w.onerror = e => { clearTimeout(timer); w.terminate(); resolve({ kind: "error", message: e.message || "the worker failed to start" }); };
    w.postMessage(ask);
  });
}

export type DeviceFacts = {
  userAgent: string; ipad: boolean; cores: number | null; memoryGB: number | null; screen: string;
  storage: { usageMB: number | null; quotaMB: number | null; persisted: boolean | null };
  features: Record<string, boolean>;
};

export async function deviceFacts(): Promise<DeviceFacts> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  // iPadOS Safari says it is a Mac; a Mac has no touch screen.
  const ipad = /iPad/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  let usageMB: number | null = null, quotaMB: number | null = null, persisted: boolean | null = null;
  try { const e = await nav.storage?.estimate?.(); if (e) { usageMB = e.usage != null ? Math.round(e.usage / 1e6) : null; quotaMB = e.quota != null ? Math.round(e.quota / 1e6) : null; } } catch { /* not offered */ }
  try { persisted = (await nav.storage?.persisted?.()) ?? null; } catch { /* not offered */ }
  const features: Record<string, boolean> = {
    "OffscreenCanvas": typeof OffscreenCanvas !== "undefined",
    "createImageBitmap": typeof createImageBitmap === "function",
    "OffscreenCanvas.convertToBlob": typeof OffscreenCanvas !== "undefined" && typeof OffscreenCanvas.prototype.convertToBlob === "function",
    "DecompressionStream": typeof DecompressionStream !== "undefined",
    "CompressionStream": typeof CompressionStream !== "undefined",
    "IndexedDB": typeof indexedDB !== "undefined",
    "Choose several files": (() => { try { return "multiple" in document.createElement("input"); } catch { return false; } })(),
  };
  return { userAgent: nav.userAgent, ipad, cores: nav.hardwareConcurrency ?? null, memoryGB: nav.deviceMemory ?? null, screen: `${screen.width} x ${screen.height} at ${devicePixelRatio}x`, storage: { usageMB, quotaMB, persisted }, features };
}
