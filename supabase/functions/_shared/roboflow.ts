// The baseline detector, behind one small function.
//
// Roboflow's hosted model `weeds-nxe1w/1` is an experiment's yardstick and
// nothing more: it is not ground truth, it does not change a treatment
// decision, it never touches an operator's verdict, and a detection from it
// is not proof that weed detection works. It is here so the same crop can be
// shown with and without a detector's boxes, at the ortho's resolution and
// at the camera's.
//
// Pure: no Deno, no Node, no DOM. The `bench-detect` edge function calls it
// with the key from its secrets; the terminal benchmark calls it with the key
// from a developer's environment. The browser imports only the types.
//
// The key arrives in the query string, which is how the service takes it.
// It is scrubbed from every error before the error leaves this module, and
// nothing here logs a URL.

export type Detection = {
  /** Box centre and size in the pixels of the image that was sent. */
  x: number; y: number; width: number; height: number;
  confidence: number;
  klass: string;
};

export type ModelStatus = "SUCCESS" | "SUCCESS_NO_DETECTIONS" | "API_ERROR" | "MODEL_SKIPPED";

export type ModelResult = {
  status: ModelStatus;
  modelId: string | null;
  count: number;
  maxConfidence: number | null;
  meanConfidence: number | null;
  detections: Detection[];
  /** The service's own reading of the image it received. */
  imageWidth: number | null;
  imageHeight: number | null;
  /** Milliseconds the call took, end to end. */
  elapsedMs: number | null;
  error: string | null;
};

export const DEFAULT_ROBOFLOW_MODEL = "weeds-nxe1w/1";
export const DEFAULT_ROBOFLOW_ENDPOINT = "https://detect.roboflow.com";
/** The service's own defaults, in percent. */
export const DEFAULT_CONFIDENCE = 40;
export const DEFAULT_OVERLAP = 30;

/** Replace every occurrence of a secret in a message, so an error can be shown. */
export function scrub(message: string, secrets: (string | null | undefined)[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("***");
  return out;
}

const failed = (modelId: string, error: string, elapsedMs: number): ModelResult => ({
  status: "API_ERROR", modelId, count: 0, maxConfidence: null, meanConfidence: null,
  detections: [], imageWidth: null, imageHeight: null, elapsedMs, error,
});

/** The one shape the report reads, from whatever the service answered. */
export function normalizeRoboflow(json: unknown, modelId: string, elapsedMs: number | null): ModelResult {
  const j = (json ?? {}) as { predictions?: unknown; image?: { width?: unknown; height?: unknown } };
  const raw = Array.isArray(j.predictions) ? (j.predictions as Record<string, unknown>[]) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const detections: Detection[] = [];
  for (const p of raw) {
    const x = num(p.x), y = num(p.y), width = num(p.width), height = num(p.height), confidence = num(p.confidence);
    if (x == null || y == null || width == null || height == null || confidence == null) continue;
    detections.push({ x, y, width, height, confidence, klass: typeof p.class === "string" ? p.class : "unknown" });
  }
  const confs = detections.map(d => d.confidence);
  return {
    status: detections.length ? "SUCCESS" : "SUCCESS_NO_DETECTIONS",
    modelId,
    count: detections.length,
    maxConfidence: confs.length ? Math.max(...confs) : null,
    meanConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
    detections,
    imageWidth: num(j.image?.width), imageHeight: num(j.image?.height),
    elapsedMs, error: null,
  };
}

export type RoboflowCall = {
  apiKey: string;
  /** "<project>/<version>", the hosted model id. */
  model?: string;
  endpoint?: string;
  /** Minimum confidence the service should return, in percent, as the service defines it. */
  confidence?: number;
  /** Box overlap threshold for the service's own suppression, in percent. */
  overlap?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** The settings a call will use, for a report. Never the key. */
export function describeRoboflow(opts: Omit<RoboflowCall, "apiKey" | "fetchImpl">): Record<string, string | number> {
  return {
    provider: "roboflow",
    model: opts.model ?? DEFAULT_ROBOFLOW_MODEL,
    endpointHost: new URL(opts.endpoint ?? DEFAULT_ROBOFLOW_ENDPOINT).host,
    confidencePercent: opts.confidence ?? DEFAULT_CONFIDENCE,
    overlapPercent: opts.overlap ?? DEFAULT_OVERLAP,
  };
}

/**
 * Whether a key is a working Roboflow key at all, and whose. The service's
 * root answers with the key's workspace. Used only to turn a 401 from the
 * model endpoint into a sentence a person can act on: "the key is fine, the
 * model is not yours" against "the key is wrong". Never throws.
 */
export async function checkRoboflowKey(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<{ valid: boolean; workspace: string | null; detail: string | null }> {
  try {
    const res = await fetchImpl(`https://api.roboflow.com/?api_key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) return { valid: false, workspace: null, detail: scrub(`HTTP ${res.status}: ${text.slice(0, 160)}`, [apiKey]) };
    let json: { workspace?: unknown } = {};
    try { json = JSON.parse(text); } catch { /* not JSON: treat as unknown */ }
    const workspace = typeof json.workspace === "string" ? json.workspace : null;
    return { valid: true, workspace, detail: null };
  } catch (e) {
    return { valid: false, workspace: null, detail: scrub((e as Error)?.message ?? String(e), [apiKey]) };
  }
}

/** A 401 or 403 from the model endpoint, explained with the key check's answer. */
export function explainRefusal(model: string, httpError: string, check: { valid: boolean; workspace: string | null; detail: string | null }): string {
  if (!check.valid) return `${httpError} The key itself was refused by Roboflow${check.detail ? ` (${check.detail})` : ""}: set ROBOFLOW_API_KEY to the workspace's private API key.`;
  return `${httpError} The key is valid${check.workspace ? ` for workspace "${check.workspace}"` : ""}, so the model "${model}" is not one that workspace can run: set ROBOFLOW_MODEL to a model of your own (its id is <project>/<version>, from the project's Deploy page).`;
}

/**
 * One image to the hosted model. `imageBase64` is the bare base64 of a JPEG or
 * PNG. Never throws: a failed call is an API_ERROR result with the key scrubbed.
 */
export async function callRoboflow(opts: RoboflowCall, imageBase64: string, mime: "image/jpeg" | "image/png"): Promise<ModelResult> {
  const model = opts.model ?? DEFAULT_ROBOFLOW_MODEL;
  const endpoint = (opts.endpoint ?? DEFAULT_ROBOFLOW_ENDPOINT).replace(/\/$/, "");
  const confidence = opts.confidence ?? DEFAULT_CONFIDENCE;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const secrets = [opts.apiKey];
  const url = `${endpoint}/${model}?api_key=${encodeURIComponent(opts.apiKey)}&confidence=${confidence}&overlap=${overlap}&format=json`;
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data:${mime};base64,${imageBase64}`,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    const text = await res.text();
    if (!res.ok) return failed(model, scrub(`HTTP ${res.status}: ${text.slice(0, 200)}`, secrets), Date.now() - t0);
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      return failed(model, scrub(`not JSON: ${text.slice(0, 120)}`, secrets), Date.now() - t0);
    }
    return normalizeRoboflow(json, model, Date.now() - t0);
  } catch (e) {
    return failed(model, scrub((e as Error)?.message ?? String(e), secrets), Date.now() - t0);
  }
}
