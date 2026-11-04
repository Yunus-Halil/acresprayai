// The corn check's two effects on a corn read, from a class probability map (seg_train.py predict --save-prob:
// R corn, G weed, B background, 0-255): clearing a weed candidate whose plant pixels the model calls corn, and adding
// the patches the model calls weed that no candidate covers (in-row weeds the position rules call corn). Used by the
// benches only; nothing here is wired into the app.

export type ProbMap = { data: Uint8Array; width: number; height: number };

const inHull = (hull: [number, number][], x: number, y: number): boolean => { let c = false; for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) { const [xi, yi] = hull[i], [xj, yj] = hull[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

/** Corn share of the plant pixels in a hull: mean corn / (corn + weed) over grid samples inside the hull where
 * corn + weed is at least half (soil inside a convex hull says nothing about the plant). Null with no plant pixels. */
export function cornShareInHull(p: ProbMap, hull: [number, number][]): number | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of hull) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 10)); let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(p.height - 1, y1); y += step) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(p.width - 1, x1); x += step) {
    if (hull.length >= 3 && !inHull(hull, x, y)) continue;
    const o = (Math.floor(y) * p.width + Math.floor(x)) * 4, c = p.data[o], w = p.data[o + 1];
    if (c + w < 128) continue;
    s += c / (c + w); n++;
  }
  return n ? s / n : null;
}

export type ModelWeed = { x: number; y: number; areaPx: number; x0: number; y0: number; x1: number; y1: number };

/**
 * Patches the model calls weed: pixels where weed > corn, weed > background and weed >= `minProb`, joined on a grid of
 * `step` pixels (8-neighbour), at least `minAreaPx` photo pixels. Centre, area and bounding box in photo pixels.
 */
export function modelWeeds(p: ProbMap, minAreaPx: number, minProb = 0.5, step = 2): ModelWeed[] {
  const gw = Math.ceil(p.width / step), gh = Math.ceil(p.height / step), on = new Uint8Array(gw * gh), t = Math.round(minProb * 255);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const o = (Math.min(p.height - 1, gy * step) * p.width + Math.min(p.width - 1, gx * step)) * 4, c = p.data[o], w = p.data[o + 1], b = p.data[o + 2];
    if (w >= t && w > c && w > b) on[gy * gw + gx] = 1;
  }
  const seen = new Uint8Array(gw * gh), stack: number[] = [], out: ModelWeed[] = [];
  for (let i0 = 0; i0 < gw * gh; i0++) {
    if (!on[i0] || seen[i0]) continue;
    seen[i0] = 1; stack.push(i0);
    let n = 0, sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    while (stack.length) {
      const i = stack.pop()!, x = i % gw, y = (i - x) / gw; n++; sx += x; sy += y; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const j = yy * gw + xx; if (on[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
    }
    const areaPx = n * step * step;
    if (areaPx >= minAreaPx) out.push({ x: (sx / n) * step, y: (sy / n) * step, areaPx, x0: x0 * step, y0: y0 * step, x1: (x1 + 1) * step, y1: (y1 + 1) * step });
  }
  return out;
}

/** Whether a model weed is already covered by a candidate (its centre inside the candidate's hull or bounding box). */
export function coveredBy(m: ModelWeed, hulls: [number, number][][]): boolean {
  return hulls.some(h => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of h) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return (m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1) || (h.length >= 3 && inHull(h, m.x, m.y));
  });
}
