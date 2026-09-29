// @vitest-environment node
//
// The shipped model, run the way the browser runs it: onnxruntime-web (the
// Node build of the same package), the same preprocessing, the same sidecar.
// Skips when no model is published, so a checkout without one still passes.
//
// What this proves: the file in public/models loads, honours the contract in
// its sidecar (input name, shape, class count), returns finite logits whose
// softmax sums to one, and gives the same answer for the same chip twice. It
// does not prove the model is right; the scorecard does that, on real data.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { batchInputs, chipToInput, objectSpanM, softmax } from "@/lib/weedScout/classify/preprocess";
import { type ModelManifest, isUsableMeta } from "@/lib/weedScout/classify/types";
import { currentModel } from "@/lib/weedScout/classify/registry";

const MODELS = join(process.cwd(), "public", "models");
const manifestPath = join(MODELS, "manifest.json");
const manifest: ModelManifest | null = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf-8")) : null;
const meta = currentModel(manifest);

/** A chip of one flat colour, `px` across, covering `spanM` of ground. */
const flatChip = (px: number, spanM: number, rgb: [number, number, number]) => {
  const rgba = new Uint8ClampedArray(px * px * 4);
  for (let i = 0; i < px * px; i++) { rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = 255; }
  return { rgba, width: px, height: px, spanM };
};

describe.skipIf(!meta)("the published model honours its sidecar", () => {
  it("names a usable contract and its files exist", () => {
    expect(isUsableMeta(meta)).toBe(true);
    expect(existsSync(join(MODELS, meta!.file))).toBe(true);
    expect(existsSync(join(MODELS, `${meta!.version}.scorecard.json`))).toBe(true);
  });

  it("loads, takes N x 3 x px x px in [0, 1], and returns N x 3 finite calibrated logits", async () => {
    const ort = await import("onnxruntime-web");
    const session = await ort.InferenceSession.create(join(MODELS, meta!.file), { executionProviders: ["wasm"] });
    expect(session.inputNames).toContain("chips");
    expect(session.outputNames).toContain("logits");
    const px = meta!.input.px;
    const chips = [
      flatChip(64, 0.6, [84, 128, 54]),     // a green plant-coloured square
      flatChip(64, 0.6, [148, 116, 88]),    // bare soil
      flatChip(32, 0.3, [104, 140, 62]),    // a smaller, paler green
    ];
    const inputs = chips.map(c => chipToInput(c, objectSpanM(0.15, meta!.input.span_rule), px));
    const tensor = new ort.Tensor("float32", batchInputs(inputs, px), [chips.length, 3, px, px]);
    const out = await session.run({ chips: tensor });
    const logits = out.logits.data as Float32Array;
    expect(logits.length).toBe(chips.length * meta!.classes.length);
    for (const v of logits) expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < chips.length; i++) {
      const p = softmax(Array.from(logits.subarray(i * 3, i * 3 + 3)));
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    }
    // Deterministic: the same chip twice gives the same logits.
    const again = await session.run({ chips: tensor });
    expect(Array.from(again.logits.data as Float32Array)).toEqual(Array.from(logits));
  }, 60_000);
});
