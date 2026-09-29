// Running the shipped model in the browser, on the chips the scout rendered.
//
// onnxruntime-web is loaded lazily, the first time a scan has chips to score,
// so a page that never runs the scout never downloads the runtime. The
// WebAssembly binary is served from our own origin (scripts/copy-ort-wasm.cjs
// puts it in public/ort/) because the CSP allows nothing else, and it runs
// under 'wasm-unsafe-eval', which is the one CSP allowance this feature
// needed and the only place it is used.
//
// One session per model per page. Chips are batched. Any failure (runtime
// missing, model 404, a chip that will not decode) degrades to "no prediction
// for this spot", never to a failed scan.

import { type ChipPixels, batchInputs, chipToInput, objectSpanM, softmax } from "./preprocess";
import { modelUrl } from "./registry";
import type { ModelMeta, Prediction } from "./types";

type Session = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | ArrayLike<number> }>>;
};

export type Classifier = {
  meta: ModelMeta;
  /** One prediction per chip, in order. */
  classify(chips: { pixels: ChipPixels; diameterM: number | null }[]): Promise<Prediction[]>;
};

let sessions = new Map<string, Promise<Classifier | null>>();

async function createSession(meta: ModelMeta): Promise<Classifier | null> {
  try {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = "/ort/";
    // A classifier over a few dozen 96 px chips gains nothing from threads,
    // and single-threaded needs no cross-origin isolation headers.
    ort.env.wasm.numThreads = 1;
    const session = (await ort.InferenceSession.create(modelUrl(meta), {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    })) as unknown as Session;
    const px = meta.input.px;
    const rule = meta.input.span_rule;
    const classify = async (chips: { pixels: ChipPixels; diameterM: number | null }[]): Promise<Prediction[]> => {
      if (!chips.length) return [];
      const inputs = chips.map(c => chipToInput(c.pixels, objectSpanM(c.diameterM, rule), px));
      const tensor = new ort.Tensor("float32", batchInputs(inputs, px), [chips.length, 3, px, px]);
      const out = await session.run({ chips: tensor });
      const logits = out.logits.data as Float32Array;
      const k = meta.classes.length;
      return chips.map((_, i) => {
        const p = softmax(Array.from(logits.subarray(i * k, (i + 1) * k)));
        return { pWeed: p[0], pCrop: p[1], pOther: p[2], modelVersion: meta.version };
      });
    };
    return { meta, classify };
  } catch (e) {
    console.warn("[weed-scout] classifier unavailable:", (e as Error)?.message ?? e);
    return null;
  }
}

export function getClassifier(meta: ModelMeta): Promise<Classifier | null> {
  let p = sessions.get(meta.version);
  if (!p) { p = createSession(meta); sessions.set(meta.version, p); }
  return p;
}

/** For tests. */
export function resetClassifiers(): void {
  sessions = new Map();
}
