// Which model, if any, this build ships.
//
// `public/models/manifest.json` is written by `offrow learn publish` and
// committed with the ONNX file and its scorecard. No manifest, or a manifest
// naming a model whose sidecar the app does not understand, means no
// classifier: the scout runs exactly as it did before, and the result says
// so in its notes. A missing model is never an error a farmer sees.

import { type ModelManifest, type ModelMeta, isUsableMeta } from "./types";

export const MODELS_BASE = "/models";

let cached: Promise<ModelMeta | null> | null = null;

export async function fetchManifest(fetchImpl: typeof fetch = fetch): Promise<ModelManifest | null> {
  try {
    const res = await fetchImpl(`${MODELS_BASE}/manifest.json`, { cache: "no-cache" });
    if (!res.ok) return null;
    const json = (await res.json()) as ModelManifest;
    if (!json || typeof json !== "object" || !json.models) return null;
    return json;
  } catch {
    return null;
  }
}

/** The current model's sidecar, or null when there is none worth loading. */
export function currentModel(manifest: ModelManifest | null): ModelMeta | null {
  if (!manifest?.current) return null;
  const meta = manifest.models[manifest.current];
  return isUsableMeta(meta) ? meta : null;
}

/** Cached for the life of the page: one manifest fetch per session. */
export function loadCurrentModel(fetchImpl?: typeof fetch): Promise<ModelMeta | null> {
  if (!cached) cached = fetchManifest(fetchImpl).then(currentModel);
  return cached;
}

/** For tests. */
export function resetRegistry(): void {
  cached = null;
}

export function modelUrl(meta: ModelMeta): string {
  return `${MODELS_BASE}/${meta.file}`;
}
