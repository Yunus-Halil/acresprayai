// The baseline detector, behind one small interface.
//
// Roboflow's hosted model `weeds-nxe1w/1` is an experiment's yardstick and
// nothing more: it is not ground truth, it does not change a treatment
// decision, it never touches an operator's verdict, and a detection from it
// is not proof that weed detection works. It is here so the same crop can be
// shown with and without a detector's boxes, at the ortho's resolution and
// at the camera's.
//
// The key arrives in the query string, which is how the service takes it.
// It is redacted from every error before the error leaves this module, and
// nothing here logs a URL.
import { redact } from "./env";

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

/** Anything that can look at an image and say what it found. */
export type ModelRunner = {
  id: string;
  /** How the runner was configured, for the report. Never a secret. */
  describe(): Record<string, string | number>;
  detect(image: Uint8Array, mime: "image/jpeg" | "image/png"): Promise<ModelResult>;
};

export const SKIPPED: ModelResult = {
  status: "MODEL_SKIPPED", modelId: null, count: 0, maxConfidence: null, meanConfidence: null,
  detections: [], imageWidth: null, imageHeight: null, elapsedMs: null, error: null,
};

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

export type RoboflowOptions = {
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

export const DEFAULT_ROBOFLOW_MODEL = "weeds-nxe1w/1";

export function createRoboflowRunner(opts: RoboflowOptions): ModelRunner {
  const model = opts.model ?? DEFAULT_ROBOFLOW_MODEL;
  const endpoint = (opts.endpoint ?? "https://detect.roboflow.com").replace(/\/$/, "");
  const confidence = opts.confidence ?? 40;
  const overlap = opts.overlap ?? 30;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const secrets = [opts.apiKey];
  return {
    id: model,
    describe: () => ({ provider: "roboflow", model, endpointHost: new URL(endpoint).host, confidencePercent: confidence, overlapPercent: overlap }),
    async detect(image, mime) {
      const url = `${endpoint}/${model}?api_key=${encodeURIComponent(opts.apiKey)}&confidence=${confidence}&overlap=${overlap}&format=json`;
      const body = `data:${mime};base64,${Buffer.from(image).toString("base64")}`;
      const t0 = Date.now();
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) {
          return { ...SKIPPED, status: "API_ERROR", modelId: model, elapsedMs: Date.now() - t0, error: redact(`HTTP ${res.status}: ${text.slice(0, 200)}`, secrets) };
        }
        let json: unknown;
        try { json = JSON.parse(text); } catch {
          return { ...SKIPPED, status: "API_ERROR", modelId: model, elapsedMs: Date.now() - t0, error: redact(`not JSON: ${text.slice(0, 120)}`, secrets) };
        }
        return normalizeRoboflow(json, model, Date.now() - t0);
      } catch (e) {
        return { ...SKIPPED, status: "API_ERROR", modelId: model, elapsedMs: Date.now() - t0, error: redact((e as Error)?.message ?? String(e), secrets) };
      }
    },
  };
}
