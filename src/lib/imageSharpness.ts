// How sharp an image really is: the median 10-90% rise width, in pixels, of its strongest edges (leaf against soil),
// sampled across each edge along its gradient. A sharp, well-sampled image reads about 1.2-1.5 px; blur widens it
// (a Gaussian blur of sigma s gives about 2.56 s). Multiplied by the image's ground pixel it is the edge width on the
// ground, which compares a photograph, an orthophoto and a map tile of the same field on one scale.
//
// Measured with it on the first corn field (2026-10-24, docs/research/orthomosaic-resolution-audit-2026-10-24.md):
// the photographs 2.0 px (2.14 cm), the same ground at the zoom-23 tile pixel 3.21 cm, at zoom 24 2.01 cm. A
// measurement, never a sharpening: nothing here changes a pixel.

/** One channel, row-major. */
export type Gray = { width: number; height: number; data: Float32Array };

export function grayFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  // Green carries most of the detail of a Bayer sensor and the most contrast between leaf and soil.
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 1];
  return { width, height, data };
}

function blur(g: Gray, sigma: number): Gray {
  const r = Math.ceil(3 * sigma), k: number[] = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const { width: w, height: h } = g, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const clamp = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * g.data[y * w + clamp(x + i, w)];
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * tmp[clamp(y + i, h) * w + x];
    out[y * w + x] = a;
  }
  return { width: w, height: h, data: out };
}

function bilinear(g: Gray, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, w = g.width;
  const at = (xx: number, yy: number) => g.data[yy * w + xx];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * The median 10-90% edge width in pixels over the strongest edges, and how many edges it rests on; null with too few.
 * `top` is the share of the image's pixels taken as edge peaks; `minStep` the smallest step (in grey levels) counted
 * as an edge rather than texture.
 */
export function edgeWidthPx(g: Gray, opts: { top?: number; half?: number; step?: number; minStep?: number } = {}): { widthPx: number; edges: number } | null {
  const top = opts.top ?? 0.004, half = opts.half ?? 6, step = opts.step ?? 0.25, minStep = opts.minStep ?? 20;
  const { width: w, height: h } = g, s = blur(g, 0.6);
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  const m = 2 * half + 2;
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
    const p = (dx: number, dy: number) => s.data[(y + dy) * w + x + dx];
    const ax = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
    const ay = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
    gx[y * w + x] = ax; gy[y * w + x] = ay; mag[y * w + x] = Math.hypot(ax, ay);
  }
  // Local maxima of the gradient magnitude (5 x 5), then the strongest of them.
  const peaks: number[] = [];
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
    const v = mag[y * w + x];
    if (v <= 0) continue;
    let max = true;
    for (let dy = -2; dy <= 2 && max; dy++) for (let dx = -2; dx <= 2; dx++) if (mag[(y + dy) * w + x + dx] > v) { max = false; break; }
    if (max) peaks.push(y * w + x);
  }
  if (!peaks.length) return null;
  const want = Math.max(1, Math.round(top * w * h));
  peaks.sort((a, b) => mag[b] - mag[a]);
  const chosen = peaks.slice(0, Math.min(peaks.length, want));
  const n = Math.round((2 * half) / step) + 1, widths: number[] = [];
  const prof = new Float64Array(n);
  for (const i of chosen) {
    const x = i % w, y = (i - x) / w, len = mag[i], ux = gx[i] / len, uy = gy[i] / len;
    for (let k = 0; k < n; k++) { const t = -half + k * step; prof[k] = bilinear(g, x + ux * t, y + uy * t); }
    let lo = 0, hi = 0;
    for (let k = 0; k < 4; k++) { lo += prof[k]; hi += prof[n - 1 - k]; }
    lo /= 4; hi /= 4;
    const span = hi - lo;
    if (span <= minStep) continue;
    // A monotone envelope so a wiggle does not break the crossing search.
    let run = -Infinity, i10 = -1, i90 = -1;
    for (let k = 0; k < n; k++) {
      run = Math.max(run, (prof[k] - lo) / span);
      if (i10 < 0 && run >= 0.1) i10 = k;
      if (i90 < 0 && run >= 0.9) { i90 = k; break; }
    }
    if (i10 > 0 && i90 > 0) widths.push((i90 - i10) * step);
  }
  if (widths.length < 20) return null;
  widths.sort((a, b) => a - b);
  return { widthPx: widths[Math.floor(widths.length / 2)], edges: widths.length };
}
