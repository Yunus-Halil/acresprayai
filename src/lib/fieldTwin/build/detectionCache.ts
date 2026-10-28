// A cache of the weed model's answers, keyed by the photograph's bytes and the detection settings, so a rebuild,
// a cancelled build or a second twin from the same flight never runs the model twice. The store is injected:
// IndexedDB in the browser (below), a folder in Node (scripts/directGeoref/buildTwinApp.ts).
import type { WeedVisionResult } from "../../weedVision/client";

export type DetectionStore = {
  get(key: string): Promise<WeedVisionResult | null>;
  put(key: string, value: WeedVisionResult): Promise<void>;
};

/** SHA-256 of the bytes, hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}

/** The cache key: the photograph's digest and the settings that shaped the answer. */
export function detectionKey(digest: string, settings: Record<string, unknown>): string {
  const s = Object.keys(settings).sort().map(k => `${k}=${JSON.stringify(settings[k])}`).join("&");
  return `${digest}|${s}`;
}

const DB = "swardus-detections", STORE = "answers";

/** IndexedDB-backed store for the browser (a worker can use it too). Null where IndexedDB is unavailable. */
export function indexedDbStore(): DetectionStore | null {
  if (typeof indexedDB === "undefined") return null;
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((res, rej) => { const req = fn(db.transaction(STORE, mode).objectStore(STORE)); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    } finally { db.close(); }
  };
  return {
    get: async key => { try { return ((await run<WeedVisionResult | undefined>("readonly", s => s.get(key))) ?? null); } catch { return null; } },
    put: async (key, value) => { try { await run("readwrite", s => s.put(value, key)); } catch { /* a full or blocked store only costs the cache */ } },
  };
}

/** A store in memory, for tests. */
export function memoryStore(): DetectionStore & { size: () => number } {
  const m = new Map<string, WeedVisionResult>();
  return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, size: () => m.size };
}
