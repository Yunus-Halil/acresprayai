// The baseline detector for the terminal benchmark: the shared Roboflow call
// (supabase/functions/_shared/roboflow.ts, the same code the bench-detect
// edge function runs) behind the runner interface the benchmark uses. The key
// comes from the developer's environment and is scrubbed from every error.
import {
  DEFAULT_ROBOFLOW_MODEL, type Detection, type ModelResult, type ModelStatus, type RoboflowCall,
  callRoboflow, describeRoboflow, normalizeRoboflow,
} from "../../supabase/functions/_shared/roboflow";
import { SKIPPED } from "@/lib/sourceFrames/benchTypes";

export { DEFAULT_ROBOFLOW_MODEL, SKIPPED, normalizeRoboflow };
export type { Detection, ModelResult, ModelStatus };

/** Anything that can look at an image and say what it found. */
export type ModelRunner = {
  id: string;
  /** How the runner was configured, for the report. Never a secret. */
  describe(): Record<string, string | number>;
  detect(image: Uint8Array, mime: "image/jpeg" | "image/png"): Promise<ModelResult>;
};

export type RoboflowOptions = RoboflowCall;

export function createRoboflowRunner(opts: RoboflowOptions): ModelRunner {
  const model = opts.model ?? DEFAULT_ROBOFLOW_MODEL;
  return {
    id: model,
    describe: () => describeRoboflow({ model, endpoint: opts.endpoint, confidence: opts.confidence, overlap: opts.overlap }),
    detect: (image, mime) => callRoboflow(opts, Buffer.from(image).toString("base64"), mime),
  };
}
