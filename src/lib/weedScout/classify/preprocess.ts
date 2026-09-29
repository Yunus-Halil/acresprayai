// From a chip to the model's input, by the same rule the trainer used.
//
// The trainer cut every example at `objectSpanM(diameter)` of ground around
// the object and resized it to `px` on a side. The scout's chips are rendered
// at least that wide (chipSpanM is 4x the diameter or more), so the model's
// input is the centre of the chip, cropped to the object span, box-filtered
// down to `px`, as RGB planes in [0, 1]. ImageNet normalisation lives inside
// the graph, so this is the whole of the client's preprocessing, and it is a
// pure function so it can be tested without a browser.
//
// If this and offrow/learn/examples.py disagree, the model is being shown
// something it was never trained on and every probability is quietly wrong.
// The constants are copied, not shared, because one is Python and one is
// TypeScript; the test pins them.

import type { SpanRule } from "./types";

/** Mirror of offrow.learn.examples: SPAN_PER_DIAMETER, MIN_SPAN_M, MAX_SPAN_M. */
export const DEFAULT_SPAN_RULE: SpanRule = { per_diameter: 4.0, min_m: 0.24, max_m: 1.2 };
/** Mirror of DEFAULT_NEGATIVE_DIAMETER_M: the framing used when no diameter is known. */
export const DEFAULT_DIAMETER_M = 0.15;

export function objectSpanM(diameterM: number | null | undefined, rule: SpanRule = DEFAULT_SPAN_RULE): number {
  const d = diameterM && diameterM > 0 ? diameterM : DEFAULT_DIAMETER_M;
  return Math.min(rule.max_m, Math.max(rule.min_m, rule.per_diameter * d));
}

export type ChipPixels = {
  /** RGBA, row-major, `width * height * 4` bytes. */
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  /** Ground metres across the chip's longer side. */
  spanM: number;
};

/**
 * Crop the centre of the chip to `objectSpan` metres and box-filter it to
 * `px` x `px`. Returns CHW float planes in [0, 1].
 *
 * The crop is a square of ground; a chip whose pixels are not square in
 * ground terms does not exist (the renderer makes them square), so the crop
 * side in pixels is one number.
 */
export function chipToInput(chip: ChipPixels, objectSpan: number, px: number): Float32Array {
  const { rgba, width, height, spanM } = chip;
  const gsd = spanM / Math.max(width, height);
  const cropPx = Math.max(1, Math.min(Math.min(width, height), Math.round(objectSpan / gsd)));
  const x0 = Math.floor((width - cropPx) / 2);
  const y0 = Math.floor((height - cropPx) / 2);
  const out = new Float32Array(3 * px * px);
  const plane = px * px;
  const scale = cropPx / px;
  for (let oy = 0; oy < px; oy++) {
    const sy0 = y0 + Math.floor(oy * scale);
    const sy1 = y0 + Math.max(sy0 - y0 + 1, Math.floor((oy + 1) * scale));
    for (let ox = 0; ox < px; ox++) {
      const sx0 = x0 + Math.floor(ox * scale);
      const sx1 = x0 + Math.max(sx0 - x0 + 1, Math.floor((ox + 1) * scale));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = sy0; y < sy1 && y < y0 + cropPx; y++) {
        let i = (y * width + sx0) * 4;
        for (let x = sx0; x < sx1 && x < x0 + cropPx; x++) {
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2];
          n++;
          i += 4;
        }
      }
      const o = oy * px + ox;
      const inv = n ? 1 / (255 * n) : 0;
      out[o] = r * inv;
      out[plane + o] = g * inv;
      out[2 * plane + o] = b * inv;
    }
  }
  return out;
}

/** Concatenate inputs into one NCHW buffer for a batched session run. */
export function batchInputs(inputs: Float32Array[], px: number): Float32Array {
  const stride = 3 * px * px;
  const out = new Float32Array(inputs.length * stride);
  inputs.forEach((t, i) => out.set(t, i * stride));
  return out;
}

export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps: number[] = [];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { const e = Math.exp(logits[i] - max); exps.push(e); sum += e; }
  return exps.map(e => e / sum);
}

/**
 * Browser only: decode a chip data URL into pixels. Returns null when the
 * image cannot be decoded or there is no document to draw into.
 */
export async function dataUrlToPixels(dataUrl: string, spanM: number): Promise<ChipPixels | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = new Image();
  const loaded = new Promise<boolean>(resolve => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  img.src = dataUrl;
  if (!(await loaded) || !img.naturalWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: data.data, width: canvas.width, height: canvas.height, spanM };
}
