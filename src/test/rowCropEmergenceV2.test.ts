// Emergence V2 on a rendered just-planted field (2026-11-02): straight rows 76 cm apart, a seedling every 16 cm. Some
// plants are drawn pale (lighter than the soil, a faint tint: the strict test misses them, the relaxed one does not),
// some positions are left empty (real skips). The second look along the rows must call the pale ones possible
// seedlings, the empty ones missing, never invent a plant in an alley, and leave V1's rows and plants untouched.
import { describe, expect, it } from "vitest";
import { EMERGENCE } from "@/lib/rowCrop/emergence";
import { readRowCrop, rowCropOverlay } from "@/lib/rowCrop/readRowCrop";

// The emergence test's geometry: 1 cm pixels on a 1600 px frame (the reader's seedling size cap is a share of the frame).
const W = 1600, H = 1200, GSD = 0.01, PITCH = 76, ALONG = 16;

function render(opts: { paleEvery: number; skipEvery: number; later: boolean }) {
  let sd = 3;
  const rnd = () => ((sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const n = (rnd() - 0.5) * 14; rgba[i * 4] = 132 + n; rgba[i * 4 + 1] = 114 + n; rgba[i * 4 + 2] = 96 + n; rgba[i * 4 + 3] = 255; }
  const blob = (x: number, y: number, rx: number, ry: number, col: [number, number, number]) => {
    for (let yy = Math.floor(y - ry); yy <= y + ry; yy++) for (let xx = Math.floor(x - rx); xx <= x + rx; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || ((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2 > 1) continue;
      const o = (yy * W + xx) * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2];
    }
  };
  const pale: [number, number][] = [], skipped: [number, number][] = [];
  const rowsX: number[] = [];
  const fieldW = opts.later ? 1000 : W;
  let k = 0;
  for (let x = 40; x < fieldW - 20; x += PITCH) {
    rowsX.push(x);
    for (let y = 10, j = 0; y < H - 10; y += ALONG, j++) {
      k++;
      if (j > 2 && k % opts.skipEvery === 0) { skipped.push([x, y]); continue; }
      if (j > 2 && k % opts.paleEvery === 0) { blob(x, y, 1.6, 2.5, [168, 170, 138]); pale.push([x, y]); continue; } // lighter, faint tint
      blob(x, y, 1.5, 2.5, [70, 150, 55]);
    }
  }
  // A later planting beyond the field: faint specks on its own lines, 76 cm apart.
  if (opts.later) for (let x = 1100; x < W - 20; x += PITCH) for (let y = 15; y < H - 15; y += ALONG) if (rnd() < 0.7) blob(x + (rnd() - 0.5) * 1, y, 1.6, 2.5, [160, 168, 132]);
  return { px: { width: W, height: H, rgba }, pale, skipped, rowsX };
}

const near = (pts: [number, number][], [x, y]: [number, number], r: number) => pts.some(([a, b]) => Math.hypot(a - x, b - y) <= r);

describe("emergence V2: the second look along the rows", () => {
  const sc = render({ paleEvery: 9, skipEvery: 13, later: false });
  const read = readRowCrop(sc.px, { stage: "emergence", gsdM: GSD });
  const o = rowCropOverlay(read);

  it("reads every planted row and keeps V1's rows", () => {
    expect(read.rows.length).toBe(sc.rowsX.length);
    const saved = { ...EMERGENCE };
    Object.assign(EMERGENCE, { recover: false, extraPlantings: false });
    const v1 = readRowCrop(sc.px, { stage: "emergence", gsdM: GSD });
    Object.assign(EMERGENCE, saved);
    expect(v1.rows.length).toBe(read.rows.length);
    expect(read.emergence!.gapsBefore).toBe(v1.summary.gaps);
  });

  it("calls most pale seedlings possible, and most skips missing", () => {
    const found = sc.pale.filter(p => near(o.possible, p, 5) || near(o.plants, p, 5)).length;
    expect(found / sc.pale.length).toBeGreaterThanOrEqual(0.7);
    const missing = sc.skipped.filter(p => near(o.missing, p, 5)).length;
    expect(missing / sc.skipped.length).toBeGreaterThanOrEqual(0.7);
    // A skip is never called a plant.
    for (const p of sc.skipped) expect(near(o.possible, p, 3)).toBe(false);
  });

  it("finds nothing in the alleys (the control) and never more gaps than V1", () => {
    expect(read.emergence!.controlRate ?? 0).toBeLessThan(0.05);
    expect(read.summary.gaps).toBeLessThanOrEqual(read.emergence!.gapsBefore);
    expect(rowCropOverlay(read).plants.length).toBe(read.summary.plants);
  });

  it("sets a later planting apart instead of calling it weeds", () => {
    const sc2 = render({ paleEvery: 1000, skipEvery: 1000, later: true });
    const r2 = readRowCrop(sc2.px, { stage: "emergence", gsdM: GSD });
    expect(r2.emergence!.laterPlanting).not.toBeNull();
    expect(r2.excluded.some(e => /later planting/.test(e.reason))).toBe(true);
    expect(r2.weeds.filter(w => w.x > 1060).length).toBeLessThanOrEqual(3);
  });
});
