// The drawn corn plant of the Realistic and Simple views, and the soil of the Realistic view (cornRender.ts says what
// is measured and what is drawn). A plant is drawn once per (size, colour, shape, direction) into a small canvas and
// stamped from there: the map never draws a leaf per frame.
import { CORN_RENDER, type ColourGrid, type Leaf, leavesFor, mixRgb, rgbCss } from "@/lib/fieldTwin/cornRender";
import type { TwinRgb } from "@/lib/fieldTwin/types";

type Ctx = CanvasRenderingContext2D;

/** One leaf from the plant's centre along +x: pointed, widest a third of the way out, its tip bent sideways. */
function leafPath(ctx: Ctx, l: Leaf, r: number) {
  const L = l.length * r, w = l.width * r, c = l.curl * r;
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(0.22 * L, -1.25 * w, 0.68 * L, -0.85 * w + 0.5 * c, L, c);
  ctx.bezierCurveTo(0.68 * L, 0.85 * w + 0.5 * c, 0.22 * L, 1.25 * w, 0, 0);
}

/**
 * A corn plant seen from above, centred in a square canvas of `px` pixels. `shade`: with a soft shadow, a lighter
 * midrib and a darker heart (Realistic); without, one flat colour (Simple).
 */
export function cornSprite(px: number, colour: TwinRgb, sizeM: number, variant: number, rotation: number, shade: boolean): HTMLCanvasElement | null {
  try {
    const c = document.createElement("canvas"); c.width = c.height = px;
    const ctx = c.getContext("2d"); if (!ctx) return null;
    const r = px * 0.44, leaves = leavesFor(sizeM, variant), turn = (rotation / CORN_RENDER.rotations) * 2 * Math.PI;
    ctx.translate(px / 2, px / 2);
    const each = (fn: (l: Leaf) => void) => { for (const l of leaves) { ctx.save(); ctx.rotate(turn + l.angle); fn(l); ctx.restore(); } };
    if (shade) {
      // The shadow: the same leaves, dark, a little down and right of the plant.
      ctx.save(); ctx.translate(px * 0.035, px * 0.045); ctx.fillStyle = "rgba(0,0,0,0.2)";
      each(l => { ctx.beginPath(); leafPath(ctx, l, r); ctx.fill(); });
      ctx.restore();
    }
    const dark = mixRgb(colour, [0, 0, 0], 0.14), light = mixRgb(colour, [255, 255, 255], 0.22);
    each(l => {
      ctx.beginPath(); leafPath(ctx, l, r);
      if (shade) { const g = ctx.createLinearGradient(0, 0, l.length * r, 0); g.addColorStop(0, rgbCss(dark)); g.addColorStop(0.45, rgbCss(colour)); g.addColorStop(1, rgbCss(light)); ctx.fillStyle = g; }
      else ctx.fillStyle = rgbCss(colour);
      ctx.fill();
      if (shade && px >= 20) {
        ctx.beginPath(); ctx.moveTo(0.06 * l.length * r, 0); ctx.quadraticCurveTo(0.6 * l.length * r, 0.3 * l.curl * r, 0.94 * l.length * r, 0.92 * l.curl * r);
        ctx.strokeStyle = rgbCss(light, 0.7); ctx.lineWidth = Math.max(0.6, px * 0.018); ctx.stroke();
      }
    });
    if (shade) { ctx.beginPath(); ctx.arc(0, 0, Math.max(0.8, r * 0.1), 0, 2 * Math.PI); ctx.fillStyle = rgbCss(mixRgb(colour, [0, 0, 0], 0.3)); ctx.fill(); }
    return c;
  } catch { return null; }
}

/** The sprites drawn so far, by what they show; emptied when it grows past a few hundred (a zoom changes every size). */
export class SpriteCache {
  private map = new Map<string, HTMLCanvasElement | null>();
  get(px: number, colour: TwinRgb, sizeM: number, variant: number, rotation: number, shade: boolean): HTMLCanvasElement | null {
    const key = `${px}|${colour[0]},${colour[1]},${colour[2]}|${variant}|${rotation}|${shade ? 1 : 0}|${sizeM < 0.08 ? 0 : sizeM < 0.2 ? 1 : 2}`;
    let s = this.map.get(key);
    if (s === undefined) { if (this.map.size > 900) this.map.clear(); s = cornSprite(px, colour, sizeM, variant, rotation, shade); this.map.set(key, s); }
    return s;
  }
  clear() { this.map.clear(); }
}

/** The sprite size (canvas pixels) for a plant drawn `drawPx` device pixels across: the next power of two, 16 to 256. */
export function spriteSizeFor(drawPx: number): number {
  let s = 16;
  while (s < drawPx && s < 256) s *= 2;
  return s;
}

/** mulberry32: a small seeded generator, so the soil's grain is the same on every visit. */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The Realistic view's ground as one canvas over the twin's box: the soil colour grid scaled up smoothly, a little
 * grain over it (so it reads as soil, not a gradient; the grain is drawn, not measured), and transparent wherever no
 * photograph reached (`mask` fills the photographed ground in the canvas's own pixels). Built once per twin.
 */
export function soilCanvas(grid: ColourGrid, longSide: number, seed: number, mask: (ctx: Ctx, width: number, height: number) => void): HTMLCanvasElement | null {
  try {
    const aspect = (grid.width * grid.cellX) / (grid.height * grid.cellY);
    const W = Math.max(8, Math.round(aspect >= 1 ? longSide : longSide * aspect)), H = Math.max(8, Math.round(aspect >= 1 ? longSide / aspect : longSide));
    const small = document.createElement("canvas"); small.width = grid.width; small.height = grid.height;
    const sg = small.getContext("2d"); if (!sg) return null;
    const img = sg.createImageData(grid.width, grid.height);
    for (let k = 0; k < grid.width * grid.height; k++) { img.data[4 * k] = grid.rgb[3 * k]; img.data[4 * k + 1] = grid.rgb[3 * k + 1]; img.data[4 * k + 2] = grid.rgb[3 * k + 2]; img.data[4 * k + 3] = 255; }
    sg.putImageData(img, 0, 0);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); if (!g) return null;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    // Drawn half a cell wider each way, so the cell centres (where the colours are) sit where they belong.
    g.drawImage(small, 0, 0, W, H);
    // Grain: blotches a few pixels across and a finer speckle, a few levels either way.
    const out = g.getImageData(0, 0, W, H), d = out.data, rnd = seeded(seed);
    const bw = Math.ceil(W / 6) + 2, bh = Math.ceil(H / 6) + 2, blot = new Float32Array(bw * bh);
    for (let k = 0; k < blot.length; k++) blot[k] = rnd() - 0.5;
    for (let y = 0; y < H; y++) {
      const fy = y / 6, y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = x / 6, x0 = Math.floor(fx), tx = fx - x0;
        const b = (blot[y0 * bw + x0] * (1 - tx) + blot[y0 * bw + x0 + 1] * tx) * (1 - ty) + (blot[(y0 + 1) * bw + x0] * (1 - tx) + blot[(y0 + 1) * bw + x0 + 1] * tx) * ty;
        const v = b * 9 + (rnd() - 0.5) * 6, k = 4 * (y * W + x);
        d[k] += v; d[k + 1] += v * 0.95; d[k + 2] += v * 0.85;
      }
    }
    g.putImageData(out, 0, 0);
    // Keep the soil only where a photograph saw the ground.
    const m = document.createElement("canvas"); m.width = W; m.height = H;
    const mg = m.getContext("2d"); if (!mg) return null;
    mg.fillStyle = "#000"; mask(mg, W, H);
    g.globalCompositeOperation = "destination-in"; g.drawImage(m, 0, 0); g.globalCompositeOperation = "source-over";
    return c;
  } catch { return null; }
}
