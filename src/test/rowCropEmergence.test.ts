// The emergence variant of the continuous-row reader (src/lib/rowCrop/emergence.ts) on a rendered just-planted
// field: bare soil, a seedling every 16 cm on rows 76 cm apart, the rows bent by a barrel lens, a grass verge down one
// side and a few weeds between the rows. The rows must come back on the planted lines across the whole frame, the
// verge left out, the weeds found off the rows, and the stand counted close to what was planted.
import { describe, expect, it } from "vitest";
import { readRowCrop, rowCropOverlay } from "@/lib/rowCrop/readRowCrop";
import { seedlingMask } from "@/lib/rowCrop/seedlingGreen";

const W = 1600, H = 1200, GSD = 0.01, PITCH = 76, K1 = 0.06, ANGLE = (88 * Math.PI) / 180;
const cx = (W - 1) / 2, cy = (H - 1) / 2, R = Math.max(W, H) / 2;
/** Where a straight-world point lands through the lens (inverse of the reader's radial model). */
const lens = (x: number, y: number): [number, number] => {
  let px = x, py = y;
  for (let i = 0; i < 8; i++) { const ux = (px - cx) / R, uy = (py - cy) / R, g = 1 + K1 * (ux * ux + uy * uy); px = cx + (x - cx) / g; py = cy + (y - cy) / g; }
  return [px, py];
};

function render(opts: { verge: boolean; seedlings: boolean }) {
  let s = 11;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const n = (rnd() - 0.5) * 24; rgba[i * 4] = 128 + n; rgba[i * 4 + 1] = 108 + n; rgba[i * 4 + 2] = 88 + n; rgba[i * 4 + 3] = 255; }
  const blob = (x: number, y: number, rx: number, ry: number) => {
    for (let yy = Math.floor(y - ry); yy <= y + ry; yy++) for (let xx = Math.floor(x - rx); xx <= x + rx; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || ((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2 > 1) continue;
      const o = (yy * W + xx) * 4; rgba[o] = 70; rgba[o + 1] = 150; rgba[o + 2] = 55;
    }
  };
  const dx = Math.cos(ANGLE), dy = Math.sin(ANGLE), nx = -Math.sin(ANGLE), ny = Math.cos(ANGLE);
  const vergeX = opts.verge ? 220 : -1;
  const rows: number[] = [];
  let planted = 0;
  // Rows as straight world lines across the frame centre at multiples of the pitch.
  for (let k = -14; k <= 14; k++) {
    const sOff = k * PITCH + 20;
    rows.push(sOff);
    for (let t = -1000; t <= 1000; t += 16) {
      const wx = cx + t * dx + sOff * nx + (rnd() - 0.5) * 2, wy = cy + t * dy + sOff * ny + (rnd() - 0.5) * 2;
      const [x, y] = lens(wx, wy);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || x < vergeX + 10) continue;
      if (!opts.seedlings || rnd() < 0.08) continue; // about 8 % never emerged
      blob(x, y, 2.5, 1.5); planted++;
    }
  }
  if (opts.verge) for (let y = 0; y < H; y++) for (let x = 0; x <= vergeX; x++) { const o = (y * W + x) * 4, n = (rnd() - 0.5) * 40; rgba[o] = 60 + n; rgba[o + 1] = 140 + n; rgba[o + 2] = 50 + n; }
  // Weeds: larger blobs midway between rows.
  const weeds: [number, number][] = [];
  for (const [t, k] of [[-300, 2], [150, -5], [420, -7], [-50, -9]]) {
    const sOff = k * PITCH + 20 + PITCH / 2, [x, y] = lens(cx + t * dx + sOff * nx, cy + t * dy + sOff * ny);
    blob(x, y, 5, 5); weeds.push([x, y]);
  }
  return { px: { width: W, height: H, rgba }, rows, planted, weeds, lensAt: lens, dir: { dx, dy, nx, ny } };
}

describe("corn at emergence: seedlings as points, rows the lines they stand on", () => {
  it("reads every planted row across a bent frame, leaves the verge out and finds the weeds", () => {
    const sc = render({ verge: true, seedlings: true });
    const read = readRowCrop(sc.px, { stage: "emergence", gsdM: GSD });
    expect(read.stage).toBe("emergence");
    expect(read.pitchM).toBeCloseTo(0.76, 1);
    // Every drawn row point within 3 cm of a planted line (through the lens).
    const { nx, ny } = sc.dir;
    let worst = 0;
    for (const row of read.rows) for (const [x, y] of row.points) {
      // Straighten the drawn point and measure its distance to the nearest planted line.
      const ux = (x - cx) / R, uy = (y - cy) / R, g = 1 + K1 * (ux * ux + uy * uy), wx = cx + (x - cx) * g, wy = cy + (y - cy) * g;
      const sAcross = (wx - cx) * nx + (wy - cy) * ny;
      worst = Math.max(worst, Math.min(...sc.rows.map(r => Math.abs(sAcross - r))));
    }
    expect(worst * GSD).toBeLessThan(0.03);
    // The rows that stand clear of the verge are all there (the verge takes about four).
    expect(read.rows.length).toBeGreaterThanOrEqual(17);
    expect(read.excluded.length).toBeGreaterThan(0);
    // The stand within 10 % of what emerged.
    expect(Math.abs((read.summary.plants ?? 0) / sc.planted - 1)).toBeLessThan(0.1);
    // Each planted weed is found off the rows.
    for (const [x, y] of sc.weeds) expect(read.weeds.some(w => Math.hypot(w.x - x, w.y - y) < 8), `weed at ${x.toFixed(0)}, ${y.toFixed(0)}`).toBe(true);
    expect(rowCropOverlay(read).plants.length).toBe(read.summary.plants);
  });

  it("refuses bare soil with the reason", () => {
    const read = readRowCrop(render({ verge: false, seedlings: false }).px, { stage: "emergence", gsdM: GSD });
    expect(read.rows).toHaveLength(0);
    expect(read.notes.join(" ")).toMatch(/no seedlings|no rows of seedlings/);
  });

  it("finds a pale sunlit leaf, lighter than the soil and only a little greener, and nothing on bare soil", () => {
    const w = 200, h = 120, rgba = new Uint8ClampedArray(w * h * 4);
    let sd = 5; const rnd = () => ((sd = (Math.imul(sd, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < w * h; i++) { const n = (rnd() - 0.5) * 16; rgba[i * 4] = 140 + n; rgba[i * 4 + 1] = 122 + n; rgba[i * 4 + 2] = 104 + n; rgba[i * 4 + 3] = 255; }
    // A pale leaf: much lighter than the soil, only a little greener (tint G - (R+B)/2 of about +22 against the soil's -0).
    const leaf: number[] = [];
    for (let y = 58; y <= 62; y++) for (let x = 60; x <= 90; x++) { const o = (y * w + x) * 4; rgba[o] = 178; rgba[o + 1] = 200; rgba[o + 2] = 150; leaf.push(y * w + x); }
    const fresh = seedlingMask({ width: w, height: h, rgba });
    const share = (m: Uint8Array) => leaf.filter(i => m[i]).length / leaf.length;
    expect(share(fresh)).toBeGreaterThan(0.9);
    let soil = 0; for (let i = 0; i < w * h; i++) if (fresh[i] && !leaf.includes(i)) soil++;
    expect(soil / (w * h)).toBeLessThan(0.002);
  });
});
